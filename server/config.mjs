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
  runway: {
    apiKey: process.env.RUNWAYML_API_SECRET || '',
    baseUrl: process.env.RUNWAY_API_BASE_URL || 'https://api.dev.runwayml.com',
    apiVersion: process.env.RUNWAY_API_VERSION || '2024-11-06',
    seedanceModel: process.env.SEEDANCE_VIDEO_MODEL || 'seedance2',
    runwayModel: process.env.RUNWAY_VIDEO_MODEL || 'gen4.5',
  },
  billing: {
    signupCredits: Math.max(0, Number(process.env.SIGNUP_CREDITS || 10)),
    costs: {
      script: Math.max(0, Number(process.env.CREDIT_COST_SCRIPT || 1)),
      videoAnalysis: Math.max(0, Number(process.env.CREDIT_COST_VIDEO_ANALYSIS || 3)),
      'gemini-omni': Math.max(0, Number(process.env.CREDIT_COST_GEMINI_VIDEO || 20)),
      'seedance-2': Math.max(0, Number(process.env.CREDIT_COST_SEEDANCE_VIDEO || 20)),
      'runway-gen45': Math.max(0, Number(process.env.CREDIT_COST_RUNWAY_VIDEO || 30)),
      'runway-ugc': Math.max(0, Number(process.env.CREDIT_COST_RUNWAY_UGC || 40)),
    },
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
  const googleConfigured = present(config.google.apiKey)
  const runwayConfigured = present(config.runway.apiKey)
  return {
    mode: production ? 'production' : 'development',
    google: {
      configured: googleConfigured,
      analysisModel: config.google.analysisModel,
      videoModel: config.google.videoModel,
      capabilities: ['完整视频理解', '口播识别', '脚本生成', '9:16 原生音频视频', '商品与模特参考图'],
    },
    runway: {
      configured: runwayConfigured,
      models: [config.runway.seedanceModel, config.runway.runwayModel],
      capabilities: ['Seedance 2', 'Runway Gen-4.5', 'Product UGC', '9:16 商品图生视频'],
    },
    videoModels: [
      {
        id: 'gemini-omni', name: 'Gemini Omni Flash', region: '海外', provider: 'gemini',
        configured: googleConfigured, requiresImage: false, supportsProductAndModel: true,
        strengths: '原生英文口播与声音，商品和模特双参考图',
      },
      {
        id: 'seedance-2', name: 'Seedance 2', region: '国内', provider: 'runway',
        configured: runwayConfigured, requiresImage: true, supportsProductAndModel: true,
        strengths: '多参考图、原生声音与电商短视频节奏',
      },
      {
        id: 'runway-gen45', name: 'Runway Gen-4.5', region: '海外', provider: 'runway',
        configured: runwayConfigured, requiresImage: true, supportsProductAndModel: false,
        strengths: '写实质感、镜头运动与广告级画面',
      },
      {
        id: 'runway-ugc', name: 'Runway Product UGC', region: '海外', provider: 'runway',
        configured: runwayConfigured, requiresImage: true, requiresBothImages: true, supportsProductAndModel: true,
        strengths: '商品图与成人模特图直出原生口播 UGC 成片',
      },
    ],
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
    billing: {
      signupCredits: config.billing.signupCredits,
      costs: config.billing.costs,
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
