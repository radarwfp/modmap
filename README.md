# modmap

> A context-efficient protocol for AI-assisted development.
> Reduce Claude token usage by **60–80%** on real projects.

Instead of pasting your entire codebase into every Claude session, `modmap` gives each module a `module.json` manifest describing its interface — and lets Claude work with the map, not the territory.

---

## The problem

When you work on a large project with Claude, you hit a wall: your codebase is 50,000+ tokens. You can't paste it all in. So you paste partial context, Claude misses things, and you burn tokens on every session re-explaining what already exists.

This gets worse with every new module you add.

## The solution

Each module folder carries a `module.json` that describes what it exports, what it imports, what types it defines. A root `project-map.json` maps the full dependency graph. Per-task Claude sessions load only:

- `project-map.json` (~400 tokens — always tiny)
- Full code from the **1–3 relevant modules** for this task
- `module.json` stubs from all other modules (~300 tokens each)

The modules you're not touching become a fraction of their original size.

---

## Experiment results

Measured on the included demo project (Task Manager API, 5 modules, 4,752 tokens total):

| Task | Active modules | Old way | Modular way | Saved |
|------|---------------|---------|-------------|-------|
| Add priority field | tasks | 4,752 | 3,654 | 23.1% |
| Add due date reminders | tasks, notifications | 4,752 | 3,654 | 23.1% |
| Add user profile endpoint | api | 4,752 | 4,752 | 0% |

**Honest note:** 23% savings on a 5-module toy project is the *floor*, not the ceiling. The demo modules are tiny and highly interconnected — working on `tasks` pulls in `database`, `auth`, and `notifications` as transitive dependencies, leaving only `api` as a stub.

The savings grow with every module you add. Here's the math:

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

---

## Quickstart

```bash
git clone https://github.com/radarwfp/modmap
cd modmap
npm install

# Validate the demo project
npm run validate -- ./demo-app

# Measure token savings
npm run measure -- --project ./demo-app --task "add priority field" --modules tasks

# See savings at scale
npx ts-node tools/project.ts

# Generate an optimised Claude prompt for a task
npm run session -- --project ./demo-app --task "add due date reminders"
```

---

## Using it on your own project

**Step 1:** Add a `module.json` to each feature folder

```bash
npm run generate -- ./src/payments   # auto-generates from your TypeScript exports
```

**Step 2:** Create a root `project-map.json`

```json
{
  "project": "my-app",
  "modules": ["auth", "payments", "notifications", "database"],
  "graph": {
    "payments": { "dependsOn": ["auth", "database", "notifications"] },
    "auth":     { "dependsOn": ["database"] },
    "notifications": { "dependsOn": ["database"] },
    "database": { "dependsOn": [] }
  }
}
```

**Step 3:** Start each Claude session with the generated prompt

```bash
npm run session -- --project . --task "add webhook support to payments"
# writes results/session-add-webhook-support-to-payments.md
# paste its contents into a new Claude chat
```

**Step 4:** Keep manifests up to date

```bash
npm run validate -- .    # run before every commit
```

---

## The module.json spec

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
    "Plan": "{ id: string; name: string; priceId: string }"
  },
  "env": ["STRIPE_SECRET_KEY"],
  "status": "stable",
  "lastModified": "2026-04-14"
}
```

---

## Tools

| Command | What it does |
|---------|-------------|
| `npm run generate -- <path>` | Scan a module, auto-create `module.json` stub from TS exports |
| `npm run validate -- <path>` | Check all manifests match actual exports, detect drift |
| `npm run measure -- --project <p> --task <t> --modules <m>` | Token comparison: old vs modular |
| `npm run session -- --project <p> --task <t>` | Generate optimised Claude prompt, save to `results/` |
| `npx ts-node tools/project.ts` | Show savings projection as project scales |

---

## The broader case

This protocol was designed to solve a developer pain point. But the same principle applies at infrastructure level: if AI systems loaded interface contracts instead of full implementations when reasoning about large codebases, the compute, memory, and energy savings at scale could be substantial.

The math is the same whether it is a developer pasting context or a model loading it internally.

---

## License

MIT — Radar WFP, 2026
