import crypto from 'node:crypto'
import path from 'node:path'
import { config } from './config.mjs'
import { deleteSecureJson, readSecureJson, writeSecureJson } from './secure-storage.mjs'

const creditsFile = () => path.join(config.dataDir, 'credits.json')
let writeQueue = Promise.resolve()

function serialized(task) {
  const result = writeQueue.then(task, task)
  writeQueue = result.catch(() => {})
  return result
}

function defaultState() {
  return { version: 1, wallets: {}, entries: [] }
}

function walletFor(state, ownerId) {
  if (!state.wallets[ownerId]) {
    const now = new Date().toISOString()
    state.wallets[ownerId] = {
      ownerId,
      balance: config.billing.signupCredits,
      createdAt: now,
      updatedAt: now,
    }
    if (config.billing.signupCredits > 0) {
      state.entries.unshift({
        id: crypto.randomUUID(), ownerId, type: 'credit', amount: config.billing.signupCredits,
        balanceAfter: config.billing.signupCredits, reason: '新客户体验额度', source: 'signup', createdAt: now,
      })
    }
  }
  return state.wallets[ownerId]
}

function publicEntry(entry) {
  return {
    id: entry.id, type: entry.type, amount: entry.amount, balanceAfter: entry.balanceAfter,
    reason: entry.reason, source: entry.source, sku: entry.sku || null, reference: entry.reference || null,
    createdAt: entry.createdAt,
  }
}

function publicWallet(wallet, entries = []) {
  return {
    balance: wallet.balance,
    updatedAt: wallet.updatedAt,
    transactions: entries.map(publicEntry),
    pricing: { ...config.billing.costs },
  }
}

async function readState() {
  const state = await readSecureJson(creditsFile(), defaultState())
  return state?.wallets && Array.isArray(state.entries) ? state : defaultState()
}

export async function getCreditAccount(ownerId) {
  return serialized(async () => {
    const state = await readState()
    const existed = Boolean(state.wallets[ownerId])
    const wallet = walletFor(state, ownerId)
    if (!existed) await writeSecureJson(creditsFile(), state)
    return publicWallet(wallet, state.entries.filter((entry) => entry.ownerId === ownerId).slice(0, 50))
  })
}

export async function reserveCredits(ownerId, sku, reference = '') {
  const cost = Number(config.billing.costs[sku])
  if (!Number.isFinite(cost) || cost < 0) {
    throw Object.assign(new Error('额度计费项目无效。'), { status: 400, code: 'INVALID_CREDIT_SKU' })
  }
  return serialized(async () => {
    const state = await readState()
    const wallet = walletFor(state, ownerId)
    if (wallet.balance < cost) {
      throw Object.assign(new Error(`可用额度不足，本次需要 ${cost} 点，当前剩余 ${wallet.balance} 点。`), {
        status: 402, code: 'INSUFFICIENT_CREDITS', required: cost, balance: wallet.balance,
      })
    }
    const now = new Date().toISOString()
    const entry = {
      id: crypto.randomUUID(), ownerId, type: 'debit', amount: -cost, balanceAfter: wallet.balance - cost,
      reason: creditLabel(sku), source: 'usage', sku, reference: String(reference || '').slice(0, 120), createdAt: now,
    }
    wallet.balance -= cost
    wallet.updatedAt = now
    state.entries.unshift(entry)
    state.entries = state.entries.slice(0, 100000)
    await writeSecureJson(creditsFile(), state)
    return { chargeId: entry.id, cost, balance: wallet.balance }
  })
}

export async function refundCredits(ownerId, chargeId, reason = '任务提交失败，额度已退回') {
  if (!chargeId) return null
  return serialized(async () => {
    const state = await readState()
    const charge = state.entries.find((entry) => entry.id === chargeId && entry.ownerId === ownerId && entry.type === 'debit')
    if (!charge) return null
    const existing = state.entries.find((entry) => entry.refundOf === chargeId)
    if (existing) return publicEntry(existing)
    const wallet = walletFor(state, ownerId)
    const now = new Date().toISOString()
    const entry = {
      id: crypto.randomUUID(), ownerId, type: 'refund', amount: Math.abs(charge.amount),
      balanceAfter: wallet.balance + Math.abs(charge.amount), reason, source: 'refund', sku: charge.sku,
      reference: charge.reference || '', refundOf: chargeId, createdAt: now,
    }
    wallet.balance = entry.balanceAfter
    wallet.updatedAt = now
    state.entries.unshift(entry)
    await writeSecureJson(creditsFile(), state)
    return publicEntry(entry)
  })
}

export async function adjustCredits(ownerId, input, actorId = 'admin') {
  const amount = Number(input?.amount)
  const reason = String(input?.reason || '').trim()
  if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 100000) {
    throw Object.assign(new Error('调整额度必须是 -100000 到 100000 之间的非零整数。'), { status: 400, code: 'INVALID_CREDIT_AMOUNT' })
  }
  if (reason.length < 2 || reason.length > 120) {
    throw Object.assign(new Error('请填写 2 到 120 个字符的调整原因。'), { status: 400, code: 'INVALID_CREDIT_REASON' })
  }
  return serialized(async () => {
    const state = await readState()
    const wallet = walletFor(state, ownerId)
    if (wallet.balance + amount < 0) {
      throw Object.assign(new Error(`扣减后余额不能小于 0，当前余额为 ${wallet.balance} 点。`), { status: 400, code: 'NEGATIVE_CREDIT_BALANCE' })
    }
    const now = new Date().toISOString()
    wallet.balance += amount
    wallet.updatedAt = now
    state.entries.unshift({
      id: crypto.randomUUID(), ownerId, type: amount > 0 ? 'credit' : 'debit', amount,
      balanceAfter: wallet.balance, reason, source: 'admin', actorId, createdAt: now,
    })
    await writeSecureJson(creditsFile(), state)
    return publicWallet(wallet, state.entries.filter((entry) => entry.ownerId === ownerId).slice(0, 50))
  })
}

export async function deleteCreditAccount(ownerId) {
  return serialized(async () => {
    const state = await readState()
    delete state.wallets[ownerId]
    state.entries = state.entries.filter((entry) => entry.ownerId !== ownerId)
    if (!Object.keys(state.wallets).length && !state.entries.length) await deleteSecureJson(creditsFile())
    else await writeSecureJson(creditsFile(), state)
  })
}

export function creditLabel(sku) {
  return ({
    script: 'AI 原创脚本', videoAnalysis: '视频内容分析', 'gemini-omni': 'Gemini Omni 视频生成',
    'seedance-2': 'Seedance 2 视频生成', 'runway-gen45': 'Runway Gen-4.5 视频生成',
    'runway-ugc': 'Runway Product UGC 视频生成',
  })[sku] || sku
}
