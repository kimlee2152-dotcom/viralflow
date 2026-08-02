import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.mjs'
import { authenticateAccount, changeAccountPassword, createAccountSession, getSessionUser, registerAccount, revokeAccountSession } from './accounts.mjs'

const auditFile = path.join(config.dataDir, 'audit', 'security.log')
const sessionCookie = 'viralflow_session'
const loginAttempts = new Map()
const registrationAttempts = new Map()
const adminUser = { id: 'admin', email: 'admin@viralflow.local', name: '管理员', role: 'admin' }

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''))
  const b = Buffer.from(String(right || ''))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))]
  }))
}

function clientKey(req) {
  return crypto.createHash('sha256').update(req.ip || req.socket.remoteAddress || 'unknown').digest('hex').slice(0, 16)
}

async function audit(event) {
  await fs.mkdir(path.dirname(auditFile), { recursive: true })
  await fs.appendFile(auditFile, `${JSON.stringify({ at:new Date().toISOString(), ...event })}\n`, { encoding:'utf8', mode:0o600 })
}

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  const developmentSocket = process.env.NODE_ENV === 'production' ? '' : ` ws://${req.headers.host} ws://127.0.0.1:*`
  res.setHeader('Content-Security-Policy', `default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'${developmentSocket}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`)
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store')
  next()
}

export async function requireAuthentication(req, res, next) {
  if (!config.security.authenticationRequired) {
    req.user = adminUser
    return next()
  }
  try {
    const user = await getSessionUser(parseCookies(req.headers.cookie)[sessionCookie], adminUser)
    if (user) {
      req.user = user
      return next()
    }
    res.status(401).json({ error:'请先登录。', code:'AUTH_REQUIRED' })
  } catch (error) { next(error) }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next()
  res.status(403).json({ error: '只有管理员可以执行这个操作。', code: 'ADMIN_REQUIRED' })
}

function setSessionCookie(res, session) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${sessionCookie}=${session.token}; Max-Age=${session.maxAgeSeconds}; Path=/; HttpOnly; SameSite=Strict${secure}`)
}

export async function login(req, res) {
  const key = clientKey(req)
  const current = loginAttempts.get(key) || { count:0, resetAt:Date.now() + 15 * 60 * 1000 }
  if (current.resetAt < Date.now()) Object.assign(current, { count:0, resetAt:Date.now() + 15 * 60 * 1000 })
  if (current.count >= 8) return res.status(429).json({ error:'登录尝试次数过多，请稍后再试。', code:'LOGIN_RATE_LIMIT' })
  const adminLogin = req.body?.admin === true
  const user = adminLogin
    ? (config.security.adminPassword && safeEqual(req.body?.password, config.security.adminPassword) ? adminUser : null)
    : await authenticateAccount(req.body?.email, req.body?.password)
  if (!user) {
    current.count += 1
    loginAttempts.set(key, current)
    await audit({ action:'login_failed', actor:key })
    return res.status(401).json({ error:'邮箱或密码不正确。', code:'INVALID_CREDENTIALS' })
  }
  loginAttempts.delete(key)
  const session = await createAccountSession(user)
  setSessionCookie(res, session)
  await audit({ action:'login_succeeded', actor:user.id, role:user.role })
  res.json({ authenticated:true, user })
}

export async function register(req, res) {
  const key = clientKey(req)
  const current = registrationAttempts.get(key) || { count:0, resetAt:Date.now() + 60 * 60 * 1000 }
  if (current.resetAt < Date.now()) Object.assign(current, { count:0, resetAt:Date.now() + 60 * 60 * 1000 })
  if (current.count >= 10) return res.status(429).json({ error:'注册次数过多，请稍后再试。', code:'REGISTER_RATE_LIMIT' })
  current.count += 1
  registrationAttempts.set(key, current)
  const user = await registerAccount(req.body || {})
  const session = await createAccountSession(user)
  setSessionCookie(res, session)
  await audit({ action:'account_registered', actor:user.id })
  res.status(201).json({ authenticated:true, user })
}

export async function logout(req, res) {
  await revokeAccountSession(parseCookies(req.headers.cookie)[sessionCookie])
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${sessionCookie}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${secure}`)
  res.setHeader('Clear-Site-Data', '"cache", "cookies", "storage"')
  res.json({ authenticated:false })
}

export async function changePassword(req, res) {
  if (req.user?.role !== 'customer') {
    return res.status(400).json({ error: '管理员密码需要在服务器配置中修改。', code: 'ADMIN_PASSWORD_MANAGED_EXTERNALLY' })
  }
  const user = await changeAccountPassword(req.user.id, req.body?.currentPassword, req.body?.newPassword)
  const session = await createAccountSession(user)
  setSessionCookie(res, session)
  await audit({ action: 'password_changed', actor: user.id })
  res.json({ authenticated: true, user })
}

export async function authenticationStatus(req, res) {
  if (!config.security.authenticationRequired) return res.json({ required:false, authenticated:true, registrationEnabled:true, user:adminUser })
  const user = await getSessionUser(parseCookies(req.headers.cookie)[sessionCookie], adminUser)
  res.json({ required:true, authenticated:Boolean(user), registrationEnabled:true, user:user || null })
}

export function auditApiRequests(req, res, next) {
  const started = Date.now()
  res.on('finish', () => {
    if (!req.path.startsWith('/api/')) return
    audit({ action:'api_request', method:req.method, path:req.path, status:res.statusCode, durationMs:Date.now()-started, actor:req.user?.id || clientKey(req) }).catch(() => {})
  })
  next()
}

export function validateProductionSecurity() {
  if (process.env.NODE_ENV !== 'production') return
  const missing = []
  if (!config.security.adminPassword) missing.push('VIRALFLOW_ADMIN_PASSWORD')
  if (!config.security.sessionSecret || config.security.sessionSecret.length < 32) missing.push('SESSION_SECRET (at least 32 characters)')
  if (!config.security.dataEncryptionKey || config.security.dataEncryptionKey.length < 32) missing.push('DATA_ENCRYPTION_KEY (at least 32 characters)')
  if (missing.length) throw new Error(`Production security configuration is incomplete: ${missing.join(', ')}`)
}
