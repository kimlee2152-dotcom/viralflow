import path from 'node:path'
import { config } from './config.mjs'
import { deleteSecureJson, readSecureJson, writeSecureJson } from './secure-storage.mjs'

const historyFile = path.join(config.dataDir, 'snapshots', 'video-history.json')

async function readHistory() {
  return readSecureJson(historyFile, [])
}

function growth(current, previous, field) {
  if (!previous || !Number.isFinite(current[field]) || !Number.isFinite(previous[field])) return null
  const delta = current[field] - previous[field]
  const rate = previous[field] > 0 ? (delta / previous[field]) * 100 : null
  return { delta, rate: rate == null ? null : Number(rate.toFixed(2)) }
}

export async function recordAndCompare(videos, requestedDays = 3) {
  const now = Date.now()
  const days = [3, 7].includes(Number(requestedDays)) ? Number(requestedDays) : 3
  const history = await readHistory()
  const target = now - days * 86400000
  const baseline = history.filter((item) => item.recordedAt <= target).sort((a, b) => b.recordedAt - a.recordedAt)[0] || null
  const baselineMap = new Map((baseline?.videos || []).map((video) => [video.id, video]))
  const enriched = videos.map((video) => {
    const previous = baselineMap.get(video.id)
    return {
      ...video,
      growth: {
        views: growth(video, previous, 'views'),
        likes: growth(video, previous, 'likes'),
        comments: growth(video, previous, 'comments'),
        shares: growth(video, previous, 'shares'),
      },
    }
  })
  const latest = history.at(-1)
  if (!latest || now - latest.recordedAt >= 30 * 60 * 1000) {
    const next = [...history, {
      recordedAt: now,
      videos: videos.map(({ id, views, likes, comments, shares }) => ({ id, views, likes, comments, shares })),
    }].filter((item) => now - item.recordedAt <= 9 * 86400000)
    await writeSecureJson(historyFile, next)
  }
  return {
    videos: enriched,
    snapshot: {
      requestedDays: days,
      baselineAvailable: Boolean(baseline),
      baselineAt: baseline ? new Date(baseline.recordedAt).toISOString() : null,
      message: baseline ? `已按 ${days} 天前快照计算增长` : `已保存首个快照；积累 ${days} 天后可计算真实增长率`,
    },
  }
}

export async function deleteSnapshots() {
  await deleteSecureJson(historyFile)
  return { deleted: true }
}
