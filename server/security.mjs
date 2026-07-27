import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.mjs'

const auditFile = path.join(config.dataDir, 'audit', 'security.log')
const sessionCookie = 'viralflow_session'
const sessionLifetimeMs = 8 * 60 * 60 * 1000
const loginAttempts = new Map()

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

function sign(value) {
  return crypto.createHmac('sha256', config.security.sessionSecret).update(value).digest('base64url')
}

function createSession() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + sessionLifetimeMs })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

function validSession(token) {
  if (!token || !config.security.sessionSecret) return false
  const [payload, signature] = token.split('.')
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return false
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).exp > Date.now() } catch { return false }
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
  next()
}

export function requireAuthentication(req, res, next) {
  if (!config.security.authenticationRequired) return next()
  if (validSession(parseCookies(req.headers.cookie)[sessionCookie])) return next()
  res.status(401).json({ error:'Authentication required', code:'AUTH_REQUIRED' })
}

export async function login(req, res) {
  const key = clientKey(req)
  const current = loginAttempts.get(key) || { count:0, resetAt:Date.now() + 15 * 60 * 1000 }
  if (current.resetAt < Date.now()) Object.assign(current, { count:0, resetAt:Date.now() + 15 * 60 * 1000 })
  if (current.count >= 5) return res.status(429).json({ error:'Too many login attempts. Try again later.', code:'LOGIN_RATE_LIMIT' })
  if (!safeEqual(req.body?.password, config.security.adminPassword)) {
    current.count += 1
    loginAttempts.set(key, current)
    await audit({ action:'login_failed', actor:key })
    return res.status(401).json({ error:'Incorrect password', code:'INVALID_CREDENTIALS' })
  }
  loginAttempts.delete(key)
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${sessionCookie}=${createSession()}; Max-Age=${sessionLifetimeMs / 1000}; Path=/; HttpOnly; SameSite=Strict${secure}`)
  await audit({ action:'login_succeeded', actor:key })
  res.json({ authenticated:true })
}

export function logout(req, res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${sessionCookie}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${secure}`)
  res.json({ authenticated:false })
}

export function authenticationStatus(req, res) {
  res.json({
    required: config.security.authenticationRequired,
    authenticated: !config.security.authenticationRequired || validSession(parseCookies(req.headers.cookie)[sessionCookie]),
  })
}

export function auditApiRequests(req, res, next) {
  const started = Date.now()
  res.on('finish', () => {
    if (!req.path.startsWith('/api/')) return
    audit({ action:'api_request', method:req.method, path:req.path, status:res.statusCode, durationMs:Date.now()-started, actor:clientKey(req) }).catch(() => {})
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
