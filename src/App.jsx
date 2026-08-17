import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProjectRail from './components/ProjectRail';
import { PROJECTS } from './projects/registry';
import { SparkTGProvider } from './context/SparkTGContext';
import { UsersProvider } from './context/UsersContext';
import { PicklistsProvider } from './context/PicklistsContext';
import { DependenciesProvider } from './context/DependenciesContext';
import { SpecialtySummariesProvider } from './context/SpecialtySummariesContext';
import { GuidanceProvider } from './context/GuidanceContext';
import UsersPage from './admin/UsersPage';
import PicklistsPage from './admin/PicklistsPage';
import DependenciesPage from './admin/DependenciesPage';
import SparkTGWidget from './projects/psri/SparkTGWidget';
import DialerPanel from './projects/psri/DialerPanel';
import ChatWidget from './projects/psri/ChatWidget';
import DoctorLookupWidget from './projects/psri/DoctorLookupWidget';
import MissedCallsWidget from './projects/psri/MissedCallsWidget';
import './App.css';

function LoginScreen() {
  const { login } = useAuth();
  return (
    <div style={{ minHeight: '100vh', display: 'flex', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <div style={{
        flex: '0 0 55%', background: 'linear-gradient(145deg, #0d4f4a 0%, #0d9488 60%, #0d4f4a 100%)',
        display: 'flex', flexDirection: 'column', padding: '56px 64px', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -80, right: -80, width: 320, height: 320, borderRadius: '50%', background: 'rgba(20,184,166,.15)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -60, left: -60, width: 240, height: 240, borderRadius: '50%', background: 'rgba(20,184,166,.10)', pointerEvents: 'none' }} />
        <div style={{ marginBottom: 64, position: 'relative' }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' }}>Open Mind Services</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', marginTop: 4 }}>PSRI Hospital — CRM</div>
        </div>
        <div style={{ position: 'relative', marginBottom: 48 }}>
          <h1 style={{ fontSize: 36, fontWeight: 800, color: '#fff', lineHeight: 1.2, margin: '0 0 16px', maxWidth: 420 }}>
            Your hospital's patient helpline, fully organised
          </h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,.55)', lineHeight: 1.7, margin: 0, maxWidth: 400 }}>
            Log calls, manage contacts, track cases, and coordinate with PSRI's clinical team — all in one place.
          </p>
        </div>
        <div style={{ marginTop: 'auto', paddingTop: 48, fontSize: 11, color: 'rgba(255,255,255,.25)', position: 'relative' }}>
          Secured by Microsoft Entra ID &nbsp;·&nbsp; Open Mind Services Limited
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: '40px 32px' }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <div style={{ marginBottom: 36 }}>
            <h2 style={{ fontSize: 24, fontWeight: 800, color: '#134e4a', margin: '0 0 8px' }}>Sign in to PSRI CRM</h2>
            <p style={{ fontSize: 14, color: '#64748b', margin: 0, lineHeight: 1.6 }}>Use your official Open Mind Microsoft account</p>
          </div>
          <button
            onClick={login}
            style={{
              width: '100%', padding: '14px 0',
              background: '#0078d4', color: '#fff', border: 'none', borderRadius: 10,
              fontSize: 15, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
              boxShadow: '0 4px 14px rgba(0,120,212,.35)', transition: 'all .2s',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 21 21" fill="none">
              <rect width="10" height="10" fill="#F25022"/><rect x="11" width="10" height="10" fill="#7FBA00"/>
              <rect y="11" width="10" height="10" fill="#00A4EF"/><rect x="11" y="11" width="10" height="10" fill="#FFB900"/>
            </svg>
            Sign in with Microsoft
          </button>
          <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', marginTop: 20 }}>
            Only authorised Open Mind agents can access this system.
          </p>
        </div>
      </div>
    </div>
  );
}

function AccessDenied() {
  const { logout } = useAuth();
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🚫</div>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#1e293b', margin: '0 0 8px' }}>Access Denied</h2>
        <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6, margin: '0 0 24px' }}>
          Your Microsoft account is not registered as a PSRI CRM agent. Contact your administrator to get access.
        </p>
        <button onClick={logout} style={{ padding: '10px 24px', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Sign out
        </button>
      </div>
    </div>
  );
}

function AppShell() {
  const { isAuthenticated, currentUser, authLoading, accessDenied, isSuperAdmin } = useAuth();

  if (!isAuthenticated) return <LoginScreen />;
  if (authLoading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontFamily: 'sans-serif' }}>
      Signing you in…
    </div>
  );
  if (accessDenied || !currentUser) return <AccessDenied />;

  return (
    <SparkTGProvider agentEmail={currentUser.email}>
      <PicklistsProvider>
        <DependenciesProvider>
          <SpecialtySummariesProvider>
            <GuidanceProvider>
              <BrowserRouter basename={import.meta.env.BASE_URL}>
                <div className="ucrm-shell">
                  <ProjectRail />
                  <Routes>
                    {PROJECTS.flatMap(project =>
                      project.modules.map(mod => (
                        <Route
                          key={mod.path}
                          path={`/${project.id}${mod.path}`}
                          element={<main className="ucrm-main">{mod.element}</main>}
                        />
                      ))
                    )}
                    {isSuperAdmin && (
                      <>
                        <Route path="/admin/users"        element={<main className="ucrm-main"><UsersPage /></main>} />
                        <Route path="/admin/picklists"    element={<main className="ucrm-main"><PicklistsPage /></main>} />
                        <Route path="/admin/dependencies" element={<main className="ucrm-main"><DependenciesPage /></main>} />
                      </>
                    )}
                    <Route path="/admin/*" element={<Navigate to="/psri/contacts" replace />} />
                    <Route path="/" element={<Navigate to="/psri/contacts" replace />} />
                  </Routes>
                  <SparkTGWidget />
                  <DialerPanel />
                  <DoctorLookupWidget />
                  <MissedCallsWidget />
                  <ChatWidget />
                </div>
              </BrowserRouter>
            </GuidanceProvider>
          </SpecialtySummariesProvider>
        </DependenciesProvider>
      </PicklistsProvider>
    </SparkTGProvider>
  );
}

export default function App() {
  return (
    <UsersProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </UsersProvider>
  );
}
