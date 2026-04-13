#!/usr/bin/env ts-node

/**
 * modmap validate
 * Checks every module.json in a project against its actual source files.
 * Warns on: missing exports, extra exports, missing imports, stale dates.
 *
 * Usage:
 *   npm run validate -- ./demo-app
 *   npm run validate -- ./demo-app/tasks
 */

import * as fs from 'fs'
import * as path from 'path'
import { readJson, fileExists, readFile, loadManifest, loadProjectMap } from '../src/utils'
import type { ModuleManifest, ProjectMap } from '../src/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ValidationIssue {
  level: 'error' | 'warning' | 'info'
  message: string
}

interface ModuleValidationResult {
  moduleName: string
  modulePath: string
  issues: ValidationIssue[]
  passed: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getActualExports(dirPath: string): Set<string> {
  const exports = new Set<string>()
  const tsFiles = fs.readdirSync(dirPath).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))

  for (const file of tsFiles) {
    const src = readFile(path.join(dirPath, file))
    const funcRegex = /export\s+(?:async\s+)?function\s+(\w+)/g
    const constRegex = /export\s+const\s+(\w+)/g
    const classRegex = /export\s+(?:default\s+)?class\s+(\w+)/g
    let match
    while ((match = funcRegex.exec(src)) !== null) exports.add(match[1])
    while ((match = constRegex.exec(src)) !== null) exports.add(match[1])
    while ((match = classRegex.exec(src)) !== null) exports.add(match[1])
  }

  return exports
}

function getActualFiles(dirPath: string): Set<string> {
  return new Set(
    fs.readdirSync(dirPath).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))
  )
}

function daysSince(dateStr: string): number {
  const d = new Date(dateStr)
  const now = new Date()
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
}

// ── Validate a single module ──────────────────────────────────────────────────

function validateModule(modulePath: string): ModuleValidationResult {
  const moduleName = path.basename(modulePath)
  const issues: ValidationIssue[] = []

  // 1. Check manifest exists
  const manifest = loadManifest(modulePath)
  if (!manifest) {
    return {
      moduleName,
      modulePath,
      issues: [{ level: 'error', message: 'module.json not found — run: npm run generate -- ' + modulePath }],
      passed: false,
    }
  }

  // 2. Check all listed files actually exist
  for (const file of manifest.files) {
    if (!fileExists(path.join(modulePath, file))) {
      issues.push({ level: 'error', message: `Listed file not found: ${file}` })
    }
  }

  // 3. Check for unlisted .ts files
  const actualFiles = getActualFiles(modulePath)
  for (const file of actualFiles) {
    if (!manifest.files.includes(file)) {
      issues.push({ level: 'warning', message: `Unlisted file (add to manifest): ${file}` })
    }
  }

  // 4. Check exported symbols exist in actual source
  const actualExports = getActualExports(modulePath)

  // Filter out db.* style nested exports — they reference object properties
  const topLevelManifestExports = Object.keys(manifest.exports)
    .filter(k => !k.includes('.'))

  for (const exportName of topLevelManifestExports) {
    if (!actualExports.has(exportName)) {
      issues.push({ level: 'error', message: `Manifest declares export "${exportName}" but it's not found in source` })
    }
  }

  // 5. Check for undeclared exports in source
  for (const actualExport of actualExports) {
    const isDeclared = Object.keys(manifest.exports).some(
      k => k === actualExport || k.startsWith(actualExport + '.')
    )
    if (!isDeclared) {
      issues.push({ level: 'warning', message: `Undeclared export in source: "${actualExport}" (add to manifest or mark internal)` })
    }
  }

  // 6. Check description is not placeholder
  if (manifest.description.startsWith('TODO:')) {
    issues.push({ level: 'warning', message: 'Description is still a placeholder' })
  }

  // 7. Check status
  if (!manifest.status) {
    issues.push({ level: 'info', message: 'No status set (draft/stable/deprecated)' })
  }

  // 8. Check lastModified staleness
  if (manifest.lastModified) {
    const days = daysSince(manifest.lastModified)
    if (days > 30) {
      issues.push({ level: 'info', message: `module.json last modified ${days} days ago — verify it's still accurate` })
    }
  } else {
    issues.push({ level: 'info', message: 'No lastModified date set' })
  }

  const hasErrors = issues.some(i => i.level === 'error')
  return { moduleName, modulePath, issues, passed: !hasErrors }
}

// ── Validate project-map.json ─────────────────────────────────────────────────

