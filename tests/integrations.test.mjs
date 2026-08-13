import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { GoogleGenAI } from '@google/genai'
import RunwayML from '@runwayml/sdk'
import { generateTikTokSign } from '../server/tiktok.mjs'
import { config, serviceStatus } from '../server/config.mjs'
import { completeAuthorization, getTikTokAuthorizationStatus } from '../server/tiktok-auth.mjs'
import { readSecureJson, writeSecureJson } from '../server/secure-storage.mjs'
import {
  accountInternals, authenticateAccount, changeAccountPassword, createAccountSession,
  deleteAccount, getSessionUser, listAccounts, registerAccount, setAccountStatus, updateAccountProfile,
} from '../server/accounts.mjs'
import { createProject, deleteAllProjects, listProjects } from '../server/projects.mjs'
import { adjustCredits, deleteCreditAccount, getCreditAccount, refundCredits, reserveCredits } from '../server/credits.mjs'

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
  assert.equal(appSource.includes('/api/videos/${task.provider}/${task.id}/content'), true)
})

test('国内外视频模型目录和 Runway 官方方法均已接入', () => {
  const models = serviceStatus().videoModels
  assert.deepEqual(models.map((item) => item.id), ['gemini-omni', 'seedance-2', 'runway-gen45', 'runway-ugc'])
  assert.equal(models.find((item) => item.id === 'seedance-2')?.region, '国内')
  assert.equal(models.find((item) => item.id === 'runway-gen45')?.region, '海外')
  const client = new RunwayML({ apiKey: 'test-only' })
  assert.equal(typeof client.imageToVideo.create, 'function')
  assert.equal(typeof client.tasks.retrieve, 'function')
  assert.equal(typeof client.recipes.productUgc, 'function')
})

