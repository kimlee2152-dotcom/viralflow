import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BarChart3, Check, ChevronRight, CircleAlert, Clapperboard, Cloud,
  Database, FileText, Film, Home, LoaderCircle, LogOut, Menu, Play,
  Plus, RefreshCw, Settings, Sparkles, Trash2, Upload, X, Zap,
} from 'lucide-react'
import { api, formatDate, formatNumber, postJson } from './api.js'

const navigation = [
  { id: 'home', label: '工作台', icon: Home },
  { id: 'create', label: '内容制作', icon: Sparkles },
  { id: 'tiktok', label: 'TikTok 数据', icon: BarChart3 },
  { id: 'projects', label: '项目记录', icon: FileText },
  { id: 'settings', label: '服务状态', icon: Settings },
]

function ErrorNotice({ message, onClose }) {
  if (!message) return null
  return <div className="notice notice-error"><CircleAlert size={18} /><span>{message}</span>{onClose ? <button onClick={onClose}><X size={16} /></button> : null}</div>
}

function LoadingButton({ loading, children, ...props }) {
  return <button {...props} disabled={loading || props.disabled}>{loading ? <LoaderCircle className="spin" size={17} /> : null}{children}</button>
}

function LoginScreen({ onLogin }) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault()
    setLoading(true); setError('')
    try {
      await postJson('/api/auth/login', { password })
      onLogin()
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }
  return <main className="login-page">
    <section className="login-card">
      <div className="brand-mark"><Zap size={24} fill="currentColor" /></div>
      <h1>ViralFlow</h1>
      <p>登录内容制作工作台</p>
      <form onSubmit={submit}>
        <label>访问密码<input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入管理员提供的密码" /></label>
        <ErrorNotice message={error} />
        <LoadingButton className="button primary full" loading={loading}>登录</LoadingButton>
      </form>
    </section>
  </main>
}

function Sidebar({ page, setPage, open, setOpen, onLogout }) {
  return <>
    {open ? <button className="sidebar-scrim" aria-label="关闭菜单" onClick={() => setOpen(false)} /> : null}
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Zap size={20} fill="currentColor" /></div><div><strong>ViralFlow</strong><span>内容增长工作台</span></div></div>
      <nav>{navigation.map(({ id, label, icon: Icon }) => <button className={page === id ? 'active' : ''} key={id} onClick={() => { setPage(id); setOpen(false) }}><Icon size={19} />{label}</button>)}</nav>
      <div className="sidebar-foot"><span>美区 TikTok Shop</span><button onClick={onLogout}><LogOut size={17} />退出</button></div>
    </aside>
  </>
}

function StatusPill({ configured, pendingText = '未配置', readyText = '已配置' }) {
  return <span className={`status-pill ${configured ? 'ok' : 'pending'}`}>{configured ? <Check size={13} /> : null}{configured ? readyText : pendingText}</span>
}

function ServiceStrip({ status }) {
  if (!status) return null
  return <div className="service-strip">
    <div><Sparkles size={18} /><span>Gemini 分析与脚本</span><StatusPill configured={status.google?.configured} /></div>
    <div><Database size={18} /><span>TikTok 官方数据</span><StatusPill configured={status.tiktok?.configured} pendingText="等待接入" /></div>
    <div><Film size={18} /><span>Omni Flash 模特视频</span><StatusPill configured={status.google?.configured} /></div>
  </div>
}

function ProjectRow({ project, onOpen, onDelete }) {
  const projectStatus = project.status === 'video_completed'
    ? '视频已完成'
    : project.status === 'video_failed'
      ? '生成失败'
      : project.status?.startsWith('video_')
        ? '视频生成中'
        : '已完成'
  const title = project.title || '未命名项目'
  return <article className="project-row" onClick={() => onOpen(project)}>
    <div className={`project-icon ${project.kind}`} >{project.kind === 'analysis' ? <Clapperboard size={19} /> : <FileText size={19} />}</div>
    <div className="project-main"><strong>{title}</strong><span>{project.kind === 'analysis' ? '视频分析' : 'AI 脚本'} · {formatDate(project.updatedAt)}</span></div>
    <span className="project-status">{projectStatus}</span>
    {onDelete ? <button className="icon-button" aria-label="删除项目" onClick={(event) => { event.stopPropagation(); onDelete(project.id) }}><Trash2 size={17} /></button> : <ChevronRight size={18} />}
  </article>
}

