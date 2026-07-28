import path from 'node:path'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local', override: false })
dotenv.config({ path: '.env', override: false })

const present = (value) => Boolean(value && String(value).trim())
const production = process.env.NODE_ENV === 'production' || process.argv.includes('--production')

export const config = {
  port: Number(process.env.PORT || 5173),
  host: process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1'),
  dataDir: path.resolve(process.env.DATA_DIR || 'data'),
  databaseUrl: process.env.DATABASE_URL || '',
  security: {
    adminPassword: process.env.VIRALFLOW_ADMIN_PASSWORD || '',
    sessionSecret: process.env.SESSION_SECRET || '',
    dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY || '',
    authenticationRequired: production || process.env.REQUIRE_AUTH === 'true',
  },
  google: {
    apiKey: process.env.GEMINI_API_KEY || '',
    analysisModel: process.env.GEMINI_ANALYSIS_MODEL || 'gemini-3.6-flash',
    videoModel: process.env.GEMINI_VIDEO_MODEL || 'gemini-omni-flash-preview',
  },
  tiktok: {
    appKey: process.env.TIKTOK_SHOP_APP_KEY || '',
    appSecret: process.env.TIKTOK_SHOP_APP_SECRET || '',
    serviceId: process.env.TIKTOK_SHOP_SERVICE_ID || '',
    accessToken: process.env.TIKTOK_SHOP_ACCESS_TOKEN || '',
    refreshToken: process.env.TIKTOK_SHOP_REFRESH_TOKEN || '',
    shopCipher: process.env.TIKTOK_SHOP_CIPHER || '',
    baseUrl: 'https://open-api.tiktokglobalshop.com',
    authBaseUrl: 'https://auth.tiktok-shops.com',
    authorizeUrl: 'https://services.us.tiktokshop.com/open/authorize',
  },
}

export function serviceStatus() {
  return {
    mode: production ? 'production' : 'development',
    google: {
      configured: present(config.google.apiKey),
      analysisModel: config.google.analysisModel,
      videoModel: config.google.videoModel,
      capabilities: ['完整视频理解', '口播识别', '脚本生成', '9:16 原生音频视频', '商品与模特参考图'],
    },
    tiktok: {
      configured: [config.tiktok.appKey, config.tiktok.appSecret, config.tiktok.accessToken].every(present),
      appConfigured: [config.tiktok.appKey, config.tiktok.appSecret].every(present),
      oauthReady: [config.tiktok.appKey, config.tiktok.appSecret, config.tiktok.serviceId].every(present),
      source: 'TikTok Shop 官方 Bestsellers 数据',
      capabilities: ['平台畅销视频榜单', '公开互动指标', '脱敏 GMV 区间'],
    },
    storage: {
      provider: present(config.databaseUrl) ? 'PostgreSQL' : '本地文件',
      encrypted: present(config.security.dataEncryptionKey),
    },
  }
}

export function requireConfigured(value, message) {
  if (!value) {
    const error = new Error(message)
    error.status = 428
    error.code = 'SERVICE_NOT_CONFIGURED'
    throw error
  }
}
