import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import OpenAI from 'openai'
import ffmpegPath from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { config, requireConfigured } from './config.mjs'

const execFileAsync = promisify(execFile)
const ffprobePath = ffprobeStatic.path

function openaiClient() {
  requireConfigured(config.openai.apiKey, 'OpenAI 服务尚未配置，请先填写 OPENAI_API_KEY。')
  return new OpenAI({ apiKey: config.openai.apiKey })
}

export async function checkOpenAIService() {
  const response = await openaiClient().responses.create({
    model: config.openai.analysisModel,
    input: '只回复 OK',
    max_output_tokens: 32,
  })
  return { ok: true, model: config.openai.analysisModel, responseId: response.id }
}

async function durationOf(filePath) {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
  ])
  return Math.max(Number.parseFloat(stdout) || 1, 1)
}

async function extractMedia(filePath, jobDir) {
  const framesDir = path.join(jobDir, 'frames')
  await fs.mkdir(framesDir, { recursive: true })
  const duration = await durationOf(filePath)
  const interval = Math.max(duration / 10, 1)
  await execFileAsync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-i', filePath,
    '-vf', `fps=1/${interval},scale=768:-2`, '-frames:v', '10', '-q:v', '3',
    path.join(framesDir, 'frame-%02d.jpg'),
  ])
  const audioPath = path.join(jobDir, 'audio.mp3')
  let hasAudio = true
  try {
    await execFileAsync(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-i', filePath,
      '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', '-y', audioPath,
    ])
  } catch {
    hasAudio = false
  }
  const frames = (await fs.readdir(framesDir))
    .filter((name) => name.endsWith('.jpg'))
    .sort()
    .map((name) => path.join(framesDir, name))
  return { duration, frames, audioPath: hasAudio ? audioPath : null }
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

const outputContract = `只输出一个有效 JSON 对象，不要使用 Markdown。结构必须是：
{
  "summary":"中文摘要",
  "hook":{"time":"0-3s","type":"钩子类型","evidence":"画面或台词证据","score":0},
  "audience":"目标消费者",
  "selling_points":["卖点"],
  "timeline":[{"time":"时间段","visual":"画面","speech":"台词摘要","purpose":"作用"}],
  "comment_insights":{"purchase_intent":0,"questions":["问题"],"objections":["顾虑"],"new_angles":["新选题"]},
  "why_it_works":[{"reason":"原因","evidence":"证据"}],
  "risks":["风险"],
  "optimized_script":{"title":"原创选题","hook_en":"美式英语钩子","hook_zh":"中文对照","scenes":[{"time":"时间","visual":"画面","voice_en":"英文台词","subtitle_en":"英文字幕"}],"cta_en":"行动引导"},
  "video_prompt":"可直接用于生成 9:16 美式 UGC 电商视频的完整英文提示词"
}`

const guardrails = `内容必须原创，不得复刻参考视频的独特台词、人物身份或受版权保护的表达。没有证据的结论标明为推测。医疗、减重、美容效果和保证性宣传必须提示合规风险。`

export async function analyzeVideo({ filePath, comments = '', product = '' }) {
  const client = openaiClient()
  const jobDir = path.join(config.dataDir, 'analysis', `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  await fs.mkdir(jobDir, { recursive: true })
  try {
    const media = await extractMedia(filePath, jobDir)
    let transcript = '视频没有可识别的音轨。'
    if (media.audioPath) {
      const transcription = await client.audio.transcriptions.create({
        file: fsSync.createReadStream(media.audioPath),
        model: config.openai.transcribeModel,
        response_format: 'text',
      })
      transcript = typeof transcription === 'string' ? transcription : transcription.text
    }
    const content = [{
      type: 'input_text',
      text: `你是 TikTok Shop 美区电商短视频分析师。请结合关键画面、语音、评论和商品资料完成分析，并给出更优的原创脚本。\n${outputContract}\n${guardrails}\n\n视频时长：${media.duration.toFixed(1)} 秒\n商品资料：${product || '未提供'}\n语音文字：${transcript}\n评论样本：${comments || '未提供'}`,
    }]
    for (const frame of media.frames) {
      content.push({ type: 'input_image', image_url: `data:image/jpeg;base64,${await fs.readFile(frame, 'base64')}`, detail: 'low' })
    }
    const response = await client.responses.create({
      model: config.openai.analysisModel,
      input: [{ role: 'user', content }],
    })
    return {
      source: 'OpenAI Responses API + Audio Transcription API',
      models: { analysis: config.openai.analysisModel, transcription: config.openai.transcribeModel },
      duration: media.duration,
      frameCount: media.frames.length,
      transcript,
      analysis: parseJson(response.output_text),
    }
  } finally {
    await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {})
    await fs.rm(filePath, { force: true }).catch(() => {})
  }
}

export async function generateScript({ product, audience, sellingPoints, comments, duration = 20, style = '美式 UGC 真人口播' }) {
  requireConfigured(product, '请先填写商品名称或商品资料。')
  const prompt = `你是 TikTok Shop 美区电商内容策划师。根据以下资料生成一个可直接拍摄、原创且合规的英文带货脚本，并给出中文解释。\n${outputContract}\n${guardrails}\n\n商品：${product}\n目标受众：${audience || '由你根据商品推断'}\n核心卖点：${sellingPoints || '由你从商品资料提炼'}\n评论/顾虑：${comments || '未提供'}\n目标时长：${Math.min(Math.max(Number(duration) || 20, 8), 60)} 秒\n视频风格：${style}`
  const response = await openaiClient().responses.create({
    model: config.openai.analysisModel,
    input: prompt,
  })
  return {
    source: 'OpenAI Responses API',
    model: config.openai.analysisModel,
    analysis: parseJson(response.output_text),
  }
}
