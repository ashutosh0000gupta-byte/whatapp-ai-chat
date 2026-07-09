// Central API client for dashboard → backend communication
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

export const api = {
  // ── Core ───────────────────────────────────────────────────
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
};
