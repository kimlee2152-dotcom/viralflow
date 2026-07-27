import crypto from 'node:crypto'
import { config, requireConfigured } from './config.mjs'
import { getTikTokAccessToken } from './tiktok-auth.mjs'

const excludeKeys = new Set(['access_token', 'sign'])

export function generateTikTokSign(pathname, params, appSecret, body = null) {
  const paramString = Object.keys(params)
    .filter((key) => !excludeKeys.has(key))
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join('')
  const bodyString = body && Object.keys(body).length ? JSON.stringify(body) : ''
  return crypto.createHmac('sha256', appSecret).update(`${appSecret}${pathname}${paramString}${bodyString}${appSecret}`).digest('hex')
}

async function tikTokGet(pathname, params = {}) {
  requireConfigured(config.tiktok.appKey && config.tiktok.appSecret, '请先配置 TikTok Shop App Key 和 App Secret。')
  const accessToken = await getTikTokAccessToken()
  const query = { ...params, app_key: config.tiktok.appKey, timestamp: Math.floor(Date.now() / 1000).toString() }
  query.sign = generateTikTokSign(pathname, query, config.tiktok.appSecret)
  const url = new URL(pathname, config.tiktok.baseUrl)
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  })
  const response = await fetch(url, { headers: { 'content-type': 'application/json', 'x-tts-access-token': accessToken } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.code) {
    const error = new Error(payload.message || `TikTok Shop 请求失败（${response.status}）`)
    error.status = response.status || 502
    error.code = payload.code || 'TIKTOK_API_ERROR'
    error.detail = payload
    throw error
  }
  return payload
}

async function resolveShopCipher() {
  if (config.tiktok.shopCipher) return config.tiktok.shopCipher
  const payload = await tikTokGet('/authorization/202309/shops')
  const shops = payload.data?.shops || []
  const shop = shops.find((item) => item.region === 'US') || shops[0]
  requireConfigured(shop?.cipher, '当前授权中没有可用的美国市场上下文，请检查 TikTok 授权。')
  return shop.cipher
}

export async function getBestsellingVideos({ date, timeSlot = '7D', currency = 'USD' }) {
  const payload = await tikTokGet('/analytics/202511/videos/bestselling', {
    shop_cipher: await resolveShopCipher(), date, time_slot: timeSlot, currency,
  })
  return {
    source: 'TikTok Shop 官方 Bestsellers',
    syncedAt: new Date().toISOString(),
    market: 'US',
    gmvNote: '官方数据仅返回经过隐私处理的 GMV 区间，不是精确值。',
    videos: (payload.data?.videos || []).map((video) => ({
      id: String(video.id),
      rank: video.rank,
      title: video.title || video.video_description || `畅销视频 #${video.rank}`,
      creator: video.nick_name ? `@${video.nick_name}` : '未知创作者',
      views: Number(video.views || 0),
      likes: Number(video.likes || 0),
      comments: Number(video.comments || 0),
      shares: Number(video.shares || 0),
      gmvRange: video.gmv_range || null,
      publishTime: video.publish_time || null,
      duration: video.duration || null,
      products: video.product_infos || [],
    })),
  }
}
