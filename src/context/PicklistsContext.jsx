import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { psri } from '../api/psri';

// Known list names — admin can still add brand-new list names from the Picklists page
export const KNOWN_LISTS = [
  'Contact Type', 'Source of Information', 'Language', 'City',
  'Channel', 'Type of Call', 'Call For', 'Type of Enquiry', 'Priority', 'Case Status',
  'Appointment Status', 'Specialty', 'Type of Procedure', 'Mode of Payment', 'Doctor',
  'Type of Complaint', 'Type of Emergency',
];

const PicklistsContext = createContext(null);

export function PicklistsProvider({ children }) {
  const [picklists, setPicklists] = useState({});
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');

  const refresh = useCallback(() => {
    setLoading(true);
    setError('');
    return psri.getPicklists()
      .then(res => setPicklists(res.picklists || {}))
      .catch(() => setError('Could not load picklists. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const getList = (listName) => picklists[listName] || [];

  const addValue = async (listName, value) => {
    try {
      await psri.addPicklistValue({ listName, value });
      await refresh();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  };

  return (
    <PicklistsContext.Provider value={{ picklists, loading, error, getList, addValue, refresh }}>
      {children}
    </PicklistsContext.Provider>
  );
}

export function usePicklists() {
  const ctx = useContext(PicklistsContext);
  if (!ctx) throw new Error('usePicklists must be used within PicklistsProvider');
  return ctx;
}
