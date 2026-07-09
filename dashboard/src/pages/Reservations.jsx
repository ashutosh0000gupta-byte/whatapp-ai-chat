import { useState, useEffect } from 'react';
import { api } from '../api';

const STATUS_COLOR = {
  pending:   'var(--orange)',
  confirmed: 'var(--green)',
  cancelled: 'var(--red)',
  completed: 'var(--blue)',
  'no-show': 'var(--text-muted)',
};

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function Reservations() {
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('all');

  const load = async () => {
    setLoading(true);
    try { setReservations(await api.getReservations()); }
    catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const updateStatus = async (id, status) => {
    try {
      await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000/api'}/reservations`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      setReservations(prev => prev.map(r => r.id === id ? { ...r, status } : r));
    } catch {}
  };

  const filtered = filter === 'all' ? reservations : reservations.filter(r => r.status === filter);

  if (loading) return <div className="spinner" />;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {['all', 'pending', 'confirmed', 'cancelled', 'completed', 'no-show'].map(f => (
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

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🍽️</div>
          <div>No {filter === 'all' ? '' : filter} reservations</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Date</th>
                <th>Time</th>
                <th>Party</th>
                <th>Occasion</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.customers?.name || 'Unknown'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{r.customers?.phone}</div>
                  </td>
                  <td>{fmtDate(r.reserved_date)}</td>
                  <td>{r.reserved_time?.slice(0, 5)}</td>
                  <td style={{ textAlign: 'center' }}>👥 {r.party_size}</td>
                  <td>{r.occasion || '—'}</td>
                  <td>
                    <span style={{
                      display: 'inline-block',
                      padding: '3px 10px', borderRadius: 99,
                      fontSize: 11, fontWeight: 700,
                      background: `${STATUS_COLOR[r.status]}22`,
                      color: STATUS_COLOR[r.status],
                    }}>
                      {r.status}
                    </span>
                  </td>
                  <td>
                    {r.status === 'pending' && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 10px' }}
                          onClick={() => updateStatus(r.id, 'confirmed')}>✅ Confirm</button>
                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }}
                          onClick={() => updateStatus(r.id, 'cancelled')}>❌</button>
                      </div>
                    )}
                    {r.status === 'confirmed' && (
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }}
                        onClick={() => updateStatus(r.id, 'completed')}>Mark Done</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
