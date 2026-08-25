import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { usePicklists } from '../../context/PicklistsContext';
import { useDependencies } from '../../context/DependenciesContext';
import { useUsers } from '../../context/UsersContext';
import { useAuth } from '../../context/AuthContext';
import { useGuidance } from '../../context/GuidanceContext';
import { useSpecialtySummaries } from '../../context/SpecialtySummariesContext';
import { useSparkTG } from '../../context/SparkTGContext';
import { psri } from '../../api/psri';
import ContactPicker from './ContactPicker';
import { DoctorSpecialtyPanel } from './DoctorLookupWidget';
import './Psri.css';

// Value-to-value dependency lookup (e.g. Specialty=Cardiology → Doctor options), with a
// fallback to the flat base picklist if no dependency pairs exist yet for that value.
function getDependentOptions(getDependentValues, getList, subField, mainField, mainValue) {
  const specific = getDependentValues(subField, mainField, mainValue);
  if (specific.length > 0) return specific;
  return getList(subField);
}

// Rule-based "next best action" hint — looks up a Tip + suggested script for the
// current Call For + field combo from the Guidance sheet. Renders nothing if no rule matches.
function GuidanceTip({ callFor, field }) {
  const { getTip } = useGuidance();
  const [open, setOpen] = useState(false);
  const tip = getTip(callFor, field);
  if (!tip) return null;
  return (
    <span className="psri-tip-wrap">
      <button type="button" className="psri-tip-icon" onClick={() => setOpen(o => !o)} onBlur={() => setOpen(false)} title="Agent guidance">ⓘ</button>
      {open && (
        <div className="psri-tip-popover">
          <p className="psri-tip-text">{String(tip.tip || '')}</p>
          {tip.script && <p className="psri-tip-script">"{String(tip.script)}"</p>}
        </div>
      )}
    </span>
  );
}

// Cached AI-generated specialty description (English/Hindi toggle) — sourced from the
// SpecialtySummaries sheet, generated once via the batch workflow, never a live OpenAI call per case.
function SpecialtyInfo({ specialty }) {
  const { getSummary } = useSpecialtySummaries();
  const [lang, setLang] = useState('en');
  const [open, setOpen] = useState(false);
  if (!specialty) return null;
  const summary = getSummary(specialty);
  return (
    <div className="psri-specialty-info">
      <button type="button" className="psri-btn-ghost" onClick={() => setOpen(o => !o)}>
        {open ? 'Hide' : 'About'} {specialty}
      </button>
      {open && (
        <div className="psri-specialty-info-panel">
          <div className="psri-lang-toggle">
            <button type="button" className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>English</button>
            <button type="button" className={lang === 'hi' ? 'active' : ''} onClick={() => setLang('hi')}>हिन्दी</button>
          </div>
          <p className="psri-specialty-info-text">
            {summary ? String((lang === 'en' ? summary.en : summary.hi) || '') || 'No summary in this language yet.' : 'No AI summary cached for this specialty yet.'}
          </p>
        </div>
      )}
    </div>
  );
}

