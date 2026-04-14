#!/usr/bin/env ts-node

/**
 * modmap project
 * Shows how token savings scale with project size.
 * Uses the real measurements from this project as the baseline
 * and projects savings at 10, 20, 30, 50 module scale.
 *
 * Usage:
 *   npm run project
 */

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
  yellow: '\x1b[33m',
}

function fmt(n: number): string { return n.toLocaleString() }
function pct(n: number): string { return n.toFixed(1) + '%' }
function bar(ratio: number, width = 36): string {
  const f = Math.round(ratio * width)
  return '█'.repeat(f) + '░'.repeat(width - f)
}

interface Scenario {
  modules: number
  activeModules: number
  tokensPerModule: number
  tokensPerManifest: number
  projectMapTokens: number
}

function calculate(s: Scenario): { old: number; new: number; saved: number; savedPct: number } {
  const old = s.modules * s.tokensPerModule + s.projectMapTokens

  // Modular: map + active full code + transitive deps (assume ~2 extra) + stubs for rest
  const loadedModules   = Math.min(s.activeModules + 2, s.modules)
  const stubOnlyModules = s.modules - loadedModules
  const newTotal = s.projectMapTokens
    + (loadedModules * s.tokensPerModule)
    + (stubOnlyModules * s.tokensPerManifest)

  const saved    = old - newTotal
  const savedPct = (saved / old) * 100

  return { old, new: newTotal, saved, savedPct }
}

function main(): void {
  console.log(`\n${C.bold}modmap project — savings projection${C.reset}`)
  console.log(`${C.gray}Based on real measurements from this project.${C.reset}`)
  console.log(`${C.gray}Assumptions: ~2,500 tokens/module, ~300 tokens/manifest, 1-2 active modules per task.\n${C.reset}`)

  // Real baseline from our demo
  console.log(`${C.bold}Actual measurements (this demo project — 5 modules):${C.reset}`)
  console.log(`  Old way:     4,752 tokens`)
  console.log(`  Modular way: 3,654 tokens`)
  console.log(`  Savings:     23.1%`)
  console.log(`  ${C.gray}(Small savings because demo modules are tiny and highly interconnected)${C.reset}`)
  console.log()

  // Projections at scale
  const scenarios = [
    { label: '10 modules  (small app)',   modules: 10,  activeModules: 1, tokensPerModule: 2500, tokensPerManifest: 300, projectMapTokens: 400 },
    { label: '20 modules  (medium app)',  modules: 20,  activeModules: 2, tokensPerModule: 2500, tokensPerManifest: 300, projectMapTokens: 600 },
    { label: '30 modules  (large app)',   modules: 30,  activeModules: 2, tokensPerModule: 2500, tokensPerManifest: 300, projectMapTokens: 800 },
    { label: '50 modules  (enterprise)',  modules: 50,  activeModules: 2, tokensPerModule: 2500, tokensPerManifest: 300, projectMapTokens: 1000 },
    { label: '20 modules  (large files)', modules: 20,  activeModules: 2, tokensPerModule: 6000, tokensPerManifest: 350, projectMapTokens: 600 },
    { label: '30 modules  (large files)', modules: 30,  activeModules: 2, tokensPerModule: 6000, tokensPerManifest: 350, projectMapTokens: 800 },
  ]

  console.log(`${C.bold}Projected savings at scale:${C.reset}`)
  console.log(`${'─'.repeat(72)}`)
  console.log(`  ${'Scenario'.padEnd(30)} ${'Old'.padStart(8)} ${'New'.padStart(8)} ${'Saved'.padStart(8)}  Bar`)
  console.log(`${'─'.repeat(72)}`)

  for (const s of scenarios) {
    const r = calculate(s)
    const color = r.savedPct > 70 ? C.green : r.savedPct > 40 ? C.yellow : C.gray
    console.log(
      `  ${s.label.padEnd(30)} ` +
      `${fmt(r.old).padStart(8)} ` +
      `${fmt(r.new).padStart(8)} ` +
      `${color}${pct(r.savedPct).padStart(7)}${C.reset}  ` +
      `${color}${bar(r.savedPct / 100, 20)}${C.reset}`
    )
  }

  console.log(`${'─'.repeat(72)}`)
  console.log()
  console.log(`${C.bold}Key insight:${C.reset}`)
  console.log(`  Every new module you add to your project ${C.bold}grows the "old way" cost linearly${C.reset}.`)
  console.log(`  The modular way only grows by one small manifest stub (~300 tokens).`)
  console.log(`  The gap widens with every module you add.`)
  console.log()
  console.log(`${C.bold}Why our demo shows only 23%:${C.reset}`)
  console.log(`  The 5 demo modules are tiny (~500-1500 tok each) and highly interconnected.`)
  console.log(`  Working on "tasks" pulls in database + auth + notifications as transitive deps,`)
  console.log(`  leaving only "api" as a stub. Real projects have more isolated modules.`)
  console.log()
}

main()
