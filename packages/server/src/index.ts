import express from 'express';
import cors from 'cors';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RepositoryAnalysis, AnalyzeProgress, FeaturedCase } from '@repo-archaeologist/core';
import {
  RepositoryAnalyzer,
  demoAnalysis,
  createEvolutionLabFixture,
  parseGitHubUrl,
} from '@repo-archaeologist/engine';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const app = express();
const PORT = process.env.PORT ?? 3001;
const HOST = process.env.HOST ?? '0.0.0.0';
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT ?? 2);
const ANALYZE_TIMEOUT_MS = Number(process.env.ANALYZE_TIMEOUT_MS ?? 180_000);
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data');

app.use(cors());
app.use(express.json());

const analyzer = new RepositoryAnalyzer();
const analysisCache = new Map<string, RepositoryAnalysis>();
const progressCache = new Map<string, AnalyzeProgress>();
let running = 0;

analysisCache.set('demo', demoAnalysis);

const FEATURED: FeaturedCase[] = [
  {
    id: 'demo',
    title: 'Agent Runtime (narrative demo)',
    description: 'CLI → Agent → Planner/Executor → MCP. Best path for a README recording.',
    owner: 'example',
    name: 'agent-runtime',
  },
  {
    id: 'evolution-lab',
    title: 'Evolution Lab (ground-truth fixture)',
    description: 'Synthetic TypeScript repo with labeled add, move, split, and merge events.',
    owner: 'repo-archaeologist',
    name: 'evolution-lab',
  },
];

async function persist(id: string, payload: unknown): Promise<void> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(join(DATA_DIR, `${id}.json`), JSON.stringify(payload), 'utf8');
  } catch {
    // persistence is best-effort
  }
}

async function loadPersisted(id: string): Promise<RepositoryAnalysis | null> {
  const file = join(DATA_DIR, `${id}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8')) as RepositoryAnalysis;
  } catch {
    return null;
  }
}

async function ensureEvolutionLab(): Promise<RepositoryAnalysis> {
  const cached = analysisCache.get('evolution-lab') ?? await loadPersisted('evolution-lab');
  if (cached && cached.evolutionEvents?.length) {
    analysisCache.set('evolution-lab', cached);
    return cached;
  }

  const dir = await mkdtemp(join(tmpdir(), 'evolution-lab-'));
  try {
    await createEvolutionLabFixture(dir);
    const result = await analyzer.analyzeLocalPath(dir, {
      minDaysBetweenSnapshots: 0,
      maxSnapshots: 20,
      clusterWindowDays: 7,
      maxCommits: 50,
    });
    result.id = 'evolution-lab';
    result.owner = 'repo-archaeologist';
    result.name = 'evolution-lab';
    analysisCache.set('evolution-lab', result);
    await persist('evolution-lab', result);
    return result;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '0.1.1',
    language: 'typescript',
    limits: { maxConcurrent: MAX_CONCURRENT, timeoutMs: ANALYZE_TIMEOUT_MS, cloneDepth: 400 },
  });
});

app.get('/api/cases', (_req, res) => {
  res.json(FEATURED);
});

app.get('/api/demo', (_req, res) => {
  res.json(demoAnalysis);
});

app.get('/api/cases/:id', async (req, res) => {
  if (req.params.id === 'demo') {
    res.json(demoAnalysis);
    return;
  }
  if (req.params.id === 'evolution-lab') {
    try {
      res.json(await ensureEvolutionLab());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to build fixture' });
    }
    return;
  }
  res.status(404).json({ error: 'Unknown case' });
});

app.post('/api/analyze', async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url) {
    res.status(400).json({ error: 'Missing url parameter' });
    return;
  }

  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    res.status(400).json({
      error: 'V1.1 accepts public GitHub URLs for TypeScript/JavaScript repositories (github.com/owner/repo).',
    });
    return;
  }

  if (running >= MAX_CONCURRENT) {
    res.status(429).json({ error: 'Too many analyses in progress. Try a featured case or wait a moment.' });
    return;
  }

  const analysisId = `analysis-${Date.now()}`;
  progressCache.set(analysisId, { stage: 'cloning', progress: 0, message: 'Starting analysis...' });
  await persist(`${analysisId}-progress`, progressCache.get(analysisId));
  res.json({ analysisId, status: 'started' });

  running += 1;
  const timeout = setTimeout(() => {
    progressCache.set(analysisId, { stage: 'error', progress: 0, message: 'Analysis timed out. Try a smaller TypeScript repository or a featured case.' });
  }, ANALYZE_TIMEOUT_MS);

  try {
    const result = await analyzer.analyzeFromUrl(url, { cloneDepth: 400, maxCommits: 400 }, (progress) => {
      progressCache.set(analysisId, progress);
    });
    analysisCache.set(analysisId, result);
    progressCache.set(analysisId, { stage: 'complete', progress: 100, message: 'Analysis complete!' });
    await persist(analysisId, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analysis failed';
    progressCache.set(analysisId, { stage: 'error', progress: 0, message });
  } finally {
    clearTimeout(timeout);
    running = Math.max(0, running - 1);
  }
});

app.get('/api/analyze/:id/progress', (req, res) => {
  const progress = progressCache.get(req.params.id);
  if (!progress) {
    res.status(404).json({ error: 'Analysis not found' });
    return;
  }
  res.json(progress);
});

app.get('/api/analyze/:id', async (req, res) => {
  if (req.params.id === 'demo') {
    res.json(demoAnalysis);
    return;
  }
  if (req.params.id === 'evolution-lab') {
    res.json(await ensureEvolutionLab());
    return;
  }

  const analysis = analysisCache.get(req.params.id) ?? await loadPersisted(req.params.id);
  if (!analysis) {
    const progress = progressCache.get(req.params.id);
    if (progress && progress.stage !== 'complete' && progress.stage !== 'error') {
      res.status(202).json({ status: 'in_progress', progress });
      return;
    }
    res.status(404).json({ error: 'Analysis not found' });
    return;
  }
  analysisCache.set(req.params.id, analysis);
  res.json(analysis);
});

const here = dirname(fileURLToPath(import.meta.url));
const webDist = join(here, '../../../apps/web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(join(webDist, 'index.html'));
  });
}

app.listen(Number(PORT), HOST, () => {
  console.log(`Repo Archaeologist API running on http://${HOST}:${PORT}`);
});
