import { useState, useEffect } from 'react';
import { api } from '../api';

// Add to api.js exports (inline here for simplicity)
async function getWaStatus() {
  const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000/api'}/wa-status`);
  if (!res.ok) throw new Error('Cannot reach backend');
  return res.json();
}

export default function WaStatusWidget() {
  const [status, setStatus] = useState(null);
  const [error,  setError]  = useState(false);

  const refresh = async () => {
    try {
      const s = await getWaStatus();
      setStatus(s);
      setError(false);
    } catch {
      setError(true);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000); // poll every 5s
    return () => clearInterval(t);
  }, []);

  if (error) return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: 'rgba(252,129,129,0.1)', border: '1px solid rgba(252,129,129,0.25)',
      borderRadius: 8, padding: '7px 14px', fontSize: 12, color: 'var(--red)',
    }}>
      ⚠️ Backend offline — run <code style={{ background: 'rgba(255,255,255,.08)', padding: '1px 6px', borderRadius: 4 }}>npm run dev</code>
    </div>
  );

  if (!status) return null;

  if (status.connected) return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: 'rgba(37,211,102,0.1)', border: '1px solid rgba(37,211,102,0.25)',
      borderRadius: 8, padding: '7px 14px', fontSize: 12, color: 'var(--green)',
    }}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 6px var(--green)' }} />
      📱 {status.info?.name ? `${status.info.name} (+${status.info.phone})` : 'WhatsApp Connected'}
    </div>
  );

  // QR not ready yet / initializing
  if (!status.qrReady) return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: 'rgba(99,179,237,0.1)', border: '1px solid rgba(99,179,237,0.25)',
      borderRadius: 8, padding: '7px 14px', fontSize: 12, color: 'var(--blue)',
    }}>
      ⏳ WhatsApp starting...
    </div>
  );

  // QR ready — show scan button
  return (
    <a
      href="http://localhost:3000/qr"
      target="_blank"
      rel="noreferrer"
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'rgba(246,173,85,0.1)', border: '1px solid rgba(246,173,85,0.3)',
        borderRadius: 8, padding: '7px 14px', fontSize: 12, color: 'var(--orange)',
        textDecoration: 'none', cursor: 'pointer',
        animation: 'pulse-border 1.5s infinite',
      }}
    >
      📷 Scan QR to Connect WhatsApp →
    </a>
  );
}
