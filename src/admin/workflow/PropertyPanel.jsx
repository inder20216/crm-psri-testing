import { useState } from 'react';
import { CONDITION_FIELDS, TEMPLATE_HINT, UPDATABLE_FIELDS, getDef, withCurrentValue } from './schema';
import { useUsers } from '../../context/UsersContext';
import { usePicklists } from '../../context/PicklistsContext';
import { useDependencies } from '../../context/DependenciesContext';

function FieldHint({ f }) {
  const isTemplate = f.type === 'textarea' || ['to', 'subject', 'value', 'message'].includes(f.key);
  return <>
    {isTemplate && <p className="wf-param-hint">{TEMPLATE_HINT}</p>}
    {f.hint && !isTemplate && <p className="wf-param-hint">{f.hint}</p>}
  </>;
}

function KVRows({ value, onChange, keyLabel, valueLabel }) {
  const rows = Array.isArray(value) ? value : [];
  return (
    <div className="wf-kv">
      {rows.map((r, i) => (
        <div className="wf-kv-row" key={i}>
          <input
            className="wf-kv-key"
            value={r.key || ''}
            onChange={e => onChange(rows.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}
            placeholder={keyLabel}
          />
          <input
            className="wf-kv-value"
            value={r.value || ''}
            onChange={e => onChange(rows.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
            placeholder={valueLabel}
          />
          <button type="button" className="wf-kv-del" title="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="wf-kv-add" onClick={() => onChange([...rows, { key: '', value: '' }])}>+ Add column</button>
    </div>
  );
}

function FieldControl({ f, config, onPatch }) {
  const { users } = useUsers();
  const { getList } = usePicklists();
  const { getDependentValues } = useDependencies();
  const value = config[f.key] ?? '';

  switch (f.type) {
    case 'user':
      return (
        <select value={value} onChange={e => onPatch({ [f.key]: e.target.value })}>
          <option value="">— Unassigned —</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
        </select>
      );
    case 'select':
      return (
        <select value={value} onChange={e => onPatch({ [f.key]: e.target.value })}>
          <option value="">— Select —</option>
          {(f.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'picklist':
      return (
        <select value={value} onChange={e => onPatch({ [f.key]: e.target.value })}>
          <option value="">{f.required ? '— Select —' : '— None —'}</option>
          {withCurrentValue(getList(f.list), value).map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      );
    case 'dependent': {
      const subOptions = f.parentKey
        ? getDependentValues(f.deps.subField, f.deps.mainField, config[f.parentKey])
        : [];
      const options = subOptions.length > 0 ? subOptions : getList(f.deps.subField);
      return (
        <select value={value} onChange={e => onPatch({ [f.key]: e.target.value })}>
          <option value="">— Select —</option>
          {withCurrentValue(options, value).map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      );
    }
    case 'contactField': {
      const list = f.allFields ? CONDITION_FIELDS : UPDATABLE_FIELDS;
      return (
        <select value={value} onChange={e => onPatch({ [f.key]: e.target.value })}>
          <option value="">— Select field —</option>
          {list.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
      );
    }
    case 'textarea':
      return <textarea rows={f.rows || (f.key === 'summary' ? 3 : 3)} value={value} onChange={e => onPatch({ [f.key]: e.target.value })} placeholder={f.placeholder || ''} />;
    case 'kv':
      return <KVRows value={value} onChange={v => onPatch({ [f.key]: v })} keyLabel={f.kvKeyLabel} valueLabel={f.kvValueLabel} />;
    default:
      return <input type="text" value={value} onChange={e => onPatch({ [f.key]: e.target.value })} placeholder={f.placeholder || ''} />;
  }
}

export default function PropertyPanel({ node, onPatch, onRemove }) {
  const [showRemove, setShowRemove] = useState(false);
  if (!node) {
    return (
      <aside className="wf-panel">
        <div className="wf-panel-empty">
          <div className="wf-panel-empty-icon">🎛️</div>
          <p>Select a node on the canvas to configure it.</p>
        </div>
      </aside>
    );
  }
  const def = getDef(node.data.actionType);
  const config = node.data.config || {};

  const patch = (obj) => {
    const next = { ...config, ...obj };
    Object.entries(obj).forEach(([key]) => {
      const f = def.fields.find(x => x.key === key);
      (f?.clears || []).forEach(k => { next[k] = ''; });
    });
    onPatch(next);
  };

  return (
    <aside className="wf-panel" onMouseLeave={() => setShowRemove(false)}>
      <div className="wf-panel-head">
        <span className="wf-node-icon" style={{ background: def.color }}>{def.icon}</span>
        <div>
          <div className="wf-panel-title">{def.label}</div>
          <div className="wf-panel-sub">{def.description}</div>
        </div>
      </div>

      <div className="wf-panel-body">
        {def.fields.length === 0 && (
          <p className="wf-param-hint" style={{ marginTop: 0 }}>This node has no settings.</p>
        )}
        {def.fields.map(f => {
          if (f.showIf && !f.showIf(config)) return null;
          return (
            <div className="wf-param" key={f.key}>
              <label>{f.label} {f.required && <span className="req">*</span>}</label>
              <FieldControl f={f} config={config} onPatch={patch} />
              <FieldHint f={f} />
            </div>
          );
        })}
      </div>

      <div className="wf-panel-foot">
        <button
          type="button"
          className="wf-btn-remove"
          onMouseEnter={() => setShowRemove(true)}
          onMouseLeave={() => setShowRemove(false)}
          onClick={onRemove}
        >
          {showRemove ? 'Really remove this node?' : 'Remove node'}
        </button>
      </div>
    </aside>
  );
}