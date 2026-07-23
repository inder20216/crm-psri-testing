import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../auth/msalConfig';
import { psri } from '../api/psri';

const AuthContext = createContext(null);

// Normalise email for comparison (lowercase, trim)
const norm = (e) => (e || '').toLowerCase().trim();

export function AuthProvider({ children }) {
  const { instance, accounts } = useMsal();
  const [currentUser, setCurrentUser] = useState(null);  // user record from Google Sheets
  const [authLoading, setAuthLoading] = useState(true);   // resolving user record
  const [accessDenied, setAccessDenied] = useState(false);

  const msAccount = accounts[0] || null;
  const isAuthenticated = !!msAccount;

  const login = useCallback(() => {
    instance.loginRedirect(loginRequest).catch(() => {});
  }, [instance]);

  const logout = useCallback(() => {
    instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin });
  }, [instance]);

  // After Microsoft login, look up the agent record in Google Sheets users list
  useEffect(() => {
    if (!msAccount) {
      setCurrentUser(null);
      setAuthLoading(false);
      setAccessDenied(false);
      return;
    }
    setAuthLoading(true);
    const msEmail = norm(msAccount.username || msAccount.idTokenClaims?.email || '');
    psri.getUsers()
      .then(res => {
        const all = res.users || [];
        const match = all.find(u => norm(u.email) === msEmail);
        if (match) {
          setCurrentUser(match);
          setAccessDenied(false);
        } else {
          setCurrentUser(null);
          setAccessDenied(true);
        }
      })
      .catch(() => {
        setCurrentUser(null);
        setAccessDenied(true);
      })
      .finally(() => setAuthLoading(false));
  }, [msAccount?.username]);  // eslint-disable-line react-hooks/exhaustive-deps

  const isSuperAdmin = currentUser?.role === 'Super Admin';
  const isAdmin      = isSuperAdmin || currentUser?.role === 'Admin';

  return (
    <AuthContext.Provider value={{
      isAuthenticated,
      currentUser,
      authLoading,
      accessDenied,
      isSuperAdmin,
      isAdmin,
      login,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