test('视频生成接口保存模型并使用统一状态与下载地址', () => {
  const serverSource = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
  const videoSource = fs.readFileSync(new URL('../server/videos.mjs', import.meta.url), 'utf8')
  assert.equal(serverSource.includes('model: task.model'), true)
  assert.equal(serverSource.includes("'/api/videos/:provider/:id/content'"), true)
  assert.equal(videoSource.includes("model: 'seedance2'"), false)
  assert.equal(videoSource.includes("client.recipes.productUgc"), true)
  assert.equal(videoSource.includes("ratio: '720:1280'"), true)
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

test('客户密码使用慢速加盐算法保存并可安全验证', async () => {
  const password = 'A unique customer password 2026!'
  const stored = await accountInternals.passwordHash(password)
  assert.equal(stored.includes(password), false)
  assert.equal(stored.startsWith('scrypt$65536$8$2$'), true)
  assert.equal(await accountInternals.verifyPassword(password, stored), true)
  assert.equal(await accountInternals.verifyPassword('wrong-password', stored), false)
})

test('客户可以维护资料密码，管理员可以暂停和恢复账户', async () => {
  const previousDataDir = config.dataDir
  const temporaryDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viralflow-accounts-'))
  config.dataDir = temporaryDataDir
  try {
    const registered = await registerAccount({ name: '测试客户', email: 'customer@example.com', password: 'Blue lantern river 2026!' })
    assert.equal(registered.status, 'active')
    assert.equal((await authenticateAccount('customer@example.com', 'Blue lantern river 2026!'))?.id, registered.id)

    const updated = await updateAccountProfile(registered.id, { name: '更新后的客户' })
    assert.equal(updated.name, '更新后的客户')

    await changeAccountPassword(registered.id, 'Blue lantern river 2026!', 'Copper meadow sky 2026!')
    assert.equal(await authenticateAccount('customer@example.com', 'Blue lantern river 2026!'), null)
    assert.equal((await authenticateAccount('customer@example.com', 'Copper meadow sky 2026!'))?.name, '更新后的客户')

    const session = await createAccountSession(registered)
    await setAccountStatus(registered.id, 'suspended')
    assert.equal(await getSessionUser(session.token, { id: 'admin' }), null)
    assert.equal((await listAccounts())[0].status, 'suspended')

    await setAccountStatus(registered.id, 'active')
    assert.equal((await authenticateAccount('customer@example.com', 'Copper meadow sky 2026!'))?.status, 'active')
    await deleteAccount(registered.id, 'Copper meadow sky 2026!')
    assert.equal((await listAccounts()).length, 0)
  } finally {
    config.dataDir = previousDataDir
    fs.rmSync(temporaryDataDir, { recursive: true, force: true })
  }
})

test('两个客户的项目数据彼此隔离', async () => {
  const ownerA = `test-a-${crypto.randomUUID()}`
  const ownerB = `test-b-${crypto.randomUUID()}`
  try {
    await createProject({ title: '客户 A 的项目' }, ownerA)
    await createProject({ title: '客户 B 的项目' }, ownerB)
    assert.deepEqual((await listProjects(ownerA)).map((item) => item.title), ['客户 A 的项目'])
    assert.deepEqual((await listProjects(ownerB)).map((item) => item.title), ['客户 B 的项目'])
  } finally {
    await deleteAllProjects(ownerA)
    await deleteAllProjects(ownerB)
  }
})

test('客户额度支持赠送、消费、退款和管理员调整', async () => {
  const previousDataDir = config.dataDir
  const previousSignupCredits = config.billing.signupCredits
  const temporaryDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viralflow-credits-'))
  const ownerId = `credit-${crypto.randomUUID()}`
  config.dataDir = temporaryDataDir
  config.billing.signupCredits = 10
  try {
    const initial = await getCreditAccount(ownerId)
    assert.equal(initial.balance, 10)
    assert.equal(initial.transactions[0].reason, '新客户体验额度')

    const charge = await reserveCredits(ownerId, 'script', '测试商品')
    assert.equal(charge.cost, config.billing.costs.script)
    assert.equal((await getCreditAccount(ownerId)).balance, 10 - config.billing.costs.script)

    await refundCredits(ownerId, charge.chargeId)
    await refundCredits(ownerId, charge.chargeId)
    assert.equal((await getCreditAccount(ownerId)).balance, 10)

    const adjusted = await adjustCredits(ownerId, { amount: 25, reason: '测试充值' })
    assert.equal(adjusted.balance, 35)
    await assert.rejects(() => adjustCredits(ownerId, { amount: -100, reason: '超额扣减' }), /余额不能小于 0/)
    await deleteCreditAccount(ownerId)
  } finally {
    config.dataDir = previousDataDir
    config.billing.signupCredits = previousSignupCredits
    fs.rmSync(temporaryDataDir, { recursive: true, force: true })
  }
})

test('公开访客模式和管理员权限保护已经启用', () => {
  const serverSource = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
  const securitySource = fs.readFileSync(new URL('../server/security.mjs', import.meta.url), 'utf8')
  assert.equal(serverSource.includes("code: 'REGISTRATION_DISABLED'"), true)
  assert.equal(serverSource.includes("'/api/google/check', requireAdmin"), true)
  assert.equal(serverSource.includes("'/api/admin/accounts', requireAdmin"), true)
  assert.equal(serverSource.includes("'/api/account/password'"), true)
  assert.equal(serverSource.includes("'/api/credits'"), true)
  assert.equal(serverSource.includes("'/api/admin/accounts/:id/credits'"), true)
  assert.equal(serverSource.includes("reserveCredits(req.user.id, 'script'"), true)
  assert.equal(serverSource.includes('listProjects(req.user.id)'), true)
  assert.equal(securitySource.includes("role: 'guest'"), true)
  assert.equal(securitySource.includes('registrationEnabled:false'), true)
  assert.equal(securitySource.includes('req.user = publicGuest(req, res)'), true)
  assert.equal(securitySource.includes('HttpOnly; SameSite=Strict'), true)
  assert.equal(securitySource.includes("guestCookie = 'viralflow_guest'"), true)
})
