import fs from 'node:fs/promises'
import { GoogleGenAI } from '@google/genai'
import RunwayML from '@runwayml/sdk'
import { config, requireConfigured } from './config.mjs'

const VIDEO_MODELS = {
  'gemini-omni': { provider: 'gemini', upstream: () => config.google.videoModel },
  'seedance-2': { provider: 'runway', upstream: () => config.runway.seedanceModel },
  'runway-gen45': { provider: 'runway', upstream: () => config.runway.runwayModel },
  'runway-ugc': { provider: 'runway', recipe: 'productUgc' },
}

function geminiClient() {
  requireConfigured(config.google.apiKey, 'Google Gemini 服务尚未配置，请先填写 GEMINI_API_KEY。')
  return new GoogleGenAI({ apiKey: config.google.apiKey })
}

function runwayClient() {
  requireConfigured(config.runway.apiKey, 'Runway 视频服务尚未配置，请先填写 RUNWAYML_API_SECRET。')
  return new RunwayML({
    apiKey: config.runway.apiKey,
    baseURL: config.runway.baseUrl,
    runwayVersion: config.runway.apiVersion,
  })
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

function publicRunwayTask(task, model = 'seedance-2') {
  const source = String(task?.status || 'PENDING').toUpperCase()
  const status = source === 'SUCCEEDED'
    ? 'completed'
    : ['FAILED', 'CANCELLED'].includes(source)
      ? 'failed'
      : source === 'PENDING' || source === 'THROTTLED'
        ? 'queued'
        : 'processing'
  return {
    provider: 'runway',
    id: task.id,
    status,
    model,
    hasContent: status === 'completed' && Array.isArray(task.output) && task.output.length > 0,
    mimeType: 'video/mp4',
    failure: task?.failure || null,
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

function normalizeRunwayError(error) {
  if (error?.status) return error
  const wrapped = new Error(error?.message || '视频模型请求失败。')
  wrapped.status = 502
  wrapped.code = 'RUNWAY_VIDEO_API_ERROR'
  wrapped.detail = error
  return wrapped
}

function resolveModel(model) {
  const selected = VIDEO_MODELS[model || 'gemini-omni']
  if (selected) return { ...selected, id: model || 'gemini-omni' }
  const error = new Error('不支持所选视频模型。')
  error.status = 400
  error.code = 'VIDEO_MODEL_NOT_SUPPORTED'
  throw error
}

async function toDataUri(file) {
  const base64 = await fs.readFile(file.path, 'base64')
  return `data:${file.mimetype};base64,${base64}`
}

function runwayPrompt(prompt, seconds, hasProduct, hasModel) {
  return optimizedTikTokPrompt(prompt, seconds, hasProduct, hasModel)
    .replaceAll(/<IMAGE_REF_\d+>/g, 'the supplied reference image')
}

async function createRunwayTask({ selected, prompt, duration, product, model }) {
  const client = runwayClient()
  const productUri = product ? await toDataUri(product) : ''
  const modelUri = model ? await toDataUri(model) : ''
  if (selected.id === 'runway-ugc') {
    requireConfigured(productUri, 'Runway Product UGC 需要上传商品参考图。')
    requireConfigured(modelUri, 'Runway Product UGC 需要上传已获授权的成人模特参考图。')
    const task = await client.recipes.productUgc({
      version: '2026-06',
      characterImage: { uri: modelUri },
      productImage: { uri: productUri },
      productInfo: prompt.slice(0, 2500),
      userConcept: runwayPrompt(prompt, duration, true, true).slice(0, 3500),
      duration,
      ratio: '720:1280',
      audio: true,
    })
    return publicRunwayTask(task, selected.id)
  }
  const images = [productUri, modelUri].filter(Boolean)
  requireConfigured(images.length, `${selected.id === 'seedance-2' ? 'Seedance 2' : 'Runway Gen-4.5'} 需要至少上传一张商品或成人模特参考图。`)
  if (selected.id === 'seedance-2') {
    const task = await client.imageToVideo.create({
      model: selected.upstream(),
      promptImage: images.map((uri) => ({ uri })),
      promptText: runwayPrompt(prompt, duration, Boolean(product), Boolean(model)).slice(0, 3500),
      ratio: '720:1280',
      duration,
      audio: true,
    })
    return publicRunwayTask(task, selected.id)
  }
  const task = await client.imageToVideo.create({
    model: selected.upstream(),
    promptImage: [{ uri: images[0], position: 'first' }],
    promptText: runwayPrompt(prompt, Math.min(duration, 10), Boolean(product), Boolean(model)).slice(0, 1000),
    ratio: '720:1280',
    duration: Math.min(duration, 10),
  })
  return publicRunwayTask(task, selected.id)
}

export async function createVideoTask({ model: modelId = 'gemini-omni', prompt, seconds = '10', referenceImages = [] }) {
  requireConfigured(prompt, '请先生成或填写视频提示词。')
  const duration = Math.min(Math.max(Number(seconds) || 10, 4), 15)
  const files = referenceImages.filter(Boolean).slice(0, 6)
  const product = files.find((file) => file.fieldname === 'productImage')
  const model = files.find((file) => file.fieldname === 'modelImage')
  const selected = resolveModel(modelId)
  try {
    if (selected.provider === 'runway') {
      return await createRunwayTask({ selected, prompt, duration, product, model })
    }
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
    return { ...publicTask(task), model: selected.id }
  } catch (error) {
    throw selected.provider === 'runway' ? normalizeRunwayError(error) : normalizeError(error)
  } finally {
    await Promise.all(files.map((file) => fs.rm(file.path, { force: true }).catch(() => {})))
  }
}

export async function getVideoTask(provider, id, model = '') {
  if (provider === 'runway') {
    try {
      return publicRunwayTask(await runwayClient().tasks.retrieve(id), model || 'seedance-2')
    } catch (error) {
      throw normalizeRunwayError(error)
    }
  }
  if (provider !== 'gemini') {
    const error = new Error('无法识别这个视频任务的来源，请重新生成。')
    error.status = 410
    error.code = 'VIDEO_PROVIDER_RETIRED'
    throw error
  }
  try {
    return { ...publicTask(await geminiClient().interactions.get(id)), model: model || 'gemini-omni' }
  } catch (error) {
    throw normalizeError(error)
  }
}

async function downloadGeminiVideo(id) {
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

async function downloadRunwayVideo(id) {
  try {
    const task = await runwayClient().tasks.retrieve(id)
    const url = task?.status === 'SUCCEEDED' && Array.isArray(task.output) ? task.output[0] : ''
    if (!url) {
      const error = new Error('视频尚未生成完成。')
      error.status = 409
      throw error
    }
    const uri = new URL(url)
    if (uri.protocol !== 'https:') throw new Error('视频下载地址无效。')
    const response = await fetch(uri, { redirect: 'follow' })
    if (!response.ok) throw new Error(`视频下载失败（${response.status}）。`)
    return { data: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get('content-type') || 'video/mp4' }
  } catch (error) {
    throw normalizeRunwayError(error)
  }
}

export async function downloadVideo(provider, id) {
  if (provider === 'gemini') return downloadGeminiVideo(id)
  if (provider === 'runway') return downloadRunwayVideo(id)
  const error = new Error('无法识别这个视频任务的来源。')
  error.status = 400
  throw error
}
