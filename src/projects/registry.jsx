import ContactsPage from './psri/ContactsPage';
import CasesPage from './psri/CasesPage';
import CallLogsPage from './psri/CallLogsPage';
import VmmHome from './vmm/VmmHome';

// Central registry of all projects in the universal CRM.
// To add a new project later: add an entry here with its modules — no other wiring needed.
export const PROJECTS = [
  {
    id: 'psri',
    name: 'PSRI Hospital',
    icon: '🏥',
    color: '#0d9488',
    modules: [
      { path: '/contacts',   label: 'Contacts',  icon: '👤', element: <ContactsPage /> },
      { path: '/cases',      label: 'Cases',     icon: '🗂️', element: <CasesPage /> },
      { path: '/call-logs',  label: 'Call Logs', icon: '☎️', element: <CallLogsPage /> },
    ],
  },
  {
    id: 'vmm',
    name: 'VMM Facility',
    icon: '🏬',
    color: '#2563eb',
    modules: [
      { path: '/home', label: 'Overview', icon: '⊞', element: <VmmHome /> },
    ],
  },
];
