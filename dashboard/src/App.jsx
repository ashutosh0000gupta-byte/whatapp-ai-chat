import { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import Overview    from './pages/Overview';
import Pipeline    from './pages/Pipeline';
import Chats       from './pages/Chats';
import Tickets     from './pages/Tickets';
import Reservations from './pages/Reservations';
import AutoReplies  from './pages/AutoReplies';
import WaStatusWidget from './components/WaStatusWidget';

const NAV = [
  { id: 'overview',      icon: '📊', label: 'Overview' },
  { id: 'pipeline',      icon: '🔄', label: 'Pipeline' },
  { id: 'chats',         icon: '💬', label: 'Conversations' },
  { id: 'reservations',  icon: '🍽️', label: 'Reservations' },
  { id: 'tickets',       icon: '🎫', label: 'Tickets' },
  { id: 'auto-replies',  icon: '⚡', label: 'Auto-Replies' },
];

export default function App() {
  const [page, setPage]           = useState('overview');
  const [stats, setStats]         = useState(null);
  const [openTickets, setOpenTickets] = useState(0);

  const refreshStats = useCallback(async () => {
    try {
      const s = await api.getStats();
      setStats(s);
      setOpenTickets(s.openTickets || 0);
    } catch { /* backend not connected yet */ }
  }, []);

  useEffect(() => {
    refreshStats();
    const t = setInterval(refreshStats, 30_000); // refresh every 30s
    return () => clearInterval(t);
  }, [refreshStats]);

  const PageComponent = {
    overview:      Overview,
    pipeline:      Pipeline,
    chats:         Chats,
    reservations:  Reservations,
    tickets:       Tickets,
    'auto-replies': AutoReplies,
  }[page];

  return (
    <div className="app-layout">
      {/* ── Sidebar ── */}
      <nav className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon">🍽️</div>
          <span>RestoCRM</span>
        </div>
        {NAV.map(item => (
          <div
            key={item.id}
            className={`nav-item ${page === item.id ? 'active' : ''}`}
            onClick={() => setPage(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
            {item.id === 'tickets' && openTickets > 0 && (
              <span className="nav-badge">{openTickets}</span>
            )}
          </div>
        ))}
        <div className="sidebar-footer">
          WhatsApp CRM v1.0<br />
          <span style={{ color: 'var(--green)' }}>● Connected</span>
        </div>
      </nav>

      {/* ── Main ── */}
      <main className="main-content">
        <div className="topbar">
          <div>
            <div className="topbar-title">
              {NAV.find(n => n.id === page)?.icon} {NAV.find(n => n.id === page)?.label}
            </div>
            <div className="topbar-subtitle">Restaurant CRM — AI-Powered WhatsApp</div>
          </div>
          <div className="topbar-right">
            <WaStatusWidget />
            <div className="live-badge">
              <div className="live-dot" />
              Live
            </div>
            <button className="btn btn-ghost" onClick={refreshStats}>↻ Refresh</button>
          </div>
        </div>

        <div className="page-body" style={{ paddingTop: 24 }}>
          <PageComponent stats={stats} />
        </div>
      </main>
    </div>
  );
}
