import { useState, useMemo, useEffect, useCallback } from 'react';
import { COUNTRIES, findCountry } from '../../data/countries';
import { INDIA_STATES, INDIA_STATE_NAMES } from '../../data/indiaStates';
import { useUsers } from '../../context/UsersContext';
import { usePicklists } from '../../context/PicklistsContext';
import { useSparkTG } from '../../context/SparkTGContext';
import { psri } from '../../api/psri';
import './Psri.css';

const SALUTATIONS = ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Master', 'Baby'];

function titleCase(s) {
  return (s || '').trim().replace(/\s+/g, ' ').replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase()).join('');
}

function fullNumber(isd, num) { return num ? `${isd} ${num}` : ''; }

const emptyForm = {
  id: '', salutation: 'Mr.', name: '', age: '',
  mobileIsd: '+91', mobile: '', altMobileIsd: '+91', altMobile: '', landlineIsd: '+91', landline: '',
  email: '',
  country: 'IN', state: '', city: '',
  contactType: '', source: '', language: '',
  assignedTo: '', notes: '',
};

function PhoneField({ label, required, isdValue, numValue, onIsdChange, onNumChange, error }) {
  return (
    <div className="psri-field" style={{ minWidth: 260 }}>
      <label>{label} {required && <span className="req">*</span>}</label>
      <div className="psri-phone-row">
        <select className="psri-isd-select" value={isdValue} onChange={e => onIsdChange(e.target.value)}>
          {COUNTRIES.map(c => <option key={c.iso2} value={c.isd}>{c.isd} {c.name}</option>)}
        </select>
        <input
          type="tel"
          maxLength={10}
          value={numValue}
          onChange={e => onNumChange(e.target.value.replace(/\D/g, ''))}
          className={error ? 'err' : ''}
          placeholder="Number"
        />
      </div>
      {error && <p className="psri-err-msg">{error}</p>}
    </div>
  );
}

// Ensures a contact's existing value (even an old/legacy one not in the picklist) is never silently dropped
function withCurrentValue(list, current) {
  if (!current || list.includes(current)) return list;
  return [...list, current];
}

