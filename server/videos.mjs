import OpenAI from 'openai'
import { config, requireConfigured } from './config.mjs'

const creatifyAdvanced = new Set()

function openaiClient() {
  requireConfigured(config.openai.apiKey, 'OpenAI 服务尚未配置，请先填写 OPENAI_API_KEY。')
  return new OpenAI({ apiKey: config.openai.apiKey })
}

async function creatifyFetch(pathname, options = {}) {
  requireConfigured(config.creatify.apiId && config.creatify.apiKey, 'Creatify 服务尚未配置。')
  const response = await fetch(new URL(pathname, config.creatify.baseUrl), {
    ...options,
    headers: {
      'X-API-ID': config.creatify.apiId,
      'X-API-KEY': config.creatify.apiKey,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.detail || payload.message || `Creatify 请求失败（${response.status}）`)
    error.status = response.status
    error.code = 'CREATIFY_API_ERROR'
    error.detail = payload
    throw error
  }
  return payload
}

export async function createVideoTask({ provider = 'sora', prompt, seconds = '8', size = '720x1280', productUrl, avatarId }) {
  requireConfigured(prompt, '请先生成或填写视频提示词。')
  if (provider === 'creatify') {
    requireConfigured(productUrl, '使用 AI 模特时需要提供可公开访问的商品链接。')
    const payload = await creatifyFetch('/api/product_to_videos/gen_image/', {
      method: 'POST',
      body: JSON.stringify({
        product_url: productUrl,
        aspect_ratio: '9x16',
        type: avatarId ? 'product_avatar' : 'product_anyshot',
        override_avatar: avatarId || null,
        image_prompt: prompt,
      }),
    })
    return { provider: 'creatify', ...payload }
  }
  const task = await openaiClient().videos.create({
    model: config.openai.videoModel,
    prompt,
    seconds: String(Math.min(Math.max(Number(seconds) || 8, 4), 20)),
    size,
  })
  return { provider: 'sora', ...task }
}

export async function getVideoTask(provider, id, prompt = '') {
  if (provider === 'creatify') {
    let task = await creatifyFetch(`/api/product_to_videos/${encodeURIComponent(id)}/`)
    if (task.status === 'image_generated' && !creatifyAdvanced.has(id)) {
      creatifyAdvanced.add(id)
      task = await creatifyFetch(`/api/product_to_videos/${encodeURIComponent(id)}/gen_video/`, {
        method: 'POST',
        body: JSON.stringify({ motion_style: task.override_avatar ? 'talking' : 'display', video_prompt: prompt || task.video_prompt || '' }),
      })
    }
    return { provider: 'creatify', ...task }
  }
  return { provider: 'sora', ...(await openaiClient().videos.retrieve(id)) }
}

export async function downloadSoraVideo(id) {
  return openaiClient().videos.downloadContent(id)
}
