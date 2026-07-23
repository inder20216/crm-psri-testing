import { useState, useMemo } from 'react';
import { useDependencies, KNOWN_RELATIONSHIPS } from '../context/DependenciesContext';
import { usePicklists } from '../context/PicklistsContext';
import './Admin.css';

export default function DependenciesPage() {
  const { dependencies, loading, error, addDependency } = useDependencies();
  const { getList } = usePicklists();
  const [form, setForm] = useState({ mainField: '', mainValue: '', subField: '', subValue: '' });
  const [busy, setBusy]   = useState(false);
  const [toast, setToast] = useState('');
  const [formErr, setFormErr] = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const mainFieldOptions = [...new Set(KNOWN_RELATIONSHIPS.map(r => r.mainField))].sort();
  const subFieldOptions  = KNOWN_RELATIONSHIPS.filter(r => r.mainField === form.mainField).map(r => r.subField);
  const mainValueOptions = form.mainField ? getList(form.mainField) : [];
  const subValueOptions  = form.subField  ? getList(form.subField)  : [];

  const grouped = useMemo(() => {
    const byRelationship = {};
    dependencies.forEach(d => {
      const relKey = `${d.mainField} → ${d.subField}`;
      if (!byRelationship[relKey]) byRelationship[relKey] = {};
      if (!byRelationship[relKey][d.mainValue]) byRelationship[relKey][d.mainValue] = [];
      byRelationship[relKey][d.mainValue].push(d.subValue);
    });
    return byRelationship;
  }, [dependencies]);

  const relationshipKeys = useMemo(() => {
    const known = KNOWN_RELATIONSHIPS.map(r => `${r.mainField} → ${r.subField}`);
    return [...new Set([...known, ...Object.keys(grouped)])];
  }, [grouped]);

  const handleAdd = async (ev) => {
    ev.preventDefault();
    const { mainField, mainValue, subField, subValue } = form;
    if (!mainField || !mainValue || !subField || !subValue) {
      setFormErr('All 4 fields are required');
      return;
    }
    setBusy(true);
    setFormErr('');
    const result = await addDependency(mainField, mainValue, subField, subValue);
    setBusy(false);
    if (result.success) {
      showToast(`Added: ${mainValue} → ${subValue}`);
      setForm(f => ({ ...f, mainValue: '', subValue: '' }));
    } else {
      setFormErr(result.error || 'Could not add dependency');
    }
  };

  return (
    <div className="admin-page">
      {toast && <div className="admin-toast">{toast}</div>}

      <div className="admin-top">
        <div>
          <h1 className="admin-title">Dependency Manager</h1>
          <p className="admin-subtitle">Value-to-value relationships — e.g. which Doctors belong to which Specialty, or which Call For options apply to which Channel</p>
        </div>
      </div>

      {error && <div className="admin-err-banner">{error}</div>}

      <div className="dep-add-card">
        <div className="picklist-card-title">+ Add a Dependency Pair</div>
        {formErr && <div className="admin-err-banner" style={{ marginBottom: 12 }}>{formErr}</div>}
        <form onSubmit={handleAdd} className="dep-add-form">

          <select
            value={form.mainField}
            onChange={e => setForm({ mainField: e.target.value, mainValue: '', subField: '', subValue: '' })}
          >
            <option value="">— Main Field —</option>
            {mainFieldOptions.map(f => <option key={f} value={f}>{f}</option>)}
          </select>

          <select
            value={form.mainValue}
            disabled={!form.mainField}
            onChange={e => setForm(f => ({ ...f, mainValue: e.target.value }))}
          >
            <option value="">{!form.mainField ? '— Select Main Field first —' : mainValueOptions.length === 0 ? '— No values in picklist —' : '— Select Main Value —'}</option>
            {mainValueOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>

          <select
            value={form.subField}
            disabled={!form.mainField}
            onChange={e => setForm(f => ({ ...f, subField: e.target.value, subValue: '' }))}
          >
            <option value="">{!form.mainField ? '— Select Main Field first —' : '— Sub Field —'}</option>
            {subFieldOptions.map(f => <option key={f} value={f}>{f}</option>)}
          </select>

          <select
            value={form.subValue}
            disabled={!form.subField}
            onChange={e => setForm(f => ({ ...f, subValue: e.target.value }))}
          >
            <option value="">{!form.subField ? '— Select Sub Field first —' : subValueOptions.length === 0 ? '— No values in picklist —' : '— Select Sub Value —'}</option>
            {subValueOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>

          <button className="admin-btn-primary" type="submit" disabled={busy}>{busy ? 'Adding…' : '+ Add'}</button>
        </form>
      </div>

      {loading ? (
        <div className="admin-table-loading">Loading dependencies…</div>
      ) : (
        relationshipKeys.map(relKey => (
          <div key={relKey} className="dep-relationship-block">
            <div className="dep-relationship-title">{relKey}</div>
            <div className="picklist-grid">
              {Object.keys(grouped[relKey] || {}).length === 0 && (
                <div className="picklist-card"><span className="picklist-empty">No pairs added yet for {relKey}</span></div>
              )}
              {Object.entries(grouped[relKey] || {}).map(([mainValue, subValues]) => (
                <div key={mainValue} className="picklist-card">
                  <div className="picklist-card-title">{mainValue}</div>
                  <div className="picklist-chips">
                    {subValues.map(v => <span key={v} className="picklist-chip">{v}</span>)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
