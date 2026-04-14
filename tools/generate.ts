#!/usr/bin/env ts-node

/**
 * modmap generate
 * Scans a module folder and auto-creates a modmap.json manifest
 * from the TypeScript exports it finds.
 *
 * Usage:
 *   npm run generate -- ./demo-app/auth
 *   npm run generate -- ./demo-app              (all subfolders)
 *   npm run generate -- ./demo-app --force      (overwrite existing manifests)
 */

import * as fs from 'fs'
import * as path from 'path'
import { writeJson, readFile, fileExists, today } from '../src/utils'
import type { ModuleManifest } from '../src/types'

const MANIFEST_FILENAME = 'modmap.json'

// ── TypeScript export parser ──────────────────────────────────────────────────

interface ParsedExport {
  name: string
  signature: string
}

function parseExports(filePath: string): ParsedExport[] {
  if (!fileExists(filePath)) return []
  const src = readFile(filePath)
  const exports: ParsedExport[] = []
  const seen = new Set<string>()

  const add = (name: string, sig: string) => {
    if (!seen.has(name)) { seen.add(name); exports.push({ name, signature: sig }) }
  }

  // export function / export async function
  const funcRegex = /export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{]+))?/g
  let m
  while ((m = funcRegex.exec(src)) !== null) {
    const params = m[2].trim().replace(/\s+/g, ' ')
    const ret = (m[3] ?? 'void').trim().replace(/\s+/g, ' ')
    add(m[1], `(${params}) => ${ret}`)
  }

  // export const name
  const constRegex = /export\s+const\s+(\w+)\s*(?::\s*([^=\n]+))?=/g
  while ((m = constRegex.exec(src)) !== null) {
    add(m[1], (m[2] ?? 'unknown').trim())
  }

  // export class
  const classRegex = /export\s+(?:default\s+)?class\s+(\w+)/g
  while ((m = classRegex.exec(src)) !== null) add(m[1], 'class')

  // export interface / export type (recorded separately, not in exports section)
  const typeRegex = /export\s+(?:interface|type)\s+(\w+)/g
  while ((m = typeRegex.exec(src)) !== null) add(m[1], 'type')

  // export { foo, bar as baz } — named re-exports
  const namedRegex = /export\s*\{([^}]+)\}\s*(?:from\s*['"][^'"]+['"])?/g
  while ((m = namedRegex.exec(src)) !== null) {
    const names = m[1].split(',').map(s => {
      const parts = s.trim().split(/\s+as\s+/)
      return (parts[1] ?? parts[0]).trim()
    }).filter(n => n && !n.startsWith('//'))
    for (const name of names) add(name, 're-export')
  }

  // export * from './other' — barrel, cannot enumerate symbols
  const barrelRegex = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g
  while ((m = barrelRegex.exec(src)) !== null) {
    add(`* from '${m[1]}'`, 'barrel re-export — symbols not enumerated, review manually')
  }

  return exports
}

function detectImports(filePath: string): Record<string, string[]> {
  if (!fileExists(filePath)) return {}
  const src = readFile(filePath)
  const imports: Record<string, string[]> = {}

  const importRegex = /import\s*\{([^}]+)\}\s*from\s*['"]\.\.\/(\w+)\//g
  let m
  while ((m = importRegex.exec(src)) !== null) {
    const symbols = m[1].split(',').map(s => {
      const parts = s.trim().split(/\s+as\s+/)
      return parts[0].trim()
    }).filter(Boolean)
    const mod = m[2]
    if (!imports[mod]) imports[mod] = []
    imports[mod].push(...symbols)
  }

  return imports
}

function getTsFiles(dirPath: string): string[] {
  return fs.readdirSync(dirPath).filter(
    f => f.endsWith('.ts') &&
         !f.endsWith('.d.ts') &&
         !f.endsWith('.test.ts') &&
         !f.endsWith('.spec.ts')
  )
  // modmap.json is .json not .ts — never picked up here
}

// ── Generate single module ────────────────────────────────────────────────────

function generateManifest(modulePath: string, force: boolean): void {
  const moduleName = path.basename(modulePath)
  const manifestPath = path.join(modulePath, MANIFEST_FILENAME)

  if (!fs.existsSync(modulePath)) {
    console.error(`  ✗ Path not found: ${modulePath}`)
    return
  }

  const tsFiles = getTsFiles(modulePath)
  if (tsFiles.length === 0) {
    console.log(`  ⚠ No .ts files in ${moduleName} — skipping`)
    return
  }

  const exists = fileExists(manifestPath)

  if (exists && !force) {
    console.log(`  ↷ ${moduleName}/modmap.json already exists — skipping (use --force to overwrite)`)
    return
  }

  const allExports: Record<string, string> = {}
  const allImports: Record<string, string[]> = {}

  for (const file of tsFiles) {
    const filePath = path.join(modulePath, file)

    for (const exp of parseExports(filePath)) {
      if (exp.signature !== 'type') {
        allExports[exp.name] = exp.signature
      }
    }

    for (const [mod, symbols] of Object.entries(detectImports(filePath))) {
      if (!allImports[mod]) allImports[mod] = []
      allImports[mod].push(...symbols)
    }
  }

  for (const mod of Object.keys(allImports)) {
    allImports[mod] = [...new Set(allImports[mod])]
  }

  const manifest: ModuleManifest = {
    name: moduleName,
    version: '1.0.0',
    description: `TODO: describe what ${moduleName} does`,
    files: tsFiles,
    exports: allExports,
    imports: allImports,
    types: {},
    env: [],
    status: 'draft',
    lastModified: today(),
  }

  writeJson(manifestPath, manifest)

  const action = exists ? 'overwritten' : 'created'
  const ec = Object.keys(allExports).length
  const ic = Object.keys(allImports).length
  console.log(`  ✓ ${moduleName}/modmap.json ${action} (${ec} exports, ${ic} import source${ic !== 1 ? 's' : ''})`)
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2)
  const targetArg = args.find(a => !a.startsWith('--'))
  const force = args.includes('--force')

  if (!targetArg) {
    console.error('Usage: npm run generate -- <path> [--force]')
    process.exit(1)
  }

  const targetPath = path.resolve(targetArg)

  if (!fs.existsSync(targetPath)) {
    console.error(`Path not found: ${targetPath}`)
    process.exit(1)
  }

  console.log(`\nmodmap generate${force ? ' (--force)' : ''}\n`)

  const tsFiles = getTsFiles(targetPath)

  if (tsFiles.length > 0) {
    generateManifest(targetPath, force)
  } else {
    const subdirs = fs.readdirSync(targetPath, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => path.join(targetPath, e.name))

    if (subdirs.length === 0) {
      console.log('No subdirectories found.')
      process.exit(0)
    }

    for (const subdir of subdirs) generateManifest(subdir, force)
  }

  console.log(`\nDone. Review generated modmap.json files and fill in descriptions.\n`)
}

main()
