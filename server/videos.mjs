import fs from 'node:fs/promises'
import { GoogleGenAI } from '@google/genai'
import { config, requireConfigured } from './config.mjs'

function geminiClient() {
  requireConfigured(config.google.apiKey, 'Google Gemini 服务尚未配置，请先填写 GEMINI_API_KEY。')
  return new GoogleGenAI({ apiKey: config.google.apiKey })
}

function outputVideo(task) {
  if (task?.output_video) return task.output_video
  for (const step of task?.steps || []) {
    for (const content of step?.content || []) {
      if (content?.type === 'video') return content
    }
  }
  return null
}

function cleanStatus(status) {
  const value = String(status || 'queued').toLowerCase()
  if (value === 'completed') return 'completed'
  if (['failed', 'cancelled', 'canceled', 'incomplete'].includes(value)) return 'failed'
  return value === 'queued' ? 'queued' : 'processing'
}

function publicTask(task) {
  const video = outputVideo(task)
  return {
    provider: 'gemini',
    id: task.id,
    status: cleanStatus(task.status),
    model: task.model || config.google.videoModel,
    hasContent: Boolean(video?.data || video?.uri),
    mimeType: video?.mime_type || 'video/mp4',
  }
}

function optimizedTikTokPrompt(prompt, seconds, hasProduct, hasModel) {
  const references = [
    hasProduct ? 'Use <IMAGE_REF_0> as the exact product reference; preserve product shape, color, proportions, packaging and visible details.' : '',
    hasModel ? `Use <IMAGE_REF_${hasProduct ? 1 : 0}> as the adult on-camera creator reference; preserve facial identity and general appearance.` : '',
  ].filter(Boolean).join('\n')
  return `Create a ${seconds}-second vertical TikTok Shop US UGC video.\n${references}\n${prompt}\n\nProduction rules: 9:16 portrait, authentic handheld smartphone footage, natural indoor lighting, immediate hook in the first 2 seconds, fast social-native pacing, clear product visibility, realistic adult hands and product interaction, natural American English dialogue, synchronized native audio, subtle room ambience, light royalty-free-style background music under the voice, safe space for TikTok interface overlays. Avoid polished television-commercial aesthetics, fake logos, invented certifications, unreadable on-screen text, distorted product geometry, extra fingers, minors, celebrity likenesses and unsupported performance claims.`
}

function normalizeError(error) {
  if (error?.status) return error
  const wrapped = new Error(error?.message || 'Gemini 视频生成请求失败。')
  wrapped.status = 502
  wrapped.code = 'GEMINI_VIDEO_API_ERROR'
  wrapped.detail = error
  return wrapped
}

export async function createVideoTask({ prompt, seconds = '10', referenceImages = [] }) {
  requireConfigured(prompt, '请先生成或填写视频提示词。')
  const duration = Math.min(Math.max(Number(seconds) || 10, 4), 15)
  const files = referenceImages.filter(Boolean).slice(0, 6)
  const product = files.find((file) => file.fieldname === 'productImage')
  const model = files.find((file) => file.fieldname === 'modelImage')
  try {
    const input = []
    for (const file of files) {
      input.push({ type: 'image', data: await fs.readFile(file.path, 'base64'), mime_type: file.mimetype })
    }
    input.push({ type: 'text', text: optimizedTikTokPrompt(prompt, duration, Boolean(product), Boolean(model)) })
    const task = await geminiClient().interactions.create({
      model: config.google.videoModel,
      input: files.length ? input : input[0].text,
      response_format: { type: 'video', aspect_ratio: '9:16', delivery: 'uri', duration: `${duration}s` },
      generation_config: { video_config: { task: files.length ? 'reference_to_video' : 'text_to_video' } },
      background: true,
      store: true,
    })
    return publicTask(task)
  } catch (error) {
    throw normalizeError(error)
  } finally {
    await Promise.all(files.map((file) => fs.rm(file.path, { force: true }).catch(() => {})))
  }
}

export async function getVideoTask(provider, id) {
  if (provider !== 'gemini') {
    const error = new Error('这个视频任务来自已停用的旧模型，请重新生成。')
    error.status = 410
    error.code = 'VIDEO_PROVIDER_RETIRED'
    throw error
  }
  try {
    return publicTask(await geminiClient().interactions.get(id))
  } catch (error) {
    throw normalizeError(error)
  }
}

export async function downloadGeminiVideo(id) {
  try {
    const task = await geminiClient().interactions.get(id)
    const video = outputVideo(task)
    if (!video) {
      const error = new Error('视频尚未生成完成。')
      error.status = 409
      throw error
    }
    if (video.data) return { data: Buffer.from(video.data, 'base64'), mimeType: video.mime_type || 'video/mp4' }
    if (video.uri) {
      const uri = new URL(video.uri)
      if (!['generativelanguage.googleapis.com', 'www.googleapis.com'].includes(uri.hostname)) throw new Error('视频下载地址无效。')
      const response = await fetch(uri, { headers: { 'x-goog-api-key': config.google.apiKey }, redirect: 'follow' })
      if (!response.ok) throw new Error(`视频下载失败（${response.status}）。`)
      return { data: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get('content-type') || video.mime_type || 'video/mp4' }
    }
    throw new Error('视频内容不可用。')
  } catch (error) {
    throw normalizeError(error)
  }
}
