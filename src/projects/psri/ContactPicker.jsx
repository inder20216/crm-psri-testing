import { useState, useEffect, useRef, useCallback } from 'react';
import { psri } from '../../api/psri';
import { usePicklists } from '../../context/PicklistsContext';
import { useUsers } from '../../context/UsersContext';
import { COUNTRIES, findCountry } from '../../data/countries';
import { INDIA_STATES, INDIA_STATE_NAMES } from '../../data/indiaStates';
import './Psri.css';

const SALUTATIONS = ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Master', 'Baby'];

function fullNumber(isd, num) { return num ? `${isd} ${num}` : ''; }

function titleCase(s) {
  return (s || '').trim().replace(/\s+/g, ' ').replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

const quickEmptyForm = {
  salutation: 'Mr.', name: '', age: '',
  mobileIsd: '+91', mobile: '', altMobileIsd: '+91', altMobile: '', landlineIsd: '+91', landline: '',
  email: '',
  country: 'IN', state: '', city: '',
  contactType: '', source: '', language: '',
  assignedTo: '', notes: '',
};

function PhoneField({ label, required, isdValue, numValue, onIsdChange, onNumChange, error }) {
  return (
    <div className="psri-field" style={{ minWidth: 220 }}>
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

// Shared by Cases & Leads — search for an existing contact, or quick-add a new one inline.
// onSelect receives the contact object: { id, name, mobile, ... }
// Ensures a contact's existing value (even an old/legacy one not in the picklist) is never silently dropped
function withCurrentValue(list, current) {
  if (!current || list.includes(current)) return list;
  return [...list, current];
}

export default function ContactPicker({ onSelect, selected, initialQuery = '', autoOpenQuickAdd = false }) {
  const { getList } = usePicklists();
  const { users } = useUsers();
  const [query, setQuery]       = useState(initialQuery);
  const [results, setResults]   = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickForm, setQuickForm]       = useState(quickEmptyForm);
  const [quickErrors, setQuickErrors]   = useState({});
  const [quickSaving, setQuickSaving]   = useState(false);
  const [quickErr, setQuickErr]         = useState('');
  const debounceRef   = useRef(null);
  const autoOpenedRef = useRef(false);

  const openQuickAdd = useCallback(() => {
    setQuickForm({ ...quickEmptyForm, name: query.trim() && /^\d+$/.test(query.trim()) ? '' : query.trim(), mobile: /^\d{10}$/.test(query.trim()) ? query.trim() : '' });
    setQuickErrors({}); setQuickErr('');
    setShowQuickAdd(true);
  }, [query]);

  // Auto-open the Quick Add modal when the caller has no contact record
  useEffect(() => {
    if (autoOpenQuickAdd && searched && !searching && results.length === 0 && !showQuickAdd && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      openQuickAdd();
    }
  }, [autoOpenQuickAdd, searched, searching, results.length, showQuickAdd, openQuickAdd]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); setSearched(false); setSearchErr(''); return; }
    debounceRef.current = setTimeout(() => {
      setSearching(true);
      setSearchErr('');
      psri.getContacts(query.trim())
        .then(res => { setResults(res.contacts || []); setSearched(true); })
        .catch(() => { setResults([]); setSearched(true); setSearchErr('Could not search contacts. Please try again, or add a new contact below.'); })
        .finally(() => setSearching(false));
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const handleQuickCountryChange = (iso2) => {
    const c = findCountry(iso2);
    setQuickForm(f => ({
      ...f, country: iso2, state: '', city: '',
      mobileIsd: c.isd, altMobileIsd: c.isd, landlineIsd: c.isd,
    }));
  };

  const validateQuick = () => {
    const e = {};
    if (!quickForm.name.trim()) e.name = 'Name is required';
    if (!/^\d{10}$/.test(quickForm.mobile.trim())) e.mobile = 'Valid 10-digit mobile is required';
    if (!quickForm.contactType) e.contactType = 'Select a contact type';
    if (quickForm.age && (Number(quickForm.age) < 0 || Number(quickForm.age) > 130)) e.age = 'Enter a valid age';
    return e;
  };

  const quickStateOptions = quickForm.country === 'IN' ? INDIA_STATE_NAMES : [];
  const quickCityOptions  = quickForm.country === 'IN' && quickForm.state ? (INDIA_STATES[quickForm.state] || []) : [];

  const handleQuickSave = async (ev) => {
    ev?.preventDefault();
    const errs = validateQuick();
    if (Object.keys(errs).length) { setQuickErrors(errs); return; }
    const cleaned = { ...quickForm, name: titleCase(quickForm.name) };
    setQuickSaving(true);
    setQuickErr('');
    try {
      const res = await psri.addContact(cleaned);
      onSelect({ ...cleaned, id: res.id });
      setShowQuickAdd(false);
      setQuery('');
      setResults([]);
    } catch (err) {
      setQuickErr(err.message || 'Could not create contact');
    } finally {
      setQuickSaving(false);
    }
  };

  if (selected) {
    return (
      <div className="cp-selected">
        <div className="psri-avatar">{(selected.name || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase()).join('')}</div>
        <div className="cp-selected-info">
          <div className="cp-selected-name">{selected.salutation} {selected.name}</div>
          <div className="cp-selected-meta">{fullNumber(selected.mobileIsd || '+91', selected.mobile)}</div>
        </div>
        <button type="button" className="psri-btn-ghost" onClick={() => onSelect(null)}>Change</button>
      </div>
    );
  }

  return (
    <div className="cp-wrap">
      <input
        className="psri-search-input"
        style={{ maxWidth: 'none', width: '100%' }}
        type="text"
        placeholder="Search contact by name, mobile, or email…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        autoFocus
      />

      {searching && <div className="cp-hint">Searching…</div>}

      {!searching && searched && results.length > 0 && (
        <div className="cp-results">
          {results.map(c => (
            <div key={c.id} className="cp-result-item" onClick={() => onSelect(c)}>
              <div className="psri-avatar" style={{ width: 34, height: 34, fontSize: 12 }}>
                {(c.name || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase()).join('')}
              </div>
              <div>
                <div className="cp-result-name">{c.salutation} {c.name}</div>
                <div className="cp-result-meta">{fullNumber(c.mobileIsd, c.mobile)} {c.contactType && `· ${c.contactType}`}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!searching && searched && results.length === 0 && (
        <div className="cp-no-results">
          {searchErr && <p className="psri-err-msg">{searchErr}</p>}
          <p>No contact found for "{query}"</p>
          <button type="button" className="psri-btn-primary" onClick={openQuickAdd}>+ Quick Add Contact</button>
        </div>
      )}

      {showQuickAdd && (
        <div className="psri-modal-overlay" onClick={() => !quickSaving && setShowQuickAdd(false)}>
          <div className="psri-modal cp-quick-add-modal" onClick={e => e.stopPropagation()}>
            <div className="psri-modal-title">Quick Add Contact</div>
            {quickErr && <div className="psri-err-banner">{quickErr}</div>}
            <div className="psri-form">

              <div className="psri-form-section-label">Identity</div>
              <div className="psri-form-row">
                <div className="psri-field" style={{ flex: '0 0 100px' }}>
                  <label>Salutation</label>
                  <select value={quickForm.salutation} onChange={e => setQuickForm(f => ({ ...f, salutation: e.target.value }))}>
                    {SALUTATIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="psri-field" style={{ flex: 1 }}>
                  <label>Full Name <span className="req">*</span></label>
                  <input
                    type="text"
                    value={quickForm.name}
                    onChange={e => setQuickForm(f => ({ ...f, name: e.target.value }))}
                    className={quickErrors.name ? 'err' : ''}
                  />
                  {quickErrors.name && <p className="psri-err-msg">{quickErrors.name}</p>}
                </div>
                <div className="psri-field" style={{ flex: '0 0 90px' }}>
                  <label>Age</label>
                  <input
                    type="number"
                    min="0" max="130"
                    value={quickForm.age}
                    onChange={e => setQuickForm(f => ({ ...f, age: e.target.value }))}
                    className={quickErrors.age ? 'err' : ''}
                  />
                  {quickErrors.age && <p className="psri-err-msg">{quickErrors.age}</p>}
                </div>
              </div>

              <div className="psri-form-section-label">Contact Information</div>
              <div className="psri-form-row">
                <PhoneField
                  label="Mobile" required
                  isdValue={quickForm.mobileIsd} numValue={quickForm.mobile}
                  onIsdChange={v => setQuickForm(f => ({ ...f, mobileIsd: v }))}
                  onNumChange={v => setQuickForm(f => ({ ...f, mobile: v }))}
                  error={quickErrors.mobile}
                />
                <PhoneField
                  label="Alternate Mobile"
                  isdValue={quickForm.altMobileIsd} numValue={quickForm.altMobile}
                  onIsdChange={v => setQuickForm(f => ({ ...f, altMobileIsd: v }))}
                  onNumChange={v => setQuickForm(f => ({ ...f, altMobile: v }))}
                />
                <PhoneField
                  label="Alternate Landline"
                  isdValue={quickForm.landlineIsd} numValue={quickForm.landline}
                  onIsdChange={v => setQuickForm(f => ({ ...f, landlineIsd: v }))}
                  onNumChange={v => setQuickForm(f => ({ ...f, landline: v }))}
                />
              </div>
              <div className="psri-field">
                <label>Email</label>
                <input type="email" value={quickForm.email} onChange={e => setQuickForm(f => ({ ...f, email: e.target.value }))} placeholder="Optional" />
              </div>

              <div className="psri-form-section-label">Address</div>
              <div className="psri-form-row">
                <div className="psri-field">
                  <label>Country</label>
                  <select value={quickForm.country} onChange={e => handleQuickCountryChange(e.target.value)}>
                    {COUNTRIES.map(c => <option key={c.iso2} value={c.iso2}>{c.name} ({c.isd})</option>)}
                  </select>
                </div>
                <div className="psri-field">
                  <label>State</label>
                  {quickForm.country === 'IN' ? (
                    <select value={quickForm.state} onChange={e => setQuickForm(f => ({ ...f, state: e.target.value, city: '' }))}>
                      <option value="">— Select —</option>
                      {quickStateOptions.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : (
                    <input type="text" value={quickForm.state} onChange={e => setQuickForm(f => ({ ...f, state: e.target.value }))} placeholder="State / Province" />
                  )}
                </div>
                <div className="psri-field">
                  <label>City</label>
                  {quickForm.country === 'IN' && quickForm.state ? (
                    <select value={quickForm.city} onChange={e => setQuickForm(f => ({ ...f, city: e.target.value }))}>
                      <option value="">— Select —</option>
                      {quickCityOptions.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : (
                    <input type="text" value={quickForm.city} onChange={e => setQuickForm(f => ({ ...f, city: e.target.value }))} placeholder="City" />
                  )}
                </div>
              </div>

              <div className="psri-form-section-label">Classification &amp; Assignment</div>
              <div className="psri-form-row">
                <div className="psri-field">
                  <label>Contact Type <span className="req">*</span></label>
                  <select
                    value={quickForm.contactType}
                    onChange={e => setQuickForm(f => ({ ...f, contactType: e.target.value }))}
                    className={quickErrors.contactType ? 'err' : ''}
                  >
                    <option value="">— Select —</option>
                    {getList('Contact Type').map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {quickErrors.contactType && <p className="psri-err-msg">{quickErrors.contactType}</p>}
                </div>
                <div className="psri-field">
                  <label>Source of Information</label>
                  <select value={quickForm.source} onChange={e => setQuickForm(f => ({ ...f, source: e.target.value }))}>
                    <option value="">— Select —</option>
                    {getList('Source of Information').map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="psri-field">
                  <label>Language Preference</label>
                  <select value={quickForm.language} onChange={e => setQuickForm(f => ({ ...f, language: e.target.value }))}>
                    <option value="">— Select —</option>
                    {getList('Language').map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div className="psri-field">
                  <label>Contact Assigned To</label>
                  <select value={quickForm.assignedTo} onChange={e => setQuickForm(f => ({ ...f, assignedTo: e.target.value }))}>
                    <option value="">— Unassigned —</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                  </select>
                </div>
              </div>

              <div className="psri-field">
                <label>Notes</label>
                <textarea
                  rows={3}
                  value={quickForm.notes}
                  onChange={e => setQuickForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Any additional context about this contact…"
                />
              </div>

              <div className="psri-modal-actions">
                <button type="button" className="psri-btn-ghost" onClick={() => setShowQuickAdd(false)} disabled={quickSaving}>Cancel</button>
                <button type="button" className="psri-btn-primary" onClick={handleQuickSave} disabled={quickSaving}>{quickSaving ? 'Creating…' : 'Create & Select'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
