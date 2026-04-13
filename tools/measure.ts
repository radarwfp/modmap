#!/usr/bin/env ts-node

/**
 * modmap measure
 * Compares token usage: pasting entire codebase vs the modular approach.
 * This is the core proof-of-concept measurement tool.
 *
 * Usage:
 *   npm run measure -- --project ./demo-app --task "add priority field" --modules tasks,database
 *   npm run measure -- --project ./demo-app --task "add email notifications" --modules notifications
 *   npm run measure -- --project ./demo-app  (measures all modules as baseline)
 */

import * as fs from 'fs'
import * as path from 'path'
import {
  readFile, fileExists, loadManifest, loadProjectMap,
  countTokensApprox, countTokensInDir, countManifestTokens,
  formatNumber, formatPct, getAllModulePaths, getTransitiveDeps
} from '../src/utils'
import type { MeasureResult } from '../src/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
  blue:   '\x1b[34m',
}

function bar(tokens: number, maxTokens: number, width = 40): string {
  const filled = Math.round((tokens / maxTokens) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function parseArgs(): { project: string; task: string; modules: string[] } {
  const args = process.argv.slice(2)
  const get = (flag: string) => {
    const i = args.indexOf(flag)
    return i !== -1 ? args[i + 1] : null
  }

  const project = get('--project') ?? './demo-app'
  const task    = get('--task')    ?? 'general task'
  const mods    = get('--modules') ?? ''

  return {
    project,
    task,
    modules: mods ? mods.split(',').map(m => m.trim()) : [],
  }
}

// ── Measurement logic ─────────────────────────────────────────────────────────

function measureOldWay(projectPath: string, modulePaths: Record<string, string>): { total: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {}

  for (const [name, modPath] of Object.entries(modulePaths)) {
    const tokens = countTokensInDir(modPath, ['.ts'])
    breakdown[name] = tokens
  }

  // Also count project-map.json as part of old way
  const mapPath = path.join(projectPath, 'project-map.json')
  if (fileExists(mapPath)) {
    breakdown['project-map.json'] = countTokensApprox(readFile(mapPath))
  }

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0)
  return { total, breakdown }
}

function measureModularWay(
  projectPath: string,
  activeModules: string[],
  allModulePaths: Record<string, string>,
  map: ReturnType<typeof loadProjectMap>
): { total: number; breakdown: { projectMap: number; activeModuleCode: number; allManifests: number }; detail: Record<string, number> } {

  // 1. project-map.json (always included — it's tiny)
  const mapPath = path.join(projectPath, 'project-map.json')
  const projectMapTokens = fileExists(mapPath) ? countTokensApprox(readFile(mapPath)) : 0

  // 2. Full code of active modules + their transitive deps
  const modulesToLoad = new Set<string>(activeModules)
  if (map) {
    for (const mod of activeModules) {
      const deps = getTransitiveDeps(mod, map.graph)
      deps.forEach(d => modulesToLoad.add(d))
    }
  }

  const detail: Record<string, number> = {}
  let activeCodeTokens = 0
  for (const mod of modulesToLoad) {
    const modPath = allModulePaths[mod]
    if (modPath) {
      const t = countTokensInDir(modPath, ['.ts'])
      detail[mod] = t
      activeCodeTokens += t
    }
  }

  // 3. module.json stubs for ALL other modules (interface only, not code)
  let manifestTokens = 0
  for (const [name, modPath] of Object.entries(allModulePaths)) {
    if (!modulesToLoad.has(name)) {
      const t = countManifestTokens(modPath)
      detail[`${name} (manifest only)`] = t
      manifestTokens += t
    }
  }

  return {
    total: projectMapTokens + activeCodeTokens + manifestTokens,
    breakdown: {
      projectMap: projectMapTokens,
      activeModuleCode: activeCodeTokens,
      allManifests: manifestTokens,
    },
    detail,
  }
}

// ── Print report ──────────────────────────────────────────────────────────────

function printReport(result: MeasureResult, detail: { old: Record<string, number>; new: Record<string, number> }): void {
  const maxTokens = result.oldWay.totalTokens

  console.log(`\n${C.bold}modmap measure${C.reset}`)
  console.log(`${C.gray}Task: "${result.task}"${C.reset}`)
  console.log(`${C.gray}Modules in scope: ${result.modulesInvolved.join(', ')}${C.reset}`)
  console.log()

  // ── Old way ──
  console.log(`${C.bold}OLD WAY${C.reset} — paste entire codebase`)
  console.log(`${C.red}${bar(result.oldWay.totalTokens, maxTokens)}${C.reset}  ${C.bold}${formatNumber(result.oldWay.totalTokens)} tokens${C.reset}`)
  console.log()
  for (const [name, tokens] of Object.entries(detail.old)) {
    const pct = ((tokens / result.oldWay.totalTokens) * 100).toFixed(1)
    console.log(`  ${C.gray}${name.padEnd(28)}${C.reset} ${formatNumber(tokens).padStart(7)} tok  (${pct}%)`)
  }

  console.log()

  // ── Modular way ──
  console.log(`${C.bold}MODULAR WAY${C.reset} — project-map + active modules only`)
  console.log(`${C.green}${bar(result.modularWay.totalTokens, maxTokens)}${C.reset}  ${C.bold}${formatNumber(result.modularWay.totalTokens)} tokens${C.reset}`)
  console.log()

  const { projectMap, activeModuleCode, allManifests } = result.modularWay.breakdown
  console.log(`  ${C.blue}${'project-map.json'.padEnd(28)}${C.reset} ${formatNumber(projectMap).padStart(7)} tok`)
  console.log(`  ${C.green}${'active module code'.padEnd(28)}${C.reset} ${formatNumber(activeModuleCode).padStart(7)} tok`)
  console.log(`  ${C.cyan}${'other manifests (stubs)'.padEnd(28)}${C.reset} ${formatNumber(allManifests).padStart(7)} tok`)

  console.log()

  // ── Savings ──
  const divider = '═'.repeat(52)
  console.log(divider)
  console.log(`  Tokens saved:   ${C.bold}${C.green}${formatNumber(result.savings.tokens)}${C.reset}`)
  console.log(`  Savings:        ${C.bold}${C.green}${formatPct(result.savings.percentage)}${C.reset}`)
  console.log(`  Context ratio:  ${C.bold}${formatPct(100 - result.savings.percentage)}${C.reset} of original`)
  console.log(divider)
  console.log()
}

// ── CLI entry point ───────────────────────────────────────────────────────────

function main(): void {
  const { project, task, modules } = parseArgs()
  const projectPath = path.resolve(project)

  if (!fs.existsSync(projectPath)) {
    console.error(`Project path not found: ${projectPath}`)
    process.exit(1)
  }

  const map = loadProjectMap(projectPath)
  if (!map) {
    console.error(`project-map.json not found in ${projectPath}`)
    process.exit(1)
  }

  const allModulePaths = getAllModulePaths(projectPath, map)

  // Default: if no modules specified, use all (baseline measurement)
  const activeModules = modules.length > 0 ? modules : map.modules

  // Validate requested modules exist
  for (const mod of activeModules) {
    if (!allModulePaths[mod]) {
      console.error(`Unknown module: "${mod}". Available: ${map.modules.join(', ')}`)
      process.exit(1)
    }
  }

  const oldMeasure  = measureOldWay(projectPath, allModulePaths)
  const newMeasure  = measureModularWay(projectPath, activeModules, allModulePaths, map)
  const savedTokens = oldMeasure.total - newMeasure.total
  const savedPct    = (savedTokens / oldMeasure.total) * 100

  const result: MeasureResult = {
    task,
    modulesInvolved: activeModules,
    oldWay: { totalTokens: oldMeasure.total, breakdown: oldMeasure.breakdown },
    modularWay: { totalTokens: newMeasure.total, breakdown: newMeasure.breakdown },
    savings: { tokens: savedTokens, percentage: savedPct },
  }

  printReport(result, { old: oldMeasure.breakdown, new: newMeasure.detail })

  // Save results to file
  const resultsDir = path.resolve('./results')
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir)

  const slug = task.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
  const outPath = path.join(resultsDir, `${slug}.json`)
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2))
  console.log(`${C.gray}Results saved to ${outPath}${C.reset}\n`)
}

main()
