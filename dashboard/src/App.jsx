import { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import Overview    from './pages/Overview';
import Pipeline    from './pages/Pipeline';
import Chats       from './pages/Chats';
import Tickets     from './pages/Tickets';
import Reservations from './pages/Reservations';
import AutoReplies  from './pages/AutoReplies';
import Businesses   from './pages/Businesses';
import WaStatusWidget from './components/WaStatusWidget';

const NAV = [
  { id: 'overview',      icon: '📊', label: 'Overview' },
  { id: 'pipeline',      icon: '🔄', label: 'Pipeline' },
  { id: 'chats',         icon: '💬', label: 'Conversations' },
  { id: 'reservations',  icon: '🍽️', label: 'Reservations' },
  { id: 'tickets',       icon: '🎫', label: 'Tickets' },
  { id: 'auto-replies',  icon: '⚡', label: 'Auto-Replies' },
  { id: 'businesses',    icon: '⚙️', label: 'Businesses' },
];

export default function App() {
  const [page, setPage]                   = useState('overview');
  const [stats, setStats]                 = useState(null);
  const [openTickets, setOpenTickets]     = useState(0);
  
  // Multi-Tenant States
  const [businesses, setBusinesses]       = useState([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState('');

  // Fetch list of businesses
  const loadBusinesses = useCallback(async () => {
    try {
      const list = await api.getBusinesses();
      setBusinesses(list);
      
      let initialId = localStorage.getItem('selectedBusinessId');
      // If there is no stored business, or it's not in the loaded list, choose the first one
      if (!initialId || !list.some(b => b.id === initialId)) {
        if (list.length > 0) {
          initialId = list[0].id;
          localStorage.setItem('selectedBusinessId', initialId);
        } else {
          initialId = '';
        }
      }
      setSelectedBusinessId(initialId);
    } catch (err) {
      console.error('Failed to load businesses:', err.message);
    }
  }, []);

  const refreshStats = useCallback(async () => {
    if (!selectedBusinessId) return;
    try {
      const s = await api.getStats();
      setStats(s);
      setOpenTickets(s.openTickets || 0);
    } catch { /* backend not connected yet */ }
  }, [selectedBusinessId]);

  // Load businesses on mount
  useEffect(() => {
    loadBusinesses();
  }, [loadBusinesses]);

  // Refresh stats when active business changes or on interval
  useEffect(() => {
    if (!selectedBusinessId) return;
    refreshStats();
    const t = setInterval(refreshStats, 30_000); // refresh every 30s
    return () => clearInterval(t);
  }, [selectedBusinessId, refreshStats]);

  const handleBusinessChange = (businessId) => {
    setSelectedBusinessId(businessId);
    localStorage.setItem('selectedBusinessId', businessId);
    // Reload state/stats
    refreshStats();
  };

  const PageComponent = {
    overview:      Overview,
    pipeline:      Pipeline,
    chats:         Chats,
    reservations:  Reservations,
    tickets:       Tickets,
    'auto-replies': AutoReplies,
    businesses:    Businesses,
  }[page];

  return (
    <div className="app-layout">
      {/* ── Sidebar ── */}
      <nav className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon">⚡</div>
          <span>BusinessFlow AI</span>
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
          BusinessFlow AI v1.0<br />
          <span style={{ color: 'var(--green)' }}>● Platform Connected</span>
        </div>
      </nav>

      {/* ── Main Content ── */}
      <main className="main-content">
        <div className="topbar">
          <div>
            <div className="topbar-title">
              {NAV.find(n => n.id === page)?.icon} {NAV.find(n => n.id === page)?.label}
            </div>
            <div className="topbar-subtitle">
              {selectedBusinessId 
                ? `Managing: ${businesses.find(b => b.id === selectedBusinessId)?.name || 'Loading...'}`
                : 'SaaS Platform Configuration'}
            </div>
          </div>
          <div className="topbar-right">
            {/* Business Dropdown Selector */}
            {businesses.length > 0 && (
              <select
                className="business-select"
                value={selectedBusinessId}
                onChange={(e) => handleBusinessChange(e.target.value)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#f0f4ff',
                  fontWeight: '600',
                  cursor: 'pointer',
                  outline: 'none',
                  marginRight: '12px',
                  fontSize: '14px',
                }}
              >
                {businesses.map(b => (
                  <option key={b.id} value={b.id} style={{ background: '#0a0f1e', color: '#f0f4ff' }}>
                    🏢 {b.name}
                  </option>
                ))}
              </select>
            )}

            {selectedBusinessId && <WaStatusWidget />}
            
            <div className="live-badge">
              <div className="live-dot" />
              Live
            </div>
            
            <button className="btn btn-ghost" onClick={() => { loadBusinesses(); refreshStats(); }}>↻ Refresh</button>
          </div>
        </div>

        <div className="page-body" style={{ paddingTop: 24 }}>
          {selectedBusinessId || page === 'businesses' ? (
            <PageComponent stats={stats} refreshStats={refreshStats} key={selectedBusinessId} />
          ) : (
            <div style={{ textAlign: 'center', padding: '64px 32px', color: 'var(--text-muted)' }}>
              <h2>Welcome to BusinessFlow AI! ⚡</h2>
              <p style={{ marginTop: '16px' }}>Please onboard or select a business from the settings tab to begin.</p>
              <button 
                className="btn btn-primary" 
                onClick={() => setPage('businesses')}
                style={{ marginTop: '24px' }}
              >
                Go to Businesses Management
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
