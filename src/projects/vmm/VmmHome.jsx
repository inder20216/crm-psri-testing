export default function VmmHome() {
  return (
    <div style={{ padding: 28, maxWidth: 520 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>VMM Facility CRM</h1>
      <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6, marginBottom: 20 }}>
        VMM currently runs as its own deployed app. It isn't merged into this universal
        shell yet — for now, open it directly:
      </p>
      <a
        href="https://inder20216.github.io/crm-vmm/"
        target="_blank"
        rel="noreferrer"
        style={{
          display: 'inline-block',
          background: '#2563eb',
          color: 'white',
          padding: '10px 18px',
          borderRadius: 10,
          fontSize: 14,
          fontWeight: 700,
        }}
      >
        Open VMM CRM →
      </a>
    </div>
  );
}
