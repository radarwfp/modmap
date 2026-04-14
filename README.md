# modmap

> A context-efficient protocol for AI-assisted development.  
> Reduce Claude token usage by **60–80%** on real projects.

Instead of pasting your entire codebase into every Claude session, `modmap` gives each module a `modmap.json` manifest describing its interface — and lets Claude work with the map, not the territory.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue)
![Status](https://img.shields.io/badge/status-experimental-orange)

---

## The problem

When you work on a large project with Claude, you hit a wall: your codebase is 50,000+ tokens. You can't paste it all in. So you paste partial context, Claude misses things, and you burn tokens on every session re-explaining what already exists.

This gets worse with every new module you add. The old way scales linearly — every new module costs its full token weight every single session, whether Claude needs it or not.

## The solution

Each module folder carries a `modmap.json` that describes what it exports, what it imports, and what types it defines. A root `project-map.json` maps the full dependency graph. Per-task Claude sessions load only:

- `project-map.json` (~400 tokens — always tiny)
- Full code from the **1–3 relevant modules** for this task
- `modmap.json` stubs from all other modules (~300 tokens each)

The modules you are not touching become a fraction of their original size.

---

## Experiment results

Measured on the included demo project (Task Manager API, 5 modules, 4,752 tokens total):

| Task | Active modules | Old way | Modular way | Saved |
|------|---------------|---------|-------------|-------|
| Add priority field | tasks | 4,752 | 3,654 | 23.1% |
| Add due date reminders | tasks, notifications | 4,752 | 3,654 | 23.1% |
| Add user profile endpoint | api | 4,752 | 4,752 | 0% |

**Honest note:** 23% savings on a 5-module toy project is the *floor*, not the ceiling. The demo modules are tiny and highly interconnected — working on `tasks` pulls in `database`, `auth`, and `notifications` as transitive dependencies, leaving only `api` as a stub. The savings grow significantly with project size.

---

## Savings at scale

*Assumptions: ~2,500 tokens/module avg, ~300 tokens/manifest, 1–2 active modules per task*

| Project size | Old way (tokens) | Modular way | Savings |
|---|---|---|---|
| 10 modules (small app) | 25,400 | 10,000 | **61%** |
| 20 modules (medium app) | 50,600 | 15,400 | **70%** |
| 30 modules (large app) | 75,800 | 18,600 | **75%** |
| 50 modules (enterprise) | 126,000 | 24,800 | **80%** |
| 30 modules (large files, ~6k tok each) | 180,800 | 33,900 | **81%** |

**The key insight:** every new module grows the "old way" cost by ~2,500 tokens. The modular way grows by just one manifest stub (~300 tokens). The gap widens with every module you add.

Run the projection tool yourself:

```bash
npx ts-node tools/project.ts
```

---

## Quickstart

```bash
git clone https://github.com/radarwfp/modmap
cd modmap
npm install

# Validate the demo project
npx ts-node tools/validate.ts ./demo-app

# Measure token savings
npx ts-node tools/measure.ts --project ./demo-app --task "add priority field" --modules tasks

# See savings projection at scale
npx ts-node tools/project.ts

# Generate an optimised Claude prompt for a task
npx ts-node tools/session.ts --project ./demo-app --task "add due date reminders"
```

---

## Using it on your own project

**Step 1 — Generate manifests for each module folder**

```bash
npx ts-node tools/generate.ts ./src/payments
# or for all subfolders at once:
npx ts-node tools/generate.ts ./src
```

This auto-detects exports, imports, and types from your TypeScript source and writes a `modmap.json` stub. Fill in the `description` field manually — one sentence is enough.

**Step 2 — Create a root `project-map.json`**

```json
{
  "project": "my-app",
  "version": "1.0.0",
  "description": "What this project does",
  "modules": ["auth", "payments", "notifications", "database"],
  "graph": {
    "payments":      { "dependsOn": ["auth", "database", "notifications"] },
    "auth":          { "dependsOn": ["database"] },
    "notifications": { "dependsOn": ["database"] },
    "database":      { "dependsOn": [] }
  },
  "conventions": {
    "auth": "all routes use requireAuth() middleware",
    "errors": "throw plain Error with descriptive messages"
  }
}
```

**Step 3 — Generate an optimised Claude prompt for your task**

```bash
npx ts-node tools/session.ts --project . --task "add webhook support to payments"
# writes: results/session-add-webhook-support-to-payments.md
```

Open that file and paste its contents into a new Claude chat. Claude gets the full code of relevant modules plus interface stubs for everything else.

**Step 4 — Keep manifests up to date**

```bash
npx ts-node tools/validate.ts .
```

Run this before every commit. It checks that every symbol declared in `modmap.json` actually exists in source, warns about undeclared exports, and detects stale manifests.

To regenerate after adding new exports:

```bash
npx ts-node tools/generate.ts ./src/payments --force
```

---

## The modmap.json spec

```json
{
  "name": "payments",
  "version": "1.0.0",
  "description": "Stripe integration and subscription management",
  "files": ["payments.service.ts", "stripe.client.ts"],
  "exports": {
    "createSubscription": "(userId: string, plan: Plan) => Promise<Sub>",
    "cancelSubscription": "(subId: string) => Promise<void>"
  },
  "imports": {
    "auth":     ["getCurrentUser"],
    "database": ["db.subscriptions"]
  },
  "types": {
    "Plan": "{ id: string; name: string; priceId: string }",
    "Sub":  "{ id: string; userId: string; status: string }"
  },
  "env": ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  "status": "stable",
  "lastModified": "2026-04-14"
}
```

---

## Tools

| Command | What it does |
|---------|-------------|
| `generate <path> [--force]` | Scan a module, auto-create `modmap.json` from TS exports. Skips existing manifests unless `--force` is passed — no feedback loops. |
| `validate <path>` | Check all manifests match actual exports, detect drift, warn on stale dates, verify no circular deps |
| `measure --project <p> --task <t> --modules <m>` | Token comparison: old way vs modular, saves JSON result to `results/` |
| `session --project <p> --task <t> [--modules <m>]` | Generate optimised Claude prompt, auto-detects relevant modules from task description |
| `project` | Show token savings projection as project scales from 10 to 50 modules |

---

## Known limitations

These are documented honestly. Some are fixable in future versions, some are fundamental to the approach.

### Fixable — planned

**Regex-based export parser, not AST.**  
The parser uses regular expressions to find exports. It correctly handles `export function`, `export const`, `export class`, `export interface`, `export type`, named re-exports (`export { foo, bar }`), and aliased re-exports (`export { foo as bar }`). It flags barrel files (`export * from './other'`) for manual review. It will miss decorated class members (NestJS, Angular), conditional exports, and dynamically generated exports. A proper TypeScript compiler API implementation would fix this.

**TypeScript only.**  
`generate` and `validate` parse TypeScript/JavaScript. Python, Go, Rust, PHP, and other languages are not supported. The protocol and manifest format are language-agnostic — only the tooling needs language-specific parsers.

**No `index.ts` barrel awareness.**  
If your module re-exports everything through an `index.ts` barrel file, the generator flags it but cannot enumerate the symbols. You need to fill in the exports manually for barrel-based modules.

### Fundamental — by design

**Savings shrink on tightly coupled codebases.**  
If the module you are working on depends (directly or transitively) on most other modules, those all get loaded as full code. A highly coupled codebase may see little benefit. The protocol works best when modules have clear, narrow responsibilities.

**Implicit contracts are invisible.**  
`modmap.json` captures the TypeScript interface — function signatures, types, imports. It does not capture: shared database table shapes, event names and payloads, environment variable formats, shared config keys, or runtime behaviour. Two modules can have perfectly valid manifests and still break each other through a shared database table that neither explicitly declares. This is a documentation discipline problem, not a tooling one.

**Manifests drift if discipline slips.**  
The `validate` tool catches drift on symbols that are declared in the manifest. If you add a new exported function and never update the manifest, Claude gets stale context. The fix is simple — run `validate` before every commit — but it requires the habit.

**Claude output quality is not measured.**  
The `measure` tool counts tokens accurately. It does not measure whether Claude's output using the modular prompt is better, worse, or equivalent to the full-codebase prompt. That requires human evaluation on real tasks.

---

## The broader case

This protocol was designed to solve a developer pain point. The same principle applies at infrastructure level: if AI systems loaded interface contracts instead of full implementations when reasoning about large codebases, the compute, memory, and energy savings at scale could be substantial.

The math is the same whether it is a developer pasting context manually or a model loading it internally.

---

## Status

This project is **experimental**. It has been tested on the included demo project and is being evaluated on larger real-world projects. Results and limitations from those tests will be published here as they become available.

Contributions, bug reports, and test results from your own projects are welcome via GitHub Issues.

---

## License

MIT — Radar WFP, 2026