function HomePage({ projects, status, setPage, openProject }) {
  return <div className="page-stack">
    <section className="hero-panel">
      <div><p className="section-label">ViralFlow 工作台</p><h1>从真实素材到可发布脚本</h1><p>上传商品视频或填写商品资料，系统会分析内容、整理评论洞察，并生成原创的美区带货脚本和视频提示词。</p></div>
      <button className="button primary" onClick={() => setPage('create')}><Plus size={18} />开始制作</button>
    </section>
    <ServiceStrip status={status} />
    <section className="workflow">
      <button onClick={() => setPage('create')}><Upload size={22} /><strong>分析真实视频</strong><span>识别画面、口播与内容结构</span><ChevronRight size={19} /></button>
      <button onClick={() => setPage('create')}><Sparkles size={22} /><strong>直接生成脚本</strong><span>从商品资料生成原创 UGC 方案</span><ChevronRight size={19} /></button>
      <button onClick={() => setPage('tiktok')}><BarChart3 size={22} /><strong>查看官方榜单</strong><span>接入后同步 Bestsellers 数据</span><ChevronRight size={19} /></button>
    </section>
    <section className="section-block">
      <div className="section-heading"><div><h2>最近项目</h2><p>分析和脚本结果会自动保存在这里</p></div><button className="text-button" onClick={() => setPage('projects')}>查看全部</button></div>
      {projects.length ? <div className="project-list">{projects.slice(0, 5).map((item) => <ProjectRow key={item.id} project={item} onOpen={openProject} />)}</div> : <EmptyState icon={FileText} title="还没有项目" text="完成一次视频分析或脚本生成后，结果会出现在这里。" action={<button className="button primary" onClick={() => setPage('create')}>创建第一个项目</button>} />}
    </section>
  </div>
}

function EmptyState({ icon: Icon, title, text, action }) {
  return <div className="empty-state"><div><Icon size={25} /></div><h3>{title}</h3><p>{text}</p>{action}</div>
}

function CreatePage({ status, onCreated }) {
  const [mode, setMode] = useState('script')
  return <div className="page-stack">
    <div className="page-title"><div><h1>内容制作</h1><p>所有结果都来自真实上传内容或你填写的商品资料，不使用样例数据。</p></div></div>
    {!status?.google?.configured ? <ErrorNotice message="Google Gemini 尚未配置，视频分析、脚本和 Omni Flash 生成功能暂不可用。" /> : null}
    <div className="mode-tabs"><button className={mode === 'script' ? 'active' : ''} onClick={() => setMode('script')}><Sparkles size={18} />商品资料生成脚本</button><button className={mode === 'video' ? 'active' : ''} onClick={() => setMode('video')}><Upload size={18} />上传视频分析</button></div>
    {mode === 'script' ? <ScriptForm disabled={!status?.google?.configured} onCreated={onCreated} /> : <VideoForm disabled={!status?.google?.configured} onCreated={onCreated} />}
  </div>
}

function Field({ label, hint, children }) {
  return <label className="field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>
}

