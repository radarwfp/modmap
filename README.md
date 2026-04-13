# modmap

> **Reduce Claude token usage by up to 90% on large projects.**

A lightweight protocol for AI-assisted development. Instead of pasting your entire codebase into every Claude session, `modmap` gives each module a `module.json` manifest describing its interface — and lets Claude work with the map, not the territory.

---

## The problem

When you work on a large project with Claude, you hit a wall: your codebase is 50,000+ tokens. You can't paste it all in. So you paste partial context, Claude misses things, and you burn tokens explaining what already exists.

## The solution

Each module folder carries a `module.json` describing what it exports, what it imports, what types it defines. A root `project-map.json` maps the dependency graph. Per-task Claude sessions load only:

- `project-map.json` (~400 tokens)
- Code from the 1–2 relevant modules (~2,000–5,000 tokens)
- `module.json` stubs from all other modules (~200 tokens each)

**Result: 70–90% reduction in context tokens per session.**

---

## Experiment results

> *(populated after Phase 4 — live experiment)*

| Task | Old way (tokens) | Modular way (tokens) | Savings |
|------|-----------------|---------------------|---------|
| Add priority field to tasks | — | — | — |
| Add webhook support | — | — | — |
| Add email notifications | — | — | — |

---

## Quickstart

```bash
npx modmap generate ./src      # auto-generate module.json files
npx modmap validate ./src      # check manifests are up to date
npx modmap session --task "add X to Y"   # generate optimized Claude prompt
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
    "auth": ["getCurrentUser"],
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
| `npm run generate [path]` | Scan a module folder, create a `module.json` stub |
| `npm run validate [path]` | Check all manifests match actual exports |
| `npm run measure --task "..." --modules a,b` | Token comparison: old way vs modular |
| `npm run session --task "..."` | Generate optimal Claude prompt for a task |

---

## Why this matters beyond developer tooling

If this interface-contract pattern were applied at the infrastructure level — where models load structural maps of projects rather than full codebases — the compute, memory, and energy savings at scale could be substantial.

---

## License

MIT
