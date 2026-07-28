import fs from 'node:fs/promises'
import { GoogleGenAI } from '@google/genai'
import { config, requireConfigured } from './config.mjs'

function geminiClient() {
  requireConfigured(config.google.apiKey, 'Google Gemini 服务尚未配置，请先填写 GEMINI_API_KEY。')
  return new GoogleGenAI({ apiKey: config.google.apiKey })
}

function parseJson(text) {
  const cleaned = String(text || '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1))
    const error = new Error('AI 返回的内容无法解析，请重试。')
    error.code = 'AI_INVALID_RESPONSE'
    throw error
  }
}

const outputSchema = {
  type: 'object',
  required: ['summary', 'hook', 'audience', 'selling_points', 'timeline', 'comment_insights', 'why_it_works', 'risks', 'optimized_script', 'video_prompt'],
  properties: {
    summary: { type: 'string' },
    hook: {
      type: 'object',
      required: ['time', 'type', 'evidence', 'score'],
      properties: {
        time: { type: 'string' }, type: { type: 'string' }, evidence: { type: 'string' },
        score: { type: 'number', minimum: 0, maximum: 100 },
      },
    },
    audience: { type: 'string' },
    selling_points: { type: 'array', items: { type: 'string' } },
    timeline: {
      type: 'array', items: {
        type: 'object', required: ['time', 'visual', 'speech', 'purpose'],
        properties: { time: { type: 'string' }, visual: { type: 'string' }, speech: { type: 'string' }, purpose: { type: 'string' } },
      },
    },
    comment_insights: {
      type: 'object', required: ['purchase_intent', 'questions', 'objections', 'new_angles'],
      properties: {
        purchase_intent: { type: 'number', minimum: 0, maximum: 100 },
        questions: { type: 'array', items: { type: 'string' } },
        objections: { type: 'array', items: { type: 'string' } },
        new_angles: { type: 'array', items: { type: 'string' } },
      },
    },
    why_it_works: {
      type: 'array', items: {
        type: 'object', required: ['reason', 'evidence'],
        properties: { reason: { type: 'string' }, evidence: { type: 'string' } },
      },
    },
    risks: { type: 'array', items: { type: 'string' } },
    optimized_script: {
      type: 'object', required: ['title', 'hook_en', 'hook_zh', 'scenes', 'cta_en'],
      properties: {
        title: { type: 'string' }, hook_en: { type: 'string' }, hook_zh: { type: 'string' },
        scenes: {
          type: 'array', items: {
            type: 'object', required: ['time', 'visual', 'voice_en', 'subtitle_en'],
            properties: { time: { type: 'string' }, visual: { type: 'string' }, voice_en: { type: 'string' }, subtitle_en: { type: 'string' } },
          },
        },
        cta_en: { type: 'string' },
      },
    },
    video_prompt: { type: 'string' },
  },
}

const outputContract = `请严格按照给定 JSON Schema 输出。分析和解释使用中文；钩子、口播、字幕、CTA 与视频生成提示词使用自然的美式英语。`

const guardrails = `内容必须原创，不得复刻参考视频的独特台词、人物身份或受版权保护的表达。没有证据的结论标明为推测。医疗、减重、美容效果和保证性宣传必须提示合规风险。视频提示词必须针对 9:16 TikTok Shop UGC：前 2 秒出现冲突或利益点，手持手机质感，自然光和真实环境，清晰展示商品，快速但易懂的镜头节奏，原生英语口播、环境声与轻量音乐；不要做成传统电视广告。若没有商品图片，不得虚构品牌文字、包装文案或认证标志。`

const textResponseFormat = { type: 'text', mime_type: 'application/json', schema: outputSchema }

function normalizeGoogleError(error) {
  if (error?.status) return error
  const wrapped = new Error(error?.message || 'Google Gemini 请求失败。')
  wrapped.status = 502
  wrapped.code = 'GEMINI_API_ERROR'
  wrapped.detail = error
  return wrapped
}

