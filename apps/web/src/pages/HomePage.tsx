import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchDemo, startAnalysis } from '../lib/api';

export default function HomePage() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

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

  const handleDemo = async () => {
    setLoading(true);
    try {
      await fetchDemo();
      navigate('/evolution/demo');
    } catch {
      setError('Failed to load demo');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero */}
      <header className="flex-1 flex flex-col items-center justify-center px-6 py-20">
        <div className="max-w-3xl w-full text-center animate-fade-in">
          {/* Logo */}
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

          <p className="text-lg text-gray-400 mb-12 max-w-xl mx-auto">
            Reconstruct the architectural evolution of any GitHub repository.
            Drag through time and watch modules emerge, split, and migrate.
          </p>

          {/* Input */}
          <form onSubmit={handleAnalyze} className="max-w-lg mx-auto mb-6">
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

          <button onClick={handleDemo} className="text-archaeologist-400 hover:text-archaeologist-300 text-sm transition-colors">
            or try the interactive demo →
          </button>
        </div>
      </header>

      {/* Tagline */}
      <footer className="border-t border-surface-border py-8 px-6">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500">
          <p>
            <span className="text-gray-400">Archify</span> tells you what the system is.<br className="sm:hidden" />
            {' '}<span className="text-gray-300">Repo Archaeologist</span> tells you how it became that way.
          </p>
          <div className="flex gap-6 text-xs">
            <span>Git → Snapshots → Events → Timeline</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
