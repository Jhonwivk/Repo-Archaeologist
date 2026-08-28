import { Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import EvolutionPage from './pages/EvolutionPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/evolution/:id" element={<EvolutionPage />} />
    </Routes>
  );
}
