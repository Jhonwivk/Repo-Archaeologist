# Repo Archaeologist

> **Archify tells you what the system is.**
> **Repo Archaeologist tells you how it became that way.**

Reconstruct the architectural evolution of any GitHub repository. Convert thousands of low-level commits into grounded, interactive **Evolution Events** — and drag through time to watch your system's architecture emerge, split, and migrate.

## What it does

Given a GitHub repo URL, Repo Archaeologist:

1. **Scans** Git history — commits, branches, file changes
2. **Selects** architecturally significant commits (time sampling + high-impact detection)
3. **Builds** architecture snapshots at each key point (modules, dependencies, symbols)
4. **Detects** structural deltas — added, removed, moved, split, merged modules
5. **Clusters** related commits into **Evolution Events** with semantic summaries
6. **Renders** an interactive timeline you can drag, scrub, and replay

## V1 Scope

```
Git Repo → Important Commits → Architecture Snapshots → Evolution Events → Interactive Timeline
```

This V1 focuses on **Architecture Evolution** — the most visually compelling layer. Future versions will add Module Genealogy, Code Symbol Evolution, and PR/Issue integration.

## Quick Start

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Start dev server (API + Web UI)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and click **"try the interactive demo"** to see a pre-built agent-runtime evolution story.

Or paste any public GitHub repo URL to analyze it live.

## Architecture

```
                 Git Repository
                       │
                       ▼
                Repository Scanner
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
 Git Analyzer      Code Analyzer     (Future: Docs)
       │               │               │
       └───────────────┼───────────────┘
                       ▼
                  Snapshot Builder
                       │
                       ▼
                 Change Detector
                       │
                       ▼
               Event Clustering Engine
                       │
                       ▼
                 Evolution Graph
                       │
                       ▼
                 Interactive UI
```

### Packages

| Package | Description |
|---------|-------------|
| `@repo-archaeologist/core` | IR types: Snapshot, EvolutionEvent, ModuleEvolution |
| `@repo-archaeologist/engine` | Git analysis, snapshot building, change detection, event clustering |
| `@repo-archaeologist/server` | Express API for repo analysis |
| `@repo-archaeologist/web` | React UI with timeline, architecture graph, replay |

### Core IR

The engine produces a deterministic intermediate representation:

```typescript
RepositoryAnalysis {
  snapshots: Snapshot[]           // Architecture at key commits
  deltas: SnapshotDelta[]         // Structural changes between snapshots
  evolutionEvents: EvolutionEvent[]  // Clustered semantic events
  moduleEvolutions: ModuleEvolution[]  // Module genealogy
  timeline: TimelinePoint[]      // Interactive timeline data
}
```

**EvolutionEvent** is the core abstraction — not individual commits:

```json
{
  "event": "Agent split into Planner + Executor",
  "type": "module_split",
  "period": "2024-07-01 → 2024-08-17",
  "commits": 11,
  "affected_modules": ["agent", "planner", "executor", "runtime"],
  "evidence": [
    "Split Agent into Planner + Executor (d4e5f6a)",
    "38 files changed across 11 commits"
  ]
}
```

## Design Philosophy

- **Deterministic first**: Git diff, AST parsing, dependency graphs, module metrics — all computed programmatically
- **LLM for semantics** (future): Commit clustering, change interpretation, "why did this happen" synthesis
- **Evolution Events over commits**: Real engineering changes span multiple commits; cluster them
- **Demo-driven**: The draggable timeline + architecture graph is the hero feature

## API

```
GET  /api/demo                          Pre-built demo analysis
POST /api/analyze  { url }              Start repo analysis
GET  /api/analyze/:id/progress          Poll analysis progress
GET  /api/analyze/:id                   Get completed analysis
```

## Development

```bash
# Run tests
npm test

# Analyze a repo from CLI (after build)
npm run analyze -w @repo-archaeologist/engine -- https://github.com/owner/repo
```

## License

MIT
