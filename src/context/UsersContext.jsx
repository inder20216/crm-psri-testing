import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { psri } from '../api/psri';

export const ROLES = ['Super Admin', 'Admin', 'User'];

const UsersContext = createContext(null);

export function UsersProvider({ children }) {
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const refresh = useCallback(() => {
    setLoading(true);
    setError('');
    return psri.getUsers()
      .then(res => setUsers(res.users || []))
      .catch(() => setError('Could not load users. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Returns { success, error? } — UI decides how to show the error
  const addUser = async (user) => {
    try {
      await psri.addUser(user);
      await refresh();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  };

  const updateUser = async (id, patch) => {
    try {
      await psri.updateUser({ id, ...patch });
      await refresh();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  };

  return (
    <UsersContext.Provider value={{ users, loading, error, addUser, updateUser, refresh }}>
      {children}
    </UsersContext.Provider>
  );
}

export function useUsers() {
  const ctx = useContext(UsersContext);
  if (!ctx) throw new Error('useUsers must be used within UsersProvider');
  return ctx;
}
