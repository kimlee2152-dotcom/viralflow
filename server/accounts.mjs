import crypto from 'node:crypto'
import path from 'node:path'
import { promisify } from 'node:util'
import { config } from './config.mjs'
import { readSecureJson, writeSecureJson } from './secure-storage.mjs'

const scrypt = promisify(crypto.scrypt)
const accountsFile = () => path.join(config.dataDir, 'accounts.json')
const sessionsFile = () => path.join(config.dataDir, 'sessions.json')
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000
const scryptOptions = { N: 65536, r: 8, p: 2, maxmem: 128 * 1024 * 1024 }
const commonPasswords = new Set(['password', 'password123', '1234567890', 'qwerty12345', 'admin123456', 'letmein123'])
let writeQueue = Promise.resolve()

function serialized(task) {
  const result = writeQueue.then(task, task)
  writeQueue = result.catch(() => {})
  return result
}

function publicUser(account) {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    role: account.role || 'customer',
    status: account.status || 'active',
    createdAt: account.createdAt,
    updatedAt: account.updatedAt || account.createdAt,
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function validateRegistration({ email, name, password }) {
  const normalizedEmail = normalizeEmail(email)
  const normalizedName = String(name || '').trim().replace(/\s+/g, ' ')
  const secret = String(password || '')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
    throw Object.assign(new Error('请输入有效的邮箱地址。'), { status: 400, code: 'INVALID_EMAIL' })
  }
  if (normalizedName.length < 2 || normalizedName.length > 60) {
    throw Object.assign(new Error('姓名长度需要在 2 到 60 个字符之间。'), { status: 400, code: 'INVALID_NAME' })
  }
  if (secret.length < 10 || secret.length > 128) {
    throw Object.assign(new Error('密码长度需要在 10 到 128 个字符之间。'), { status: 400, code: 'WEAK_PASSWORD' })
  }
  if (commonPasswords.has(secret.toLowerCase()) || secret.toLowerCase().includes(normalizedEmail.split('@')[0])) {
    throw Object.assign(new Error('这个密码太容易被猜到，请换一个更安全的密码。'), { status: 400, code: 'WEAK_PASSWORD' })
  }
  return { email: normalizedEmail, name: normalizedName, password: secret }
}

