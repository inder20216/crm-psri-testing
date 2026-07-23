import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { psri } from '../api/psri';

// Known relationships — admin can still add brand-new Main Field/Sub Field pairs from the page
export const KNOWN_RELATIONSHIPS = [
  { mainField: 'Specialty',    subField: 'Doctor' },
  { mainField: 'Call For',     subField: 'Type of Enquiry' },
  { mainField: 'Call For',     subField: 'Appointment Status' },
  { mainField: 'Type of Call', subField: 'Call For' },
  { mainField: 'Channel',      subField: 'Call For' },
];

const DependenciesContext = createContext(null);

export function DependenciesProvider({ children }) {
  const [dependencies, setDependencies] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');

  const refresh = useCallback(() => {
    setLoading(true);
    setError('');
    return psri.getDependencies()
      .then(res => setDependencies(res.dependencies || []))
      .catch(() => setError('Could not load dependencies. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Returns the list of Sub Values for a given Sub Field, narrowed to the given Main Field + Main Value pair.
  // Empty array if mainValue isn't set yet or nothing matches.
  const getDependentValues = (subField, mainField, mainValue) => {
    if (!mainValue) return [];
    const matches = dependencies.filter(d =>
      d.mainField === mainField && d.mainValue === mainValue && d.subField === subField
    );
    return [...new Set(matches.map(d => d.subValue))].sort((a, b) => a.localeCompare(b));
  };

  // All distinct Main Values seen so far for a given mainField (used to populate "add new pair" forms)
  const getMainValues = (mainField) =>
    [...new Set(dependencies.filter(d => d.mainField === mainField).map(d => d.mainValue))].sort((a, b) => a.localeCompare(b));

  const addDependency = async (mainField, mainValue, subField, subValue) => {
    try {
      await psri.addDependency({ mainField, mainValue, subField, subValue });
      await refresh();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  };

  return (
    <DependenciesContext.Provider value={{ dependencies, loading, error, getDependentValues, getMainValues, addDependency, refresh }}>
      {children}
    </DependenciesContext.Provider>
  );
}

export function useDependencies() {
  const ctx = useContext(DependenciesContext);
  if (!ctx) throw new Error('useDependencies must be used within DependenciesProvider');
  return ctx;
}