export default function ContactsPage() {
  const { users } = useUsers();
  const { getList: getPicklist } = usePicklists();
  const { dial, hasWidget } = useSparkTG();
  const [contacts, setContacts]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [loadErr, setLoadErr]     = useState('');
  const [query, setQuery]         = useState('');
  const [selected, setSelected]   = useState(null);
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState(emptyForm);
  const [errors, setErrors]       = useState({});
  const [saving, setSaving]       = useState(false);
  const [saveErr, setSaveErr]     = useState('');
  const [toast, setToast]         = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const refresh = useCallback(() => {
    setLoading(true);
    setLoadErr('');
    return psri.getContacts()
      .then(res => setContacts(res.contacts || []))
      .catch(() => setLoadErr('Could not load contacts. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.mobile.includes(q) ||
      (c.altMobile || '').includes(q) ||
      (c.email || '').toLowerCase().includes(q)
    );
  }, [contacts, query]);

  const openNew = () => { setForm(emptyForm); setErrors({}); setSaveErr(''); setShowForm(true); };
  const openEdit = (c) => { setForm(c); setErrors({}); setSaveErr(''); setShowForm(true); };

  const handleNameBlur = () => setForm(f => ({ ...f, name: titleCase(f.name) }));

  const handleCountryChange = (iso2) => {
    const c = findCountry(iso2);
    setForm(f => ({
      ...f, country: iso2, state: '', city: '',
      mobileIsd: c.isd, altMobileIsd: c.isd, landlineIsd: c.isd,
    }));
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!/^\d{10}$/.test(form.mobile.trim())) e.mobile = 'Valid 10-digit mobile is required';
    if (!form.contactType) e.contactType = 'Select a contact type';
    if (form.age && (Number(form.age) < 0 || Number(form.age) > 130)) e.age = 'Enter a valid age';
    return e;
  };

  const handleSave = async (ev) => {
    ev.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    const cleaned = { ...form, name: titleCase(form.name) };
    setSaving(true);
    setSaveErr('');
    try {
      if (cleaned.id) {
        await psri.updateContact(cleaned);
        showToast('Contact updated');
      } else {
        await psri.addContact(cleaned);
        showToast('Contact created');
      }
      await refresh();
      setShowForm(false);
      setSelected(null);
    } catch (err) {
      setSaveErr(err.message || 'Could not save contact. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleCall = (c, e) => {
    e?.stopPropagation();
    if (hasWidget) { dial(c.mobile); return; }
    window.location.href = `tel:${c.mobileIsd.replace('+', '00')}${c.mobile}`;
  };
  const handleEmail = (c, e) => {
    e?.stopPropagation();
    if (!c.email) { showToast('No email on file for this contact'); return; }
    window.location.href = `mailto:${c.email}`;
  };
  const handleWhatsapp = (c, e) => {
    e?.stopPropagation();
    window.open(`https://wa.me/${c.mobileIsd.replace('+', '')}${c.mobile}`, '_blank');
  };

  const stateOptions = form.country === 'IN' ? INDIA_STATE_NAMES : [];
  const cityOptions   = form.country === 'IN' && form.state ? (INDIA_STATES[form.state] || []) : [];

  if (showForm) {
    return (
      <div className="psri-page">
        {toast && <div className="psri-toast">{toast}</div>}

        <div className="psri-form-top">
          <button className="psri-btn-ghost" onClick={() => !saving && setShowForm(false)} disabled={saving}>← Back</button>
          <h1 className="psri-title" style={{ marginLeft: 12 }}>{form.id ? 'Edit Contact' : 'New Contact'}</h1>
        </div>

        {saveErr && <div className="psri-err-banner" style={{ marginBottom: 16, maxWidth: 920 }}>{saveErr}</div>}

        <form onSubmit={handleSave} className="psri-form psri-form-fullpage">

          <div className="psri-form-section-label">Identity</div>
          <div className="psri-form-row">
            <div className="psri-field" style={{ flex: '0 0 100px' }}>
              <label>Salutation</label>
              <select value={form.salutation} onChange={e => setForm(f => ({ ...f, salutation: e.target.value }))}>
                {SALUTATIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="psri-field" style={{ flex: 1 }}>
              <label>Full Name <span className="req">*</span> <span className="psri-hint-inline">(auto-corrected to Title Case)</span></label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                onBlur={handleNameBlur}
                className={errors.name ? 'err' : ''}
                placeholder="e.g. rajesh kumar"
              />
              {errors.name && <p className="psri-err-msg">{errors.name}</p>}
            </div>
            <div className="psri-field" style={{ flex: '0 0 90px' }}>
              <label>Age</label>
              <input
                type="number"
                min="0" max="130"
                value={form.age}
                onChange={e => setForm(f => ({ ...f, age: e.target.value }))}
                className={errors.age ? 'err' : ''}
              />
              {errors.age && <p className="psri-err-msg">{errors.age}</p>}
            </div>
          </div>

          <div className="psri-form-section-label">Contact Information</div>
          <div className="psri-form-row">
            <PhoneField
              label="Mobile" required
              isdValue={form.mobileIsd} numValue={form.mobile}
              onIsdChange={v => setForm(f => ({ ...f, mobileIsd: v }))}
              onNumChange={v => setForm(f => ({ ...f, mobile: v }))}
              error={errors.mobile}
            />
            <PhoneField
              label="Alternate Mobile"
              isdValue={form.altMobileIsd} numValue={form.altMobile}
              onIsdChange={v => setForm(f => ({ ...f, altMobileIsd: v }))}
              onNumChange={v => setForm(f => ({ ...f, altMobile: v }))}
            />
            <PhoneField
              label="Alternate Landline"
              isdValue={form.landlineIsd} numValue={form.landline}
              onIsdChange={v => setForm(f => ({ ...f, landlineIsd: v }))}
              onNumChange={v => setForm(f => ({ ...f, landline: v }))}
            />
          </div>
          <div className="psri-field">
            <label>Email</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="Optional"
            />
          </div>

          <div className="psri-form-section-label">Address</div>
          <div className="psri-form-row">
            <div className="psri-field">
              <label>Country</label>
              <select value={form.country} onChange={e => handleCountryChange(e.target.value)}>
                {COUNTRIES.map(c => <option key={c.iso2} value={c.iso2}>{c.name} ({c.isd})</option>)}
              </select>
            </div>
            <div className="psri-field">
              <label>State {form.country === 'IN' && <span className="psri-hint-inline">(auto-narrows City)</span>}</label>
              {form.country === 'IN' ? (
                <select value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value, city: '' }))}>
                  <option value="">— Select —</option>
                  {stateOptions.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <input type="text" value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} placeholder="State / Province" />
              )}
            </div>
            <div className="psri-field">
              <label>City</label>
              {form.country === 'IN' && form.state ? (
                <select value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}>
                  <option value="">— Select —</option>
                  {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : (
                <input type="text" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="City" />
              )}
            </div>
          </div>

          <div className="psri-form-section-label">Classification &amp; Assignment</div>
          <div className="psri-form-row">
            <div className="psri-field">
              <label>Contact Type <span className="req">*</span></label>
              <select
                value={form.contactType}
                onChange={e => setForm(f => ({ ...f, contactType: e.target.value }))}
                className={errors.contactType ? 'err' : ''}
              >
                <option value="">— Select —</option>
                {withCurrentValue(getPicklist('Contact Type'), form.contactType).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {errors.contactType && <p className="psri-err-msg">{errors.contactType}</p>}
            </div>
            <div className="psri-field">
              <label>Source of Information</label>
              <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}>
                <option value="">— Select —</option>
                {withCurrentValue(getPicklist('Source of Information'), form.source).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="psri-field">
              <label>Language Preference</label>
              <select value={form.language} onChange={e => setForm(f => ({ ...f, language: e.target.value }))}>
                <option value="">— Select —</option>
                {withCurrentValue(getPicklist('Language'), form.language).map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="psri-field">
              <label>Contact Assigned To</label>
              <select value={form.assignedTo} onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))}>
                <option value="">— Unassigned —</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
              </select>
            </div>
          </div>

          <div className="psri-field">
            <label>Notes</label>
            <textarea
              rows={4}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Any additional context about this contact…"
            />
          </div>

          <div className="psri-form-actions-sticky">
            <button type="button" className="psri-btn-ghost" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
            <button type="submit" className="psri-btn-primary" disabled={saving}>
              {saving ? 'Saving…' : (form.id ? 'Save Changes' : 'Create Contact')}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="psri-page">
      {toast && <div className="psri-toast">{toast}</div>}

      <div className="psri-top">
        <div>
          <h1 className="psri-title">Contacts</h1>
          <p className="psri-subtitle">PSRI Hospital — Patient &amp; Caller Directory</p>
        </div>
      </div>

      {loadErr && <div className="psri-err-banner">{loadErr}</div>}

      <div className="psri-search-row">
        <input
          className="psri-search-input"
          type="text"
          placeholder="Search by name, mobile, or email…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button className="psri-btn-primary" onClick={openNew} style={{ flexShrink: 0 }}>+ New Contact</button>
        <span className="psri-count">{filtered.length} contact{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="psri-layout">
        {/* ── Contact List ── */}
        <div className="psri-list">
          {loading && <div className="psri-empty">Loading contacts…</div>}
          {!loading && !loadErr && filtered.length === 0 && (
            <div className="psri-empty">No contacts found. Try a different search or add a new contact.</div>
          )}
          {!loading && filtered.map(c => (
            <div
              key={c.id}
              className={`psri-contact-card ${selected?.id === c.id ? 'active' : ''}`}
              onClick={() => setSelected(c)}
            >
              <div className="psri-avatar">{initials(c.name)}</div>
              <div className="psri-contact-main">
                <div className="psri-contact-name">{c.salutation} {c.name}{c.age ? `, ${c.age}` : ''}</div>
                <div className="psri-contact-meta">
                  <span>{fullNumber(c.mobileIsd, c.mobile)}</span>
                  {c.contactType && <span className="psri-badge">{c.contactType}</span>}
                </div>
              </div>
              <div className="psri-actions" onClick={e => e.stopPropagation()}>
                <button className="psri-action-btn call"  title="Call"     onClick={e => handleCall(c, e)}>📞</button>
                <button className="psri-action-btn mail"  title="Email"    onClick={e => handleEmail(c, e)}>✉️</button>
                <button className="psri-action-btn wa"    title="WhatsApp" onClick={e => handleWhatsapp(c, e)}>💬</button>
              </div>
            </div>
          ))}
        </div>

        {/* ── Detail Panel ── */}
        <div className="psri-detail">
          {!selected ? (
            <div className="psri-detail-empty">
              <div className="psri-detail-empty-icon">👤</div>
              <p>Select a contact to view details</p>
            </div>
          ) : (
            <div className="psri-detail-card">
              <div className="psri-detail-head">
                <div className="psri-avatar lg">{initials(selected.name)}</div>
                <div>
                  <div className="psri-detail-name">{selected.salutation} {selected.name}{selected.age ? `, ${selected.age}` : ''}</div>
                  {selected.contactType && <span className="psri-badge">{selected.contactType}</span>}
                </div>
                <button className="psri-btn-ghost" onClick={() => openEdit(selected)}>Edit</button>
              </div>

              <div className="psri-omni-row">
                <button className="psri-omni-btn" onClick={e => handleCall(selected, e)}>📞 Call</button>
                <button className="psri-omni-btn" onClick={e => handleEmail(selected, e)}>✉️ Email</button>
                <button className="psri-omni-btn" onClick={e => handleWhatsapp(selected, e)}>💬 WhatsApp</button>
                <button className="psri-omni-btn disabled" disabled title="Coming soon">📨 SMS</button>
              </div>

              <div className="psri-detail-grid">
                <div className="psri-detail-item"><span>Mobile</span><strong>{fullNumber(selected.mobileIsd, selected.mobile) || '—'}</strong></div>
                <div className="psri-detail-item"><span>Alternate Mobile</span><strong>{fullNumber(selected.altMobileIsd, selected.altMobile) || '—'}</strong></div>
                <div className="psri-detail-item"><span>Alternate Landline</span><strong>{fullNumber(selected.landlineIsd, selected.landline) || '—'}</strong></div>
                <div className="psri-detail-item"><span>Email</span><strong>{selected.email || '—'}</strong></div>
                <div className="psri-detail-item"><span>Age</span><strong>{selected.age || '—'}</strong></div>
                <div className="psri-detail-item"><span>Country</span><strong>{findCountry(selected.country).name}</strong></div>
                <div className="psri-detail-item"><span>State</span><strong>{selected.state || '—'}</strong></div>
                <div className="psri-detail-item"><span>City</span><strong>{selected.city || '—'}</strong></div>
                <div className="psri-detail-item"><span>Source</span><strong>{selected.source || '—'}</strong></div>
                <div className="psri-detail-item"><span>Language</span><strong>{selected.language || '—'}</strong></div>
                <div className="psri-detail-item"><span>Assigned To</span><strong>{users.find(u => u.id === selected.assignedTo)?.name || '—'}</strong></div>
              </div>

              {selected.notes && (
                <div className="psri-detail-notes">
                  <span>Notes</span>
                  <p>{selected.notes}</p>
                </div>
              )}

              <div className="psri-detail-section">
                <div className="psri-detail-section-title">Communication History</div>
                <div className="psri-history-empty">No calls, emails, or messages logged yet for this contact.</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
