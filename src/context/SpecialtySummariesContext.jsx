import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { psri } from '../api/psri';

const SpecialtySummariesContext = createContext(null);

export function SpecialtySummariesProvider({ children }) {
  const [summaries, setSummaries] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');

  const refresh = useCallback(() => {
    setLoading(true);
    setError('');
    return psri.getSpecialtySummaries()
      .then(res => setSummaries(res.summaries || []))
      .catch(() => setError('Could not load specialty summaries. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Returns { en, hi } for a specialty, or null if no cached summary exists yet.
  const getSummary = (specialty) => summaries.find(s => s.specialty === specialty) || null;

  return (
    <SpecialtySummariesContext.Provider value={{ summaries, loading, error, getSummary, refresh }}>
      {children}
    </SpecialtySummariesContext.Provider>
  );
}

export function useSpecialtySummaries() {
  const ctx = useContext(SpecialtySummariesContext);
  if (!ctx) throw new Error('useSpecialtySummaries must be used within SpecialtySummariesProvider');
  return ctx;
}
