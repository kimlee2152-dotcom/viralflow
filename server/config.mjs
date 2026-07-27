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
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    analysisModel: process.env.OPENAI_ANALYSIS_MODEL || 'gpt-5.4',
    transcribeModel: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe',
    videoModel: process.env.OPENAI_VIDEO_MODEL || 'sora-2',
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
  creatify: {
    apiId: process.env.CREATIFY_API_ID || '',
    apiKey: process.env.CREATIFY_API_KEY || '',
    baseUrl: 'https://api.creatify.ai',
  },
}

export function serviceStatus() {
  return {
    mode: production ? 'production' : 'development',
    openai: {
      configured: present(config.openai.apiKey),
      analysisModel: config.openai.analysisModel,
      transcribeModel: config.openai.transcribeModel,
      videoModel: config.openai.videoModel,
      capabilities: ['视频画面分析', '语音转文字', '脚本生成', 'AI 视频生成'],
    },
    tiktok: {
      configured: [config.tiktok.appKey, config.tiktok.appSecret, config.tiktok.accessToken].every(present),
      appConfigured: [config.tiktok.appKey, config.tiktok.appSecret].every(present),
      oauthReady: [config.tiktok.appKey, config.tiktok.appSecret, config.tiktok.serviceId].every(present),
      source: 'TikTok Shop 官方 Bestsellers 数据',
      capabilities: ['平台畅销视频榜单', '公开互动指标', '脱敏 GMV 区间'],
    },
    creatify: {
      configured: [config.creatify.apiId, config.creatify.apiKey].every(present),
      capabilities: ['商品视频', 'AI 模特', '口型与配音'],
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
