import { useState, useEffect, useRef } from 'react';
import { psri } from '../../api/psri';
import './Psri.css';

function DoctorSearchTab() {
  const [query, setQuery]         = useState('');
  const [results, setResults]     = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [activeDoctor, setActiveDoctor] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); setSearchErr(''); return; }
    debounceRef.current = setTimeout(() => {
      setSearching(true);
      setSearchErr('');
      psri.searchDoctors(query.trim(), 'doctor')
        .then(res => setResults(res.results || []))
        .catch(() => setSearchErr('Could not search doctors. Please try again.'))
        .finally(() => setSearching(false));
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  return (
    <div>
      <input
        className="psri-search-input"
        style={{ maxWidth: 'none', width: '100%' }}
        type="text"
        placeholder="Search doctor name…"
        value={query}
        onChange={e => { setQuery(e.target.value); setActiveDoctor(null); }}
      />
      {searching && <p className="cp-hint">Searching…</p>}
      {searchErr && <p className="psri-err-msg">{searchErr}</p>}
      {!searching && !activeDoctor && query.trim() && results.length === 0 && !searchErr && (
        <p className="cp-hint">No matches found.</p>
      )}
      {!activeDoctor && results.length > 0 && (
        <div className="psri-side-results">
          {results.map((r, i) => (
            <div key={i} className="psri-side-result-item" onClick={() => setActiveDoctor(r)}>
              <strong>{r.doctorName || '(unnamed)'}</strong>
              <span>{r.specialty}</span>
            </div>
          ))}
        </div>
      )}
      {activeDoctor && (
        <div className="psri-side-detail">
          <button type="button" className="psri-btn-ghost" onClick={() => setActiveDoctor(null)} style={{ marginBottom: 8 }}>← Back to results</button>
          <div className="psri-side-detail-name">{activeDoctor.doctorName}</div>
          <div className="psri-badge">{activeDoctor.specialty}</div>
          {Object.entries(activeDoctor)
            .filter(([k, v]) => !['doctorName', 'specialty'].includes(k) && v)
            .map(([k, v]) => (
              <div key={k} className="psri-side-detail-row"><span>{k}</span><strong>{String(v)}</strong></div>
            ))}
        </div>
      )}
    </div>
  );
}

function SpecialtySearchTab() {
  const [query, setQuery]     = useState('');
  const [result, setResult]   = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [lang, setLang]       = useState('en');
  const [activeDoctor, setActiveDoctor] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!query.trim()) { setResult(null); setSearchErr(''); return; }
    debounceRef.current = setTimeout(() => {
      setSearching(true);
      setSearchErr('');
      psri.searchSpecialty(query.trim())
        .then(res => setResult(res))
        .catch(() => setSearchErr('Could not search specialty. Please try again.'))
        .finally(() => setSearching(false));
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  return (
    <div>
      <input
        className="psri-search-input"
        style={{ maxWidth: 'none', width: '100%' }}
        type="text"
        placeholder="Search specialty…"
        value={query}
        onChange={e => { setQuery(e.target.value); setActiveDoctor(null); }}
      />
      {searching && <p className="cp-hint">Searching…</p>}
      {searchErr && <p className="psri-err-msg">{searchErr}</p>}
      {!searching && !result && query.trim() && !searchErr && (
        <p className="cp-hint">No matches found.</p>
      )}

      {result && !activeDoctor && (
        <div className="psri-specialty-group">
          <div className="psri-specialty-group-title">{result.specialty}</div>
          <div className="psri-lang-toggle">
            <button type="button" className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>English</button>
            <button type="button" className={lang === 'hi' ? 'active' : ''} onClick={() => setLang('hi')}>हिन्दी</button>
          </div>
          <p className="psri-specialty-info-text">{String(lang === 'en' ? (result.summaryEn || '') : (result.summaryHi || '')) || 'No AI summary available yet.'}</p>
          <div className="psri-side-results">
            {(result.doctors || []).length === 0 && <p className="cp-hint">No doctors currently listed for this specialty.</p>}
            {(result.doctors || []).map((r, i) => (
              <div key={i} className="psri-side-result-item" onClick={() => setActiveDoctor(r)}>
                <strong>{r.doctorName || '(unnamed)'}</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeDoctor && (
        <div className="psri-side-detail">
          <button type="button" className="psri-btn-ghost" onClick={() => setActiveDoctor(null)} style={{ marginBottom: 8 }}>← Back to results</button>
          <div className="psri-side-detail-name">{activeDoctor.doctorName}</div>
          <div className="psri-badge">{activeDoctor.specialty}</div>
          {Object.entries(activeDoctor)
            .filter(([k, v]) => !['doctorName', 'specialty'].includes(k) && v)
            .map(([k, v]) => (
              <div key={k} className="psri-side-detail-row"><span>{k}</span><strong>{String(v)}</strong></div>
            ))}
        </div>
      )}
    </div>
  );
}

export function DoctorSpecialtyPanel() {
  const [tab, setTab] = useState('doctor');
  return (
    <div className="psri-side-card">
      <div className="psri-side-card-title">Doctor &amp; Specialty Lookup</div>
      <div className="psri-lang-toggle" style={{ marginBottom: 10 }}>
        <button type="button" className={tab === 'doctor' ? 'active' : ''} onClick={() => setTab('doctor')}>By Doctor</button>
        <button type="button" className={tab === 'specialty' ? 'active' : ''} onClick={() => setTab('specialty')}>By Specialty</button>
      </div>
      {tab === 'doctor' ? <DoctorSearchTab /> : <SpecialtySearchTab />}
    </div>
  );
}

export default function DoctorLookupWidget() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className={`dr-lookup-toggle-btn${open ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Doctor & Specialty Lookup"
      >
        👨‍⚕️
      </button>

      {open && (
        <div className="dr-lookup-panel">
          <div className="dr-lookup-header">
            <span className="dr-lookup-header-title">👨‍⚕️ Doctor &amp; Specialty Lookup</span>
            <button className="dr-lookup-close-btn" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="dr-lookup-body">
            <DoctorLookupBody />
          </div>
        </div>
      )}
    </>
  );
}

function DoctorLookupBody() {
  const [tab, setTab] = useState('doctor');
  return (
    <>
      <div className="psri-lang-toggle" style={{ marginBottom: 12 }}>
        <button type="button" className={tab === 'doctor' ? 'active' : ''} onClick={() => setTab('doctor')}>By Doctor</button>
        <button type="button" className={tab === 'specialty' ? 'active' : ''} onClick={() => setTab('specialty')}>By Specialty</button>
      </div>
      {tab === 'doctor' ? <DoctorSearchTab /> : <SpecialtySearchTab />}
    </>
  );
}
