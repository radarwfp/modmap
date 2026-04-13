import * as fs from 'fs'
import * as path from 'path'
import type { ModuleManifest, ProjectMap } from './types'

// ── File helpers ─────────────────────────────────────────────────────────────

export function readJson<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(raw) as T
}

export function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath)
}

export function readDir(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return []
  return fs.readdirSync(dirPath)
}

export function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8')
}

// ── Manifest helpers ──────────────────────────────────────────────────────────

export function findProjectRoot(startDir: string = process.cwd()): string {
  let dir = startDir
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'project-map.json'))) return dir
    dir = path.dirname(dir)
  }
  return startDir
}

export function loadManifest(modulePath: string): ModuleManifest | null {
  const manifestPath = path.join(modulePath, 'module.json')
  if (!fileExists(manifestPath)) return null
  return readJson<ModuleManifest>(manifestPath)
}

export function loadProjectMap(rootDir: string): ProjectMap | null {
  const mapPath = path.join(rootDir, 'project-map.json')
  if (!fileExists(mapPath)) return null
  return readJson<ProjectMap>(mapPath)
}

export function getAllModulePaths(rootDir: string, map: ProjectMap): Record<string, string> {
  const result: Record<string, string> = {}
  for (const mod of map.modules) {
    result[mod] = path.join(rootDir, mod)
  }
  return result
}

// ── Token counting ────────────────────────────────────────────────────────────
// Uses a simple but accurate approximation:
// 1 token ≈ 4 characters for English code/prose (conservative, actual is ~3.5-4)

export function countTokensApprox(text: string): number {
  return Math.ceil(text.length / 4)
}

export function countTokensInFile(filePath: string): number {
  if (!fileExists(filePath)) return 0
  const content = readFile(filePath)
  return countTokensApprox(content)
}

export function countTokensInDir(dirPath: string, extensions = ['.ts', '.js', '.json', '.md']): number {
  if (!fs.existsSync(dirPath)) return 0
  let total = 0
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
      total += countTokensInFile(path.join(dirPath, entry.name))
    }
  }
  return total
}

export function countManifestTokens(modulePath: string): number {
  return countTokensInFile(path.join(modulePath, 'module.json'))
}

// ── Dependency resolution ─────────────────────────────────────────────────────

export function getTransitiveDeps(
  moduleName: string,
  graph: ProjectMap['graph'],
  visited = new Set<string>()
): string[] {
  if (visited.has(moduleName)) return []
  visited.add(moduleName)
  const direct = graph[moduleName]?.dependsOn ?? []
  const transitive: string[] = []
  for (const dep of direct) {
    transitive.push(dep)
    transitive.push(...getTransitiveDeps(dep, graph, visited))
  }
  return [...new Set(transitive)]
}

// ── Formatting ────────────────────────────────────────────────────────────────

export function formatNumber(n: number): string {
  return n.toLocaleString()
}

export function formatPct(n: number): string {
  return n.toFixed(1) + '%'
}

export function today(): string {
  return new Date().toISOString().split('T')[0]
}