export async function checkGeminiService() {
  try {
    const response = await geminiClient().interactions.create({
      model: config.google.analysisModel,
      input: '只回复 OK',
      response_format: { type: 'text', mime_type: 'text/plain' },
      store: false,
    })
    return { ok: true, model: config.google.analysisModel, responseId: response.id, text: response.output_text }
  } catch (error) {
    throw normalizeGoogleError(error)
  }
}

async function waitForFile(ai, uploaded) {
  let file = uploaded
  const deadline = Date.now() + 5 * 60 * 1000
  while (String(file.state || '').toUpperCase() === 'PROCESSING' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000))
    file = await ai.files.get({ name: file.name })
  }
  const state = String(file.state || '').toUpperCase()
  if (state === 'FAILED') throw new Error('Google 无法处理这个视频文件，请换一个常见的 MP4、MOV 或 WebM 文件重试。')
  if (state !== 'ACTIVE') throw new Error('视频处理超时，请稍后重试。')
  return file
}

export async function analyzeVideo({ filePath, mimeType = 'video/mp4', comments = '', product = '' }) {
  const ai = geminiClient()
  let remoteFile
  try {
    remoteFile = await ai.files.upload({ file: filePath, config: { mimeType, displayName: 'ViralFlow source video' } })
    remoteFile = await waitForFile(ai, remoteFile)
    const prompt = `你是 TikTok Shop 美区电商短视频分析师。完整理解这个视频的画面、镜头、屏幕文字、人物动作、口播、声音和节奏，再结合评论与商品资料输出分析和一套更强的原创脚本。必须给出可直接用于 Gemini Omni Flash 的英文视频提示词。\n\n${outputContract}\n${guardrails}\n\n商品资料：${product || '未提供'}\n评论样本：${comments || '未提供'}`
    const response = await ai.interactions.create({
      model: config.google.analysisModel,
      input: [
        { type: 'video', uri: remoteFile.uri, mime_type: remoteFile.mimeType || mimeType },
        { type: 'text', text: prompt },
      ],
      response_format: textResponseFormat,
      store: false,
    })
    return {
      source: 'Google Gemini Interactions API',
      models: { analysis: config.google.analysisModel, videoUnderstanding: config.google.analysisModel },
      transcript: '口播、环境声与画面已由 Gemini 统一理解并纳入分析。',
      analysis: parseJson(response.output_text),
    }
  } catch (error) {
    throw normalizeGoogleError(error)
  } finally {
    if (remoteFile?.name) await ai.files.delete({ name: remoteFile.name }).catch(() => {})
    await fs.rm(filePath, { force: true }).catch(() => {})
  }
}

export async function generateScript({ product, audience, sellingPoints, comments, duration = 20, style = '美式 UGC 真人口播' }) {
  requireConfigured(product, '请先填写商品名称或商品资料。')
  const prompt = `你是 TikTok Shop 美区电商内容策略师。根据资料生成可直接拍摄、原创、合规且适合移动端快速观看的英文带货脚本，并给出中文解释和可直接用于 Gemini Omni Flash 的视频提示词。\n\n${outputContract}\n${guardrails}\n\n商品：${product}\n目标受众：${audience || '根据商品推断'}\n核心卖点：${sellingPoints || '从商品资料提炼'}\n评论与顾虑：${comments || '未提供'}\n目标时长：${Math.min(Math.max(Number(duration) || 20, 8), 60)} 秒\n视频风格：${style}`
  try {
    const response = await geminiClient().interactions.create({
      model: config.google.analysisModel,
      input: prompt,
      response_format: textResponseFormat,
      store: false,
    })
    return {
      source: 'Google Gemini Interactions API',
      model: config.google.analysisModel,
      analysis: parseJson(response.output_text),
    }
  } catch (error) {
    throw normalizeGoogleError(error)
  }
}
