# Repo Archaeologist

> **Archify tells you what the system is.**
> **Repo Archaeologist tells you how it became that way.**

Reconstruct the architectural evolution of a GitHub repository. Convert thousands of low-level commits into grounded **Evolution Events**, then open one to see **Before / After**, module genealogy, and the commits that prove the claim.

**Demo path:** paste a repo → pick a major evolution event → inspect how the system changed, which modules split or moved, and which real commits/files support that conclusion.

## V1.1 scope

V1.1 is optimized for **TypeScript/JavaScript repositories and monorepos**.

It does **not** yet claim reliable support for Python, Go, Rust, or other languages. Those will land later behind a `LanguageAdapter`.

Current accuracy target (synthetic Evolution Lab fixture):

| Metric | Target |
|--------|--------|
| Module precision | ≥ 85% |
| Important event recall | ≥ 75% |
| Every event linked to commit/file evidence | 100% |

## Quick start

```bash
npm install
npm test          # builds first, then runs unit + fixture e2e tests
npm run dev       # API on :3001, UI on :5173
```

Open [http://localhost:5173](http://localhost:5173):

1. Click **Evolution Lab** for a labeled add / move / split / merge repo
2. Click **Agent Runtime** for the narrative architecture story
3. Or paste a public `github.com/owner/repo` TypeScript URL

Production-style (API serves the built UI):

```bash
npm run build
npm start         # http://localhost:3001
```

## How it works

```
Git history
  → important commits
  → TS/JS architecture snapshots (compiler API + workspace packages)
  → identity-stable deltas (add / move / rename / split / merge)
  → evolution events with evidence
  → interactive Before/After time machine
```

Deterministic pieces do the structural work: Git diffs, rename detection, TypeScript AST, tsconfig path aliases, workspace package names, module fingerprints.

LLM interpretation is intentionally **not** in V1.1. If the underlying events are wrong, generated prose would only make them look more convincing.

## What you can inspect

- **Before / After** for a selected Evolution Event
- **Stable graph layout** so unchanged modules stay put while you scrub time
- **Module genealogy** (click a node): born, moved, split, merged, removed
- **Evidence**: supporting commits, changed files, dependency changes, confidence
- **Replay** the repository as a short architecture documentary

## Packages

| Package | Role |
|---------|------|
| `@repo-archaeologist/core` | IR: Snapshot, EvolutionEvent, ModuleEvolution |
| `@repo-archaeologist/engine` | Git + TS/JS analysis, identity, eval fixture |
| `@repo-archaeologist/server` | API, featured cases, analysis limits |
| `@repo-archaeologist/web` | Timeline, Before/After, genealogy |

## Limits (live analysis)

Live GitHub analysis is capped so the demo stays usable:

- Shallow clone depth 400
- Max 400 commits scanned
- 2 concurrent jobs
- ~3 minute timeout

Featured cases are precomputed / generated locally and open immediately.

## Accuracy notes

Move / split / merge are emitted only when Git renames or file-level overlap support them. A new directory that merely *looks* similar to an existing module is classified as **added**, not a split.

Python/Go/Rust files are ignored in V1.1.

## API

```
GET  /api/health
GET  /api/cases                      Featured demos
GET  /api/cases/:id                  demo | evolution-lab
POST /api/analyze  { url }           Start GitHub analysis
GET  /api/analyze/:id/progress
GET  /api/analyze/:id
```

## License

MIT
