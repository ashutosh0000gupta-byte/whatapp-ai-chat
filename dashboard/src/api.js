// Central API client for dashboard → backend communication
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

async function apiFetch(path, options = {}) {
  const selectedBusinessId = localStorage.getItem('selectedBusinessId') || '';
  
  const headers = { 
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Inject selected business ID header for tenant isolation
  if (selectedBusinessId) {
    headers['X-Business-ID'] = selectedBusinessId;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

export const api = {
  // ── Core CRM ───────────────────────────────────────────────────
  getStats:        ()             => apiFetch('/stats'),
  getCustomers:    ()             => apiFetch('/customers'),
  getLeads:        ()             => apiFetch('/leads'),
  updateLead:      (id, data)     => apiFetch(`/leads/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getMessages:     (id)           => apiFetch(`/messages/${id}`),
  getTickets:      ()             => apiFetch('/tickets'),
  updateTicket:    (id, data)     => apiFetch(`/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getReservations: ()             => apiFetch('/reservations'),
  sendManual:      (phone, message) => apiFetch('/send-manual', { method: 'POST', body: JSON.stringify({ phone, message }) }),

  // ── Auto-Reply Rules ────────────────────────────────────────
  getAutoReplies:  ()             => apiFetch('/auto-replies'),
  createAutoReply: (data)         => apiFetch('/auto-replies', { method: 'POST', body: JSON.stringify(data) }),
  updateAutoReply: (id, data)     => apiFetch(`/auto-replies/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteAutoReply: (id)           => apiFetch(`/auto-replies/${id}`, { method: 'DELETE' }),

  // ── Contact Modes ────────────────────────────────────────────
  getContactMode:  (phone)        => apiFetch(`/contact-mode/${encodeURIComponent(phone)}`),
  setContactMode:  (phone, mode)  => apiFetch('/contact-mode', { method: 'POST', body: JSON.stringify({ phone, mode }) }),

  // ── AI Preview ───────────────────────────────────────────────
  getAiPreview:    (phone, message, customerId) =>
    apiFetch('/ai-preview', { method: 'POST', body: JSON.stringify({ phone, message, customerId }) }),

  // ── Business Tenants Management ──────────────────────────────
  getBusinesses:   ()             => apiFetch('/businesses'),
  getBusiness:     (id)           => apiFetch(`/businesses/${id}`),
  createBusiness:  (data)         => apiFetch('/businesses', { method: 'POST', body: JSON.stringify(data) }),
  updateBusiness:  (id, data)     => apiFetch(`/businesses/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteBusiness:  (id)           => apiFetch(`/businesses/${id}`, { method: 'DELETE' }),
  getBusinessQr:   (id)           => apiFetch(`/businesses/${id}/qr`),
};