function ScriptForm({ disabled, onCreated }) {
  const [form, setForm] = useState({ product: '', audience: '', sellingPoints: '', comments: '', duration: '20', style: '美式 UGC 真人口播' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const set = (key) => (event) => setForm((value) => ({ ...value, [key]: event.target.value }))
  const submit = async (event) => {
    event.preventDefault(); setLoading(true); setError('')
    try { onCreated((await postJson('/api/scripts', form)).project) } catch (err) { setError(err.message) } finally { setLoading(false) }
  }
  return <form className="form-panel" onSubmit={submit}>
    <div className="form-intro"><div><h2>创建原创带货脚本</h2><p>信息越具体，生成的脚本越接近可拍摄版本。</p></div><span>真实 AI 生成</span></div>
    <Field label="商品名称与资料"><textarea required rows="4" value={form.product} onChange={set('product')} placeholder="例如：便携式榨汁杯，USB-C 充电，适合办公室和旅行……" /></Field>
    <div className="field-grid"><Field label="目标消费者"><input value={form.audience} onChange={set('audience')} placeholder="例如：25-40 岁忙碌上班族" /></Field><Field label="视频风格"><select value={form.style} onChange={set('style')}><option>美式 UGC 真人口播</option><option>产品特写演示</option><option>问题解决型</option><option>开箱测评</option></select></Field></div>
    <Field label="核心卖点"><textarea rows="3" value={form.sellingPoints} onChange={set('sellingPoints')} placeholder="每行一个卖点，或直接粘贴商品详情" /></Field>
    <Field label="评论、常见问题或顾虑"><textarea rows="3" value={form.comments} onChange={set('comments')} placeholder="可粘贴真实评论；系统会提炼购买意向、问题和反对理由" /></Field>
    <div className="form-actions"><ErrorNotice message={error} onClose={() => setError('')} /><Field label="目标时长"><select value={form.duration} onChange={set('duration')}><option value="15">15 秒</option><option value="20">20 秒</option><option value="30">30 秒</option><option value="45">45 秒</option></select></Field><LoadingButton className="button primary" disabled={disabled} loading={loading}><Sparkles size={17} />生成脚本</LoadingButton></div>
  </form>
}

function VideoForm({ disabled, onCreated }) {
  const [file, setFile] = useState(null)
  const [product, setProduct] = useState('')
  const [comments, setComments] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault()
    if (!file) return setError('请选择一个视频文件。')
    setLoading(true); setError('')
    const body = new FormData(); body.append('video', file); body.append('product', product); body.append('comments', comments)
    try { onCreated((await api('/api/analyze-video', { method: 'POST', body })).project) } catch (err) { setError(err.message) } finally { setLoading(false) }
  }
  return <form className="form-panel" onSubmit={submit}>
    <div className="form-intro"><div><h2>分析真实商品视频</h2><p>系统会抽取关键画面、识别口播，并结合评论生成优化脚本。</p></div><span>最大 200 MB</span></div>
    <label className={`upload-zone ${file ? 'selected' : ''}`}><input type="file" accept="video/*" onChange={(event) => setFile(event.target.files?.[0] || null)} /><div><Upload size={26} /><strong>{file ? file.name : '点击选择视频'}</strong><span>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : '支持 MP4、MOV、WebM 等常见格式'}</span></div></label>
    <Field label="商品资料"><textarea rows="3" value={product} onChange={(event) => setProduct(event.target.value)} placeholder="商品名称、价格、核心卖点、目标人群等" /></Field>
    <Field label="评论样本"><textarea rows="4" value={comments} onChange={(event) => setComments(event.target.value)} placeholder="粘贴视频下方的真实评论，一行一条" /></Field>
    <div className="form-actions"><ErrorNotice message={error} onClose={() => setError('')} /><LoadingButton className="button primary" disabled={disabled || !file} loading={loading}>{loading ? '正在分析，可能需要几分钟' : '开始真实分析'}</LoadingButton></div>
  </form>
}

