/**
 * Local JSON Database File-Store (Alternative to Supabase)
 * Saves all data to a local `db.json` file in the project root.
 * Scoped by business_id (Multi-Tenant SaaS).
 */

const fs   = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '../../db.json');

// ── In-Memory Database Structure ─────────────────────────────
let db = {
  businesses:        [],
  whatsapp_sessions:  [],
  customers:         [],
  leads:             [],
  reservations:      [],
  orders:            [],
  tickets:           [],
  messages:          [],
  reminders:         [],
  autoReplies:       [],
};

// ── Load database from file on boot ──────────────────────────
function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      db = { ...db, ...JSON.parse(raw) };
      migrateToMultiTenant();
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

// ── Retroactive Schema Migration ─────────────────────────────
function migrateToMultiTenant() {
  let modified = false;

  // Initialize new arrays
  if (!db.businesses) {
    db.businesses = [];
    modified = true;
  }
  if (!db.whatsapp_sessions) {
    db.whatsapp_sessions = [];
    modified = true;
  }
  if (!db.autoReplies) {
    db.autoReplies = [];
    modified = true;
  }

  // Create default business if none exists
  const defaultId = 'default-business-id';
  if (db.businesses.length === 0) {
    db.businesses.push({
      id: defaultId,
      name: process.env.RESTAURANT_NAME || 'Default Restaurant',
      wa_phone_number: process.env.RESTAURANT_PHONE || '+919999999999',
      workflow_name: 'restaurant',
      ai_system_prompt: `You are an AI-powered WhatsApp CRM assistant. Help customers with table reservations, menu inquiries, delivery/takeaway orders, feedback, and support.`,
      knowledge_base: '',
      working_hours: {},
      subscription_plan: 'free',
      status: 'active',
      crm_settings: {},
      memory_settings: {},
      payment_config: {},
      api_keys: {},
      feature_flags: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    modified = true;
  }

  // Set default business_id on existing customers
  if (db.customers) {
    db.customers.forEach(c => {
      if (!c.business_id) {
        c.business_id = defaultId;
        modified = true;
      }
      if (!c.contact_mode) {
        c.contact_mode = 'ai';
        modified = true;
      }
    });

    // Migrate old db.contactModes to customers
    if (db.contactModes) {
      for (const [phone, mode] of Object.entries(db.contactModes)) {
        const customer = db.customers.find(c => c.phone === phone);
        if (customer) {
          customer.contact_mode = mode;
          modified = true;
        }
      }
      delete db.contactModes;
      modified = true;
    }
  }

  // Set default business_id on all other records
  const tables = ['leads', 'reservations', 'orders', 'tickets', 'messages', 'reminders', 'autoReplies'];
  tables.forEach(table => {
    if (db[table]) {
      db[table].forEach(item => {
        if (!item.business_id) {
          item.business_id = defaultId;
          modified = true;
        }
      });
    }
  });

  if (modified) {
    console.log('[LocalDB] 🛠️ Auto-migrated database schema to multi-tenant.');
    saveDb();
  }
}

// Initialize on boot
loadDb();

// ══════════════════════════════════════════════════════════════
//  BUSINESS MANAGEMENT
// ══════════════════════════════════════════════════════════════

async function getAllBusinesses() {
  return db.businesses;
}

async function getBusinessById(businessId) {
  return db.businesses.find(b => b.id === businessId) || null;
}

async function getBusinessByPhone(phone) {
  const normalized = phone.replace(/^\+/, '').trim();
  return db.businesses.find(b => {
    const bPhone = b.wa_phone_number.replace(/^\+/, '').trim();
    return bPhone === normalized;
  }) || null;
}

async function createBusiness(data) {
  const business = {
    id: uuid(),
    name: data.name,
    wa_phone_number: data.wa_phone_number,
    workflow_name: data.workflow_name || null,
    ai_system_prompt: data.ai_system_prompt || '',
    knowledge_base: data.knowledge_base || '',
    working_hours: data.working_hours || {},
    subscription_plan: data.subscription_plan || 'free',
    status: data.status || 'active',
    crm_settings: data.crm_settings || {},
    memory_settings: data.memory_settings || {},
    payment_config: data.payment_config || {},
    api_keys: data.api_keys || {},
    feature_flags: data.feature_flags || {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.businesses.push(business);
  saveDb();
  return business;
}

async function updateBusiness(businessId, fields) {
  const business = db.businesses.find(b => b.id === businessId);
  if (business) {
    Object.assign(business, fields);
    business.updated_at = new Date().toISOString();
    saveDb();
  }
  return business;
}

async function deleteBusiness(businessId) {
  const idx = db.businesses.findIndex(b => b.id === businessId);
  if (idx !== -1) {
    db.businesses.splice(idx, 1);
    // Cascade delete related records
    const tables = ['customers', 'leads', 'reservations', 'orders', 'tickets', 'messages', 'reminders', 'autoReplies', 'whatsapp_sessions'];
    tables.forEach(table => {
      if (db[table]) {
        db[table] = db[table].filter(item => item.business_id !== businessId);
      }
    });
    saveDb();
    return true;
  }
  return false;
}

// ══════════════════════════════════════════════════════════════
//  WHATSAPP SESSION MANAGEMENT
// ══════════════════════════════════════════════════════════════

async function getSessionByBusinessId(businessId) {
  let session = db.whatsapp_sessions.find(s => s.business_id === businessId);
  if (!session) {
    session = {
      id: uuid(),
      business_id: businessId,
      phone_number: null,
      connection_status: 'disconnected',
      last_connected_time: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.whatsapp_sessions.push(session);
    saveDb();
  }
  return session;
}

async function updateSessionStatus(businessId, phoneNumber, connectionStatus) {
  const session = await getSessionByBusinessId(businessId);
  session.connection_status = connectionStatus;
  if (phoneNumber) session.phone_number = phoneNumber;
  if (connectionStatus === 'connected') {
    session.last_connected_time = new Date().toISOString();
  }
  session.updated_at = new Date().toISOString();
  saveDb();
  return session;
}

// ══════════════════════════════════════════════════════════════
//  CUSTOMER
// ══════════════════════════════════════════════════════════════

async function upsertCustomer(businessId, phone, name = null) {
  let customer = db.customers.find(c => c.business_id === businessId && c.phone === phone);

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
    business_id: businessId,
    phone,
    name,
    language: 'en',
    preferred_time: null,
    dietary_prefs: [],
    visit_count: 0,
    total_spent: 0,
    loyalty_points: 0,
    notes: null,
    contact_mode: 'ai',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  db.customers.push(customer);

  // Create lead record
  const lead = {
    id: uuid(),
    business_id: businessId,
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

async function updateCustomer(businessId, customerId, fields) {
  const customer = db.customers.find(c => c.business_id === businessId && c.id === customerId);
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

async function updateLeadStage(businessId, customerId, stage, interest = null) {
  const lead = db.leads.find(l => l.business_id === businessId && l.customer_id === customerId);
  if (lead) {
    lead.stage = stage;
    if (interest) lead.interest = interest;
    lead.last_activity = new Date().toISOString();
    saveDb();
  }
}

async function updateLeadById(businessId, leadId, fields) {
  const lead = db.leads.find(l => l.business_id === businessId && l.id === leadId);
  if (lead) {
    Object.assign(lead, fields);
    saveDb();
  }
  return lead;
}

async function getLeadByCustomer(businessId, customerId) {
  return db.leads.find(l => l.business_id === businessId && l.customer_id === customerId) || null;
}

// ══════════════════════════════════════════════════════════════
//  MESSAGES
// ══════════════════════════════════════════════════════════════

async function logMessage(businessId, { customerId, direction, content, intent, waMessageId, aiResponse }) {
  const msg = {
    id: uuid(),
    business_id: businessId,
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

async function getMessageHistory(businessId, customerId, limit = 10) {
  const msgs = db.messages
    .filter(m => m.business_id === businessId && m.customer_id === customerId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return msgs.slice(0, limit).reverse();
}

// ══════════════════════════════════════════════════════════════
//  RESERVATIONS
// ══════════════════════════════════════════════════════════════

async function createReservation(businessId, customerId, details) {
  const res = {
    id: uuid(),
    business_id: businessId,
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
    
    // Fetch business name
    const biz = await getBusinessById(businessId);
    const bizName = biz?.name || 'CRM Assistant';

    await createReminder(businessId, {
      customerId,
      reservationId: res.id,
      message: `Reminder: Your table is booked for ${details.reserved_time} today at ${bizName}. See you soon! 🍽️`,
      scheduledAt: dt.toISOString(),
    });
  }

  saveDb();
  return res;
}

async function updateReservation(businessId, reservationId, fields) {
  const res = db.reservations.find(r => r.business_id === businessId && r.id === reservationId);
  if (res) {
    Object.assign(res, fields);
    res.updated_at = new Date().toISOString();
    saveDb();
  }
  return res;
}

async function getReservationsByCustomer(businessId, customerId) {
  return db.reservations
    .filter(r => r.business_id === businessId && r.customer_id === customerId)
    .sort((a, b) => new Date(b.reserved_date) - new Date(a.reserved_date));
}

async function getAllReservations(businessId) {
  return db.reservations
    .filter(r => r.business_id === businessId)
    .sort((a, b) => new Date(a.reserved_date) - new Date(b.reserved_date))
    .map(r => ({
      ...r,
      customers: db.customers.find(c => c.id === r.customer_id) || null,
    }));
}

// ══════════════════════════════════════════════════════════════
//  ORDERS
// ══════════════════════════════════════════════════════════════

async function createOrder(businessId, customerId, details) {
  const order = {
    id: uuid(),
    business_id: businessId,
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

async function updateOrder(businessId, orderId, fields) {
  const order = db.orders.find(o => o.business_id === businessId && o.id === orderId);
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

async function createTicket(businessId, customerId, { issue, category = 'general', priority = 'normal' }) {
  const ticket = {
    id: uuid(),
    business_id: businessId,
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

async function updateTicket(businessId, ticketId, fields) {
  const ticket = db.tickets.find(t => t.business_id === businessId && t.id === ticketId);
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

async function createReminder(businessId, { customerId, reservationId = null, message, scheduledAt }) {
  const rem = {
    id: uuid(),
    business_id: businessId,
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

async function getDashboardStats(businessId) {
  const pipeline = { new: 0, qualified: 0, converted: 0, lost: 0 };
  const leads = db.leads.filter(l => l.business_id === businessId);
  leads.forEach(l => {
    if (pipeline[l.stage] !== undefined) {
      pipeline[l.stage]++;
    }
  });

  const bCustomers = db.customers.filter(c => c.business_id === businessId);
  const reservations = db.reservations.filter(r => r.business_id === businessId && r.status === 'confirmed');
  const tickets = db.tickets.filter(t => t.business_id === businessId && (t.status === 'open' || t.status === 'escalated'));

  return {
    totalCustomers: bCustomers.length,
    pipeline,
    confirmedReservations: reservations.length,
    openTickets: tickets.length,
  };
}

async function getAllCustomersWithLeads(businessId) {
  const bCustomers = db.customers.filter(c => c.business_id === businessId);
  return bCustomers.map(c => {
    const lead = db.leads.find(l => l.business_id === businessId && l.customer_id === c.id);
    return {
      ...c,
      leads: lead ? { stage: lead.stage, interest: lead.interest, last_activity: lead.last_activity } : null,
    };
  });
}

async function getAllTickets(businessId) {
  const bTickets = db.tickets.filter(t => t.business_id === businessId);
  return bTickets.map(t => {
    const customer = db.customers.find(c => c.business_id === businessId && c.id === t.customer_id);
    return { ...t, customers: customer };
  });
}

async function getAllLeads(businessId) {
  const bLeads = db.leads.filter(l => l.business_id === businessId);
  return bLeads.map(l => {
    const customer = db.customers.find(c => c.business_id === businessId && c.id === l.customer_id);
    return { ...l, customers: customer };
  });
}

// ══════════════════════════════════════════════════════════════
//  AUTO-REPLY RULES
// ══════════════════════════════════════════════════════════════

async function getAllAutoReplies(businessId) {
  return db.autoReplies.filter(r => r.business_id === businessId);
}

async function createAutoReply(businessId, { keyword, response, enabled = true, matchType = 'contains' }) {
  const rule = {
    id: uuid(),
    business_id: businessId,
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

async function updateAutoReply(businessId, ruleId, fields) {
  const rule = db.autoReplies.find(r => r.business_id === businessId && r.id === ruleId);
  if (rule) {
    Object.assign(rule, fields);
    if (fields.keyword) rule.keyword = fields.keyword.trim().toLowerCase();
    rule.updated_at = new Date().toISOString();
    saveDb();
  }
  return rule;
}

async function deleteAutoReply(businessId, ruleId) {
  const idx = db.autoReplies.findIndex(r => r.business_id === businessId && r.id === ruleId);
  if (idx !== -1) {
    db.autoReplies.splice(idx, 1);
    saveDb();
    return true;
  }
  return false;
}

/**
 * Match incoming message text against all enabled auto-reply rules for a business.
 */
function matchAutoReply(businessId, text) {
  const lower = text.toLowerCase().trim();
  const enabled = db.autoReplies.filter(r => r.business_id === businessId && r.enabled);
  for (const rule of enabled) {
    const kw = rule.keyword;
    const matched =
      rule.matchType === 'exact'      ? lower === kw :
      rule.matchType === 'startsWith' ? lower.startsWith(kw) :
                                        lower.includes(kw); // contains
    if (matched) return rule.response;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
//  CONTACT MODES
// ══════════════════════════════════════════════════════════════

function getContactMode(businessId, phone) {
  const customer = db.customers.find(c => c.business_id === businessId && c.phone === phone);
  return customer ? (customer.contact_mode || 'ai') : 'ai';
}

function setContactMode(businessId, phone, mode) {
  if (!['ai', 'manual'].includes(mode)) throw new Error('Invalid mode');
  const customer = db.customers.find(c => c.business_id === businessId && c.phone === phone);
  if (customer) {
    customer.contact_mode = mode;
    customer.updated_at = new Date().toISOString();
    saveDb();
  }
}

module.exports = {
  getAllBusinesses, getBusinessById, getBusinessByPhone, createBusiness, updateBusiness, deleteBusiness,
  getSessionByBusinessId, updateSessionStatus,
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
