import crypto from 'node:crypto'
import path from 'node:path'
import { config } from './config.mjs'
import { deleteSecureJson, readSecureJson, writeSecureJson } from './secure-storage.mjs'

const projectsFile = path.join(config.dataDir, 'projects.json')

async function readProjects() {
  const projects = await readSecureJson(projectsFile, [])
  return Array.isArray(projects) ? projects : []
}

async function writeProjects(projects) {
  await writeSecureJson(projectsFile, projects.slice(0, 200))
}

export async function listProjects() {
  const projects = await readProjects()
  return projects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
}

export async function getProject(id) {
  return (await readProjects()).find((project) => project.id === id) || null
}

export async function createProject(input) {
  const now = new Date().toISOString()
  const project = {
    id: crypto.randomUUID(),
    kind: input.kind || 'script',
    title: input.title || '未命名项目',
    status: input.status || 'completed',
    createdAt: now,
    updatedAt: now,
    ...input,
  }
  const projects = await readProjects()
  await writeProjects([project, ...projects.filter((item) => item.id !== project.id)])
  return project
}

export async function updateProject(id, patch) {
  const projects = await readProjects()
  const index = projects.findIndex((project) => project.id === id)
  if (index < 0) return null
  projects[index] = { ...projects[index], ...patch, id, updatedAt: new Date().toISOString() }
  await writeProjects(projects)
  return projects[index]
}

export async function deleteProject(id) {
  const projects = await readProjects()
  const next = projects.filter((project) => project.id !== id)
  if (next.length === projects.length) return false
  await writeProjects(next)
  return true
}

export async function deleteAllProjects() {
  await deleteSecureJson(projectsFile)
}
