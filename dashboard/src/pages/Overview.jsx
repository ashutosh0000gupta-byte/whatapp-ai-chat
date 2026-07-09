import { useState, useEffect } from 'react';
import { api } from '../api';

export default function Overview({ stats }) {
  const pipeline = stats?.pipeline || {};
  const total    = stats?.totalCustomers || 0;
  const reserved = stats?.confirmedReservations || 0;
  const tickets  = stats?.openTickets || 0;
  const converted = pipeline.converted || 0;
  const convRate  = total > 0 ? Math.round((converted / total) * 100) : 0;

  const kpis = [
    { label: 'Total Customers',  value: total,    icon: '👥', color: 'green' },
    { label: 'Conversion Rate',  value: `${convRate}%`, icon: '📈', color: 'blue' },
    { label: 'Confirmed Tables', value: reserved,  icon: '🍽️', color: 'purple' },
    { label: 'Open Tickets',     value: tickets,   icon: '🎫', color: 'orange' },
  ];

  return (
    <>
      {/* KPI Cards */}
      <div className="kpi-grid">
        {kpis.map(k => (
          <div key={k.label} className={`kpi-card ${k.color}`}>
            <div className="kpi-icon">{k.icon}</div>
            <div className="kpi-value">{k.value ?? '—'}</div>
            <div className="kpi-label">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Pipeline Summary */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Lead Pipeline Summary</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
          {[
            { stage: 'new',       label: '🆕 New',       color: 'var(--blue)' },
            { stage: 'qualified', label: '🔥 Qualified',  color: 'var(--orange)' },
            { stage: 'converted', label: '✅ Converted',  color: 'var(--green)' },
            { stage: 'lost',      label: '❌ Lost',       color: 'var(--red)' },
          ].map(s => (
            <div key={s.stage} style={{
              background: 'rgba(255,255,255,0.04)',
              border: `1px solid rgba(255,255,255,0.07)`,
              borderRadius: 10, padding: '14px 16px', textAlign: 'center'
            }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>
                {pipeline[s.stage] || 0}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Tips */}
      <div style={{ marginTop: 16 }} className="card">
        <div className="card-header">
          <span className="card-title">🚀 Quick Actions</span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            '💬 Reply to new chats',
            '🍽️ Confirm pending reservations',
            '🎫 Resolve open tickets',
            '🔔 Check due reminders',
          ].map(tip => (
            <div key={tip} style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid var(--border)',
              borderRadius: 8, padding: '8px 14px',
              fontSize: 12, color: 'var(--text-secondary)'
            }}>{tip}</div>
          ))}
        </div>
      </div>
    </>
  );
}
