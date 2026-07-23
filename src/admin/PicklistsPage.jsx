import { useState } from 'react';
import { usePicklists, KNOWN_LISTS } from '../context/PicklistsContext';
import './Admin.css';

export default function PicklistsPage() {
  const { picklists, loading, error, getList, addValue } = usePicklists();
  const [newListName, setNewListName] = useState('');
  const [drafts, setDrafts] = useState({}); // { [listName]: inputValue }
  const [busy, setBusy]     = useState(''); // listName currently saving
  const [toast, setToast]   = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  // Union of known list names + any list names already in the sheet (e.g. custom ones admin added)
  const allListNames = [...new Set([...KNOWN_LISTS, ...Object.keys(picklists)])].sort();

  const handleAddValue = async (listName) => {
    const value = (drafts[listName] || '').trim();
    if (!value) return;
    setBusy(listName);
    const result = await addValue(listName, value);
    setBusy('');
    if (result.success) {
      setDrafts(d => ({ ...d, [listName]: '' }));
      showToast(`Added "${value}" to ${listName}`);
    } else {
      showToast(result.error || 'Could not add value');
    }
  };

  const handleCreateList = async (ev) => {
    ev.preventDefault();
    const listName = newListName.trim();
    if (!listName) return;
    const value = (drafts[listName] || '').trim();
    if (!value) { showToast('Enter at least one starting value for the new list'); return; }
    setBusy(listName);
    const result = await addValue(listName, value);
    setBusy('');
    if (result.success) {
      setNewListName('');
      setDrafts(d => ({ ...d, [listName]: '' }));
      showToast(`Created list "${listName}"`);
    } else {
      showToast(result.error || 'Could not create list');
    }
  };

  return (
    <div className="admin-page">
      {toast && <div className="admin-toast">{toast}</div>}

      <div className="admin-top">
        <div>
          <h1 className="admin-title">Picklist Manager</h1>
          <p className="admin-subtitle">Manage dropdown values used across Contacts, Cases &amp; Leads — Source of Information, Contact Type, City, etc.</p>
        </div>
      </div>

      {error && <div className="admin-err-banner">{error}</div>}

      {loading ? (
        <div className="admin-table-loading">Loading picklists…</div>
      ) : (
        <div className="picklist-grid">
          {allListNames.map(listName => (
            <div key={listName} className="picklist-card">
              <div className="picklist-card-title">{listName}</div>
              <div className="picklist-chips">
                {getList(listName).length === 0 && <span className="picklist-empty">No values yet</span>}
                {getList(listName).map(v => (
                  <span key={v} className="picklist-chip">{v}</span>
                ))}
              </div>
              <div className="picklist-add-row">
                <input
                  type="text"
                  placeholder={`Add a value to ${listName}…`}
                  value={drafts[listName] || ''}
                  onChange={e => setDrafts(d => ({ ...d, [listName]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddValue(listName))}
                />
                <button
                  className="admin-btn-ghost"
                  onClick={() => handleAddValue(listName)}
                  disabled={busy === listName || !(drafts[listName] || '').trim()}
                >
                  {busy === listName ? 'Adding…' : '+ Add'}
                </button>
              </div>
            </div>
          ))}

          <div className="picklist-card picklist-new-card">
            <div className="picklist-card-title">+ New Picklist</div>
            <form onSubmit={handleCreateList} className="picklist-new-form">
              <input
                type="text"
                placeholder="List name (e.g. Department)"
                value={newListName}
                onChange={e => setNewListName(e.target.value)}
              />
              <input
                type="text"
                placeholder="First value"
                value={drafts[newListName.trim()] || ''}
                onChange={e => setDrafts(d => ({ ...d, [newListName.trim()]: e.target.value }))}
                disabled={!newListName.trim()}
              />
              <button className="admin-btn-primary" type="submit" disabled={!newListName.trim() || busy === newListName.trim()}>
                {busy === newListName.trim() ? 'Creating…' : 'Create List'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
