import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PROJECTS } from '../projects/registry';
import { useAuth } from '../context/AuthContext';
import './ProjectRail.css';

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase()).join('');
}

export default function ProjectRail() {
  const { pathname } = useLocation();
  const { currentUser, isSuperAdmin, isAdmin, logout } = useAuth();
  const [expanded, setExpanded] = useState(false);

  // Users only see PSRI; Super Admins see all projects
  const visibleProjects = isSuperAdmin
    ? PROJECTS
    : PROJECTS.filter(p => p.id === 'psri');

  return (
    <aside className={`rail ${expanded ? 'expanded' : ''}`}>
      <div className="rail-top">
        <div className="rail-logo">UC</div>
        {expanded && <div className="rail-brand">Universal CRM</div>}
      </div>

      <div className="rail-projects">
        {visibleProjects.map(p => {
          const isActiveProject = pathname.startsWith(`/${p.id}`);
          return (
            <div key={p.id} className="rail-project-group">
              <Link
                to={`/${p.id}${p.modules[0].path}`}
                className={`rail-item ${isActiveProject ? 'active' : ''}`}
                style={{ '--rail-color': p.color }}
                title={p.name}
              >
                <span className="rail-icon">{p.icon}</span>
                {expanded && <span className="rail-label">{p.name}</span>}
              </Link>
              {expanded && isActiveProject && p.modules.length > 0 && (
                <div className="rail-submodules">
                  {p.modules.map(mod => (
                    <Link
                      key={mod.path}
                      to={`/${p.id}${mod.path}`}
                      className={`rail-subitem ${pathname === `/${p.id}${mod.path}` ? 'active' : ''}`}
                    >
                      <span className="rail-subicon">{mod.icon}</span>
                      <span>{mod.label}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Add Project — Super Admin only */}
        {isSuperAdmin && (
          <button className="rail-item rail-add" title="Add a new project (coming soon)">
            <span className="rail-icon">+</span>
            {expanded && <span className="rail-label">Add Project</span>}
          </button>
        )}
      </div>

      <div className="rail-bottom">
        {/* Settings — Super Admin only */}
        {isSuperAdmin && (
          <div className="rail-project-group">
            <Link
              to="/admin/users"
              className={`rail-item ${pathname.startsWith('/admin') ? 'active' : ''}`}
              style={{ '--rail-color': '#4338ca' }}
              title="Settings"
            >
              <span className="rail-icon">⚙</span>
              {expanded && <span className="rail-label">Settings</span>}
            </Link>
            {expanded && pathname.startsWith('/admin') && (
              <div className="rail-submodules">
                <Link to="/admin/users" className={`rail-subitem ${pathname === '/admin/users' ? 'active' : ''}`}>
                  <span className="rail-subicon">👤</span><span>Users</span>
                </Link>
                <Link to="/admin/picklists" className={`rail-subitem ${pathname === '/admin/picklists' ? 'active' : ''}`}>
                  <span className="rail-subicon">☰</span><span>Picklists</span>
                </Link>
                <Link to="/admin/dependencies" className={`rail-subitem ${pathname === '/admin/dependencies' ? 'active' : ''}`}>
                  <span className="rail-subicon">🔗</span><span>Dependencies</span>
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Productivity dashboard — Admin and Super Admin (TL/Manager) */}
        {isAdmin && (
          <Link
            to="/admin/productivity"
            className={`rail-item ${pathname === '/admin/productivity' ? 'active' : ''}`}
            style={{ '--rail-color': '#4338ca' }}
            title="Agent Productivity"
          >
            <span className="rail-icon">📊</span>
            {expanded && <span className="rail-label">Productivity</span>}
          </Link>
        )}

        {/* Logged-in user avatar + logout */}
        {currentUser && (
          <button
            className="rail-item rail-user-btn"
            title={expanded ? '' : `${currentUser.name}\n${currentUser.role}\nClick to sign out`}
            onClick={logout}
            style={{ '--rail-color': '#0d9488', cursor: 'pointer' }}
          >
            <span className="rail-icon rail-avatar">{initials(currentUser.name)}</span>
            {expanded && (
              <span className="rail-user-info">
                <span className="rail-user-name">{currentUser.name}</span>
                <span className="rail-user-role">{currentUser.role} · Sign out</span>
              </span>
            )}
          </button>
        )}

        <button className="rail-toggle" onClick={() => setExpanded(e => !e)} title={expanded ? 'Collapse' : 'Expand'}>
          {expanded ? '‹' : '›'}
        </button>
      </div>
    </aside>
  );
}
