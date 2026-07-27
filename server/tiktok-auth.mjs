import crypto from 'node:crypto'
import path from 'node:path'
import { config, requireConfigured } from './config.mjs'
import { deleteSecureJson, readSecureJson, writeSecureJson } from './secure-storage.mjs'

const tokenFile = path.join(config.dataDir, 'tiktok-auth.json')
const stateLifetimeSeconds = 10 * 60

function hasAppCredentials() {
  return Boolean(config.tiktok.appKey && config.tiktok.appSecret)
}

async function readStoredToken() {
  return readSecureJson(tokenFile, null)
}

async function writeStoredToken(token) {
  await writeSecureJson(tokenFile, {
    access_token: token.access_token,
    access_token_expire_in: token.access_token_expire_in,
    refresh_token: token.refresh_token,
    refresh_token_expire_in: token.refresh_token_expire_in,
    granted_scopes: token.granted_scopes || [],
    saved_at: new Date().toISOString(),
  })
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))]
  }))
}

async function requestToken(pathname, params) {
  requireConfigured(hasAppCredentials(), '请先配置 TikTok Shop App Key 和 App Secret。')
  const url = new URL(pathname, config.tiktok.authBaseUrl)
  Object.entries({ app_key: config.tiktok.appKey, app_secret: config.tiktok.appSecret, ...params })
    .forEach(([key, value]) => url.searchParams.set(key, value))
  const response = await fetch(url)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.code) {
    const error = new Error(payload.message || `TikTok 授权请求失败（${response.status}）`)
    error.status = response.ok ? 400 : response.status
    error.code = payload.code || 'TIKTOK_AUTH_ERROR'
    throw error
  }
  await writeStoredToken(payload.data)
  return payload.data
}

export function createAuthorization(res) {
  requireConfigured(config.tiktok.serviceId && hasAppCredentials(), '请先配置 TikTok Shop Service ID、App Key 和 App Secret。')
  const state = crypto.randomBytes(24).toString('base64url')
  res.setHeader('set-cookie', `tiktok_oauth_state=${state}; Max-Age=${stateLifetimeSeconds}; Path=/; HttpOnly; SameSite=Lax`)
  const url = new URL(config.tiktok.authorizeUrl)
  url.searchParams.set('service_id', config.tiktok.serviceId)
  url.searchParams.set('state', state)
  return url.toString()
}

export async function completeAuthorization(req) {
  if (!req.query.code || req.query.code === 'null' || req.query.error) {
    const error = new Error(req.query.error === 'auth_denied' ? '你取消了 TikTok 数据授权。' : 'TikTok 没有返回有效授权码。')
    error.status = 400
    throw error
  }
  const expectedState = parseCookies(req.headers.cookie).tiktok_oauth_state
  const receivedState = String(req.query.state || '')
  const stateMatches = expectedState && receivedState && expectedState.length === receivedState.length
    && crypto.timingSafeEqual(Buffer.from(expectedState), Buffer.from(receivedState))
  if (!stateMatches) {
    const error = new Error('TikTok 授权状态校验失败，请重新发起授权。')
    error.status = 400
    error.code = 'INVALID_OAUTH_STATE'
    throw error
  }
  return requestToken('/api/v2/token/get', { auth_code: req.query.code, grant_type: 'authorized_code' })
}

export async function refreshAuthorization() {
  const stored = await readStoredToken()
  const refreshToken = stored?.refresh_token || config.tiktok.refreshToken
  requireConfigured(refreshToken, '没有可用的刷新令牌，请重新授权 TikTok 数据。')
  return requestToken('/api/v2/token/refresh', { refresh_token: refreshToken, grant_type: 'refresh_token' })
}

export async function getTikTokAccessToken() {
  if (config.tiktok.accessToken) return config.tiktok.accessToken
  const stored = await readStoredToken()
  requireConfigured(stored?.access_token, '尚未授权 TikTok 官方数据，请先在数据源页面完成授权。')
  const expiresAt = Number(stored.access_token_expire_in || 0) * 1000
  if (expiresAt && expiresAt - Date.now() < 60 * 60 * 1000) return (await refreshAuthorization()).access_token
  return stored.access_token
}

export async function getTikTokAuthorizationStatus() {
  const stored = await readStoredToken()
  const environmentAuthorized = Boolean(config.tiktok.accessToken)
  const expiresAt = stored?.access_token_expire_in ? new Date(Number(stored.access_token_expire_in) * 1000).toISOString() : null
  return {
    appConfigured: hasAppCredentials(),
    oauthReady: Boolean(hasAppCredentials() && config.tiktok.serviceId),
    authorized: environmentAuthorized || Boolean(stored?.access_token),
    source: environmentAuthorized ? 'environment' : stored?.access_token ? 'oauth' : null,
    expiresAt,
  }
}

export async function disconnectTikTok() {
  await deleteSecureJson(tokenFile)
  return { disconnected: true, environmentTokenStillActive: Boolean(config.tiktok.accessToken) }
}