function ProjectDetail({ project, status, onBack, onRefresh }) {
  const result = project?.result
  const analysis = result?.analysis
  const script = analysis?.optimized_script
  const [error, setError] = useState('')
  const [task, setTask] = useState(project.videoTask || null)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [productImage, setProductImage] = useState(null)
  const [modelImage, setModelImage] = useState(null)
  const prompt = analysis?.video_prompt || ''
  const createVideo = async () => {
    setCreating(true); setError('')
    try {
      const body = new FormData()
      body.append('prompt', prompt)
      body.append('seconds', '10')
      body.append('projectId', project.id)
      if (productImage) body.append('productImage', productImage)
      if (modelImage) body.append('modelImage', modelImage)
      const created = await api('/api/videos', { method: 'POST', body })
      setTask({ provider: created.provider, id: created.id, status: created.status || 'queued', prompt })
      onRefresh()
    } catch (err) { setError(err.message) } finally { setCreating(false) }
  }
  useEffect(() => {
    if (!task?.id || ['completed', 'failed', 'cancelled'].includes(String(task.status).toLowerCase())) return undefined
    const timer = setInterval(async () => {
      try {
        const next = await api(`/api/videos/${task.provider}/${task.id}?projectId=${project.id}&prompt=${encodeURIComponent(prompt)}`)
        setTask({ ...task, ...next }); onRefresh()
      } catch (err) { setError(err.message); clearInterval(timer) }
    }, 10000)
    return () => clearInterval(timer)
  }, [task?.id, task?.provider, task?.status, project.id, prompt, onRefresh])
  if (!analysis) return <EmptyState icon={CircleAlert} title="项目结果不完整" text="请重新创建这个项目。" action={<button className="button secondary" onClick={onBack}>返回</button>} />
  return <div className="page-stack">
    <button className="back-button" onClick={onBack}>‹ 返回项目列表</button>
    <section className="result-hero"><div><p>{project.kind === 'analysis' ? '真实视频分析结果' : 'AI 原创脚本'}</p><h1>{script?.title || project.title}</h1><span>{formatDate(project.createdAt)} · {result.model || result.models?.analysis}</span></div><StatusPill configured readyText="已完成" /></section>
    <ErrorNotice message={error} onClose={() => setError('')} />
    <div className="result-grid">
      <section className="result-card"><h2>内容结论</h2><p className="summary-text">{analysis.summary}</p><dl><div><dt>目标消费者</dt><dd>{analysis.audience}</dd></div><div><dt>开场钩子</dt><dd>{analysis.hook?.type} · {analysis.hook?.score || 0} 分</dd></div></dl><h3>核心卖点</h3><ul>{analysis.selling_points?.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <section className="result-card"><h2>评论洞察</h2><div className="score"><strong>{analysis.comment_insights?.purchase_intent || 0}</strong><span>购买意向分</span></div><h3>消费者顾虑</h3><ul>{analysis.comment_insights?.objections?.length ? analysis.comment_insights.objections.map((item) => <li key={item}>{item}</li>) : <li>未提供足够评论样本</li>}</ul><h3>新内容角度</h3><ul>{analysis.comment_insights?.new_angles?.map((item) => <li key={item}>{item}</li>)}</ul></section>
    </div>
    <section className="section-block script-section"><div className="section-heading"><div><h2>优化后的英文脚本</h2><p>{script?.hook_zh}</p></div></div><div className="hook-copy"><span>0-3 秒钩子</span><strong>{script?.hook_en}</strong></div><div className="scene-list">{script?.scenes?.map((scene, index) => <div key={`${scene.time}-${index}`}><time>{scene.time}</time><div><strong>{scene.voice_en}</strong><p>{scene.visual}</p></div></div>)}</div><div className="cta-line"><span>CTA</span>{script?.cta_en}</div></section>
    <section className="section-block prompt-section"><div className="section-heading"><div><h2>AI 视频提示词</h2><p>专为 9:16 美区 TikTok UGC 与 Gemini Omni Flash 优化</p></div><button className="button secondary" onClick={async () => { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? <Check size={16} /> : null}{copied ? '已复制' : '复制提示词'}</button></div><pre>{prompt}</pre>{!task ? <div className="reference-upload-grid"><label className={productImage ? 'mini-upload selected' : 'mini-upload'}><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setProductImage(event.target.files?.[0] || null)} /><Upload size={19} /><span><strong>商品参考图</strong><small>{productImage?.name || '建议上传，保持商品外观准确'}</small></span></label><label className={modelImage ? 'mini-upload selected' : 'mini-upload'}><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setModelImage(event.target.files?.[0] || null)} /><Upload size={19} /><span><strong>成人模特参考图</strong><small>{modelImage?.name || '可选，用于固定 AI 出镜人物'}</small></span></label></div> : null}<div className="video-action"><div>{task ? <><strong>视频任务：{task.status || 'queued'}</strong><span>系统每 10 秒自动刷新状态</span></> : <><strong>使用 Gemini Omni Flash 生成视频</strong><span>竖屏、原生英语口播与声音；参考图可保持商品和模特一致</span></>}</div>{String(task?.status).toLowerCase() === 'completed' ? <a className="button primary" href={`/api/videos/gemini/${task.id}/content`}><Play size={17} />下载视频</a> : <LoadingButton className="button primary" loading={creating} disabled={!status?.google?.configured || Boolean(task?.id)} onClick={createVideo}><Film size={17} />{task?.id ? '正在生成' : '生成 10 秒视频'}</LoadingButton>}</div></section>
    {analysis.risks?.length ? <section className="risk-box"><CircleAlert size={20} /><div><strong>发布前检查</strong><ul>{analysis.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></div></section> : null}
  </div>
}

function ProjectsPage({ projects, openProject, removeProject }) {
  return <div className="page-stack"><div className="page-title"><div><h1>项目记录</h1><p>这里仅显示你真实创建的分析和脚本。</p></div></div><section className="section-block">{projects.length ? <div className="project-list">{projects.map((item) => <ProjectRow key={item.id} project={item} onOpen={openProject} onDelete={removeProject} />)}</div> : <EmptyState icon={FileText} title="暂无项目" text="从内容制作页面开始创建。" />}</section></div>
}

function TikTokPage({ status }) {
  const [auth, setAuth] = useState(null)
  const [videos, setVideos] = useState([])
  const [snapshot, setSnapshot] = useState(null)
  const [days, setDays] = useState('3')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const loadAuth = useCallback(() => api('/api/tiktok/auth/status').then(setAuth).catch((err) => setError(err.message)), [])
  useEffect(() => { loadAuth() }, [loadAuth])
  const sync = async () => {
    setLoading(true); setError('')
    try { const data = await postJson('/api/tiktok/bestsellers', { timeSlot: '7D', days: Number(days) }); setVideos(data.videos || []); setSnapshot(data.snapshot) } catch (err) { setError(err.message) } finally { setLoading(false) }
  }
  return <div className="page-stack"><div className="page-title"><div><h1>TikTok 官方数据</h1><p>只展示 TikTok Shop 对外开放的 Bestsellers 数据，不读取商家私有视频。</p></div></div><ErrorNotice message={error} onClose={() => setError('')} />
    <section className="connection-card"><div className="connection-icon"><Database size={24} /></div><div><h2>美国市场 Bestsellers</h2><p>{auth?.authorized ? '授权有效，可以同步官方榜单。' : status?.tiktok?.oauthReady ? '应用已配置，等待完成平台授权或审核。' : '尚未配置完整的 TikTok 应用凭证。'}</p></div><StatusPill configured={auth?.authorized} readyText="已授权" pendingText={status?.tiktok?.oauthReady ? '等待授权' : '未配置'} />{auth?.authorized ? <button className="button secondary" onClick={sync}><RefreshCw size={16} />同步数据</button> : status?.tiktok?.oauthReady ? <a className="button primary" href="/api/tiktok/oauth/start">连接 TikTok</a> : null}</section>
    {!auth?.authorized ? <section className="review-note"><Cloud size={21} /><div><strong>真实数据仍受 TikTok 官方审核控制</strong><p>你的 Bestsellers 权限和美国数据安全审核通过后，才会产生真实榜单。网站不会用演示数据填充空白。</p></div></section> : null}
    {auth?.authorized ? <div className="sync-toolbar"><label>增长窗口<select value={days} onChange={(event) => setDays(event.target.value)}><option value="3">最近 3 天</option><option value="7">最近 7 天</option></select></label><LoadingButton className="button primary" loading={loading} onClick={sync}>同步官方榜单</LoadingButton></div> : null}
    {snapshot ? <div className="notice notice-info">{snapshot.message}</div> : null}
    {videos.length ? <section className="video-table"><div className="video-table-head"><span>排名 / 视频</span><span>观看</span><span>点赞</span><span>评论</span><span>GMV 区间</span></div>{videos.map((video) => <div className="video-table-row" key={video.id}><span><b>#{video.rank}</b><strong>{video.title}</strong><small>{video.creator}</small></span><span>{formatNumber(video.views)}</span><span>{formatNumber(video.likes)}</span><span>{formatNumber(video.comments)}</span><span>{video.gmvRange || '未公开'}</span></div>)}</section> : <EmptyState icon={BarChart3} title="暂无官方榜单数据" text={auth?.authorized ? '点击“同步官方榜单”获取真实数据。首次同步只建立快照，之后才能计算 3 天或 7 天增长。' : '完成 TikTok 审核与授权后，真实榜单会显示在这里。'} />}
  </div>
}

function SettingsPage({ status, refresh }) {
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('')
  const check = async () => { setChecking(true); setMessage(''); try { const result = await postJson('/api/google/check', {}); setMessage(`连接成功：${result.model}`); refresh() } catch (err) { setMessage(err.message) } finally { setChecking(false) } }
  const services = [
    ['Google Gemini', status?.google?.configured, '完整视频理解、原创脚本与 Omni Flash 竖屏视频'],
    ['TikTok Shop', status?.tiktok?.configured, '官方 Bestsellers 榜单'],
    ['加密存储', status?.storage?.encrypted, '项目、令牌和操作记录'],
  ]
  return <div className="page-stack"><div className="page-title"><div><h1>服务状态</h1><p>这里显示的是服务器上的真实配置状态，不会向浏览器泄露密钥。</p></div></div><section className="section-block service-list">{services.map(([name, ready, description]) => <div key={name}><div><strong>{name}</strong><span>{description}</span></div><StatusPill configured={ready} /></div>)}</section>{message ? <div className="notice notice-info">{message}</div> : null}<button className="button secondary align-start" onClick={check} disabled={!status?.google?.configured || checking}>{checking ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}测试 Google Gemini 连接</button></div>
}

export default function App() {
  const initialPage = new URLSearchParams(window.location.search).get('page') || 'home'
  const [auth, setAuth] = useState({ loading: true, required: false, authenticated: false })
  const [page, setPage] = useState(initialPage)
  const [status, setStatus] = useState(null)
  const [projects, setProjects] = useState([])
  const [selected, setSelected] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [error, setError] = useState('')

  const loadData = useCallback(async () => {
    try {
      const [service, projectData] = await Promise.all([api('/api/status'), api('/api/projects')])
      setStatus(service); setProjects(projectData.projects || [])
      setSelected((current) => current ? (projectData.projects || []).find((item) => item.id === current.id) || current : null)
    } catch (err) { if (err.status === 401) setAuth((value) => ({ ...value, authenticated: false })); else setError(err.message) }
  }, [])

  const checkAuth = useCallback(async () => {
    try {
      const state = await api('/api/auth/status')
      setAuth({ ...state, loading: false })
      if (state.authenticated) await loadData()
    } catch (err) { setError(err.message); setAuth((value) => ({ ...value, loading: false })) }
  }, [loadData])

  useEffect(() => { checkAuth() }, [checkAuth])
  useEffect(() => {
    const url = new URL(window.location.href); url.searchParams.set('page', page); window.history.replaceState({}, '', url)
  }, [page])

  const openProject = (project) => { setSelected(project); setPage('detail') }
  const onCreated = (project) => { setProjects((items) => [project, ...items]); openProject(project) }
  const removeProject = async (id) => { try { await api(`/api/projects/${id}`, { method: 'DELETE' }); setProjects((items) => items.filter((item) => item.id !== id)) } catch (err) { setError(err.message) } }
  const logout = async () => { await postJson('/api/auth/logout', {}); setAuth((value) => ({ ...value, authenticated: false })) }

  const content = useMemo(() => {
    if (page === 'create') return <CreatePage status={status} onCreated={onCreated} />
    if (page === 'tiktok') return <TikTokPage status={status} />
    if (page === 'projects') return <ProjectsPage projects={projects} openProject={openProject} removeProject={removeProject} />
    if (page === 'settings') return <SettingsPage status={status} refresh={loadData} />
    if (page === 'detail' && selected) return <ProjectDetail project={selected} status={status} onBack={() => setPage('projects')} onRefresh={loadData} />
    return <HomePage projects={projects} status={status} setPage={setPage} openProject={openProject} />
  }, [page, projects, selected, status, loadData])

  if (auth.loading) return <div className="boot-screen"><LoaderCircle className="spin" size={28} />正在启动 ViralFlow</div>
  if (auth.required && !auth.authenticated) return <LoginScreen onLogin={checkAuth} />
  return <div className="app-shell"><Sidebar page={page} setPage={setPage} open={sidebarOpen} setOpen={setSidebarOpen} onLogout={logout} /><div className="main-shell"><header className="topbar"><button className="menu-button" onClick={() => setSidebarOpen(true)}><Menu size={21} /></button><div><strong>{navigation.find((item) => item.id === page)?.label || '项目详情'}</strong><span>真实内容 · 真实数据 · 原创生成</span></div><StatusPill configured={status?.google?.configured} pendingText="AI 未配置" /></header><main className="content"><ErrorNotice message={error} onClose={() => setError('')} />{content}</main></div></div>
}
