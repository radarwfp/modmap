#!/usr/bin/env ts-node

/**
 * modmap generate
 * Scans a module folder and auto-creates a module.json stub
 * from the TypeScript exports it finds.
 *
 * Usage:
 *   npm run generate -- ./demo-app/auth
 *   npm run generate -- ./demo-app  (generates for all modules)
 */

import * as fs from 'fs'
import * as path from 'path'
import { writeJson, readFile, fileExists, today } from '../src/utils'
import type { ModuleManifest } from '../src/types'

// ── TypeScript export parser (regex-based, no compiler needed) ────────────────

interface ParsedExport {
  name: string
  signature: string
}

function parseExports(filePath: string): ParsedExport[] {
  if (!fileExists(filePath)) return []
  const src = readFile(filePath)
  const exports: ParsedExport[] = []

  // Match: export function name(params): ReturnType
  const funcRegex = /export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*([^\{]+))?/g
  let match
  while ((match = funcRegex.exec(src)) !== null) {
    const name = match[1]
    const params = match[2].trim().replace(/\s+/g, ' ')
    const ret = (match[3] ?? 'void').trim().replace(/\s+/g, ' ')
    exports.push({ name, signature: `(${params}) => ${ret}` })
  }

  // Match: export const name = ... or export const name: Type
  const constRegex = /export\s+const\s+(\w+)\s*(?::\s*([^=\n]+))?=/g
  while ((match = constRegex.exec(src)) !== null) {
    const name = match[1]
    const type = (match[2] ?? 'unknown').trim()
    // Skip if already captured as function
    if (!exports.find(e => e.name === name)) {
      exports.push({ name, signature: type })
    }
  }

  // Match: export interface / export type
  const typeRegex = /export\s+(?:interface|type)\s+(\w+)/g
  while ((match = typeRegex.exec(src)) !== null) {
    exports.push({ name: match[1], signature: 'type' })
  }

  return exports
}

function detectImports(filePath: string): Record<string, string[]> {
  if (!fileExists(filePath)) return {}
  const src = readFile(filePath)
  const imports: Record<string, string[]> = {}

  // Match: import { a, b, c } from '../moduleName/...'
  const importRegex = /import\s*\{([^}]+)\}\s*from\s*['"]\.\.\/(\w+)\//g
  let match
  while ((match = importRegex.exec(src)) !== null) {
    const symbols = match[1].split(',').map(s => s.trim()).filter(Boolean)
    const moduleName = match[2]
    if (!imports[moduleName]) imports[moduleName] = []
    imports[moduleName].push(...symbols)
  }

  return imports
}

function getTsFiles(dirPath: string): string[] {
  return fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.test.ts'))
}

// ── Generate a single module ──────────────────────────────────────────────────

function generateManifest(modulePath: string): void {
  const moduleName = path.basename(modulePath)
  const manifestPath = path.join(modulePath, 'module.json')

  if (!fs.existsSync(modulePath)) {
    console.error(`  ✗ Path not found: ${modulePath}`)
    return
  }

  const tsFiles = getTsFiles(modulePath)
  if (tsFiles.length === 0) {
    console.log(`  ⚠ No .ts files found in ${moduleName}, skipping`)
    return
  }

  // Check if manifest already exists
  const exists = fileExists(manifestPath)

  const allExports: Record<string, string> = {}
  const allImports: Record<string, string[]> = {}

  for (const file of tsFiles) {
    const filePath = path.join(modulePath, file)
    const parsed = parseExports(filePath)
    for (const exp of parsed) {
      // Skip type-only exports from the manifest exports section
      if (exp.signature !== 'type') {
        allExports[exp.name] = exp.signature
      }
    }
    const imports = detectImports(filePath)
    for (const [mod, symbols] of Object.entries(imports)) {
      if (!allImports[mod]) allImports[mod] = []
      allImports[mod].push(...symbols)
    }
  }

  // Deduplicate imports
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

  const action = exists ? 'updated' : 'created'
  console.log(`  ✓ ${moduleName}/module.json ${action} (${Object.keys(allExports).length} exports, ${Object.keys(allImports).length} import sources)`)
}

// ── CLI entry point ───────────────────────────────────────────────────────────

function main(): void {
  const targetArg = process.argv[2]

  if (!targetArg) {
    console.error('Usage: npm run generate -- <module-path-or-parent-dir>')
    process.exit(1)
  }

  const targetPath = path.resolve(targetArg)

  if (!fs.existsSync(targetPath)) {
    console.error(`Path not found: ${targetPath}`)
    process.exit(1)
  }

  console.log('\nmodmap generate\n')

  // If target contains a module.json or .ts files directly → single module
  const tsFiles = fs.readdirSync(targetPath).filter(f => f.endsWith('.ts'))
  if (tsFiles.length > 0) {
    generateManifest(targetPath)
  } else {
    // Treat as parent dir — generate for all subdirs
    const subdirs = fs.readdirSync(targetPath, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => path.join(targetPath, e.name))

    if (subdirs.length === 0) {
      console.log('No subdirectories found.')
      process.exit(0)
    }

    for (const subdir of subdirs) {
      generateManifest(subdir)
    }
  }

  console.log('\nDone. Review generated module.json files and fill in descriptions.\n')
}

main()
