import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { config } from './config.mjs'

const { Pool } = pg
const envelopeVersion = 1
let pool
let tableReady

function targetPath(filePath) {
  return filePath instanceof URL ? fileURLToPath(filePath) : path.resolve(filePath)
}

function storageKey(filePath) {
  const target = targetPath(filePath)
  const relative = path.relative(config.dataDir, target)
  return (relative.startsWith('..') ? path.basename(target) : relative).replaceAll('\\', '/')
}

async function database() {
  if (!config.databaseUrl) return null
  if (!pool) pool = new Pool({ connectionString: config.databaseUrl, max: 5 })
  if (!tableReady) {
    tableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS viralflow_kv (
        key TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
  }
  await tableReady
  return pool
}

function encryptionKey() {
  if (!config.security.dataEncryptionKey) return null
  return crypto.createHash('sha256').update(config.security.dataEncryptionKey, 'utf8').digest()
}

function encryptJson(value) {
  const key = encryptionKey()
  if (!key) return value
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    encrypted: true,
    version: envelopeVersion,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: ciphertext.toString('base64'),
  }
}

function decryptJson(value) {
  if (!value?.encrypted) return value
  const key = encryptionKey()
  if (!key) throw new Error('数据已加密，但服务器缺少 DATA_ENCRYPTION_KEY。')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()])
  return JSON.parse(plaintext.toString('utf8'))
}

export async function readSecureJson(filePath, fallback) {
  const db = await database()
  if (db) {
    const result = await db.query('SELECT payload FROM viralflow_kv WHERE key = $1', [storageKey(filePath)])
    return result.rows.length ? decryptJson(result.rows[0].payload) : fallback
  }
  try {
    return decryptJson(JSON.parse(await fs.readFile(targetPath(filePath), 'utf8')))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

export async function writeSecureJson(filePath, value) {
  const stored = encryptJson(value)
  const db = await database()
  if (db) {
    await db.query(`
      INSERT INTO viralflow_kv (key, payload, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
    `, [storageKey(filePath), JSON.stringify(stored)])
    return
  }
  const target = targetPath(filePath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.tmp`
  await fs.writeFile(temporary, JSON.stringify(stored, null, 2), { encoding: 'utf8', mode: 0o600 })
  await fs.rename(temporary, target)
}

export async function deleteSecureJson(filePath) {
  const db = await database()
  if (db) {
    await db.query('DELETE FROM viralflow_kv WHERE key = $1', [storageKey(filePath)])
    return
  }
  await fs.rm(targetPath(filePath), { force: true })
}

export function secureStorageStatus() {
  return {
    provider: config.databaseUrl ? 'PostgreSQL' : 'file',
    encryptedAtRest: Boolean(encryptionKey()),
    algorithm: encryptionKey() ? 'AES-256-GCM' : null,
  }
}
