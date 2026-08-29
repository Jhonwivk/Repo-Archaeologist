import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchCases, startAnalysis } from '../lib/api';

interface FeaturedCase {
  id: string;
  title: string;
  description: string;
  owner: string;
  name: string;
}

const FALLBACK_CASES: FeaturedCase[] = [
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

export default function HomePage() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cases, setCases] = useState<FeaturedCase[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    fetchCases()
      .then((list) => {
        if (list.length) setCases(list);
        else setCases(FALLBACK_CASES);
      })
      .catch(() => setCases(FALLBACK_CASES));
  }, []);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError('');

    try {
      const { analysisId } = await startAnalysis(url.trim());
      navigate(`/evolution/${analysisId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="max-w-3xl w-full text-center animate-fade-in">
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-archaeologist-600 flex items-center justify-center">
              <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 18V6l3 4.5 3-3 3 4.5 3-4.5v12" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="12" cy="4" r="1.5" fill="currentColor" stroke="none" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Repo Archaeologist</h1>
          </div>

          <p className="text-4xl sm:text-5xl font-bold tracking-tight mb-4 bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent">
            Understand how software<br />became what it is.
          </p>

          <p className="text-lg text-gray-400 mb-3 max-w-xl mx-auto">
            Reconstruct architectural evolution from Git history. Open an event to see Before / After, then inspect the commits that prove it.
          </p>
          <p className="text-sm text-gray-500 mb-10">
            V1.1 is optimized for TypeScript/JavaScript repositories and monorepos.
          </p>

          <form onSubmit={handleAnalyze} className="max-w-lg mx-auto mb-10">
            <div className="flex gap-2">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="github.com/owner/repo"
                className="input-field flex-1 font-mono text-sm"
                disabled={loading}
              />
              <button type="submit" className="btn-primary whitespace-nowrap" disabled={loading || !url.trim()}>
                {loading ? 'Analyzing...' : 'Analyze'}
              </button>
            </div>
            {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
          </form>

          <div className="grid sm:grid-cols-2 gap-3 max-w-2xl mx-auto text-left">
            {cases.map((c) => (
              <button
                key={c.id}
                onClick={() => navigate(`/evolution/${c.id}`)}
                className="card p-4 hover:border-archaeologist-500 transition-colors text-left"
              >
                <p className="text-sm font-medium text-gray-200">{c.title}</p>
                <p className="text-xs text-gray-500 mt-1">{c.description}</p>
              </button>
            ))}
          </div>
        </div>
      </header>

      <footer className="border-t border-surface-border py-8 px-6">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500">
          <p>
            <span className="text-gray-400">Archify</span> tells you what the system is.{' '}
            <span className="text-gray-300">Repo Archaeologist</span> tells you how it became that way.
          </p>
          <span className="text-xs">Git → Snapshots → Events → Timeline</span>
        </div>
      </footer>
    </div>
  );
}
