import { useState, useEffect } from 'react';
import { api } from '../api';

const PRIORITY_CLS = { urgent: 'priority-urgent', high: 'priority-high', normal: 'priority-normal', low: 'priority-low' };
const STATUS_CLS   = { open: 'status-open', escalated: 'status-escalated', 'in-progress': 'status-in-progress', resolved: 'status-resolved', closed: 'status-resolved' };

function fmt(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function Tickets() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('all');

  const load = async () => {
    setLoading(true);
    try { setTickets(await api.getTickets()); }
    catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const resolve = async (id) => {
    await api.updateTicket(id, { status: 'resolved' });
    setTickets(prev => prev.map(t => t.id === id ? { ...t, status: 'resolved' } : t));
  };

  const escalate = async (id) => {
    await api.updateTicket(id, { status: 'escalated', priority: 'urgent' });
    setTickets(prev => prev.map(t => t.id === id ? { ...t, status: 'escalated', priority: 'urgent' } : t));
  };

  const filtered = filter === 'all' ? tickets : tickets.filter(t => t.status === filter);

  if (loading) return <div className="spinner" />;

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['all', 'open', 'escalated', 'in-progress', 'resolved'].map(f => (
          <button
            key={f}
            className={`btn ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={load}>↻</button>
      </div>

      {filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🎉</div>
          <div>No {filter === 'all' ? '' : filter} tickets!</div>
        </div>
      )}

      <div className="ticket-list">
        {filtered.map(t => (
          <div key={t.id} className="ticket-item">
            <div className={`ticket-priority ${PRIORITY_CLS[t.priority] || 'priority-normal'}`} />
            <div style={{ flex: 1 }}>
              <div className="ticket-issue">{t.issue}</div>
              <div className="ticket-meta">
                👤 {t.customers?.name || t.customers?.phone || 'Unknown'} &nbsp;·&nbsp;
                📂 {t.category} &nbsp;·&nbsp;
                🕐 {fmt(t.created_at)}
              </div>
              {/* Actions */}
              {t.status !== 'resolved' && t.status !== 'closed' && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn btn-primary" style={{ fontSize: 11, padding: '5px 12px' }} onClick={() => resolve(t.id)}>
                    ✅ Resolve
                  </button>
                  {t.status !== 'escalated' && (
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: '5px 12px' }} onClick={() => escalate(t.id)}>
                      ⚠️ Escalate
                    </button>
                  )}
                </div>
              )}
            </div>
            <span className={`ticket-status-badge ${STATUS_CLS[t.status] || 'status-open'}`}>
              {t.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
