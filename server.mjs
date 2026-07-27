import fs from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import multer from 'multer'
import { createServer as createViteServer } from 'vite'
import { config, serviceStatus } from './server/config.mjs'
import { analyzeVideo, checkOpenAIService, generateScript } from './server/analysis.mjs'
import { getBestsellingVideos } from './server/tiktok.mjs'
import { completeAuthorization, createAuthorization, disconnectTikTok, getTikTokAuthorizationStatus, refreshAuthorization } from './server/tiktok-auth.mjs'
import { createVideoTask, downloadSoraVideo, getVideoTask } from './server/videos.mjs'
import { deleteSnapshots, recordAndCompare } from './server/snapshots.mjs'
import { createProject, deleteProject, getProject, listProjects, updateProject } from './server/projects.mjs'
import { auditApiRequests, authenticationStatus, login, logout, requireAuthentication, securityHeaders, validateProductionSecurity } from './server/security.mjs'

const production = process.argv.includes('--production')
if (production) process.env.NODE_ENV = 'production'
validateProductionSecurity()

const app = express()
const uploadDir = path.join(config.dataDir, 'uploads')
await fs.mkdir(uploadDir, { recursive: true })

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const supported = file.mimetype.startsWith('video/')
    callback(supported ? null : new Error('只支持上传视频文件。'), supported)
  },
})

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(securityHeaders)
app.use(express.json({ limit: '2mb' }))
app.use(auditApiRequests)

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'ViralFlow', time: new Date().toISOString() }))
app.get('/api/auth/status', authenticationStatus)
app.post('/api/auth/login', login)
app.post('/api/auth/logout', logout)
app.use('/api', requireAuthentication)

app.get('/api/status', (_req, res) => res.json(serviceStatus()))
app.post('/api/openai/check', asyncRoute(async (_req, res) => res.json(await checkOpenAIService())))

app.get('/api/projects', asyncRoute(async (_req, res) => res.json({ projects: await listProjects() })))
app.get('/api/projects/:id', asyncRoute(async (req, res) => {
  const project = await getProject(req.params.id)
  if (!project) return res.status(404).json({ error: '项目不存在。', code: 'PROJECT_NOT_FOUND' })
  res.json({ project })
}))
app.delete('/api/projects/:id', asyncRoute(async (req, res) => {
  if (!await deleteProject(req.params.id)) return res.status(404).json({ error: '项目不存在。', code: 'PROJECT_NOT_FOUND' })
  res.json({ deleted: true })
}))

app.post('/api/scripts', asyncRoute(async (req, res) => {
  const result = await generateScript(req.body || {})
  const project = await createProject({
    kind: 'script',
    title: result.analysis?.optimized_script?.title || req.body.product,
    status: 'completed',
    input: {
      product: req.body.product,
      audience: req.body.audience || '',
      sellingPoints: req.body.sellingPoints || '',
      comments: req.body.comments || '',
      duration: req.body.duration || 20,
      style: req.body.style || '美式 UGC 真人口播',
    },
    result,
  })
  res.status(201).json({ project })
}))

app.post('/api/analyze-video', upload.single('video'), asyncRoute(async (req, res) => {
  if (!req.file) {
    const error = new Error('请选择一个视频文件。')
    error.status = 400
    throw error
  }
  const result = await analyzeVideo({ filePath: req.file.path, comments: req.body.comments, product: req.body.product })
  const project = await createProject({
    kind: 'analysis',
    title: result.analysis?.optimized_script?.title || req.body.product || req.file.originalname,
    status: 'completed',
    input: { product: req.body.product || '', comments: req.body.comments || '', fileName: req.file.originalname },
    result,
  })
  res.status(201).json({ project })
}))

app.post('/api/videos', asyncRoute(async (req, res) => {
  const task = await createVideoTask(req.body)
  if (req.body.projectId) {
    await updateProject(req.body.projectId, {
      status: 'video_processing',
      videoTask: { provider: task.provider, id: task.id || task.uuid, status: task.status || 'queued', prompt: req.body.prompt },
    })
  }
  res.status(202).json(task)
}))

app.get('/api/videos/:provider/:id', asyncRoute(async (req, res) => {
  const task = await getVideoTask(req.params.provider, req.params.id, req.query.prompt || '')
  if (req.query.projectId) {
    const complete = ['completed', 'done', 'success'].includes(String(task.status).toLowerCase())
    const failed = ['failed', 'error', 'cancelled'].includes(String(task.status).toLowerCase())
    await updateProject(req.query.projectId, {
      status: complete ? 'video_completed' : failed ? 'video_failed' : 'video_processing',
      videoTask: { provider: task.provider, id: task.id || req.params.id, status: task.status, prompt: req.query.prompt || '', task },
    })
  }
  res.json(task)
}))

app.get('/api/videos/sora/:id/content', asyncRoute(async (req, res) => {
  const content = await downloadSoraVideo(req.params.id)
  res.setHeader('content-type', 'video/mp4')
  res.setHeader('content-disposition', `attachment; filename="${req.params.id}.mp4"`)
  res.send(Buffer.from(await content.arrayBuffer()))
}))

app.get('/api/tiktok/auth/status', asyncRoute(async (_req, res) => res.json(await getTikTokAuthorizationStatus())))
app.get('/api/tiktok/oauth/start', (req, res, next) => {
  try { res.redirect(createAuthorization(res)) } catch (error) { next(error) }
})
app.get('/api/tiktok/oauth/callback', async (req, res) => {
  try {
    await completeAuthorization(req)
    res.setHeader('set-cookie', 'tiktok_oauth_state=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax')
    res.redirect('/?page=tiktok&tiktok=connected')
  } catch (error) {
    console.error(`[TikTok OAuth] ${error.code || 'ERROR'}: ${error.message}`)
    res.redirect(`/?page=tiktok&tiktok=error&message=${encodeURIComponent(error.message)}`)
  }
})
app.post('/api/tiktok/auth/refresh', asyncRoute(async (_req, res) => {
  await refreshAuthorization()
  res.json(await getTikTokAuthorizationStatus())
}))
app.delete('/api/tiktok/auth', asyncRoute(async (_req, res) => {
  const authorization = await disconnectTikTok()
  await deleteSnapshots()
  res.json({ ...authorization, snapshotsDeleted: true })
}))
app.post('/api/tiktok/bestsellers', asyncRoute(async (req, res) => {
  const timeSlot = req.body.timeSlot || '7D'
  const slotDays = timeSlot === '1D' ? 1 : timeSlot === '30D' ? 30 : 7
  const result = await getBestsellingVideos({
    date: req.body.date || new Date(Date.now() - slotDays * 86400000).toISOString().slice(0, 10),
    timeSlot,
    currency: 'USD',
  })
  res.json({ ...result, ...(await recordAndCompare(result.videos, req.body.days || 3)) })
}))

if (production) {
  app.use(express.static(path.resolve('dist'), { maxAge: '1h' }))
  app.get('/{*splat}', (_req, res) => res.sendFile(path.resolve('dist/index.html')))
} else {
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' })
  app.use(vite.middlewares)
}

app.use((error, _req, res, _next) => {
  console.error(`[API] ${error.code || 'ERROR'}: ${error.message}`)
  res.status(error.status || (error instanceof multer.MulterError ? 400 : 500)).json({
    error: error.message || '服务处理失败。',
    code: error.code || 'INTERNAL_ERROR',
    detail: process.env.NODE_ENV === 'development' ? error.detail : undefined,
  })
})

app.listen(config.port, config.host, () => {
  console.log(`ViralFlow 已启动：http://${config.host}:${config.port}`)
})
