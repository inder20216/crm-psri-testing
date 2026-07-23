import { useState } from 'react';
import { useSparkTG } from '../../context/SparkTGContext';

const WIDGET_URL = import.meta.env.VITE_SPARKTG_WIDGET_URL || '';

export default function SparkTGWidget() {
  const { iframeRef, widgetVisible, setWidgetVisible, ready, ssoStatus, rawEvents, clearRawEvents } = useSparkTG();
  const [debugOpen, setDebugOpen] = useState(false);

  if (!WIDGET_URL) return null;

  const statusClass = ready && ssoStatus === 'success' ? 'stg-dot--green'
    : ready ? 'stg-dot--yellow'
    : 'stg-dot--grey';

  return (
    <>
      <button
        className="stg-toggle-btn"
        onClick={() => setWidgetVisible(v => !v)}
        title={widgetVisible ? 'Hide Dialer' : 'Open Dialer'}
        aria-label="SparkTG Dialer"
      >
        <span className="stg-phone-icon">&#128222;</span>
        <span className={`stg-dot ${statusClass}`} />
      </button>

      {/* Debug toggle — small button next to the dialer toggle */}
      <button
        className="stg-toggle-btn stg-debug-btn"
        onClick={() => setDebugOpen(v => !v)}
        title="SparkTG Event Debug"
        style={{ bottom: 72 }}
      >
        <span style={{ fontSize: 13, fontWeight: 700 }}>⚙</span>
        {rawEvents.length > 0 && <span className="stg-dot stg-dot--yellow" />}
      </button>

      {debugOpen && (
        <div className="stg-debug-panel">
          <div className="stg-debug-header">
            <span>SparkTG Raw Events</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={clearRawEvents} style={{ fontSize: 11, cursor: 'pointer', background: 'none', border: '1px solid #444', color: '#ccc', borderRadius: 4, padding: '2px 8px' }}>Clear</button>
              <button onClick={() => setDebugOpen(false)} style={{ fontSize: 13, cursor: 'pointer', background: 'none', border: 'none', color: '#ccc' }}>✕</button>
            </div>
          </div>
          {rawEvents.length === 0 && (
            <div className="stg-debug-empty">No events yet. Make or receive a call to see what SparkTG sends.</div>
          )}
          {rawEvents.map((e, i) => (
            <div key={i} className="stg-debug-event">
              <div className="stg-debug-event-header">
                <span className="stg-debug-event-name">{e.event}</span>
                <span className="stg-debug-event-ts">{e.ts}</span>
              </div>
              <pre className="stg-debug-event-data">{JSON.stringify(e.data, null, 2)}</pre>
            </div>
          ))}
        </div>
      )}

      <iframe
        ref={iframeRef}
        id="sparktg-widget"
        src={WIDGET_URL}
        allow="microphone; camera; autoplay; speaker-selection; display-capture"
        title="SparkTG Dialer"
        className={`stg-iframe${widgetVisible ? ' stg-iframe--visible' : ''}`}
      />
    </>
  );
}
