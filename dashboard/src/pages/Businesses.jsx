import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

export default function Businesses() {
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingBiz, setEditingBiz] = useState(null); // holds biz object being created/edited
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // QR scanner modal state
  const [qrBiz, setQrBiz] = useState(null);
  const [qrData, setQrData] = useState(null);
  const [qrIntervalId, setQrIntervalId] = useState(null);

  const fetchBusinesses = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.getBusinesses();
      setBusinesses(list);
    } catch (err) {
      console.error('Error fetching businesses:', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBusinesses();
  }, [fetchBusinesses]);

  // Handle QR polling
  const pollQrStatus = useCallback(async (bizId) => {
    try {
      const data = await api.getBusinessQr(bizId);
      setQrData(data);
      if (data.connected) {
        // Connected! Reload businesses to show status and stop polling
        fetchBusinesses();
        // Don't clear completely so user sees "connected" checkmark in QR modal
      }
    } catch (err) {
      console.error('Error polling QR status:', err.message);
    }
  }, [fetchBusinesses]);

  const openQrModal = (biz) => {
    setQrBiz(biz);
    setQrData(null);
    setIsModalOpen(false); // close form modal
    
    // Initial fetch
    pollQrStatus(biz.id);
    
    // Poll every 4 seconds
    const interval = setInterval(() => {
      pollQrStatus(biz.id);
    }, 4000);
    setQrIntervalId(interval);
  };

  const closeQrModal = () => {
    if (qrIntervalId) {
      clearInterval(qrIntervalId);
      setQrIntervalId(null);
    }
    setQrBiz(null);
    setQrData(null);
  };

  useEffect(() => {
    return () => {
      if (qrIntervalId) clearInterval(qrIntervalId);
    };
  }, [qrIntervalId]);

  const handleOpenForm = (biz = null) => {
    if (biz) {
      setEditingBiz({ ...biz });
    } else {
      setEditingBiz({
        name: '',
        wa_phone_number: '',
        workflow_name: '',
        ai_system_prompt: '',
        knowledge_base: '',
        subscription_plan: 'free',
        status: 'active',
      });
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (editingBiz.id) {
        await api.updateBusiness(editingBiz.id, editingBiz);
      } else {
        await api.createBusiness(editingBiz);
      }
      setIsModalOpen(false);
      setEditingBiz(null);
      fetchBusinesses();
      // Reload page to refresh dropdown
      window.location.reload();
    } catch (err) {
      alert('Error saving business: ' + err.message);
    }
  };

  const handleDelete = async (bizId) => {
    if (!confirm('Are you sure you want to delete this business? All associated CRM data, WhatsApp sessions, and messages will be permanently deleted.')) return;
    try {
      await api.deleteBusiness(bizId);
      fetchBusinesses();
      window.location.reload();
    } catch (err) {
      alert('Error deleting business: ' + err.message);
    }
  };

  return (
    <div className="businesses-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: '#f0f4ff' }}>Business Onboarding & Settings</h2>
          <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 4 }}>Manage multiple clients, configure their n8n flows, and link WhatsApp devices.</p>
        </div>
        <button className="btn btn-primary" onClick={() => handleOpenForm()}>➕ Onboard Business</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 64, color: '#94a3b8' }}>Loading onboarded businesses...</div>
      ) : businesses.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 64 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🏢</div>
          <h3 style={{ color: '#f0f4ff', fontSize: 18 }}>No Businesses Onboarded Yet</h3>
          <p style={{ color: '#94a3b8', marginTop: 8, maxWidth: 400, margin: '8px auto' }}>Onboard your first client business. You can then scan their QR code to link their WhatsApp line.</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => handleOpenForm()}>Onboard Now</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 20 }}>
          {businesses.map(biz => (
            <div className="card" key={biz.id} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                  <div>
                    <h3 style={{ color: '#f0f4ff', fontSize: 18, fontWeight: 600 }}>{biz.name}</h3>
                    <span style={{ 
                      display: 'inline-block', 
                      marginTop: 6, 
                      padding: '2px 8px', 
                      borderRadius: 4, 
                      fontSize: 11, 
                      fontWeight: 700,
                      background: biz.subscription_plan === 'free' ? 'rgba(148, 163, 184, 0.15)' : 'rgba(37, 211, 102, 0.15)',
                      color: biz.subscription_plan === 'free' ? '#94a3b8' : '#25D366'
                    }}>
                      {biz.subscription_plan.toUpperCase()} PLAN
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost" onClick={() => handleOpenForm(biz)} style={{ padding: '6px 10px', fontSize: 12 }}>✏️ Edit</button>
                    <button className="btn btn-ghost" onClick={() => handleDelete(biz.id)} style={{ padding: '6px 10px', fontSize: 12, color: '#f56565' }}>🗑️ Delete</button>
                  </div>
                </div>

                <div style={{ fontSize: 13, color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                  <div>📞 <strong style={{ color: '#f0f4ff' }}>WA Phone:</strong> {biz.wa_phone_number}</div>
                  <div>🔗 <strong style={{ color: '#f0f4ff' }}>n8n Webhook:</strong> {biz.workflow_name ? `/webhook/${biz.workflow_name}` : 'Not Assigned'}</div>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    🤖 <strong style={{ color: '#f0f4ff' }}>Prompt:</strong> {biz.ai_system_prompt || 'Generic AI instruction'}
                  </div>
                </div>
              </div>

              {/* WhatsApp Connection status card segment */}
              <div style={{ 
                marginTop: 20, 
                padding: '12px 16px', 
                borderRadius: 10, 
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ 
                    width: 10, 
                    height: 10, 
                    borderRadius: '50%', 
                    background: biz.status === 'active' ? '#25d366' : '#a0aec0',
                    boxShadow: biz.status === 'active' ? '0 0 8px #25d366' : 'none'
                  }} />
                  <span style={{ fontSize: 13, color: '#f0f4ff' }}>WhatsApp Session</span>
                </div>
                
                <button 
                  className="btn btn-ghost"
                  onClick={() => openQrModal(biz)}
                  style={{ 
                    padding: '6px 14px', 
                    fontSize: 12, 
                    background: 'rgba(37,211,102,0.08)', 
                    border: '1px solid rgba(37,211,102,0.2)',
                    color: '#25d366',
                    borderRadius: 6
                  }}
                >
                  Link WhatsApp
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── ONBOARDING / CONFIG MODAL ── */}
      {isModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 540, padding: 28, position: 'relative' }}>
            <h3 style={{ fontSize: 20, fontWeight: 700, color: '#f0f4ff', marginBottom: 20 }}>
              {editingBiz.id ? 'Edit Business Configuration' : 'Onboard New Business'}
            </h3>
            
            <form onSubmit={handleSave}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: '#94a3b8' }}>Business Name *</label>
                  <input 
                    type="text" required placeholder="FixMasterz"
                    value={editingBiz.name}
                    onChange={e => setEditingBiz({ ...editingBiz, name: e.target.value })}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: '#070a13', color: '#f0f4ff', outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: '#94a3b8' }}>WhatsApp Number *</label>
                  <input 
                    type="text" required placeholder="+919876543210"
                    value={editingBiz.wa_phone_number}
                    onChange={e => setEditingBiz({ ...editingBiz, wa_phone_number: e.target.value })}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: '#070a13', color: '#f0f4ff', outline: 'none' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: '#94a3b8' }}>n8n Webhook Name</label>
                  <input 
                    type="text" placeholder="service-center"
                    value={editingBiz.workflow_name || ''}
                    onChange={e => setEditingBiz({ ...editingBiz, workflow_name: e.target.value })}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: '#070a13', color: '#f0f4ff', outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: '#94a3b8' }}>Subscription Plan</label>
                  <select 
                    value={editingBiz.subscription_plan}
                    onChange={e => setEditingBiz({ ...editingBiz, subscription_plan: e.target.value })}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: '#070a13', color: '#f0f4ff', outline: 'none' }}
                  >
                    <option value="free">Free Trial</option>
                    <option value="starter">Starter</option>
                    <option value="growth">Growth</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: '#94a3b8' }}>AI System instruction Prompt</label>
                <textarea 
                  rows="3" placeholder="You are a customer support assistant for FixMasterz, an electronics repair company. Be concise, greet clients by name..."
                  value={editingBiz.ai_system_prompt || ''}
                  onChange={e => setEditingBiz({ ...editingBiz, ai_system_prompt: e.target.value })}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: '#070a13', color: '#f0f4ff', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: '#94a3b8' }}>Business Knowledge Base</label>
                <textarea 
                  rows="3" placeholder="Add menu details, hospital services list, or working hours FAQ information here..."
                  value={editingBiz.knowledge_base || ''}
                  onChange={e => setEditingBiz({ ...editingBiz, knowledge_base: e.target.value })}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: '#070a13', color: '#f0f4ff', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button type="button" className="btn btn-ghost" onClick={() => { setIsModalOpen(false); setEditingBiz(null); }}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Configuration</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── WHATSAPP QR LINK MODAL ── */}
      {qrBiz && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 440, padding: 32, textAlign: 'center', position: 'relative' }}>
            <button 
              onClick={closeQrModal}
              style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer' }}
            >
              ✕
            </button>
            <div style={{ fontSize: 42, marginBottom: 12 }}>📱</div>
            <h3 style={{ fontSize: 20, fontWeight: 700, color: '#f0f4ff' }}>Link {qrBiz.name} WhatsApp</h3>
            <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 8 }}>Scope: {qrBiz.wa_phone_number}</p>

            <div style={{ margin: '24px 0', minHeight: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
              {qrData ? (
                qrData.connected ? (
                  <div style={{ padding: 20 }}>
                    <div style={{ fontSize: 52 }}>🟢</div>
                    <h4 style={{ color: '#25D366', marginTop: 12, fontSize: 18, fontWeight: 700 }}>WhatsApp Linked!</h4>
                    <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 8 }}>
                      Successfully authenticated as:<br />
                      <strong style={{ color: '#f0f4ff' }}>{qrData.info?.name}</strong> (+{qrData.info?.phone})
                    </p>
                    <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={closeQrModal}>Done</button>
                  </div>
                ) : qrData.qr ? (
                  <div>
                    <img src={qrData.qr} alt="WhatsApp QR Code" style={{ border: '4px solid #25D366', borderRadius: 8, display: 'block', margin: '0 auto 12px auto' }} width="230" />
                    <p style={{ color: '#94a3b8', fontSize: 12 }}>Scan this QR code from WhatsApp Link a Device</p>
                  </div>
                ) : (
                  <div style={{ color: '#94a3b8' }}>
                    <div style={{ fontSize: 24, animation: 'spin 1.5s linear infinite', display: 'inline-block' }}>🔄</div>
                    <p style={{ marginTop: 12 }}>Generating connection session...</p>
                  </div>
                )
              ) : (
                <div style={{ color: '#94a3b8' }}>Requesting connection status...</div>
              )}
            </div>

            <div style={{ textAlign: 'left', fontSize: 12, color: '#94a3b8', background: 'rgba(37,211,102,0.04)', border: '1px solid rgba(37,211,102,0.1)', padding: '12px 16px', borderRadius: 8 }}>
              1️⃣ Open WhatsApp on the business phone.<br />
              2️⃣ Tap Link a Device under Settings/Linked Devices.<br />
              3️⃣ Scan this QR code. The session will connect automatically.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
