import { PALETTE_GROUPS } from './schema';

export default function Palette({ onAdd }) {
  return (
    <aside className="wf-palette">
      <div className="wf-palette-title">Nodes</div>
      {PALETTE_GROUPS.map(g => (
        <div key={g.group} className="wf-palette-group">
          <div className="wf-palette-group-label" style={{ color: g.color }}>{g.group}</div>
          {g.items.map(item => (
            <button
              key={item.actionType}
              type="button"
              className="wf-palette-item"
              onClick={() => onAdd(item.actionType)}
              title={`${item.description}. Click to add.`}
            >
              <span className="wf-palette-item-icon" style={{ background: item.color }}>{item.icon}</span>
              <span>
                <span className="wf-palette-item-name">{item.label}</span>
                <span className="wf-palette-item-desc">{item.description}</span>
              </span>
            </button>
          ))}
        </div>
      ))}
      <div className="wf-palette-hint">Click a node to add it to the canvas. Connect actions by dragging from a node’s right handle to the next node’s left handle.</div>
    </aside>
  );
}