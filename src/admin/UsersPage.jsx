import { useState } from 'react';
import { useUsers, ROLES } from '../context/UsersContext';
import './Admin.css';

const emptyForm = { id: '', name: '', contact: '', email: '', password: '', role: 'User', sparktgExtension: '' };

export default function UsersPage() {
  const { users, loading, error, addUser, updateUser } = useUsers();
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState(emptyForm);
  const [errors, setErrors]       = useState({});
  const [saving, setSaving]       = useState(false);
  const [saveErr, setSaveErr]     = useState('');
  const [toast, setToast]         = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const openNew  = () => { setForm(emptyForm); setErrors({}); setSaveErr(''); setShowForm(true); };
  const openEdit = (u) => { setForm({ ...u, password: '' }); setErrors({}); setSaveErr(''); setShowForm(true); };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!/^\d{10}$/.test(form.contact.trim())) e.contact = 'Valid 10-digit contact number is required';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) e.email = 'Valid official email is required';
    if (!form.id && form.password.trim().length < 6) e.password = 'Password must be at least 6 characters';
    if (!form.role) e.role = 'Select a role';
    return e;
  };

  const handleSave = async (ev) => {
    ev.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    setSaveErr('');
    const result = form.id ? await updateUser(form.id, form) : await addUser(form);
    setSaving(false);
    if (result.success) {
      showToast(form.id ? 'User updated' : 'User created');
      setShowForm(false);
    } else {
      setSaveErr(result.error || 'Could not save user. Please try again.');
    }
  };

  if (showForm) {
    return (
      <div className="admin-page">
        {toast && <div className="admin-toast">{toast}</div>}

        <div className="admin-form-top">
          <button className="admin-btn-ghost" onClick={() => !saving && setShowForm(false)} disabled={saving}>← Back</button>
          <h1 className="admin-title" style={{ marginLeft: 12 }}>{form.id ? 'Edit User' : 'New User'}</h1>
        </div>

        {saveErr && <div className="admin-err-banner" style={{ marginBottom: 16, maxWidth: 600 }}>{saveErr}</div>}

        <form onSubmit={handleSave} className="admin-form admin-form-fullpage">
          <div className="admin-field">
            <label>User Name <span className="req">*</span></label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className={errors.name ? 'err' : ''}
              placeholder="e.g. Priya Mehta"
            />
            {errors.name && <p className="admin-err-msg">{errors.name}</p>}
          </div>

          <div className="admin-form-row">
            <div className="admin-field">
              <label>User Contact Number <span className="req">*</span></label>
              <input
                type="tel"
                maxLength={10}
                value={form.contact}
                onChange={e => setForm(f => ({ ...f, contact: e.target.value.replace(/\D/g, '') }))}
                className={errors.contact ? 'err' : ''}
                placeholder="10-digit mobile"
              />
              {errors.contact && <p className="admin-err-msg">{errors.contact}</p>}
            </div>
            <div className="admin-field">
              <label>Role <span className="req">*</span></label>
              <select
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className={errors.role ? 'err' : ''}
              >
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>

          <div className="admin-field">
            <label>User Official Email <span className="req">*</span></label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className={errors.email ? 'err' : ''}
              placeholder="name@openmindserviceslimited.in"
            />
            {errors.email && <p className="admin-err-msg">{errors.email}</p>}
          </div>

          <div className="admin-field">
            <label>SparkTG Extension <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional — used to match this agent's calls on Call Logs)</span></label>
            <input
              type="text"
              value={form.sparktgExtension}
              onChange={e => setForm(f => ({ ...f, sparktgExtension: e.target.value.trim() }))}
              placeholder="e.g. 11128705"
            />
          </div>

          <div className="admin-field">
            <label>User Password {form.id && <span style={{ color: '#94a3b8', fontWeight: 400 }}>(leave blank to keep unchanged)</span>} {!form.id && <span className="req">*</span>}</label>
            <input
              type="password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              className={errors.password ? 'err' : ''}
              placeholder={form.id ? '••••••••' : 'Minimum 6 characters'}
            />
            {errors.password && <p className="admin-err-msg">{errors.password}</p>}
          </div>

          <div className="admin-form-actions-sticky">
            <button type="button" className="admin-btn-ghost" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
            <button type="submit" className="admin-btn-primary" disabled={saving}>
              {saving ? 'Saving…' : (form.id ? 'Save Changes' : 'Create User')}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="admin-page">
      {toast && <div className="admin-toast">{toast}</div>}

      <div className="admin-top">
        <div>
          <h1 className="admin-title">User Management</h1>
          <p className="admin-subtitle">Manage who can access this CRM and at what level — once created, a user cannot be removed</p>
        </div>
        <button className="admin-btn-primary" onClick={openNew}>+ New User</button>
      </div>

      {error && <div className="admin-err-banner">{error}</div>}

      <div className="admin-table-wrap">
        {loading ? (
          <div className="admin-table-loading">Loading users…</div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact Number</th>
                <th>Official Email</th>
                <th>Role</th>
                <th>SparkTG Extension</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 700 }}>{u.name}</td>
                  <td>{u.contact}</td>
                  <td>{u.email}</td>
                  <td><span className={`admin-role-badge role-${u.role.replace(/\s+/g, '-').toLowerCase()}`}>{u.role}</span></td>
                  <td>{u.sparktgExtension || '—'}</td>
                  <td className="admin-row-actions">
                    <button className="admin-btn-ghost" onClick={() => openEdit(u)}>Edit</button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8', padding: 24 }}>No users yet</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
