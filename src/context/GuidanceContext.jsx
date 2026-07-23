import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { psri } from '../api/psri';

const GuidanceContext = createContext(null);

export function GuidanceProvider({ children }) {
  const [guidance, setGuidance] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  const refresh = useCallback(() => {
    setLoading(true);
    setError('');
    return psri.getGuidance()
      .then(res => setGuidance(res.guidance || []))
      .catch(() => setError('Could not load guidance. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Returns { tip, script } for the given Call For + field name, or null if no rule matches.
  const getTip = (callFor, field) => {
    if (!callFor) return null;
    const match = guidance.find(g => g.callFor === callFor && g.field === field);
    return match ? { tip: match.tip, script: match.script } : null;
  };

  return (
    <GuidanceContext.Provider value={{ guidance, loading, error, getTip, refresh }}>
      {children}
    </GuidanceContext.Provider>
  );
}

export function useGuidance() {
  const ctx = useContext(GuidanceContext);
  if (!ctx) throw new Error('useGuidance must be used within GuidanceProvider');
  return ctx;
}
