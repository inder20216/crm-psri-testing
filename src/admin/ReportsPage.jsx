import { useState } from 'react';
import { psri } from '../api/psri';
import './Admin.css';

// Raw CSV export only — every column, straight from the database. Deliberately
// no on-screen aggregation here: the client builds their own pivots/reports
// from this data separately (a different, custom report is handled outside
// the CRM, not this page).
function ExportCard({ title, hint, buildUrl }) {
  const [from, setFrom] = useState('');
  const [to, setTo]     = useState('');

  return (
    <div className="admin-table-wrap" style={{ padding: 20, marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>{title}</h3>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--admin-text-2)' }}>{hint}</p>
      <div className="admin-form-row" style={{ alignItems: 'flex-end' }}>
        <div className="admin-field">
          <label>From (optional)</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="admin-field">
          <label>To (optional)</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <a
          className="admin-btn-primary"
          style={{ textDecoration: 'none', display: 'inline-block' }}
          href={buildUrl(from, to)}
          download
        >
          Download CSV
        </a>
      </div>
      {(from || to) && (
        <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--admin-text-2)' }}>
          Leave both blank to download everything.
        </p>
      )}
    </div>
  );
}

export default function ReportsPage() {
  return (
    <div className="admin-page">
      <div className="admin-top">
        <div>
          <h1 className="admin-title">Reports</h1>
          <p className="admin-subtitle">Raw data export — every field, filterable by date. No summarizing here; build your own report from the download.</p>
        </div>
      </div>

      <ExportCard
        title="Contacts"
        hint="Every contact field, one row per contact."
        buildUrl={psri.exportContactsUrl}
      />
      <ExportCard
        title="Cases"
        hint="Every case field, one row per case."
        buildUrl={psri.exportCasesUrl}
      />
      <ExportCard
        title="High Value Cases"
        hint="Same as the Cases export, filtered to cases marked High Value only."
        buildUrl={psri.exportHighValueUrl}
      />
    </div>
  );
}
