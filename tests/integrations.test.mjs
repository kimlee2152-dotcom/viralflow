import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import OpenAI from 'openai'
import ffmpegPath from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { generateTikTokSign } from '../server/tiktok.mjs'
import { config, serviceStatus } from '../server/config.mjs'
import { completeAuthorization, getTikTokAuthorizationStatus } from '../server/tiktok-auth.mjs'
import { readSecureJson, writeSecureJson } from '../server/secure-storage.mjs'

test('TikTok 官方签名示例可以复现', () => {
  const sign = generateTikTokSign('/authorization/202309/shops', {
    app_key: '29a39d', timestamp: '1623812664',
  }, 'e59af819cc')
  assert.equal(sign, 'b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8')
})

test('服务状态不会把密钥返回给浏览器', () => {
  const serialized = JSON.stringify(serviceStatus())
  assert.equal(serialized.includes('apiKey'), false)
  assert.equal(serialized.includes('appSecret'), false)
  assert.equal(serialized.includes('accessToken'), false)
})

test('TikTok 授权状态不会返回访问令牌', async () => {
  const serialized = JSON.stringify(await getTikTokAuthorizationStatus())
  assert.equal(serialized.includes('access_token'), false)
  assert.equal(serialized.includes('refresh_token'), false)
})

test('TikTok OAuth 拒绝不匹配的状态值', async () => {
  await assert.rejects(() => completeAuthorization({
    query: { code: 'test-code', state: 'short' },
    headers: { cookie: 'tiktok_oauth_state=a-different-long-state' },
  }), /授权状态校验失败/)
})

test('服务端没有店铺私有视频接口或虚构数据', () => {
  const serverSource = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
  const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.equal(serverSource.includes('/api/tiktok/shop-videos'), false)
  assert.equal(appSource.includes('demo'), false)
})

test('视频处理程序已经安装', () => {
  assert.equal(fs.existsSync(ffmpegPath), true)
  assert.equal(fs.existsSync(ffprobeStatic.path), true)
})

test('当前 OpenAI SDK 包含 Sora 任务方法', () => {
  const client = new OpenAI({ apiKey: 'test-only' })
  assert.equal(typeof client.videos.create, 'function')
  assert.equal(typeof client.videos.retrieve, 'function')
  assert.equal(typeof client.videos.downloadContent, 'function')
})

test('敏感 JSON 可以加密保存并正确读取', async () => {
  const file = new URL('../data/test-secure-storage.json', import.meta.url)
  const previous = config.security.dataEncryptionKey
  config.security.dataEncryptionKey = 'test-only-key-with-at-least-32-characters'
  try {
    await writeSecureJson(file, { access_token: 'secret-token', value: 42 })
    const raw = fs.readFileSync(file, 'utf8')
    assert.equal(raw.includes('secret-token'), false)
    assert.deepEqual(await readSecureJson(file, null), { access_token: 'secret-token', value: 42 })
  } finally {
    config.security.dataEncryptionKey = previous
    fs.rmSync(file, { force: true })
  }
})
