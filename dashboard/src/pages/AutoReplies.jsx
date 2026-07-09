import { useState, useEffect } from 'react';
import { api } from '../api';

const MATCH_LABELS = {
  contains:   'Contains',
  exact:      'Exact match',
  startsWith: 'Starts with',
};

export default function AutoReplies() {
  const [rules,   setRules]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  // New rule form state
  const [form, setForm] = useState({
    keyword:   '',
    response:  '',
    matchType: 'contains',
    enabled:   true,
  });
  const [showForm, setShowForm] = useState(false);
  const [editId,   setEditId]   = useState(null);

  const flash = (msg, isError = false) => {
    if (isError) { setError(msg); setTimeout(() => setError(''), 3500); }
    else { setSuccess(msg); setTimeout(() => setSuccess(''), 3000); }
  };

  const load = async () => {
    try {
      const data = await api.getAutoReplies();
      setRules(data);
    } catch {
      flash('Failed to load rules', true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleToggle = async (rule) => {
    try {
      await api.updateAutoReply(rule.id, { enabled: !rule.enabled });
      setRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r));
    } catch {
      flash('Failed to update rule', true);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this auto-reply rule?')) return;
    try {
      await api.deleteAutoReply(id);
      setRules(prev => prev.filter(r => r.id !== id));
      flash('Rule deleted');
    } catch {
      flash('Failed to delete rule', true);
    }
  };

  const handleEdit = (rule) => {
    setForm({ keyword: rule.keyword, response: rule.response, matchType: rule.matchType, enabled: rule.enabled });
    setEditId(rule.id);
    setShowForm(true);
  };

  const resetForm = () => {
    setForm({ keyword: '', response: '', matchType: 'contains', enabled: true });
    setEditId(null);
    setShowForm(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.keyword.trim() || !form.response.trim()) {
      flash('Keyword and Response are required', true);
      return;
    }
    setSaving(true);
    try {
      if (editId) {
        const updated = await api.updateAutoReply(editId, form);
        setRules(prev => prev.map(r => r.id === editId ? updated : r));
        flash('Rule updated ✓');
      } else {
        const created = await api.createAutoReply(form);
        setRules(prev => [...prev, created]);
        flash('Rule created ✓');
      }
      resetForm();
    } catch {
      flash('Failed to save rule', true);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="spinner" />;

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>⚡ Auto-Reply Rules</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
            Keyword-triggered instant replies — checked <strong style={{ color: 'var(--green)' }}>before</strong> AI so they always fire.
          </p>
        </div>
        <button
          id="add-rule-btn"
          className="btn btn-primary"
          onClick={() => { resetForm(); setShowForm(v => !v); }}
        >
          {showForm && !editId ? '✕ Cancel' : '+ Add Rule'}
        </button>
      </div>

      {/* ── Flash messages ── */}
      {error   && <div className="alert alert-error"   style={alertStyle('red')}>   {error}   </div>}
      {success && <div className="alert alert-success" style={alertStyle('green')}> {success} </div>}

      {/* ── Add / Edit Form ── */}
      {showForm && (
        <form onSubmit={handleSubmit} style={formCardStyle}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, color: 'var(--text-primary)' }}>
            {editId ? '✏️ Edit Rule' : '➕ New Auto-Reply Rule'}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label style={labelStyle}>
              Keyword / Trigger *
              <input
                id="rule-keyword"
                className="input"
                placeholder='e.g. menu, hours, price'
                value={form.keyword}
                onChange={e => setForm(p => ({ ...p, keyword: e.target.value }))}
                required
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Match Type
              <select
                id="rule-match-type"
                value={form.matchType}
                onChange={e => setForm(p => ({ ...p, matchType: e.target.value }))}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="contains">Contains keyword</option>
                <option value="startsWith">Starts with keyword</option>
                <option value="exact">Exact match only</option>
              </select>
            </label>
          </div>

          <label style={{ ...labelStyle, display: 'block', marginBottom: 12 }}>
            Auto-Reply Message *
            <textarea
              id="rule-response"
              className="chat-input"
              placeholder='Message sent when keyword is matched…'
              value={form.response}
              onChange={e => setForm(p => ({ ...p, response: e.target.value }))}
              rows={3}
              required
              style={{ ...inputStyle, resize: 'vertical', minHeight: 72 }}
            />
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="checkbox"
                id="rule-enabled"
                checked={form.enabled}
                onChange={e => setForm(p => ({ ...p, enabled: e.target.checked }))}
                style={{ accentColor: 'var(--green)', width: 16, height: 16 }}
              />
              <span style={{ color: 'var(--text-primary)' }}>Enable immediately</span>
            </label>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={resetForm}>Cancel</button>
              <button id="save-rule-btn" type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : editId ? 'Save Changes' : 'Create Rule'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* ── Rules Table ── */}
      {rules.length === 0 ? (
        <div className="empty-state" style={{ padding: '60px 0' }}>
          <div className="empty-icon">⚡</div>
          <div>No auto-reply rules yet.</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
            Click <strong>"+ Add Rule"</strong> to create your first instant reply.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rules.map(rule => (
            <div key={rule.id} style={ruleCardStyle(rule.enabled)}>
              {/* Left: keyword + response */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={keywordBadge}>{rule.keyword}</span>
                  <span style={matchBadge}>{MATCH_LABELS[rule.matchType] || rule.matchType}</span>
                  {!rule.enabled && (
                    <span style={{ fontSize: 10, color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4 }}>
                      DISABLED
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  → {rule.response}
                </div>
              </div>

              {/* Right: actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {/* Toggle */}
                <button
                  id={`toggle-rule-${rule.id}`}
                  onClick={() => handleToggle(rule)}
                  title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                  style={toggleBtnStyle(rule.enabled)}
                >
                  {rule.enabled ? '● On' : '○ Off'}
                </button>
                <button
                  id={`edit-rule-${rule.id}`}
                  className="btn btn-ghost"
                  onClick={() => handleEdit(rule)}
                  style={{ padding: '4px 10px', fontSize: 12 }}
                >
                  ✏️ Edit
                </button>
                <button
                  id={`delete-rule-${rule.id}`}
                  className="btn btn-ghost"
                  onClick={() => handleDelete(rule.id)}
                  style={{ padding: '4px 10px', fontSize: 12, color: 'var(--red)' }}
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Info box ── */}
      <div style={infoBoxStyle}>
        <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>💡 How auto-replies work</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <li>Rules are checked <strong style={{ color: 'var(--text-primary)' }}>before</strong> the AI — a keyword match fires instantly.</li>
          <li><strong style={{ color: 'var(--text-primary)' }}>Contains</strong>: message includes the keyword anywhere.</li>
          <li><strong style={{ color: 'var(--text-primary)' }}>Starts with</strong>: message begins with the keyword.</li>
          <li><strong style={{ color: 'var(--text-primary)' }}>Exact</strong>: full message equals the keyword.</li>
          <li>Keywords are case-insensitive. Disable a rule to pause it without deleting.</li>
        </ul>
      </div>
    </div>
  );
}

// ── Inline styles (small helpers) ─────────────────────────────────────
const alertStyle = (color) => ({
  padding: '10px 14px',
  borderRadius: 8,
  marginBottom: 14,
  fontSize: 13,
  background: `rgba(var(--${color}-rgb, ${color === 'green' ? '37,211,102' : '252,129,129'}), 0.12)`,
  border: `1px solid rgba(var(--${color}-rgb, ${color === 'green' ? '37,211,102' : '252,129,129'}), 0.25)`,
  color: color === 'green' ? 'var(--green)' : 'var(--red)',
});

const formCardStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '20px 24px',
  marginBottom: 20,
};

const labelStyle = {
  fontSize: 12,
  color: 'var(--text-secondary)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const inputStyle = {
  width: '100%',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '8px 12px',
  color: 'var(--text-primary)',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};

const ruleCardStyle = (enabled) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  background: 'var(--surface)',
  border: `1px solid ${enabled ? 'var(--border)' : 'rgba(255,255,255,0.04)'}`,
  borderRadius: 10,
  padding: '12px 16px',
  opacity: enabled ? 1 : 0.6,
  transition: 'opacity 0.2s',
});

const keywordBadge = {
  background: 'rgba(37,211,102,0.12)',
  color: 'var(--green)',
  border: '1px solid rgba(37,211,102,0.25)',
  borderRadius: 6,
  padding: '2px 10px',
  fontSize: 12,
  fontWeight: 700,
  fontFamily: 'monospace',
};

const matchBadge = {
  background: 'rgba(99,179,237,0.1)',
  color: '#63b3ed',
  border: '1px solid rgba(99,179,237,0.2)',
  borderRadius: 6,
  padding: '2px 8px',
  fontSize: 10,
  fontWeight: 600,
};

const toggleBtnStyle = (enabled) => ({
  cursor: 'pointer',
  border: `1px solid ${enabled ? 'rgba(37,211,102,0.4)' : 'rgba(255,255,255,0.1)'}`,
  background: enabled ? 'rgba(37,211,102,0.12)' : 'rgba(255,255,255,0.04)',
  color: enabled ? 'var(--green)' : 'var(--text-secondary)',
  borderRadius: 20,
  padding: '4px 12px',
  fontSize: 12,
  fontWeight: 600,
  transition: 'all 0.2s',
});

const infoBoxStyle = {
  marginTop: 28,
  background: 'rgba(99,179,237,0.06)',
  border: '1px solid rgba(99,179,237,0.15)',
  borderRadius: 10,
  padding: '14px 18px',
};
