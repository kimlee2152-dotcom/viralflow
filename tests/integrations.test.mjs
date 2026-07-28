import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { GoogleGenAI } from '@google/genai'
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

test('Google Gemini SDK 包含视频理解和异步视频任务方法', () => {
  const client = new GoogleGenAI({ apiKey: 'test-only' })
  assert.equal(typeof client.files.upload, 'function')
  assert.equal(typeof client.files.get, 'function')
  assert.equal(typeof client.interactions.create, 'function')
  assert.equal(typeof client.interactions.get, 'function')
})

test('前后端已经移除 OpenAI、Sora 和 Creatify 依赖', () => {
  const files = ['../server.mjs', '../server/config.mjs', '../server/analysis.mjs', '../server/videos.mjs', '../src/App.jsx']
  const source = files.map((file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n')
  assert.equal(/OpenAI|Sora|Creatify/i.test(source), false)
  assert.equal(source.includes('gemini-omni-flash-preview'), true)
})

test('Gemini 视频任务支持商品图、成人模特图和安全下载', () => {
  const serverSource = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
  const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.equal(serverSource.includes("{ name: 'productImage', maxCount: 1 }"), true)
  assert.equal(serverSource.includes("{ name: 'modelImage', maxCount: 1 }"), true)
  assert.equal(appSource.includes("body.append('productImage', productImage)"), true)
  assert.equal(appSource.includes("body.append('modelImage', modelImage)"), true)
  assert.equal(appSource.includes('/api/videos/gemini/'), true)
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
