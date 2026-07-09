/**
 * Local JSON Database File-Store (Alternative to Supabase)
 * Saves all data to a local `db.json` file in the project root.
 * Works 100% offline and locally without credentials.
 */

const fs   = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '../../db.json');

// ── In-Memory Database Structure ─────────────────────────────
let db = {
  customers:    [],
  leads:        [],
  reservations: [],
  orders:       [],
  tickets:      [],
  messages:     [],
  reminders:    [],
  autoReplies:  [],
  contactModes: {}, // { [phone]: 'ai' | 'manual' }
};

// ── Load database from file on boot ──────────────────────────
function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      db = { ...db, ...JSON.parse(raw) };
    } else {
      saveDb();
    }
  } catch (e) {
    console.error('[LocalDB] Error loading db.json:', e.message);
  }
}

// ── Save database to file ────────────────────────────────────
function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error('[LocalDB] Error saving db.json:', e.message);
  }
}

// Helper to generate UUID
function uuid() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Initialize on load
loadDb();

// ══════════════════════════════════════════════════════════════
//  CUSTOMER
// ══════════════════════════════════════════════════════════════

async function upsertCustomer(phone, name = null) {
  let customer = db.customers.find(c => c.phone === phone);

  if (customer) {
    if (name && !customer.name) {
      customer.name = name;
      customer.updated_at = new Date().toISOString();
      saveDb();
    }
    return { customer, isNew: false };
  }

  // Create new customer
  customer = {
    id: uuid(),
    phone,
    name,
    language: 'en',
    preferred_time: null,
    dietary_prefs: [],
    visit_count: 0,
    total_spent: 0,
    loyalty_points: 0,
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  db.customers.push(customer);

  // Create lead record
  const lead = {
    id: uuid(),
    customer_id: customer.id,
    stage: 'new',
    source: 'whatsapp',
    interest: null,
    follow_up_at: null,
    last_activity: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
  db.leads.push(lead);

  saveDb();
  return { customer, isNew: true };
}

async function updateCustomer(customerId, fields) {
  const customer = db.customers.find(c => c.id === customerId);
  if (customer) {
    Object.assign(customer, fields);
    customer.updated_at = new Date().toISOString();
    saveDb();
  }
  return customer;
}

// ══════════════════════════════════════════════════════════════
//  LEAD PIPELINE
// ══════════════════════════════════════════════════════════════

async function updateLeadStage(customerId, stage, interest = null) {
  const lead = db.leads.find(l => l.customer_id === customerId);
  if (lead) {
    lead.stage = stage;
    if (interest) lead.interest = interest;
    lead.last_activity = new Date().toISOString();
    saveDb();
  }
}

async function updateLeadById(leadId, fields) {
  const lead = db.leads.find(l => l.id === leadId);
  if (lead) {
    Object.assign(lead, fields);
    saveDb();
  }
  return lead;
}

async function getLeadByCustomer(customerId) {
  return db.leads.find(l => l.customer_id === customerId) || null;
}

// ══════════════════════════════════════════════════════════════
//  MESSAGES
// ══════════════════════════════════════════════════════════════

async function logMessage({ customerId, direction, content, intent, waMessageId, aiResponse }) {
  const msg = {
    id: uuid(),
    customer_id: customerId,
    direction,
    content,
    intent: intent || null,
    wa_message_id: waMessageId || null,
    ai_response: aiResponse || null,
    created_at: new Date().toISOString(),
  };
  db.messages.push(msg);
  saveDb();
  return msg;
}

async function getMessageHistory(customerId, limit = 10) {
  const msgs = db.messages
    .filter(m => m.customer_id === customerId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return msgs.slice(0, limit).reverse();
}

// ══════════════════════════════════════════════════════════════
//  RESERVATIONS
// ══════════════════════════════════════════════════════════════

async function createReservation(customerId, details) {
  const res = {
    id: uuid(),
    customer_id: customerId,
    party_size: details.party_size || 1,
    reserved_date: details.reserved_date || new Date().toISOString().split('T')[0],
    reserved_time: details.reserved_time || '19:00:00',
    table_number: details.table_number || null,
    occasion: details.occasion || null,
    special_notes: details.special_notes || null,
    status: details.status || 'pending',
    reminder_sent: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  db.reservations.push(res);

  // Auto-schedule reminder
  if (details.reserved_date && details.reserved_time) {
    const dt = new Date(`${details.reserved_date}T${details.reserved_time}`);
    dt.setHours(dt.getHours() - 2);
    await createReminder({
      customerId,
      reservationId: res.id,
      message: `Reminder: Your table is booked for ${details.reserved_time} today at ${process.env.RESTAURANT_NAME || 'RestoCRM'}. See you soon! 🍽️`,
      scheduledAt: dt.toISOString(),
    });
  }

  saveDb();
  return res;
}

async function updateReservation(reservationId, fields) {
  const res = db.reservations.find(r => r.id === reservationId);
  if (res) {
    Object.assign(res, fields);
    res.updated_at = new Date().toISOString();
    saveDb();
  }
  return res;
}

async function getReservationsByCustomer(customerId) {
  return db.reservations
    .filter(r => r.customer_id === customerId)
    .sort((a, b) => new Date(b.reserved_date) - new Date(a.reserved_date));
}

async function getAllReservations() {
  return db.reservations
    .sort((a, b) => new Date(a.reserved_date) - new Date(b.reserved_date))
    .map(r => ({
      ...r,
      customers: db.customers.find(c => c.id === r.customer_id) || null,
    }));
}

// ══════════════════════════════════════════════════════════════
//  ORDERS
// ══════════════════════════════════════════════════════════════

async function createOrder(customerId, details) {
  const order = {
    id: uuid(),
    customer_id: customerId,
    order_type: details.order_type || 'dine-in',
    items: details.items || [],
    total_amount: details.total_amount || 0,
    status: details.status || 'received',
    payment_status: details.payment_status || 'pending',
    payment_link: details.payment_link || null,
    delivery_addr: details.delivery_addr || null,
    lead_stage: details.lead_stage || 'qualified',
    metadata: details.metadata || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.orders.push(order);
  saveDb();
  return order;
}

async function updateOrder(orderId, fields) {
  const order = db.orders.find(o => o.id === orderId);
  if (order) {
    Object.assign(order, fields);
    order.updated_at = new Date().toISOString();
    saveDb();
  }
  return order;
}

// ══════════════════════════════════════════════════════════════
//  TICKETS
// ══════════════════════════════════════════════════════════════

async function createTicket(customerId, { issue, category = 'general', priority = 'normal' }) {
  const ticket = {
    id: uuid(),
    customer_id: customerId,
    issue,
    category,
    status: 'open',
    priority,
    assigned_to: null,
    resolution: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.tickets.push(ticket);
  saveDb();
  return ticket;
}

async function updateTicket(ticketId, fields) {
  const ticket = db.tickets.find(t => t.id === ticketId);
  if (ticket) {
    Object.assign(ticket, fields);
    ticket.updated_at = new Date().toISOString();
    saveDb();
  }
  return ticket;
}

// ══════════════════════════════════════════════════════════════
//  REMINDERS
// ══════════════════════════════════════════════════════════════

async function createReminder({ customerId, reservationId = null, message, scheduledAt }) {
  const rem = {
    id: uuid(),
    customer_id: customerId,
    reservation_id: reservationId,
    message,
    scheduled_at: scheduledAt,
    sent: false,
    sent_at: null,
    created_at: new Date().toISOString(),
  };
  db.reminders.push(rem);
  saveDb();
}

async function getPendingReminders() {
  const now = new Date().toISOString();
  return db.reminders
    .filter(r => !r.sent && r.scheduled_at <= now)
    .map(r => {
      const customer = db.customers.find(c => c.id === r.customer_id);
      return { ...r, customers: customer };
    });
}

async function markReminderSent(reminderId) {
  const rem = db.reminders.find(r => r.id === reminderId);
  if (rem) {
    rem.sent = true;
    rem.sent_at = new Date().toISOString();
    saveDb();
  }
}

// ══════════════════════════════════════════════════════════════
//  DASHBOARD QUERIES
// ══════════════════════════════════════════════════════════════

async function getDashboardStats() {
  const pipeline = { new: 0, qualified: 0, converted: 0, lost: 0 };
  db.leads.forEach(l => {
    if (pipeline[l.stage] !== undefined) {
      pipeline[l.stage]++;
    }
  });

  return {
    totalCustomers: db.customers.length,
    pipeline,
    confirmedReservations: db.reservations.filter(r => r.status === 'confirmed').length,
    openTickets: db.tickets.filter(t => t.status === 'open' || t.status === 'escalated').length,
  };
}

async function getAllCustomersWithLeads() {
  return db.customers.map(c => {
    const lead = db.leads.find(l => l.customer_id === c.id);
    return {
      ...c,
      leads: lead ? { stage: lead.stage, interest: lead.interest, last_activity: lead.last_activity } : null,
    };
  });
}

async function getAllTickets() {
  return db.tickets.map(t => {
    const customer = db.customers.find(c => c.id === t.customer_id);
    return { ...t, customers: customer };
  });
}

async function getAllLeads() {
  return db.leads.map(l => {
    const customer = db.customers.find(c => c.id === l.customer_id);
    return { ...l, customers: customer };
  });
}

// ══════════════════════════════════════════════════════════════
//  AUTO-REPLY RULES
// ══════════════════════════════════════════════════════════════

async function getAllAutoReplies() {
  return db.autoReplies;
}

async function createAutoReply({ keyword, response, enabled = true, matchType = 'contains' }) {
  const rule = {
    id: uuid(),
    keyword: keyword.trim().toLowerCase(),
    response,
    enabled,
    matchType, // 'contains' | 'exact' | 'startsWith'
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.autoReplies.push(rule);
  saveDb();
  return rule;
}

async function updateAutoReply(ruleId, fields) {
  const rule = db.autoReplies.find(r => r.id === ruleId);
  if (rule) {
    Object.assign(rule, fields);
    if (fields.keyword) rule.keyword = fields.keyword.trim().toLowerCase();
    rule.updated_at = new Date().toISOString();
    saveDb();
  }
  return rule;
}

async function deleteAutoReply(ruleId) {
  const idx = db.autoReplies.findIndex(r => r.id === ruleId);
  if (idx !== -1) {
    db.autoReplies.splice(idx, 1);
    saveDb();
    return true;
  }
  return false;
}

/**
 * Match incoming message text against all enabled auto-reply rules.
 * Returns the matched rule's response, or null if no match.
 */
function matchAutoReply(text) {
  const lower = text.toLowerCase().trim();
  const enabled = db.autoReplies.filter(r => r.enabled);
  for (const rule of enabled) {
    const kw = rule.keyword;
    const matched =
      rule.matchType === 'exact'      ? lower === kw :
      rule.matchType === 'startsWith' ? lower.startsWith(kw) :
                                        lower.includes(kw); // default: contains
    if (matched) return rule.response;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
//  CONTACT MODES  (ai | manual)
// ══════════════════════════════════════════════════════════════

function getContactMode(phone) {
  return db.contactModes[phone] || 'ai';
}

function setContactMode(phone, mode) {
  if (!['ai', 'manual'].includes(mode)) throw new Error('Invalid mode');
  db.contactModes[phone] = mode;
  saveDb();
}

module.exports = {
  upsertCustomer, updateCustomer,
  updateLeadStage, updateLeadById, getLeadByCustomer,
  logMessage, getMessageHistory,
  createReservation, updateReservation, getReservationsByCustomer, getAllReservations,
  createOrder, updateOrder,
  createTicket, updateTicket,
  createReminder, getPendingReminders, markReminderSent,
  getDashboardStats, getAllCustomersWithLeads, getAllTickets, getAllLeads,
  getAllAutoReplies, createAutoReply, updateAutoReply, deleteAutoReply, matchAutoReply,
  getContactMode, setContactMode,
};
