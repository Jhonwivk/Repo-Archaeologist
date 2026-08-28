import express from 'express';
import cors from 'cors';
import type { RepositoryAnalysis, AnalyzeProgress } from '@repo-archaeologist/core';
import { RepositoryAnalyzer, demoAnalysis } from '@repo-archaeologist/engine';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

const analyzer = new RepositoryAnalyzer();
const analysisCache = new Map<string, RepositoryAnalysis>();
const progressCache = new Map<string, AnalyzeProgress>();

// Store demo on startup
analysisCache.set('demo', demoAnalysis);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

app.get('/api/demo', (_req, res) => {
  res.json(demoAnalysis);
});

app.post('/api/analyze', async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url) {
    res.status(400).json({ error: 'Missing url parameter' });
    return;
  }

  const analysisId = `analysis-${Date.now()}`;
  progressCache.set(analysisId, { stage: 'cloning', progress: 0, message: 'Starting analysis...' });

  // Return immediately with analysis ID for polling
  res.json({ analysisId, status: 'started' });

  // Run analysis in background
  try {
    const result = await analyzer.analyzeFromUrl(url, {}, (progress) => {
      progressCache.set(analysisId, progress);
    });
    analysisCache.set(analysisId, result);
    progressCache.set(analysisId, { stage: 'complete', progress: 100, message: 'Analysis complete!' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analysis failed';
    progressCache.set(analysisId, { stage: 'error', progress: 0, message });
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

app.get('/api/analyze/:id', (req, res) => {
  const analysis = analysisCache.get(req.params.id);
  if (!analysis) {
    const progress = progressCache.get(req.params.id);
    if (progress && progress.stage !== 'complete' && progress.stage !== 'error') {
      res.status(202).json({ status: 'in_progress', progress });
      return;
    }
    res.status(404).json({ error: 'Analysis not found' });
    return;
  }
  res.json(analysis);
});

app.listen(PORT, () => {
  console.log(`Repo Archaeologist API running on http://localhost:${PORT}`);
});
