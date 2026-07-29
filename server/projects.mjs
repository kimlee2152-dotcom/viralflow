import crypto from 'node:crypto'
import path from 'node:path'
import { config } from './config.mjs'
import { deleteSecureJson, readSecureJson, writeSecureJson } from './secure-storage.mjs'

function projectsFile(ownerId = 'admin') {
  if (ownerId === 'admin') return path.join(config.dataDir, 'projects.json')
  const safeOwner = String(ownerId).replace(/[^a-zA-Z0-9-]/g, '')
  return path.join(config.dataDir, 'users', safeOwner, 'projects.json')
}

async function readProjects(ownerId) {
  const projects = await readSecureJson(projectsFile(ownerId), [])
  return Array.isArray(projects) ? projects : []
}

async function writeProjects(projects, ownerId) {
  await writeSecureJson(projectsFile(ownerId), projects.slice(0, 200))
}

export async function listProjects(ownerId = 'admin') {
  const projects = await readProjects(ownerId)
  return projects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
}

export async function getProject(id, ownerId = 'admin') {
  return (await readProjects(ownerId)).find((project) => project.id === id) || null
}

export async function createProject(input, ownerId = 'admin') {
  const now = new Date().toISOString()
  const project = {
    id: crypto.randomUUID(),
    kind: input.kind || 'script',
    title: input.title || '未命名项目',
    status: input.status || 'completed',
    createdAt: now,
    updatedAt: now,
    ...input,
    ownerId,
  }
  const projects = await readProjects(ownerId)
  await writeProjects([project, ...projects.filter((item) => item.id !== project.id)], ownerId)
  return project
}

export async function updateProject(id, patch, ownerId = 'admin') {
  const projects = await readProjects(ownerId)
  const index = projects.findIndex((project) => project.id === id)
  if (index < 0) return null
  projects[index] = { ...projects[index], ...patch, id, ownerId, updatedAt: new Date().toISOString() }
  await writeProjects(projects, ownerId)
  return projects[index]
}

export async function deleteProject(id, ownerId = 'admin') {
  const projects = await readProjects(ownerId)
  const next = projects.filter((project) => project.id !== id)
  if (next.length === projects.length) return false
  await writeProjects(next, ownerId)
  return true
}

export async function deleteAllProjects(ownerId = 'admin') {
  await deleteSecureJson(projectsFile(ownerId))
}
