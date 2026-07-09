import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';

function fmt(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function initials(name, phone) {
  if (name) return name.slice(0, 2).toUpperCase();
  return (phone || '??').slice(-2);
}

export default function Chats() {
  const [customers, setCustomers] = useState([]);
  const [selected,  setSelected]  = useState(null);
  const [messages,  setMessages]  = useState([]);
  const [input,     setInput]     = useState('');
  const [sending,   setSending]   = useState(false);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [search,    setSearch]    = useState('');

  // AI/Manual mode per selected contact
  const [contactMode, setContactMode] = useState('ai'); // 'ai' | 'manual'
  const [modeLoading, setModeLoading] = useState(false);

  // AI Preview
  const [aiPreview,      setAiPreview]      = useState(null);  // { reply, intent }
  const [aiPreviewLoading, setAiPreviewLoading] = useState(false);

  const msgEndRef = useRef(null);
  const pollRef   = useRef(null);

  // Load customers
  useEffect(() => {
    const load = () =>
      api.getCustomers()
        .then(c => { setCustomers(c); setLoading(false); })
        .catch(() => setLoading(false));
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  // Load contact mode when selection changes
  useEffect(() => {
    if (!selected) return;
    setAiPreview(null);
    setModeLoading(true);
    api.getContactMode(selected.phone)
      .then(data => setContactMode(data.mode || 'ai'))
      .catch(() => setContactMode('ai'))
      .finally(() => setModeLoading(false));
  }, [selected]);

  // Load messages and auto-poll every 3s when a chat is selected
  useEffect(() => {
    if (!selected) return;
    const load = () =>
      api.getMessages(selected.id)
        .then(setMessages)
        .catch(() => {});
    load();
    clearInterval(pollRef.current);
    pollRef.current = setInterval(load, 3_000);
    return () => clearInterval(pollRef.current);
  }, [selected]);

  // Scroll to bottom on new messages
  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Toggle AI / Manual mode ──────────────────────────────────
  const handleModeToggle = useCallback(async () => {
    if (!selected || modeLoading) return;
    const newMode = contactMode === 'ai' ? 'manual' : 'ai';
    setModeLoading(true);
    try {
      await api.setContactMode(selected.phone, newMode);
      setContactMode(newMode);
      setAiPreview(null);
    } catch {
      setError('⚠️ Failed to update mode');
    } finally {
      setModeLoading(false);
    }
  }, [selected, contactMode, modeLoading]);

  // ── Send message (manual) ──────────────────────────────────
  const handleSend = async (textOverride) => {
    const msg = (textOverride || input).trim();
    if (!msg || !selected || sending) return;
    setSending(true);
    setError('');
    setAiPreview(null);
    try {
      await api.sendManual(selected.phone, msg);
      setMessages(prev => [...prev, {
        direction: 'outbound',
        content: msg,
        created_at: new Date().toISOString(),
      }]);
      setInput('');
    } catch {
      setError('⚠️ Send failed — make sure WhatsApp is connected at /qr');
    } finally {
      setSending(false);
    }
  };

  // ── Ask AI (preview without sending) ──────────────────────
  const handleAskAi = async () => {
    if (!input.trim() || !selected || aiPreviewLoading) return;
    setAiPreviewLoading(true);
    setAiPreview(null);
    setError('');
    try {
      const result = await api.getAiPreview(selected.phone, input.trim(), selected.id);
      setAiPreview(result);
    } catch {
      setError('⚠️ AI preview failed — check server connection');
    } finally {
      setAiPreviewLoading(false);
    }
  };

  // Filtered customer list
  const filtered = customers.filter(c => {
    const q = search.toLowerCase();
    return !q || (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q);
  });

  if (loading) return <div className="spinner" />;

  return (
    <div className="chat-layout">
      {/* ── Customer List ── */}
      <div className="chat-list">
        <div className="chat-list-header">
          💬 Conversations ({customers.length})
        </div>

        {/* Search bar */}
        <div style={{ padding: '8px 10px 4px' }}>
          <input
            id="chat-search"
            type="text"
            placeholder="Search name or phone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '6px 10px', fontSize: 12,
              color: 'var(--text-primary)', outline: 'none',
            }}
          />
        </div>

        {filtered.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <div>{search ? 'No matches.' : 'No customers yet.\nSend a WhatsApp message to get started.'}</div>
          </div>
        )}
        {filtered.map(c => (
          <div
            key={c.id}
            id={`contact-${c.id}`}
            className={`chat-list-item ${selected?.id === c.id ? 'active' : ''}`}
            onClick={() => setSelected(c)}
          >
            <div className="chat-avatar">{initials(c.name, c.phone)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="chat-item-name">{c.name || 'Unknown'}</div>
              <div className="chat-item-phone">{c.phone}</div>
            </div>
            {/* Mode indicator dot */}
            {selected?.id === c.id && (
              <div
                title={contactMode === 'ai' ? 'AI mode active' : 'Manual mode — you are handling this'}
                style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: contactMode === 'ai' ? 'var(--green)' : '#f6ad55',
                }}
              />
            )}
          </div>
        ))}
      </div>

      {/* ── Chat Window ── */}
      <div className="chat-window">
        {!selected ? (
          <div className="empty-state" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div className="empty-icon">💬</div>
            <div>Select a conversation to view chat history</div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="chat-window-header">
              <div className="chat-avatar" style={{ width: 34, height: 34, fontSize: 13 }}>
                {initials(selected.name, selected.phone)}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{selected.name || 'Unknown'}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{selected.phone}</div>
              </div>

              {/* AI / Manual toggle */}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {selected.visit_count || 0} visits
                </div>
                <button
                  id={`mode-toggle-${selected.id}`}
                  onClick={handleModeToggle}
                  disabled={modeLoading}
                  title={
                    contactMode === 'ai'
                      ? 'AI is auto-replying. Click to switch to Manual mode.'
                      : 'You are in Manual mode. Click to re-enable AI auto-replies.'
                  }
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    border: `1px solid ${contactMode === 'ai' ? 'rgba(37,211,102,0.4)' : 'rgba(246,173,85,0.4)'}`,
                    background: contactMode === 'ai' ? 'rgba(37,211,102,0.1)' : 'rgba(246,173,85,0.1)',
                    color: contactMode === 'ai' ? 'var(--green)' : '#f6ad55',
                    borderRadius: 20, padding: '5px 12px',
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    transition: 'all 0.2s', opacity: modeLoading ? 0.5 : 1,
                  }}
                >
                  {contactMode === 'ai' ? '🤖 AI Active' : '👤 Manual'}
                </button>
              </div>
            </div>

            {/* Mode banner */}
            {contactMode === 'manual' && (
              <div style={{
                background: 'rgba(246,173,85,0.08)',
                borderBottom: '1px solid rgba(246,173,85,0.2)',
                padding: '6px 16px',
                fontSize: 12, color: '#f6ad55',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                👤 <strong>Manual mode</strong> — AI auto-replies are paused. You are handling this conversation.
              </div>
            )}

            {/* Messages */}
            <div className="chat-messages">
              {messages.length === 0 && (
                <div className="empty-state">
                  <div className="empty-icon">🗨️</div>
                  <div>No messages yet — {contactMode === 'ai' ? 'AI will auto-reply to incoming messages' : 'you are in manual mode'}</div>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`chat-bubble ${m.direction}`}>
                  {m.direction === 'outbound' && (
                    <div style={{ fontSize: 9, opacity: 0.5, marginBottom: 2 }}>
                      {m.intent === 'auto_reply' ? '⚡ Auto-reply' : m.intent ? `🤖 AI · ${m.intent}` : '👤 Agent'}
                    </div>
                  )}
                  {m.content}
                  <div className="bubble-time">{fmt(m.created_at)}</div>
                </div>
              ))}
              <div ref={msgEndRef} />
            </div>

            {/* AI Preview bubble */}
            {aiPreview && (
              <div style={{
                margin: '0 16px 8px',
                background: 'rgba(37,211,102,0.06)',
                border: '1px solid rgba(37,211,102,0.2)',
                borderRadius: 12,
                padding: '10px 14px',
              }}>
                <div style={{ fontSize: 10, color: 'var(--green)', marginBottom: 5, fontWeight: 700 }}>
                  🤖 AI Suggestion · {aiPreview.intent}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: 8 }}>
                  {aiPreview.reply}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    id="send-ai-preview-btn"
                    className="btn btn-primary"
                    style={{ padding: '4px 12px', fontSize: 12 }}
                    onClick={() => handleSend(aiPreview.reply)}
                    disabled={sending}
                  >
                    ✓ Send this
                  </button>
                  <button
                    id="use-ai-as-draft-btn"
                    className="btn btn-ghost"
                    style={{ padding: '4px 12px', fontSize: 12 }}
                    onClick={() => { setInput(aiPreview.reply); setAiPreview(null); }}
                  >
                    ✏️ Edit first
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '4px 12px', fontSize: 12 }}
                    onClick={() => setAiPreview(null)}
                  >
                    ✕ Dismiss
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div style={{
                padding: '6px 14px', fontSize: 12, color: 'var(--red)',
                background: 'rgba(252,129,129,0.1)', borderTop: '1px solid rgba(252,129,129,0.2)',
              }}>
                {error}
              </div>
            )}

            {/* Input bar */}
            <div className="chat-input-bar">
              <textarea
                id="chat-input"
                className="chat-input"
                placeholder={`Reply to ${selected.name || selected.phone}…`}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                rows={1}
              />
              {/* Ask AI button */}
              <button
                id="ask-ai-btn"
                className="btn btn-ghost"
                onClick={handleAskAi}
                disabled={!input.trim() || aiPreviewLoading}
                title="Preview what AI would reply (without sending)"
                style={{
                  fontSize: 12, padding: '8px 12px', whiteSpace: 'nowrap',
                  borderColor: 'rgba(37,211,102,0.3)', color: 'var(--green)',
                }}
              >
                {aiPreviewLoading ? '…' : '🤖 Ask AI'}
              </button>
              <button
                id="send-btn"
                className="send-btn"
                onClick={() => handleSend()}
                disabled={!input.trim() || sending}
                title="Send message (Enter)"
              >
                {sending ? '…' : '➤ Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
