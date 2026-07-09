import { useState, useEffect } from 'react';
import { api } from '../api';

const STAGES = ['new', 'qualified', 'converted', 'lost'];
const STAGE_LABELS = {
  new:       { label: '🆕 New',       cls: 'stage-new' },
  qualified: { label: '🔥 Qualified',  cls: 'stage-qualified' },
  converted: { label: '✅ Converted',  cls: 'stage-converted' },
  lost:      { label: '❌ Lost',       cls: 'stage-lost' },
};

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function Pipeline() {
  const [leads, setLeads]     = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try { setLeads(await api.getLeads()); }
    catch { /* backend offline */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const byStage = STAGES.reduce((acc, s) => {
    acc[s] = leads.filter(l => l.stage === s);
    return acc;
  }, {});

  const moveStage = async (lead, newStage) => {
    try {
      await api.updateLead(lead.id, { stage: newStage });
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, stage: newStage } : l));
    } catch {}
  };

  if (loading) return <div className="spinner" />;

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {leads.length} leads total
        </div>
        <button className="btn btn-ghost" onClick={load}>↻ Refresh</button>
      </div>

      <div className="pipeline-grid">
        {STAGES.map(stage => {
          const col = byStage[stage];
          const { label, cls } = STAGE_LABELS[stage];
          return (
            <div key={stage} className={`pipeline-col ${cls}`}>
              <div className="pipeline-col-header">
                <span className="pipeline-col-title">{label}</span>
                <span className="stage-count">{col.length}</span>
              </div>

              {col.length === 0 && (
                <div className="empty-state" style={{ padding: '20px 0' }}>
                  <div style={{ fontSize: 24 }}>🫙</div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>Empty</div>
                </div>
              )}

              {col.map(lead => (
                <div key={lead.id} className="lead-card">
                  <div className="lead-name">
                    {lead.customers?.name || 'Unknown'}
                  </div>
                  <div className="lead-phone">{lead.customers?.phone}</div>
                  {lead.interest && (
                    <div className="lead-interest">💬 {lead.interest}</div>
                  )}
                  <div className="lead-time">{timeAgo(lead.last_activity)}</div>

                  {/* Stage quick-move */}
                  <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {STAGES.filter(s => s !== stage).map(s => (
                      <button
                        key={s}
                        onClick={() => moveStage(lead, s)}
                        style={{
                          fontSize: 10, padding: '2px 7px',
                          borderRadius: 99, cursor: 'pointer',
                          background: 'rgba(255,255,255,0.06)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          color: 'var(--text-secondary)',
                        }}
                      >→ {s}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
