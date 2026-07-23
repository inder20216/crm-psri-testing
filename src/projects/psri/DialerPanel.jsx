import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { psri } from '../../api/psri';
import { useSparkTG } from '../../context/SparkTGContext';

export default function DialerPanel() {
  const { hasWidget, callState, dismissCall, setDialerPrefill } = useSparkTG();
  const navigate = useNavigate();

  const [contact,     setContact]     = useState(null);
  const [recentCases, setRecentCases] = useState([]);
  const [searching,   setSearching]   = useState(false);
  const [noContact,   setNoContact]   = useState(false);

  const phone = callState?.phone;
  const callStateRef   = useRef(callState);
  const autoNavigated  = useRef(false);
  useEffect(() => { callStateRef.current = callState; }, [callState]);

  useEffect(() => {
    if (!phone) {
      setContact(null); setRecentCases([]); setNoContact(false);
      autoNavigated.current = false;
      return;
    }
    let cancelled = false;
    autoNavigated.current = false;
    setSearching(true);
    setContact(null); setRecentCases([]); setNoContact(false);

    psri.getContacts(phone)
      .then(res => {
        if (cancelled) return;
        const list = res.contacts || [];
        if (list.length > 0) {
          const found = list[0];
          setContact(found);
          return psri.getCases(found.mobile).then(cr => {
            if (cancelled) return;
            setRecentCases((cr.cases || []).slice(0, 3));
            if (!autoNavigated.current) {
              autoNavigated.current = true;
              const cs = callStateRef.current;
              goToCases({
                contact:      { id: found.id, name: found.name, mobile: found.mobile, mobileIsd: found.mobileIsd || '+91', salutation: found.salutation },
                channel:      'Call',
                typeOfCall:   cs?.direction === 'inbound' ? 'Inbound' : 'Outbound',
                callTxnId:    cs?.callId    || '',
                calledNumber: cs?.calledTo  || '',
              });
              dismissCall();
            }
          });
        } else {
          if (!autoNavigated.current) {
            autoNavigated.current = true;
            const cs = callStateRef.current;
            goToCases({
              contact:          null,
              prefillMobile:    phone,
              autoOpenQuickAdd: true,
              channel:          'Call',
              typeOfCall:       cs?.direction === 'inbound' ? 'Inbound' : 'Outbound',
              callTxnId:        cs?.callId   || '',
              calledNumber:     cs?.calledTo || '',
            });
            dismissCall();
          }
        }
      })
      .catch(() => {
        if (!cancelled && !autoNavigated.current) {
          autoNavigated.current = true;
          const cs = callStateRef.current;
          goToCases({
            contact:          null,
            prefillMobile:    phone,
            autoOpenQuickAdd: true,
            channel:          'Call',
            typeOfCall:       cs?.direction === 'inbound' ? 'Inbound' : 'Outbound',
            callTxnId:        cs?.callId   || '',
            calledNumber:     cs?.calledTo || '',
          });
          dismissCall();
        }
      })
      .finally(() => { if (!cancelled) setSearching(false); });

    return () => { cancelled = true; };
  }, [phone]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasWidget || !callState) return null;

  const buildPrefill = (repeatFrom) => ({
    contact:      contact ? { id: contact.id, name: contact.name, mobile: contact.mobile, mobileIsd: contact.mobileIsd || '+91' } : null,
    prefillMobile: !contact ? phone : undefined,
    channel:      'Call',
    typeOfCall:   callState.direction === 'inbound' ? 'Inbound' : 'Outbound',
    callTxnId:    callState.callId || '',
    calledNumber: callState.calledTo || '',
    repeatFrom:   repeatFrom || undefined,
  });

  const goToCases = (prefill) => {
    setDialerPrefill(prefill);
    navigate('/psri/cases');
  };

  return (
    <div className="stg-dialer-panel">
      <div className="stg-dialer-header">
        <div className="stg-dialer-direction">
          <span className={`stg-call-badge ${callState.direction === 'inbound' ? 'stg-call-badge--in' : 'stg-call-badge--out'}`}>
            {callState.direction === 'inbound' ? '↙ Incoming' : '↗ Outgoing'}
          </span>
          {callState.ended && <span className="stg-call-ended-badge">Call Ended</span>}
        </div>
        <button className="stg-dialer-close" onClick={dismissCall} title="Dismiss">&#10005;</button>
      </div>

      <div className="stg-dialer-phone">{callState.phone || 'Unknown Number'}</div>
      {callState.name && <div className="stg-dialer-caller-name">{callState.name}</div>}

      {searching && <p className="stg-hint">Searching contact&hellip;</p>}

      {!searching && contact && (
        <div className="stg-contact-found">
          <div className="stg-contact-row">
            <div className="stg-contact-avatar">
              {(contact.name || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase()).join('')}
            </div>
            <div>
              <div className="stg-contact-name">{contact.salutation} {contact.name}</div>
              <div className="stg-contact-mobile">{contact.mobile}</div>
            </div>
          </div>
          <div className="stg-dialer-actions">
            <button className="stg-btn-primary" onClick={() => goToCases(buildPrefill())}>+ New Case</button>
          </div>

          {recentCases.length > 0 && (
            <div className="stg-recent-cases">
              <div className="stg-recent-title">Recent Cases</div>
              {recentCases.map(c => (
                <div key={c.id} className="stg-recent-case">
                  <div className="stg-recent-case-top">
                    <span className="stg-badge">{c.callFor || c.typeOfCall || '—'}</span>
                    <span className="stg-recent-date">
                      {c.created ? new Date(c.created).toLocaleDateString('en-IN') : ''}
                    </span>
                  </div>
                  <p className="stg-recent-summary">{c.summary || '(no summary)'}</p>
                  <button className="stg-btn-ghost" onClick={() => goToCases(buildPrefill(c))}>
                    Repeat with New Enquiry
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!searching && noContact && (
        <div className="stg-no-contact">
          <p className="stg-hint">No contact found for this number.</p>
          <div className="stg-dialer-actions">
            <button className="stg-btn-primary" onClick={() => goToCases(buildPrefill())}>
              Add Contact &amp; Create Case
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