async function passwordHash(password) {
  const salt = crypto.randomBytes(16)
  const derived = await scrypt(password, salt, 64, scryptOptions)
  return `scrypt$${scryptOptions.N}$${scryptOptions.r}$${scryptOptions.p}$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

async function verifyPassword(password, stored) {
  const [algorithm, n, r, p, salt, expected] = String(stored || '').split('$')
  if (algorithm !== 'scrypt' || !salt || !expected) return false
  const expectedBuffer = Buffer.from(expected, 'base64url')
  const actual = await scrypt(String(password || ''), Buffer.from(salt, 'base64url'), expectedBuffer.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * 1024 * 1024,
  })
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer)
}

export async function registerAccount(input) {
  const validated = validateRegistration(input || {})
  return serialized(async () => {
    const accounts = await readSecureJson(accountsFile(), [])
    if (accounts.some((account) => account.email === validated.email)) {
      throw Object.assign(new Error('这个邮箱已经注册，请直接登录。'), { status: 409, code: 'ACCOUNT_EXISTS' })
    }
    const account = {
      id: crypto.randomUUID(),
      email: validated.email,
      name: validated.name,
      role: 'customer',
      status: 'active',
      passwordHash: await passwordHash(validated.password),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await writeSecureJson(accountsFile(), [account, ...accounts].slice(0, 10000))
    return publicUser(account)
  })
}

export async function authenticateAccount(email, password) {
  const normalizedEmail = normalizeEmail(email)
  const accounts = await readSecureJson(accountsFile(), [])
  const account = accounts.find((item) => item.email === normalizedEmail)
  if (!account) {
    await scrypt(String(password || ''), Buffer.from('ViralFlowUnknownUser'), 64, scryptOptions)
    return null
  }
  if (account.status === 'suspended') {
    await verifyPassword(password, account.passwordHash)
    return null
  }
  return await verifyPassword(password, account.passwordHash) ? publicUser(account) : null
}

export async function updateAccountProfile(userId, input) {
  const name = String(input?.name || '').trim().replace(/\s+/g, ' ')
  if (name.length < 2 || name.length > 60) {
    throw Object.assign(new Error('姓名长度需要在 2 到 60 个字符之间。'), { status: 400, code: 'INVALID_NAME' })
  }
  return serialized(async () => {
    const accounts = await readSecureJson(accountsFile(), [])
    const index = accounts.findIndex((account) => account.id === userId)
    if (index < 0) throw Object.assign(new Error('账户不存在。'), { status: 404, code: 'ACCOUNT_NOT_FOUND' })
    accounts[index] = { ...accounts[index], name, updatedAt: new Date().toISOString() }
    await writeSecureJson(accountsFile(), accounts)
    return publicUser(accounts[index])
  })
}

export async function changeAccountPassword(userId, currentPassword, nextPassword) {
  return serialized(async () => {
    const accounts = await readSecureJson(accountsFile(), [])
    const index = accounts.findIndex((account) => account.id === userId)
    if (index < 0) throw Object.assign(new Error('账户不存在。'), { status: 404, code: 'ACCOUNT_NOT_FOUND' })
    if (!await verifyPassword(currentPassword, accounts[index].passwordHash)) {
      throw Object.assign(new Error('当前密码不正确。'), { status: 401, code: 'INVALID_CURRENT_PASSWORD' })
    }
    const validated = validateRegistration({
      email: accounts[index].email,
      name: accounts[index].name,
      password: nextPassword,
    })
    accounts[index] = {
      ...accounts[index],
      passwordHash: await passwordHash(validated.password),
      updatedAt: new Date().toISOString(),
    }
    await writeSecureJson(accountsFile(), accounts)
    const sessions = await readSecureJson(sessionsFile(), [])
    await writeSecureJson(sessionsFile(), sessions.filter((session) => session.userId !== userId && session.expiresAt > Date.now()))
    return publicUser(accounts[index])
  })
}

export async function deleteAccount(userId, password) {
  return serialized(async () => {
    const accounts = await readSecureJson(accountsFile(), [])
    const account = accounts.find((item) => item.id === userId)
    if (!account) throw Object.assign(new Error('账户不存在。'), { status: 404, code: 'ACCOUNT_NOT_FOUND' })
    if (!await verifyPassword(password, account.passwordHash)) {
      throw Object.assign(new Error('密码不正确，账户未注销。'), { status: 401, code: 'INVALID_CURRENT_PASSWORD' })
    }
    await writeSecureJson(accountsFile(), accounts.filter((item) => item.id !== userId))
    const sessions = await readSecureJson(sessionsFile(), [])
    await writeSecureJson(sessionsFile(), sessions.filter((session) => session.userId !== userId && session.expiresAt > Date.now()))
    return true
  })
}

export async function listAccounts() {
  const accounts = await readSecureJson(accountsFile(), [])
  return accounts.map(publicUser).sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
}

export async function setAccountStatus(userId, status) {
  if (!['active', 'suspended'].includes(status)) {
    throw Object.assign(new Error('账户状态无效。'), { status: 400, code: 'INVALID_ACCOUNT_STATUS' })
  }
  return serialized(async () => {
    const accounts = await readSecureJson(accountsFile(), [])
    const index = accounts.findIndex((account) => account.id === userId)
    if (index < 0) throw Object.assign(new Error('账户不存在。'), { status: 404, code: 'ACCOUNT_NOT_FOUND' })
    accounts[index] = { ...accounts[index], status, updatedAt: new Date().toISOString() }
    await writeSecureJson(accountsFile(), accounts)
    if (status === 'suspended') {
      const sessions = await readSecureJson(sessionsFile(), [])
      await writeSecureJson(sessionsFile(), sessions.filter((session) => session.userId !== userId && session.expiresAt > Date.now()))
    }
    return publicUser(accounts[index])
  })
}

function sessionHash(token) {
  return crypto.createHash('sha256').update(token).digest('base64url')
}

export async function createAccountSession(user) {
  const token = crypto.randomBytes(32).toString('base64url')
  const now = Date.now()
  await serialized(async () => {
    const sessions = await readSecureJson(sessionsFile(), [])
    const active = sessions.filter((session) => session.expiresAt > now)
    active.push({ tokenHash: sessionHash(token), userId: user.id, expiresAt: now + sessionLifetimeMs, createdAt: new Date(now).toISOString() })
    await writeSecureJson(sessionsFile(), active.slice(-50000))
  })
  return { token, maxAgeSeconds: sessionLifetimeMs / 1000 }
}

export async function getSessionUser(token, adminUser) {
  if (!token) return null
  const now = Date.now()
  const sessions = await readSecureJson(sessionsFile(), [])
  const session = sessions.find((item) => item.tokenHash === sessionHash(token) && item.expiresAt > now)
  if (!session) return null
  if (session.userId === adminUser.id) return adminUser
  const accounts = await readSecureJson(accountsFile(), [])
  const account = accounts.find((item) => item.id === session.userId)
  return account && account.status !== 'suspended' ? publicUser(account) : null
}

export async function revokeAccountSession(token) {
  if (!token) return
  await serialized(async () => {
    const hash = sessionHash(token)
    const sessions = await readSecureJson(sessionsFile(), [])
    await writeSecureJson(sessionsFile(), sessions.filter((item) => item.tokenHash !== hash && item.expiresAt > Date.now()))
  })
}

export const accountInternals = { verifyPassword, passwordHash, sessionLifetimeMs }
