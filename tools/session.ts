#!/usr/bin/env ts-node

/**
 * modmap session
 * Generates the optimised Claude prompt for a given task.
 * Automatically figures out which modules to load based on the task description.
 *
 * Usage:
 *   npm run session -- --project ./demo-app --task "add priority field to tasks"
 *   npm run session -- --project ./demo-app --task "add webhooks" --modules tasks,notifications
 */

import * as fs from 'fs'
import * as path from 'path'
import {
  readFile, fileExists, loadManifest, loadProjectMap,
  countTokensApprox, countTokensInDir, countManifestTokens,
  getAllModulePaths, getTransitiveDeps, formatNumber
} from '../src/utils'

// ── Helpers ───────────────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
  yellow: '\x1b[33m',
}

function parseArgs(): { project: string; task: string; modules: string[] } {
  const args = process.argv.slice(2)
  const get = (flag: string) => {
    const i = args.indexOf(flag)
    return i !== -1 ? args[i + 1] : null
  }
  return {
    project: get('--project') ?? './demo-app',
    task:    get('--task')    ?? '',
    modules: (get('--modules') ?? '').split(',').map(s => s.trim()).filter(Boolean),
  }
}

function readModuleCode(modulePath: string): string {
  const files = fs.readdirSync(modulePath).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))
  return files.map(f => {
    const content = readFile(path.join(modulePath, f))
    return `// ── ${f} ──\n${content}`
  }).join('\n\n')
}

function readManifestStub(modulePath: string): string {
  const manifestPath = path.join(modulePath, 'modmap.json')
  return fileExists(manifestPath) ? readFile(manifestPath) : '(no modmap.json found)'
}

// ── Simple keyword-based module guesser ───────────────────────────────────────
// When --modules not specified, guess from task description keywords

function guessModules(task: string, allModules: string[]): string[] {
  const lower = task.toLowerCase()
  const guessed: string[] = []

  for (const mod of allModules) {
    if (lower.includes(mod)) {
      guessed.push(mod)
    }
  }

  // Common keyword mappings
  const keywordMap: Record<string, string[]> = {
    'login':    ['auth'],       'logout':   ['auth'],       'token':   ['auth'],
    'user':     ['auth'],       'password': ['auth'],       'role':    ['auth'],
    'task':     ['tasks'],      'assign':   ['tasks'],      'complete':['tasks'],
    'priority': ['tasks'],      'deadline': ['tasks'],      'due':     ['tasks'],
    'notify':   ['notifications'], 'email': ['notifications'], 'alert': ['notifications'],
    'message':  ['notifications'],
    'db':       ['database'],   'schema':   ['database'],   'model':   ['database'],
    'route':    ['api'],        'endpoint': ['api'],        'handler': ['api'],
    'webhook':  ['api', 'tasks'],
  }

  for (const [keyword, mods] of Object.entries(keywordMap)) {
    if (lower.includes(keyword)) {
      for (const mod of mods) {
        if (!guessed.includes(mod)) guessed.push(mod)
      }
    }
  }

  // Default to tasks if nothing matched
  if (guessed.length === 0 && allModules.includes('tasks')) {
    guessed.push('tasks')
  }

  return guessed.length > 0 ? guessed : [allModules[0]]
}

// ── Build the session prompt ──────────────────────────────────────────────────

function buildPrompt(
  task: string,
  projectMapContent: string,
  activeModules: string[],
  modulePaths: Record<string, string>,
  allModules: string[],
  transitiveDeps: string[]
): string {
  const sections: string[] = []

  sections.push(`# Context: modmap session
Task: ${task}
Active modules: ${activeModules.join(', ')}
`)

  // Project map
  sections.push(`## project-map.json
\`\`\`json
${projectMapContent}
\`\`\``)

  // Full code for active modules + transitive deps
  const toLoad = [...new Set([...activeModules, ...transitiveDeps])]

  for (const mod of toLoad) {
    const modPath = modulePaths[mod]
    if (!modPath) continue
    const code = readModuleCode(modPath)
    sections.push(`## ${mod}/ (full code)
\`\`\`typescript
${code}
\`\`\``)
  }

  // Manifest stubs for all other modules
  const others = allModules.filter(m => !toLoad.includes(m))
  if (others.length > 0) {
    sections.push(`## Other modules (interface stubs only — do not load full code)`)
    for (const mod of others) {
      const modPath = modulePaths[mod]
      if (!modPath) continue
      const stub = readManifestStub(modPath)
      sections.push(`### ${mod}/modmap.json
\`\`\`json
${stub}
\`\`\``)
    }
  }

  sections.push(`## Your task
${task}

Rules:
- Only modify files in: ${activeModules.join(', ')}
- Update modmap.json if you add/change/remove any exports
- If this task requires changes to other modules, list them and stop — I will start a new session for each
- After completing, output a brief handover summary`)

  return sections.join('\n\n')
}

// ── CLI entry point ───────────────────────────────────────────────────────────

function main(): void {
  const { project, task, modules } = parseArgs()

  if (!task) {
    console.error('Usage: npm run session -- --project ./demo-app --task "your task description"')
    process.exit(1)
  }

  const projectPath = path.resolve(project)
  const map = loadProjectMap(projectPath)

  if (!map) {
    console.error(`project-map.json not found in ${projectPath}`)
    process.exit(1)
  }

  const allModulePaths = getAllModulePaths(projectPath, map)
  const activeModules  = modules.length > 0 ? modules : guessModules(task, map.modules)
  const transitiveDeps = activeModules.flatMap(m => getTransitiveDeps(m, map.graph))
  const uniqueDeps     = [...new Set(transitiveDeps)].filter(d => !activeModules.includes(d))

  const mapPath = path.join(projectPath, 'project-map.json')
  const projectMapContent = fileExists(mapPath) ? readFile(mapPath) : '{}'

  const prompt = buildPrompt(task, projectMapContent, activeModules, allModulePaths, map.modules, uniqueDeps)
  const tokenCount = countTokensApprox(prompt)

  console.log(`\n${C.bold}modmap session${C.reset}`)
  console.log(`${C.gray}Task:    ${C.reset}${task}`)
  console.log(`${C.gray}Modules: ${C.reset}${C.green}${activeModules.join(', ')} (full code)${C.reset}`)
  if (uniqueDeps.length > 0) {
    console.log(`${C.gray}Deps:    ${C.reset}${C.cyan}${uniqueDeps.join(', ')} (full code, transitive)${C.reset}`)
  }
  const others = map.modules.filter(m => !activeModules.includes(m) && !uniqueDeps.includes(m))
  if (others.length > 0) {
    console.log(`${C.gray}Others:  ${C.reset}${C.gray}${others.join(', ')} (manifest stub only)${C.reset}`)
  }
  console.log(`${C.gray}Tokens:  ${C.reset}${C.bold}~${formatNumber(tokenCount)}${C.reset}`)
  console.log()

  // Write prompt to file
  const outDir = path.resolve('./results')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir)

  const slug = task.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
  const outPath = path.join(outDir, `session-${slug}.md`)
  fs.writeFileSync(outPath, prompt)

  console.log(`${C.bold}Prompt written to:${C.reset} ${outPath}`)
  console.log(`${C.gray}Copy its contents and paste into a new Claude chat.${C.reset}`)
  console.log()
  console.log(`${C.bold}── Prompt preview (first 800 chars) ──────────────────${C.reset}`)
  console.log(prompt.slice(0, 800) + (prompt.length > 800 ? '\n...' : ''))
  console.log()
}

main()