function validateProjectMap(rootPath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const mapPath = path.join(rootPath, 'project-map.json')

  if (!fileExists(mapPath)) {
    return [{ level: 'error', message: 'project-map.json not found at ' + rootPath }]
  }

  const map = readJson<ProjectMap>(mapPath)

  // Check all listed modules exist
  for (const mod of map.modules) {
    const modPath = path.join(rootPath, mod)
    if (!fs.existsSync(modPath)) {
      issues.push({ level: 'error', message: `project-map.json lists module "${mod}" but folder not found` })
    }
  }

  // Check graph references known modules
  for (const [mod, { dependsOn }] of Object.entries(map.graph)) {
    if (!map.modules.includes(mod)) {
      issues.push({ level: 'error', message: `Graph references unknown module: "${mod}"` })
    }
    for (const dep of dependsOn) {
      if (!map.modules.includes(dep)) {
        issues.push({ level: 'error', message: `Module "${mod}" depends on unknown module: "${dep}"` })
      }
    }
  }

  // Check for circular dependencies (simple DFS)
  function hasCycle(mod: string, visited: Set<string>, stack: Set<string>): boolean {
    visited.add(mod)
    stack.add(mod)
    for (const dep of (map.graph[mod]?.dependsOn ?? [])) {
      if (!visited.has(dep) && hasCycle(dep, visited, stack)) return true
      if (stack.has(dep)) return true
    }
    stack.delete(mod)
    return false
  }

  for (const mod of map.modules) {
    if (hasCycle(mod, new Set(), new Set())) {
      issues.push({ level: 'error', message: `Circular dependency detected involving module: "${mod}"` })
    }
  }

  return issues
}

// ── Print results ─────────────────────────────────────────────────────────────

const ICONS = { error: '✗', warning: '⚠', info: 'ℹ' }
const COLORS = { error: '\x1b[31m', warning: '\x1b[33m', info: '\x1b[36m', reset: '\x1b[0m', green: '\x1b[32m', bold: '\x1b[1m' }

function printResult(result: ModuleValidationResult): void {
  const icon = result.passed ? `${COLORS.green}✓${COLORS.reset}` : `${COLORS.error}✗${COLORS.reset}`
  console.log(`\n${icon} ${COLORS.bold}${result.moduleName}${COLORS.reset}`)

  if (result.issues.length === 0) {
    console.log(`  ${COLORS.green}All checks passed${COLORS.reset}`)
    return
  }

  for (const issue of result.issues) {
    const color = COLORS[issue.level]
    const icon = ICONS[issue.level]
    console.log(`  ${color}${icon}${COLORS.reset} ${issue.message}`)
  }
}

// ── CLI entry point ───────────────────────────────────────────────────────────

function main(): void {
  const targetArg = process.argv[2]
  if (!targetArg) {
    console.error('Usage: npm run validate -- <project-root-or-module-path>')
    process.exit(1)
  }

  const targetPath = path.resolve(targetArg)
  console.log(`\n${COLORS.bold}modmap validate${COLORS.reset} — ${targetPath}\n`)

  // Check if it's a single module (has .ts files) or a project root
  const hasTsFiles = fs.existsSync(targetPath) &&
    fs.readdirSync(targetPath).some(f => f.endsWith('.ts'))

  if (hasTsFiles) {
    // Single module
    const result = validateModule(targetPath)
    printResult(result)
    process.exit(result.passed ? 0 : 1)
  }

  // Project root — validate map + all modules
  const mapIssues = validateProjectMap(targetPath)
  if (mapIssues.length > 0) {
    console.log(`${COLORS.bold}project-map.json${COLORS.reset}`)
    for (const issue of mapIssues) {
      console.log(`  ${COLORS[issue.level]}${ICONS[issue.level]}${COLORS.reset} ${issue.message}`)
    }
  } else {
    console.log(`${COLORS.green}✓${COLORS.reset} ${COLORS.bold}project-map.json${COLORS.reset} — OK`)
  }

  const subdirs = fs.readdirSync(targetPath, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => path.join(targetPath, e.name))

  const results = subdirs.map(validateModule)
  results.forEach(printResult)

  const errorCount = results.filter(r => !r.passed).length
  const warnCount  = results.reduce((n, r) => n + r.issues.filter(i => i.level === 'warning').length, 0)

  console.log(`\n${'─'.repeat(50)}`)
  if (errorCount === 0) {
    console.log(`${COLORS.green}✓ All modules passed validation${COLORS.reset}  (${warnCount} warning${warnCount !== 1 ? 's' : ''})`)
  } else {
    console.log(`${COLORS.error}✗ ${errorCount} module${errorCount !== 1 ? 's' : ''} failed${COLORS.reset}  (${warnCount} warning${warnCount !== 1 ? 's' : ''})`)
  }
  console.log()

  process.exit(errorCount > 0 ? 1 : 0)
}

main()