// Searchable combobox — filters options as the agent types, replaces plain <select> where
// the list is long and speed matters (e.g. Type of Enquiry during a live call).
function SearchableSelect({ value, onChange, options, placeholder = '— Select —' }) {
  const [search, setSearch] = useState('');
  const [open, setOpen]     = useState(false);
  const wrapRef             = useRef(null);
  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    function handleOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  return (
    <div className="psri-searchable-select" ref={wrapRef}>
      <input
        type="text"
        className="psri-searchable-input"
        placeholder={open ? 'Type to filter…' : (value || placeholder)}
        value={open ? search : ''}
        onFocus={() => { setOpen(true); setSearch(''); }}
        onChange={e => { setSearch(e.target.value); setOpen(true); }}
      />
      {open && (
        <div className="psri-searchable-dropdown">
          {value && (
            <div className="psri-searchable-item psri-searchable-clear"
              onMouseDown={() => { onChange(''); setOpen(false); setSearch(''); }}>
              — Clear selection —
            </div>
          )}
          {filtered.length === 0 && <div className="psri-searchable-empty">No matches</div>}
          {filtered.map(o => (
            <div key={o}
              className={`psri-searchable-item${o === value ? ' selected' : ''}`}
              onMouseDown={() => { onChange(o); setOpen(false); setSearch(''); }}>
              {o}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ContactHistoryPanel({ contact, excludeCaseId }) {
  const [cases, setCases]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(new Set());

  useEffect(() => {
    if (!contact?.mobile) { setCases([]); setExpanded(new Set()); return; }
    setLoading(true);
    psri.getCases(contact.mobile)
      .then(res => setCases((res.cases || []).filter(c => c.id !== excludeCaseId)))
      .catch(() => setCases([]))
      .finally(() => setLoading(false));
  }, [contact?.mobile, excludeCaseId]);

  function toggleExpand(id) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (!contact) {
    return (
      <div className="psri-side-card">
        <div className="psri-side-card-title">Contact History</div>
        <p className="cp-hint">Select a contact to see their past cases.</p>
      </div>
    );
  }

  return (
    <div className="psri-side-card">
      <div className="psri-side-card-title">Contact History — {contact.name}</div>
      {loading && <p className="cp-hint">Loading…</p>}
      {!loading && cases.length === 0 && <p className="cp-hint">No case history for this contact.</p>}
      {!loading && cases.length > 0 && (
        <div className="psri-side-results">
          {cases.map(c => {
            const isOpen = expanded.has(c.id);
            return (
              <div key={c.id} className="psri-side-history-item">
                <div className="psri-side-history-top">
                  <span className="psri-badge">{c.callFor || c.typeOfCall || '—'}</span>
                  <span className="psri-side-history-date">{c.created ? new Date(c.created).toLocaleDateString() : ''}</span>
                  <button type="button" className="psri-expand-btn" onClick={() => toggleExpand(c.id)}>
                    {isOpen ? '▲' : '▼'}
                  </button>
                </div>
                <p className="psri-side-history-summary">{String(c.summary || '') || '(no summary)'}</p>
                {isOpen && (
                  <div className="psri-history-detail">
                    {c.channel        && <div className="psri-hd-row"><span>Channel</span><strong>{c.channel}</strong></div>}
                    {c.typeOfCall     && <div className="psri-hd-row"><span>Type of Call</span><strong>{c.typeOfCall}</strong></div>}
                    {c.typeOfEnquiry  && <div className="psri-hd-row"><span>Enquiry</span><strong>{c.typeOfEnquiry}</strong></div>}
                    {c.typeOfComplaint && <div className="psri-hd-row"><span>Complaint</span><strong>{c.typeOfComplaint}</strong></div>}
                    {c.typeOfEmergency && <div className="psri-hd-row"><span>Emergency</span><strong>{c.typeOfEmergency}</strong></div>}
                    {c.specialty      && <div className="psri-hd-row"><span>Specialty</span><strong>{c.specialty}</strong></div>}
                    {c.doctorName     && <div className="psri-hd-row"><span>Doctor</span><strong>{c.doctorName}</strong></div>}
                    {c.appointmentDate && <div className="psri-hd-row"><span>Appointment</span><strong>{c.appointmentDate}{c.appointmentTime ? ` at ${c.appointmentTime}` : ''}</strong></div>}
                    {c.appointmentStatus && <div className="psri-hd-row"><span>Appt Status</span><strong>{c.appointmentStatus}</strong></div>}
                    {c.isCallback     && <div className="psri-hd-row"><span>Callback</span><strong>{c.callbackDatetime || 'Arranged'}</strong></div>}
                    {c.isTransfer     && <div className="psri-hd-row"><span>Transferred To</span><strong>{c.transferredTo || 'Yes'}</strong></div>}
                    {c.isHighValue    && <div className="psri-hd-row"><span>High Value</span><strong>Yes</strong></div>}
                    {c.remarks        && <div className="psri-hd-remarks"><span>Remarks</span><p>{c.remarks}</p></div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GuidancePanel({ callFor, typeOfEnquiry }) {
  const { getTip } = useGuidance();
  const tip = getTip(callFor, typeOfEnquiry);
  if (!typeOfEnquiry || !tip) return null;
  return (
    <div className="psri-guidance-panel">
      <div className="psri-guidance-panel-title">Agent Guidance</div>
      {tip.tip && <p className="psri-guidance-tip">{tip.tip}</p>}
      {tip.script && (
        <div className="psri-guidance-script">
          <span className="psri-guidance-script-label">Say to patient</span>
          <p>"{tip.script}"</p>
        </div>
      )}
    </div>
  );
}

// Sidebar guidance bubble — auto-shows and expands when Call For / sub-type changes.
// Picks the most specific tip available, falls back to the Call For–level tip.
function LiveGuidancePanel({ callFor, typeOfEnquiry, typeOfComplaint, typeOfEmergency }) {
  const { getTip } = useGuidance();
  const [minimized, setMinimized] = useState(false);

  const tip =
    getTip(callFor, typeOfEnquiry)  ||
    getTip(callFor, typeOfComplaint)||
    getTip(callFor, typeOfEmergency)||
    getTip(callFor, 'Call For');

  useEffect(() => {
    if (tip) setMinimized(false);
  }, [callFor, typeOfEnquiry, typeOfComplaint, typeOfEmergency]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!callFor || !tip) return null;

  return (
    <div className={`psri-live-guidance${minimized ? ' minimized' : ''}`}>
      <div className="psri-live-guidance-header">
        <span className="psri-live-guidance-title">💡 Agent Guidance</span>
        <button
          type="button"
          className="psri-live-guidance-toggle"
          onClick={() => setMinimized(m => !m)}
          title={minimized ? 'Expand' : 'Minimise'}
        >
          {minimized ? '▼' : '▲'}
        </button>
      </div>
      {!minimized && (
        <div className="psri-live-guidance-body">
          {tip.tip && <p className="psri-live-guidance-tip">{tip.tip}</p>}
          {tip.script && (
            <div className="psri-live-guidance-script">
              <span>Say to patient:</span>
              <p>"{tip.script}"</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AiAdvisorPanel({ form, onCheck, checking, result, err }) {
  const ready = !!(form.callFor && form.summary?.trim());
  return (
    <div className="psri-side-card">
      <div className="psri-ai-title">✦ AI Advisor</div>
      {!ready && <p className="cp-hint">Fill <strong>Call For</strong> and <strong>Summary</strong> to enable.</p>}
      {ready && !result && (
        <button type="button" className="psri-ai-check-btn" onClick={onCheck} disabled={checking}>
          {checking ? 'Analysing…' : 'Check this Case'}
        </button>
      )}
      {err && !result && (
        <div>
          <p className="psri-err-msg" style={{ marginBottom: 8 }}>{err}</p>
          <button type="button" className="psri-btn-ghost" style={{ fontSize: 12 }} onClick={onCheck}>Retry</button>
        </div>
      )}
      {result && (
        <div className="psri-ai-result">
          {(!result.flags?.length && !result.isHighValue && !result.suggestNextCall) && (
            <div className="psri-ai-ok">✓ Case looks complete</div>
          )}
          {result.flags?.length > 0 && (
            <div className="psri-ai-section">
              <div className="psri-ai-label psri-ai-label--warn">Flags</div>
              {result.flags.map((f, i) => <div key={i} className="psri-ai-flag">{f}</div>)}
            </div>
          )}
          {result.isHighValue && (
            <div className="psri-ai-section">
              <div className="psri-ai-label psri-ai-label--hv">★ High Value Query</div>
              <p className="psri-ai-text">{result.highValueReason}</p>
            </div>
          )}
          {result.suggestNextCall && (
            <div className="psri-ai-section">
              <div className="psri-ai-label psri-ai-label--next">Suggested Follow-up</div>
              <p className="psri-ai-text">{result.nextCallSuggestion}</p>
            </div>
          )}
          <button type="button" className="psri-btn-ghost" onClick={onCheck} disabled={checking}
            style={{ marginTop: 10, fontSize: 12, padding: '6px 12px', width: '100%' }}>
            {checking ? 'Re-checking…' : 'Re-check'}
          </button>
        </div>
      )}
    </div>
  );
}

const emptyForm = {
  id: '', contact: null,
  channel: '', calledNumber: '', callTxnId: '',
  typeOfCall: '', callFor: '', typeOfEnquiry: '',
  priority: '', queryType: '', status: 'Resolved', summary: '', assignedTo: '',
  specialty: '', doctorName: '', specificDoctorRequested: false,
  appointmentDate: '', appointmentTime: '', appointmentStatus: '',
  typeOfComplaint: '',
  typeOfEmergency: '',
  isCallback: false, callbackDatetime: '', callbackCompleted: false,
  isTransfer: false, transferredTo: '',
  isHighValue: false, typeOfProcedure: '', nameOfProcedure: '', modeOfPayment: '', specialtyEnquiredFor: '',
  isAppreciation: false, appreciationDetails: '',
};

function fromApiCase(c) {
  return {
    id: c.id,
    contact: { id: c.contactId, name: c.contactName, mobile: c.contactMobile, mobileIsd: '+91' },
    channel: c.channel, calledNumber: c.calledNumber, callTxnId: c.callTxnId,
    typeOfCall: c.typeOfCall, callFor: c.callFor, typeOfEnquiry: c.typeOfEnquiry,
    priority: c.priority, queryType: c.queryType || '', status: c.status, summary: c.summary, assignedTo: c.assignedTo,
    specialty: c.specialty, doctorName: c.doctorName,
    specificDoctorRequested: c.specificDoctorRequested,
    appointmentDate: c.appointmentDate, appointmentTime: c.appointmentTime, appointmentStatus: c.appointmentStatus,
    typeOfComplaint: c.typeOfComplaint || '',
    typeOfEmergency: c.typeOfEmergency || '',
    isCallback: c.isCallback, callbackDatetime: c.callbackDatetime, callbackCompleted: c.callbackCompleted,
    isTransfer: c.isTransfer, transferredTo: c.transferredTo,
    isHighValue: c.isHighValue, typeOfProcedure: c.typeOfProcedure, nameOfProcedure: c.nameOfProcedure,
    modeOfPayment: c.modeOfPayment, specialtyEnquiredFor: c.specialtyEnquiredFor,
    isAppreciation: c.isAppreciation, appreciationDetails: c.appreciationDetails || '',
  };
}

export default function CasesPage() {
  const { getList } = usePicklists();
  const { getDependentValues } = useDependencies();
  const { users } = useUsers();
  const { dial, hasWidget, dialerPrefill, setDialerPrefill } = useSparkTG();
  const [cases, setCases]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [loadErr, setLoadErr]   = useState('');
  const [query, setQuery]       = useState('');
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState(emptyForm);
  const [errors, setErrors]     = useState({});
  const [saving, setSaving]     = useState(false);
  const [saveErr, setSaveErr]   = useState('');
  const [toast, setToast]       = useState('');
  const [calledSameAsContact, setCalledSameAsContact] = useState(false);
  const [dialerPrefillMobile,   setDialerPrefillMobile]   = useState('');
  const [autoOpenQuickAdd,      setAutoOpenQuickAdd]      = useState(false);
  const { currentUser } = useAuth();
  const currentAgentId = currentUser?.id || '';
  const [aiPolishing, setAiPolishing]     = useState(false);
  const [aiChecking, setAiChecking]       = useState(false);
  const [aiCheckResult, setAiCheckResult] = useState(null);
  const [aiCheckErr, setAiCheckErr]       = useState('');
  const [saved, setSaved]                 = useState(false);
  const [savingDraft, setSavingDraft]     = useState(false);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  // Always holds the latest form, even inside effects that only re-run on
  // other dependencies (e.g. the dialerPrefill interrupt handler below) —
  // a plain closure over `form` there would see a stale snapshot.
  const formRef = useRef(form);
  useEffect(() => { formRef.current = form; }, [form]);

  // Builds the same payload shape handleSave() sends, but tagged as an
  // incomplete/draft record and without the full-case validation — used
  // both by the explicit "Save as Incomplete" button and by the automatic
  // save-before-overwrite when a new call interrupts an in-progress case.
  const buildDraftPayload = (f) => ({
    id: f.id,
    contactId: f.contact.id, contactName: f.contact.name, contactMobile: f.contact.mobile,
    channel: f.channel, calledNumber: f.calledNumber, callTxnId: f.callTxnId,
    typeOfCall: f.typeOfCall, callFor: f.callFor, typeOfEnquiry: f.typeOfEnquiry,
    priority: f.priority, queryType: f.queryType, status: 'Incomplete', summary: f.summary, assignedTo: f.assignedTo,
    isAppointment: f.callFor === 'Appointment',
    specialty: f.specialty, doctorName: f.doctorName,
    specificDoctorRequested: f.specificDoctorRequested,
    appointmentDate: f.appointmentDate, appointmentTime: f.appointmentTime, appointmentStatus: f.appointmentStatus,
    typeOfComplaint: f.typeOfComplaint,
    typeOfEmergency: f.typeOfEmergency,
    isCallback: f.isCallback, callbackDatetime: f.callbackDatetime, callbackCompleted: f.callbackCompleted,
    isTransfer: f.isTransfer, transferredTo: f.transferredTo,
    isHighValue: f.isHighValue, typeOfProcedure: f.typeOfProcedure, nameOfProcedure: f.nameOfProcedure,
    modeOfPayment: f.modeOfPayment, specialtyEnquiredFor: f.specialtyEnquiredFor,
    isAppreciation: f.isAppreciation, appreciationDetails: f.appreciationDetails,
  });

  // Persists an in-progress form as an Incomplete case — never throws, since
  // callers use this both as a background auto-save and as an explicit action
  // that must not block the agent from moving on to the next call.
  const saveAsIncomplete = async (f) => {
    if (!f?.contact) return null;
    try {
      const payload = buildDraftPayload(f);
      const res = payload.id ? await psri.updateCase(payload) : await psri.addCase(payload);
      return res?.id || payload.id || null;
    } catch (err) {
      console.warn('[cases] save as incomplete failed:', err.message);
      return null;
    }
  };

  const refresh = useCallback(() => {
    setLoading(true);
    setLoadErr('');
    return psri.getCases()
      .then(res => setCases(res.cases || []))
      .catch(() => setLoadErr('Could not load cases. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!dialerPrefill) return;
    setDialerPrefill(null);

    // A new call (or a Resume click) is about to replace whatever's on
    // screen. If that's a brand-new, never-saved case the agent had started
    // filling in, don't let it just vanish — stash it as Incomplete first.
    // Skipped for cases opened via Edit (form.id set — never downgrade a
    // real case's status) and right after a successful create (saved===true,
    // form.id not yet populated locally — would otherwise duplicate it).
    const prev = formRef.current;
    if (showForm && prev?.contact && !prev.id && !saved && (prev.summary?.trim() || prev.callFor)) {
      saveAsIncomplete(prev);
      showToast('Previous case saved to Incomplete Cases');
    }

    setSaved(false);
    setAiCheckResult(null);
    setAiCheckErr('');

    if (dialerPrefill.resumeCase) {
      setForm(fromApiCase(dialerPrefill.resumeCase));
      setDialerPrefillMobile('');
      setAutoOpenQuickAdd(false);
    } else if (dialerPrefill.repeatFrom) {
      const rep = fromApiCase(dialerPrefill.repeatFrom);
      setForm({
        ...rep,
        id: '',
        summary: '',
        status: '',
        channel:    dialerPrefill.channel    || rep.channel,
        typeOfCall: dialerPrefill.typeOfCall || rep.typeOfCall,
        callTxnId:  dialerPrefill.callTxnId  || '',
        contact:    dialerPrefill.contact    || rep.contact,
      });
      setDialerPrefillMobile('');
      setAutoOpenQuickAdd(false);
    } else {
      setForm({
        ...emptyForm,
        contact:      dialerPrefill.contact      || null,
        channel:      dialerPrefill.channel      || '',
        typeOfCall:   dialerPrefill.typeOfCall   || '',
        callTxnId:    dialerPrefill.callTxnId    || '',
        calledNumber: dialerPrefill.calledNumber || '',
        status:       'Resolved',
        assignedTo:   currentAgentId,
      });
      setDialerPrefillMobile(dialerPrefill.prefillMobile || '');
      setAutoOpenQuickAdd(dialerPrefill.autoOpenQuickAdd || false);
    }
    setErrors({});
    setSaveErr('');
    setCalledSameAsContact(false);
    setShowForm(true);
  }, [dialerPrefill, setDialerPrefill]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cases;
    return cases.filter(c =>
      (c.contactName || '').toLowerCase().includes(q) ||
      (c.contactMobile || '').includes(q) ||
      (c.summary || '').toLowerCase().includes(q) ||
      (c.id || '').toLowerCase().includes(q)
    );
  }, [cases, query]);

  const openNew  = () => { setForm({ ...emptyForm, status: 'Resolved', assignedTo: currentAgentId }); setErrors({}); setSaveErr(''); setCalledSameAsContact(false); setShowForm(true); };
  const openEdit = (c) => {
    const mapped = fromApiCase(c);
    setForm(mapped);
    setErrors({}); setSaveErr('');
    setCalledSameAsContact(!!mapped.calledNumber && mapped.calledNumber === mapped.contact?.mobile);
    setShowForm(true);
  };

  const validate = () => {
    const e = {};
    if (!form.contact) e.contact = 'Select or create a contact first';
    if (form.channel === 'Call' && !form.typeOfCall) e.typeOfCall = 'Select Type of Call';
    if (!form.callFor) e.callFor = 'Select Call For';
    if (!form.summary.trim()) e.summary = 'Summary is required';
    return e;
  };

  const polishSummary = async () => {
    if (!form.summary.trim() || aiPolishing) return;
    setAiPolishing(true);
    try {
      const res = await psri.polishSummary({
        summary: form.summary,
        callFor: form.callFor,
        channel: form.channel,
        typeOfEnquiry: form.typeOfEnquiry,
        specialty: form.specialty,
      });
      if (res.polished) setForm(f => ({ ...f, summary: res.polished }));
    } catch {
      // silent — summary stays unchanged
    } finally {
      setAiPolishing(false);
    }
  };

  const checkCase = async () => {
    setAiChecking(true);
    setAiCheckErr('');
    try {
      const res = await psri.validateCase({
        channel: form.channel,
        typeOfCall: form.typeOfCall,
        callFor: form.callFor,
        typeOfEnquiry: form.typeOfEnquiry,
        specialty: form.specialty,
        doctorName: form.doctorName,
        priority: form.priority,
        status: form.status,
        summary: form.summary,
        isHighValue: form.isHighValue,
        isCallback: form.isCallback,
        callbackDatetime: form.callbackDatetime,
        appointmentDate: form.appointmentDate,
        appointmentStatus: form.appointmentStatus,
      });
      setAiCheckResult(res);
    } catch {
      setAiCheckErr('AI check failed. Please try again.');
    } finally {
      setAiChecking(false);
    }
  };

  const handleSave = async (ev) => {
    ev.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    setSaveErr('');
    const payload = {
      id: form.id,
      contactId: form.contact.id, contactName: form.contact.name, contactMobile: form.contact.mobile,
      channel: form.channel, calledNumber: form.calledNumber, callTxnId: form.callTxnId,
      typeOfCall: form.typeOfCall, callFor: form.callFor, typeOfEnquiry: form.typeOfEnquiry,
      priority: form.priority, queryType: form.queryType, status: 'Resolved', summary: form.summary, assignedTo: form.assignedTo,
      isAppointment: form.callFor === 'Appointment',
      specialty: form.specialty, doctorName: form.doctorName,
      specificDoctorRequested: form.specificDoctorRequested,
      appointmentDate: form.appointmentDate, appointmentTime: form.appointmentTime, appointmentStatus: form.appointmentStatus,
      typeOfComplaint: form.typeOfComplaint,
      typeOfEmergency: form.typeOfEmergency,
      isCallback: form.isCallback, callbackDatetime: form.callbackDatetime, callbackCompleted: form.callbackCompleted,
      isTransfer: form.isTransfer, transferredTo: form.transferredTo,
      isHighValue: form.isHighValue, typeOfProcedure: form.typeOfProcedure, nameOfProcedure: form.nameOfProcedure,
      modeOfPayment: form.modeOfPayment, specialtyEnquiredFor: form.specialtyEnquiredFor,
      isAppreciation: form.isAppreciation, appreciationDetails: form.appreciationDetails,
    };
    try {
      if (form.id) {
        await psri.updateCase(payload);
        showToast('Case updated');
      } else {
        await psri.addCase(payload);
        showToast('Case created');
      }
      await refresh();
      setSaved(true);
      checkCase();
    } catch (err) {
      setSaveErr(err.message || 'Could not save case. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Deliberate half-way save — lets the agent step away (e.g. to take a new
  // call) without losing what's typed so far or forcing the required fields.
  const handleSaveDraft = async () => {
    if (!form.contact || savingDraft || saving) return;
    setSavingDraft(true);
    setSaveErr('');
    const newId = await saveAsIncomplete(form);
    setSavingDraft(false);
    if (newId === null) {
      setSaveErr('Could not save as Incomplete. Please try again.');
      return;
    }
    showToast('Saved — resume anytime from Incomplete Cases');
    setShowForm(false);
  };

  if (showForm) {
    return (
      <div className="psri-page">
        {toast && <div className="psri-toast">{toast}</div>}
        <div className="psri-form-top">
          <button className="psri-btn-ghost" onClick={() => !saving && setShowForm(false)} disabled={saving}>← Back</button>
          <h1 className="psri-title" style={{ marginLeft: 12 }}>{form.id ? 'Edit Case' : 'New Case'}</h1>
        </div>

        {saveErr && <div className="psri-err-banner" style={{ marginBottom: 16, maxWidth: 920 }}>{saveErr}</div>}

        <div className="psri-case-layout">
        <form onSubmit={handleSave} className="psri-form psri-form-fullpage psri-case-main">
          <div className="psri-form-section-label">Contact</div>
          <ContactPicker
            selected={form.contact}
            initialQuery={dialerPrefillMobile}
            autoOpenQuickAdd={autoOpenQuickAdd}
            onSelect={c => {
              setForm(f => ({
                ...f,
                contact: c,
                calledNumber: calledSameAsContact ? (c?.mobile || '') : f.calledNumber,
              }));
              if (c) setDialerPrefillMobile('');
            }}
          />
          {errors.contact && <p className="psri-err-msg">{errors.contact}</p>}

          {!form.contact && (
            <div className="psri-form-gate-msg">
              Select or add a contact above to unlock the rest of this form.
            </div>
          )}
          <div className={!form.contact ? 'psri-form-gated locked' : 'psri-form-gated'}>
          <div className="psri-form-section-label">Call Details</div>
          <div className="psri-form-row">
            <div className="psri-field">
              <label>Channel</label>
              <select value={form.channel} onChange={e => {
                const ch = e.target.value;
                setForm(f => ({
                  ...f, channel: ch,
                  ...(ch !== 'Call' ? { calledNumber: '', callTxnId: '', typeOfCall: '', callFor: '', typeOfEnquiry: '', appointmentStatus: '' } : {}),
                }));
                if (ch !== 'Call') setCalledSameAsContact(false);
              }}>
                <option value="">— Select —</option>
                {getList('Channel').map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            {form.channel === 'Call' && (
              <>
                <div className="psri-field">
                  <label>Called Number</label>
                  <input
                    type="text"
                    value={form.calledNumber}
                    onChange={e => setForm(f => ({ ...f, calledNumber: e.target.value }))}
                    disabled={calledSameAsContact}
                  />
                  <label className="psri-checkbox-inline">
                    <input
                      type="checkbox"
                      checked={calledSameAsContact}
                      disabled={!form.contact}
                      onChange={e => {
                        const checked = e.target.checked;
                        setCalledSameAsContact(checked);
                        if (checked) setForm(f => ({ ...f, calledNumber: f.contact?.mobile || '' }));
                      }}
                    />
                    Same as contact's mobile
                  </label>
                </div>
                <div className="psri-field">
                  <label>Call Transaction ID</label>
                  <input type="text" value={form.callTxnId} onChange={e => setForm(f => ({ ...f, callTxnId: e.target.value }))} placeholder="e.g. 5e15d0d8-f557-491f-adbb-cc63a5cfae0f" />
                </div>
              </>
            )}
          </div>
          {form.channel === 'Call' && (
            <div className="psri-form-row">
              <div className="psri-field">
                <label>Type of Call <span className="req">*</span> <span className="psri-hint-inline">(narrows Call For)</span></label>
                <select
                  value={form.typeOfCall}
                  onChange={e => setForm(f => ({ ...f, typeOfCall: e.target.value, callFor: '', typeOfEnquiry: '', appointmentStatus: '' }))}
                  className={errors.typeOfCall ? 'err' : ''}
                >
                  <option value="">— Select —</option>
                  {getList('Type of Call').map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                {errors.typeOfCall && <p className="psri-err-msg">{errors.typeOfCall}</p>}
              </div>
              <div className="psri-field">
                <label>Call For <span className="req">*</span> <GuidanceTip callFor={form.callFor} field="Call For" /></label>
                <select
                  value={form.callFor}
                  disabled={!form.typeOfCall}
                  onChange={e => setForm(f => ({ ...f, callFor: e.target.value, typeOfEnquiry: '', appointmentStatus: '' }))}
                  className={errors.callFor ? 'err' : ''}
                >
                  <option value="">{form.typeOfCall ? '— Select —' : '— Select Type of Call first —'}</option>
                  {form.typeOfCall ? getDependentOptions(getDependentValues, getList, 'Call For', 'Type of Call', form.typeOfCall).map(v => <option key={v} value={v}>{v}</option>) : null}
                </select>
                {errors.callFor && <p className="psri-err-msg">{errors.callFor}</p>}
              </div>
            </div>
          )}
          {form.channel !== 'Call' && (
            <div className="psri-form-row">
              <div className="psri-field" style={{ maxWidth: 360 }}>
                <label>Call For <span className="req">*</span> <span className="psri-hint-inline">(narrows by Channel)</span> <GuidanceTip callFor={form.callFor} field="Call For" /></label>
                <select
                  value={form.callFor}
                  disabled={!form.channel}
                  onChange={e => setForm(f => ({ ...f, callFor: e.target.value, typeOfEnquiry: '', appointmentStatus: '' }))}
                  className={errors.callFor ? 'err' : ''}
                >
                  <option value="">{form.channel ? '— Select —' : '— Select Channel first —'}</option>
                  {form.channel ? getDependentOptions(getDependentValues, getList, 'Call For', 'Channel', form.channel).map(v => <option key={v} value={v}>{v}</option>) : null}
                </select>
                {errors.callFor && <p className="psri-err-msg">{errors.callFor}</p>}
              </div>
            </div>
          )}
          {/* ── Dynamic section based on Call For ── */}

          {form.callFor === 'Appointment' && (
            <div className="psri-callfor-section">
              <div className="psri-form-section-label">Appointment</div>
              <div className="psri-form-row">
                <div className="psri-field">
                  <label>Appointment Status</label>
                  <select value={form.appointmentStatus} onChange={e => setForm(f => ({ ...f, appointmentStatus: e.target.value }))}>
                    <option value="">— Select —</option>
                    {getDependentOptions(getDependentValues, getList, 'Appointment Status', 'Call For', form.callFor).map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div className="psri-field">
                  <label>Specialty <span className="psri-hint-inline">(narrows Doctor)</span> <GuidanceTip callFor={form.callFor} field="Specialty" /></label>
                  <select value={form.specialty} onChange={e => setForm(f => ({ ...f, specialty: e.target.value, doctorName: '' }))}>
                    <option value="">— Select —</option>
                    {getList('Specialty').map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                  <SpecialtyInfo specialty={form.specialty} />
                </div>
                <div className="psri-field">
                  <label>Doctor</label>
                  <select value={form.doctorName} disabled={!form.specialty} onChange={e => setForm(f => ({ ...f, doctorName: e.target.value }))}>
                    <option value="">{form.specialty ? '— Select —' : '— Select Specialty first —'}</option>
                    {form.specialty ? getDependentOptions(getDependentValues, getList, 'Doctor', 'Specialty', form.specialty).map(v => <option key={v} value={v}>{v}</option>) : null}
                  </select>
                </div>
              </div>
              <div className="psri-form-row">
                <div className="psri-field">
                  <label>Appointment Date <GuidanceTip callFor={form.callFor} field="Appointment Date" /></label>
                  <input type="date" value={form.appointmentDate} onChange={e => setForm(f => ({ ...f, appointmentDate: e.target.value }))} />
                </div>
                <div className="psri-field">
                  <label>Appointment Time</label>
                  <input type="time" value={form.appointmentTime} onChange={e => setForm(f => ({ ...f, appointmentTime: e.target.value }))} />
                </div>
                <div className="psri-field" style={{ flex: '0 0 180px' }}>
                  <label className="psri-checkbox-inline" style={{ marginTop: 28 }}>
                    <input type="checkbox" checked={form.specificDoctorRequested} onChange={e => setForm(f => ({ ...f, specificDoctorRequested: e.target.checked }))} />
                    Specific Doctor Requested
                  </label>
                </div>
              </div>
            </div>
          )}

          {form.callFor === 'Enquiry or Transfer' && (
            <div className="psri-callfor-section">
              <div className="psri-form-section-label">Enquiry</div>
              <div className="psri-field" style={{ maxWidth: 420 }}>
                <label>Type of Enquiry</label>
                <SearchableSelect
                  value={form.typeOfEnquiry}
                  onChange={v => setForm(f => ({ ...f, typeOfEnquiry: v }))}
                  options={getDependentOptions(getDependentValues, getList, 'Type of Enquiry', 'Call For', form.callFor)}
                />
              </div>
              <GuidancePanel callFor={form.callFor} typeOfEnquiry={form.typeOfEnquiry} />
            </div>
          )}

          {form.callFor === 'Complaint/Feedback' && (
            <div className="psri-callfor-section">
              <div className="psri-form-section-label">Complaint / Feedback</div>
              <div className="psri-field" style={{ maxWidth: 360 }}>
                <label>Type of Complaint</label>
                <select value={form.typeOfComplaint} onChange={e => setForm(f => ({ ...f, typeOfComplaint: e.target.value }))}>
                  <option value="">— Select —</option>
                  {getList('Type of Complaint').map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </div>
          )}

          {form.callFor === 'Emergency' && (
            <div className="psri-callfor-section">
              <div className="psri-form-section-label">Emergency</div>
              <div className="psri-field" style={{ maxWidth: 360 }}>
                <label>Type of Emergency</label>
                <select value={form.typeOfEmergency} onChange={e => setForm(f => ({ ...f, typeOfEmergency: e.target.value }))}>
                  <option value="">— Select —</option>
                  {getList('Type of Emergency').map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* ── Universal toggles (all Call For types) ── */}
          <label className="psri-section-toggle">
            <input type="checkbox" checked={form.isCallback} onChange={e => setForm(f => ({ ...f, isCallback: e.target.checked }))} />
            Call Back Arranged
          </label>
          {form.isCallback && (
            <div className="psri-subsection">
              <div className="psri-form-row">
                <div className="psri-field">
                  <label>Call Back Date &amp; Time</label>
                  <input type="datetime-local" value={form.callbackDatetime} onChange={e => setForm(f => ({ ...f, callbackDatetime: e.target.value }))} />
                </div>
                <div className="psri-field" style={{ flex: '0 0 200px' }}>
                  <label className="psri-checkbox-inline" style={{ marginTop: 28 }}>
                    <input type="checkbox" checked={form.callbackCompleted} onChange={e => setForm(f => ({ ...f, callbackCompleted: e.target.checked }))} />
                    Call Back Completed
                  </label>
                </div>
              </div>
            </div>
          )}

          <label className="psri-section-toggle">
            <input type="checkbox" checked={form.isTransfer} onChange={e => setForm(f => ({ ...f, isTransfer: e.target.checked }))} />
            Transfer Required
          </label>
          {form.isTransfer && (
            <div className="psri-subsection">
              <div className="psri-field">
                <label>Transferred To</label>
                <SearchableSelect
                  value={form.transferredTo}
                  onChange={v => setForm(f => ({ ...f, transferredTo: v }))}
                  options={getList('Transferred To')}
                />
              </div>
            </div>
          )}

          <label className="psri-section-toggle">
            <input type="checkbox" checked={form.isHighValue} onChange={e => setForm(f => ({ ...f, isHighValue: e.target.checked }))} />
            High Value Case
          </label>
          {form.isHighValue && (
            <div className="psri-subsection">
              <div className="psri-form-row">
                <div className="psri-field">
                  <label>Type of Procedure</label>
                  <select value={form.typeOfProcedure} onChange={e => setForm(f => ({ ...f, typeOfProcedure: e.target.value }))}>
                    <option value="">— Select —</option>
                    {getList('Type of Procedure').map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div className="psri-field">
                  <label>Name of Procedure</label>
                  <SearchableSelect
                    value={form.nameOfProcedure}
                    onChange={v => setForm(f => ({ ...f, nameOfProcedure: v }))}
                    options={getList('Name of Procedure')}
                  />
                </div>
              </div>
              <div className="psri-form-row">
                <div className="psri-field">
                  <label>Mode of Payment</label>
                  <select value={form.modeOfPayment} onChange={e => setForm(f => ({ ...f, modeOfPayment: e.target.value }))}>
                    <option value="">— Select —</option>
                    {getList('Mode of Payment').map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div className="psri-field">
                  <label>Specialty Enquired For</label>
                  <select value={form.specialtyEnquiredFor} onChange={e => setForm(f => ({ ...f, specialtyEnquiredFor: e.target.value }))}>
                    <option value="">— Select —</option>
                    {getList('Specialty').map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

          <label className="psri-section-toggle">
            <input type="checkbox" checked={form.isAppreciation} onChange={e => setForm(f => ({ ...f, isAppreciation: e.target.checked }))} />
            Appreciation Received
          </label>
          {form.isAppreciation && (
            <div className="psri-subsection">
              <div className="psri-field">
                <label>What was the Appreciation About?</label>
                <textarea rows={2} value={form.appreciationDetails} onChange={e => setForm(f => ({ ...f, appreciationDetails: e.target.value }))} placeholder="Describe the appreciation — doctor, staff, service, etc." />
              </div>
            </div>
          )}

          </div>{/* /psri-form-gated */}

          <div className="psri-field psri-summary-field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Summary <span className="req">*</span>
              <GuidanceTip callFor={form.callFor} field="Summary" />
              <button type="button" className="psri-ai-polish-btn" onClick={polishSummary} disabled={!form.summary.trim() || aiPolishing}>
                {aiPolishing ? 'Polishing…' : '✦ Polish'}
              </button>
            </label>
            <textarea rows={3} value={form.summary} onChange={e => setForm(f => ({ ...f, summary: e.target.value }))} className={errors.summary ? 'err' : ''} placeholder="Type your notes here — hit Polish to clean them up…" />
            {errors.summary && <p className="psri-err-msg">{errors.summary}</p>}
          </div>

          <div className="psri-bottom-meta">
            <div className="psri-field" style={{ maxWidth: 300 }}>
              <label>Assigned To</label>
              <select value={form.assignedTo} onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))}>
                <option value="">— Unassigned —</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
              </select>
            </div>
            <div className="psri-field" style={{ maxWidth: 220 }}>
              <label>Query Type</label>
              <select value={form.queryType} onChange={e => setForm(f => ({ ...f, queryType: e.target.value }))}>
                <option value="">— Select —</option>
                <option value="Basic">Basic</option>
                <option value="Detailed">Detailed</option>
              </select>
            </div>
          </div>

          <div className="psri-form-actions-sticky">
            {saved ? (
              <>
                <span className="psri-saved-badge">✓ Saved — review AI suggestions on the right, then edit if needed</span>
                <button type="submit" className="psri-btn-ghost" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
                <button type="button" className="psri-btn-primary" onClick={() => { setShowForm(false); setSelected(null); setSaved(false); setAiCheckResult(null); }}>Done</button>
              </>
            ) : (
              <>
                <button type="button" className="psri-btn-ghost" onClick={() => { setShowForm(false); setSaved(false); }} disabled={saving || savingDraft}>Cancel</button>
                {form.contact && (
                  <button type="button" className="psri-btn-ghost" onClick={handleSaveDraft} disabled={saving || savingDraft} title="Save what's filled so far and come back to it later">
                    {savingDraft ? 'Saving…' : '💾 Save as Incomplete'}
                  </button>
                )}
                <button type="submit" className="psri-btn-primary" disabled={saving || savingDraft}>{saving ? 'Saving…' : (form.id ? 'Save Changes' : 'Create Case')}</button>
              </>
            )}
          </div>
        </form>
        <aside className="psri-case-sidebar">
          <LiveGuidancePanel
            key={`${form.callFor}|${form.typeOfEnquiry}|${form.typeOfComplaint}|${form.typeOfEmergency}`}
            callFor={form.callFor}
            typeOfEnquiry={form.typeOfEnquiry}
            typeOfComplaint={form.typeOfComplaint}
            typeOfEmergency={form.typeOfEmergency}
          />
          {saved && (
            <AiAdvisorPanel
              form={form}
              onCheck={checkCase}
              checking={aiChecking}
              result={aiCheckResult}
              err={aiCheckErr}
            />
          )}
          <DoctorSpecialtyPanel />
          <ContactHistoryPanel contact={form.contact} excludeCaseId={form.id} />
        </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="psri-page">
      {toast && <div className="psri-toast">{toast}</div>}

      <div className="psri-top">
        <div>
          <h1 className="psri-title">Cases</h1>
          <p className="psri-subtitle">PSRI Hospital — Call Center Cases</p>
        </div>
        {currentUser && (
          <div className="psri-agent-bar">
            <span className="psri-agent-label">Agent</span>
            <span className="psri-agent-name">{currentUser.name}</span>
          </div>
        )}
      </div>

      {loadErr && <div className="psri-err-banner">{loadErr}</div>}

      <div className="psri-search-row">
        <input
          className="psri-search-input"
          type="text"
          placeholder="Search by contact name, mobile, or summary…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button className="psri-btn-primary" onClick={openNew} style={{ flexShrink: 0 }}>+ New Case</button>
        <span className="psri-count">{filtered.length} case{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="psri-layout">
        <div className="psri-list">
          {loading && <div className="psri-empty">Loading cases…</div>}
          {!loading && !loadErr && filtered.length === 0 && (
            <div className="psri-empty">No cases found. Try a different search or create a new case.</div>
          )}
          {!loading && filtered.map(c => (
            <div key={c.id} className={`psri-contact-card ${selected?.id === c.id ? 'active' : ''}`} onClick={() => setSelected(c)}>
              <div className="psri-avatar">{(c.contactName || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase()).join('')}</div>
              <div className="psri-contact-main">
                <div className="psri-contact-name">{c.contactName || 'Unknown Contact'}</div>
                <div className="psri-contact-meta">
                  <span>
                    {c.contactMobile}
                    {hasWidget && c.contactMobile && (
                      <button
                        className="stg-c2c-btn"
                        title={`Call ${c.contactMobile}`}
                        onClick={e => { e.stopPropagation(); dial(c.contactMobile); }}
                      >&#128222;</button>
                    )}
                  </span>
                  {c.status && <span className="psri-badge">{c.status}</span>}
                  {c.priority && <span className="psri-badge">{c.priority}</span>}
                  {c.queryType && <span className="psri-badge">{c.queryType}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="psri-detail">
          {!selected ? (
            <div className="psri-detail-empty">
              <div className="psri-detail-empty-icon">🗂️</div>
              <p>Select a case to view details</p>
            </div>
          ) : (
            <div className="psri-detail-card">
              <div className="psri-detail-head">
                <div className="psri-avatar lg">{(selected.contactName || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase()).join('')}</div>
                <div>
                  <div className="psri-detail-name">{selected.contactName}</div>
                  {selected.status && <span className="psri-badge">{selected.status}</span>}
                </div>
                <button className="psri-btn-ghost" onClick={() => openEdit(selected)}>Edit</button>
              </div>
              <div className="psri-detail-grid">
                <div className="psri-detail-item">
                  <span>Mobile</span>
                  <strong>
                    {selected.contactMobile || '—'}
                    {hasWidget && selected.contactMobile && (
                      <button
                        className="stg-c2c-btn"
                        title={`Call ${selected.contactMobile}`}
                        onClick={() => dial(selected.contactMobile)}
                      >&#128222;</button>
                    )}
                  </strong>
                </div>
                <div className="psri-detail-item"><span>Channel</span><strong>{selected.channel || '—'}</strong></div>
                <div className="psri-detail-item"><span>Type of Call</span><strong>{selected.typeOfCall || '—'}</strong></div>
                <div className="psri-detail-item"><span>Call For</span><strong>{selected.callFor || '—'}</strong></div>
                <div className="psri-detail-item"><span>Type of Enquiry</span><strong>{selected.typeOfEnquiry || '—'}</strong></div>
                {selected.typeOfComplaint && <div className="psri-detail-item"><span>Type of Complaint</span><strong>{selected.typeOfComplaint}</strong></div>}
                {selected.typeOfEmergency && <div className="psri-detail-item"><span>Type of Emergency</span><strong>{selected.typeOfEmergency}</strong></div>}
                {selected.queryType && <div className="psri-detail-item"><span>Query Type</span><strong>{selected.queryType}</strong></div>}
                <div className="psri-detail-item"><span>Assigned To</span><strong>{users.find(u => u.id === selected.assignedTo)?.name || '—'}</strong></div>
              </div>
              {selected.summary && (
                <div className="psri-detail-notes">
                  <span>Summary</span>
                  <p>{selected.summary}</p>
                </div>
              )}
              {selected.isAppreciation && (
                <div className="psri-detail-notes" style={{ borderLeftColor: '#22c55e' }}>
                  <span>Appreciation Received</span>
                  <p>{selected.appreciationDetails || '(no details recorded)'}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
