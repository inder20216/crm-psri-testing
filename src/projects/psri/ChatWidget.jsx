import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import './Chat.css';

const TARIFF_BOT_ID = 'tariff-bot';
const N8N_BASE = import.meta.env.VITE_PSRI_API_BASE || '/psri-webhook';
const TARIFF_ENDPOINT = `${N8N_BASE}/psri-tariff-chat`;

// ── Helpers ──────────────────────────────────────────────────────────────────
function initials(name) {
  return (name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function highlightMentions(text) {
  const parts = text.split(/(@\S+)/g);
  return parts.map((p, i) =>
    p.startsWith('@') ? <span key={i} className="chat-mention">{p}</span> : p
  );
}

function formatBotText(text) {
  const rawLines = text.split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim() !== '');
  const hasBullets = rawLines.some(l => /^\s*-\s+/.test(l));

  if (hasBullets) {
    // Walk lines in original order instead of bucketing "all headings" then
    // "all bullets" separately — that used to detach a heading from the
    // list it introduced (e.g. "Additional charges:" ending up nowhere near
    // its own bullets) and flatten indented sub-bullets in with top-level
    // ones (e.g. per-room-type prices rendering as siblings of the bullet
    // that names the room types, instead of nested under it), turning a
    // correct multi-section answer into a scrambled single list.
    const blocks = [];
    let currentList = null;
    rawLines.forEach(raw => {
      const bulletMatch = raw.match(/^(\s*)-\s+(.*)$/);
      if (!bulletMatch) {
        currentList = null;
        blocks.push({ type: 'text', text: raw.trim() });
        return;
      }
      const indented = bulletMatch[1].length > 0;
      const content = bulletMatch[2].trim();
      if (!currentList) {
        currentList = { type: 'list', items: [] };
        blocks.push(currentList);
      }
      if (indented && currentList.items.length > 0) {
        currentList.items[currentList.items.length - 1].children.push(content);
      } else {
        currentList.items.push({ text: content, children: [] });
      }
    });

    return (
      <>
        {blocks.map((b, i) => b.type === 'text' ? (
          <span key={i} style={{ display: 'block', marginBottom: 4 }}>{b.text}</span>
        ) : (
          <ul key={i} style={{ margin: '4px 0 8px', paddingLeft: 16 }}>
            {b.items.map((it, j) => (
              <li key={j} style={{ marginBottom: 3 }}>
                {it.text}
                {it.children.length > 0 && (
                  <ul style={{ margin: '2px 0 0', paddingLeft: 16 }}>
                    {it.children.map((c, k) => <li key={k} style={{ marginBottom: 2 }}>{c}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        ))}
      </>
    );
  }

  // No newline bullets — check for inline " - Category:" pattern
  // Split only on " - " followed by a capital letter (new item, not a price range)
  const inlineParts = text.split(/ - (?=[A-Z])/);
  if (inlineParts.length > 2) {
    return (
      <>
        <span style={{ display: 'block', marginBottom: 4 }}>{inlineParts[0]}</span>
        <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
          {inlineParts.slice(1).map((p, i) => <li key={i} style={{ marginBottom: 3 }}>{p.trim()}</li>)}
        </ul>
      </>
    );
  }

  return <span style={{ whiteSpace: 'pre-wrap' }}>{text}</span>;
}

export default function ChatWidget() {
  const { currentUser } = useAuth();
  const [open,        setOpen]        = useState(false);
  const [messages,    setMessages]    = useState({ [TARIFF_BOT_ID]: [] });
  const [input,       setInput]       = useState('');
  const [botThinking, setBotThinking] = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const botMsgs   = messages[TARIFF_BOT_ID] || [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || botThinking) return;
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const agentMsg = {
      id: Date.now(),
      sender: currentUser?.name || 'You',
      time: now,
      text,
    };
    setMessages(prev => ({ [TARIFF_BOT_ID]: [...(prev[TARIFF_BOT_ID] || []), agentMsg] }));
    setInput('');
    setBotThinking(true);
    try {
      // The bot's own answers have taken up to ~13s in practice (LLM-backed
      // workflow) — without a cap, a genuinely stuck request just leaves
      // the "thinking" dots running forever with no feedback at all.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      let res;
      try {
        res = await fetch(TARIFF_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, agentId: currentUser?.id || '' }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!res.ok) throw new Error(`request failed: ${res.status}`);
      const data = await res.json();
      const botMsg = {
        id: Date.now() + 1,
        sender: 'Tariff Bot',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: data.output || 'Sorry, I could not find an answer.',
        isBot: true,
      };
      setMessages(prev => ({ [TARIFF_BOT_ID]: [...(prev[TARIFF_BOT_ID] || []), botMsg] }));
    } catch {
      const errMsg = {
        id: Date.now() + 1,
        sender: 'Tariff Bot',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: 'Having trouble connecting. Please try again.',
        isBot: true,
      };
      setMessages(prev => ({ [TARIFF_BOT_ID]: [...(prev[TARIFF_BOT_ID] || []), errMsg] }));
    } finally {
      setBotThinking(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <>
      <button
        className={`chat-toggle-btn${open ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Tariff Bot"
      >
        💬
      </button>

      {open && (
        <div className="chat-panel">
          <div className="chat-header">
            <span className="chat-header-title">🤖 PSRI Tariff Bot</span>
            <button className="chat-close-btn" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className="chat-messages" style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {botMsgs.length === 0 && (
              <div className="chat-bot-welcome">
                <div className="chat-bot-welcome-icon">🤖</div>
                <div className="chat-bot-welcome-text">
                  <strong>PSRI Tariff Bot</strong>
                  <p>Ask me about room rates, procedure charges, corporate empanelment terms, or any tariff question.</p>
                  <div className="chat-bot-examples">
                    <span>Try: "ICU rate per day"</span>
                    <span>Try: "Air India discount on surgery"</span>
                    <span>Try: "Twin bedded room charge"</span>
                  </div>
                </div>
              </div>
            )}
            {botMsgs.map((msg) => {
              const isYou = !msg.isBot;
              return (
                <div key={msg.id} className={`chat-msg${isYou ? ' chat-msg--you' : ''}`}>
                  {!isYou && <div className="chat-avatar chat-avatar--b">🤖</div>}
                  <div className="chat-msg-body">
                    <div className="chat-msg-meta">
                      <span className="chat-msg-sender">{msg.sender}</span>
                      <span className="chat-msg-time">{msg.time}</span>
                    </div>
                    <div className="chat-bubble">
                      {msg.isBot ? formatBotText(msg.text) : msg.text}
                    </div>
                  </div>
                </div>
              );
            })}
            {botThinking && (
              <div className="chat-msg">
                <div className="chat-avatar chat-avatar--b">🤖</div>
                <div className="chat-msg-body">
                  <div className="chat-bubble chat-bubble--thinking">
                    <span className="chat-dot" /><span className="chat-dot" /><span className="chat-dot" />
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="chat-input-row">
            <textarea
              ref={inputRef}
              className="chat-input"
              rows={1}
              placeholder="Ask about tariffs, room rates, corporate terms…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={botThinking}
            />
            <button className="chat-send-btn" onClick={sendMessage} disabled={!input.trim() || botThinking}>↑</button>
          </div>
        </div>
      )}
    </>
  );
}
