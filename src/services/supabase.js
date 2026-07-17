require('dotenv').config();

// Fallback to local JSON database unless explicitly configured for Postgres
const useLocal = process.env.DB_MODE !== 'postgres';

if (useLocal) {
  console.log('[Database] 💾 Running in local JSON database mode (db.json)');
  module.exports = {
    ...require('./localDb'),
    supabase: null // No longer using Supabase client
  };
  return;
}

const { Pool } = require('pg');

console.log('[Database] 🐘 Connecting directly to Railway PostgreSQL...');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

// ══════════════════════════════════════════════════════════════
//  BUSINESS MANAGEMENT
// ══════════════════════════════════════════════════════════════

async function getAllBusinesses() {
  const res = await pool.query('SELECT * FROM businesses ORDER BY name ASC');
  return res.rows;
}

async function getBusinessById(businessId) {
  const res = await pool.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
  return res.rows[0] || null;
}

async function getBusinessByPhone(phone) {
  const normalized = phone.replace(/^\+/, '').trim();
  const res = await pool.query('SELECT * FROM businesses');
  return res.rows.find(b => b.wa_phone_number.replace(/^\+/, '').trim() === normalized) || null;
}

async function createBusiness(fields) {
  const res = await pool.query(
    `INSERT INTO businesses (
      name, wa_phone_number, workflow_name, ai_system_prompt, knowledge_base, 
      working_hours, subscription_plan, status, crm_settings, memory_settings, 
      payment_config, api_keys, feature_flags
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [
      fields.name, fields.wa_phone_number, fields.workflow_name || null, fields.ai_system_prompt || '',
      fields.knowledge_base || '', fields.working_hours || {}, fields.subscription_plan || 'free',
      fields.status || 'active', fields.crm_settings || {}, fields.memory_settings || {},
      fields.payment_config || {}, fields.api_keys || {}, fields.feature_flags || {}
    ]
  );
  return res.rows[0];
}

async function updateBusiness(businessId, fields) {
  const setClauses = [];
  const values = [];
  let index = 1;
  for (const [key, val] of Object.entries(fields)) {
    if (key === 'id' || key === 'created_at' || key === 'updated_at') continue;
    setClauses.push(`${key} = $${index}`);
    values.push(val);
    index++;
  }
  values.push(businessId);
  const query = `UPDATE businesses SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${index} RETURNING *`;
  const res = await pool.query(query, values);
  return res.rows[0];
}

async function deleteBusiness(businessId) {
  await pool.query('DELETE FROM businesses WHERE id = $1', [businessId]);
  return true;
}

// ══════════════════════════════════════════════════════════════
//  WHATSAPP SESSION MANAGEMENT
// ══════════════════════════════════════════════════════════════

async function getSessionByBusinessId(businessId) {
  const selectRes = await pool.query('SELECT * FROM whatsapp_sessions WHERE business_id = $1', [businessId]);
  if (selectRes.rows[0]) return selectRes.rows[0];

  const insertRes = await pool.query(
    'INSERT INTO whatsapp_sessions (business_id) VALUES ($1) RETURNING *',
    [businessId]
  );
  return insertRes.rows[0];
}

async function updateSessionStatus(businessId, phoneNumber, connectionStatus) {
  await getSessionByBusinessId(businessId);

  let query = 'UPDATE whatsapp_sessions SET connection_status = $1, updated_at = NOW()';
  const params = [connectionStatus];
  let index = 2;

  if (phoneNumber) {
    query += `, phone_number = $${index}`;
    params.push(phoneNumber);
    index++;
  }
  if (connectionStatus === 'connected') {
    query += `, last_connected_time = NOW()`;
  }
  query += ` WHERE business_id = $${index} RETURNING *`;
  params.push(businessId);

  const res = await pool.query(query, params);
  return res.rows[0];
}

// ══════════════════════════════════════════════════════════════
//  CUSTOMER
// ══════════════════════════════════════════════════════════════

async function upsertCustomer(businessId, phone, name = null) {
  const selectRes = await pool.query(
    'SELECT * FROM customers WHERE business_id = $1 AND phone = $2',
    [businessId, phone]
  );

  let customer = selectRes.rows[0];
  if (customer) {
    if (name && !customer.name) {
      const updateRes = await pool.query(
        'UPDATE customers SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [name, customer.id]
      );
      customer = updateRes.rows[0];
    }
    return { customer, isNew: false };
  }

  // Insert customer
  const insertRes = await pool.query(
    'INSERT INTO customers (business_id, phone, name) VALUES ($1, $2, $3) RETURNING *',
    [businessId, phone, name]
  );
  customer = insertRes.rows[0];

  // Create initial lead
  await pool.query(
    'INSERT INTO leads (business_id, customer_id, stage, source) VALUES ($1, $2, $3, $4)',
    [businessId, customer.id, 'new', 'whatsapp']
  );

  return { customer, isNew: true };
}

async function updateCustomer(businessId, customerId, fields) {
  const setClauses = [];
  const values = [];
  let index = 1;
  for (const [key, val] of Object.entries(fields)) {
    if (key === 'id' || key === 'business_id' || key === 'created_at' || key === 'updated_at') continue;
    setClauses.push(`${key} = $${index}`);
    values.push(val);
    index++;
  }
  values.push(businessId, customerId);
  const query = `UPDATE customers SET ${setClauses.join(', ')}, updated_at = NOW() WHERE business_id = $${index} AND id = $${index + 1} RETURNING *`;
  const res = await pool.query(query, values);
  return res.rows[0];
}

// ══════════════════════════════════════════════════════════════
//  LEAD PIPELINE
// ══════════════════════════════════════════════════════════════

async function updateLeadStage(businessId, customerId, stage, interest = null) {
  if (interest) {
    await pool.query(
      'UPDATE leads SET stage = $1, interest = $2, last_activity = NOW() WHERE business_id = $3 AND customer_id = $4',
      [stage, interest, businessId, customerId]
    );
  } else {
    await pool.query(
      'UPDATE leads SET stage = $1, last_activity = NOW() WHERE business_id = $2 AND customer_id = $3',
      [stage, businessId, customerId]
    );
  }
}

async function updateLeadById(businessId, leadId, fields) {
  const setClauses = [];
  const values = [];
  let index = 1;
  for (const [key, val] of Object.entries(fields)) {
    if (key === 'id' || key === 'business_id' || key === 'customer_id' || key === 'created_at') continue;
    setClauses.push(`${key} = $${index}`);
    values.push(val);
    index++;
  }
  values.push(businessId, leadId);
  const query = `UPDATE leads SET ${setClauses.join(', ')} WHERE business_id = $${index} AND id = $${index + 1} RETURNING *`;
  const res = await pool.query(query, values);
  return res.rows[0];
}

async function getLeadByCustomer(businessId, customerId) {
  const res = await pool.query(
    'SELECT * FROM leads WHERE business_id = $1 AND customer_id = $2',
    [businessId, customerId]
  );
  return res.rows[0] || null;
}

// ══════════════════════════════════════════════════════════════
//  MESSAGES
// ══════════════════════════════════════════════════════════════

async function logMessage(businessId, { customerId, direction, content, intent, waMessageId, aiResponse }) {
  await pool.query(
    `INSERT INTO messages (business_id, customer_id, direction, content, intent, wa_message_id, ai_response) 
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [businessId, customerId, direction, content, intent || null, waMessageId || null, aiResponse ? JSON.stringify(aiResponse) : null]
  );
}

async function getMessageHistory(businessId, customerId, limit = 10) {
  const res = await pool.query(
    `SELECT direction, content, created_at FROM messages 
     WHERE business_id = $1 AND customer_id = $2 
     ORDER BY created_at DESC LIMIT $3`,
    [businessId, customerId, limit]
  );
  return res.rows.reverse();
}

// ══════════════════════════════════════════════════════════════
//  RESERVATIONS
// ══════════════════════════════════════════════════════════════

async function createReservation(businessId, customerId, details) {
  const res = await pool.query(
    `INSERT INTO reservations (
      business_id, customer_id, party_size, reserved_date, reserved_time, 
      table_number, occasion, special_notes, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      businessId, customerId, details.party_size || 1, 
      details.reserved_date || new Date().toISOString().split('T')[0],
      details.reserved_time || '19:00:00', details.table_number || null,
      details.occasion || null, details.special_notes || null, details.status || 'pending'
    ]
  );
  const data = res.rows[0];

  if (data && details.reserved_date && details.reserved_time) {
    const dt = new Date(`${details.reserved_date}T${details.reserved_time}`);
    dt.setHours(dt.getHours() - 2);

    const biz = await getBusinessById(businessId);
    const bizName = biz?.name || 'BusinessFlow AI';

    await createReminder(businessId, {
      customerId,
      reservationId: data.id,
      message: `Reminder: Your table is booked for ${details.reserved_time} today at ${bizName}. See you soon! 🍽️`,
      scheduledAt: dt.toISOString(),
    });
  }
  return data;
}

async function updateReservation(businessId, reservationId, fields) {
  const setClauses = [];
  const values = [];
  let index = 1;
  for (const [key, val] of Object.entries(fields)) {
    if (key === 'id' || key === 'business_id' || key === 'customer_id' || key === 'created_at' || key === 'updated_at') continue;
    setClauses.push(`${key} = $${index}`);
    values.push(val);
    index++;
  }
  values.push(businessId, reservationId);
  await pool.query(
    `UPDATE reservations SET ${setClauses.join(', ')}, updated_at = NOW() 
     WHERE business_id = $${index} AND id = $${index + 1}`,
    values
  );
}

async function getReservationsByCustomer(businessId, customerId) {
  const res = await pool.query(
    'SELECT * FROM reservations WHERE business_id = $1 AND customer_id = $2 ORDER BY reserved_date DESC',
    [businessId, customerId]
  );
  return res.rows;
}

async function getAllReservations(businessId) {
  const res = await pool.query(
    `SELECT r.*, row_to_json(c) as customers 
     FROM reservations r
     LEFT JOIN customers c ON r.customer_id = c.id
     WHERE r.business_id = $1
     ORDER BY r.reserved_date ASC`,
    [businessId]
  );
  return res.rows;
}

// ══════════════════════════════════════════════════════════════
//  ORDERS
// ══════════════════════════════════════════════════════════════

async function createOrder(businessId, customerId, details) {
  const res = await pool.query(
    `INSERT INTO orders (
      business_id, customer_id, order_type, items, total_amount, 
      status, payment_status, payment_link, delivery_addr, lead_stage, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      businessId, customerId, details.order_type || 'dine-in',
      details.items ? JSON.stringify(details.items) : null,
      details.total_amount || 0, details.status || 'received',
      details.payment_status || 'pending', details.payment_link || null,
      details.delivery_addr || null, details.lead_stage || 'qualified',
      details.metadata ? JSON.stringify(details.metadata) : null
    ]
  );
  return res.rows[0];
}

async function updateOrder(businessId, orderId, fields) {
  const setClauses = [];
  const values = [];
  let index = 1;
  for (const [key, val] of Object.entries(fields)) {
    if (key === 'id' || key === 'business_id' || key === 'customer_id' || key === 'created_at' || key === 'updated_at') continue;
    setClauses.push(`${key} = $${index}`);
    values.push(key === 'items' || key === 'metadata' ? JSON.stringify(val) : val);
    index++;
  }
  values.push(businessId, orderId);
  await pool.query(
    `UPDATE orders SET ${setClauses.join(', ')}, updated_at = NOW() 
     WHERE business_id = $${index} AND id = $${index + 1}`,
    values
  );
}

// ══════════════════════════════════════════════════════════════
//  TICKETS
// ══════════════════════════════════════════════════════════════

async function createTicket(businessId, customerId, { issue, category = 'general', priority = 'normal' }) {
  const res = await pool.query(
    `INSERT INTO tickets (business_id, customer_id, issue, category, priority) 
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [businessId, customerId, issue, category, priority]
  );
  return res.rows[0];
}

async function updateTicket(businessId, ticketId, fields) {
  const setClauses = [];
  const values = [];
  let index = 1;
  for (const [key, val] of Object.entries(fields)) {
    if (key === 'id' || key === 'business_id' || key === 'customer_id' || key === 'created_at' || key === 'updated_at') continue;
    setClauses.push(`${key} = $${index}`);
    values.push(val);
    index++;
  }
  values.push(businessId, ticketId);
  await pool.query(
    `UPDATE tickets SET ${setClauses.join(', ')}, updated_at = NOW() 
     WHERE business_id = $${index} AND id = $${index + 1}`,
    values
  );
}

// ══════════════════════════════════════════════════════════════
//  REMINDERS
// ══════════════════════════════════════════════════════════════

async function createReminder(businessId, { customerId, reservationId = null, message, scheduledAt }) {
  await pool.query(
    `INSERT INTO reminders (business_id, customer_id, reservation_id, message, scheduled_at) 
     VALUES ($1, $2, $3, $4, $5)`,
    [businessId, customerId, reservationId, message, scheduledAt]
  );
}

async function getPendingReminders() {
  const res = await pool.query(
    `SELECT r.*, row_to_json(c) as customers 
     FROM reminders r
     LEFT JOIN customers c ON r.customer_id = c.id
     WHERE r.sent = false AND r.scheduled_at <= NOW()`
  );
  return res.rows;
}

async function markReminderSent(reminderId) {
  await pool.query(
    'UPDATE reminders SET sent = true, sent_at = NOW() WHERE id = $1',
    [reminderId]
  );
}

// ══════════════════════════════════════════════════════════════
//  DASHBOARD QUERIES
// ══════════════════════════════════════════════════════════════

async function getDashboardStats(businessId) {
  const customersRes = await pool.query('SELECT COUNT(*) FROM customers WHERE business_id = $1', [businessId]);
  const leadsRes = await pool.query('SELECT stage FROM leads WHERE business_id = $1', [businessId]);
  const reservationsRes = await pool.query("SELECT COUNT(*) FROM reservations WHERE business_id = $1 AND status = 'confirmed'", [businessId]);
  const ticketsRes = await pool.query("SELECT COUNT(*) FROM tickets WHERE business_id = $1 AND status IN ('open', 'escalated')", [businessId]);

  const stageCount = { new: 0, qualified: 0, converted: 0, lost: 0 };
  leadsRes.rows.forEach(l => {
    if (stageCount[l.stage] !== undefined) {
      stageCount[l.stage]++;
    }
  });

  return {
    totalCustomers: parseInt(customersRes.rows[0].count) || 0,
    pipeline: stageCount,
    confirmedReservations: parseInt(reservationsRes.rows[0].count) || 0,
    openTickets: parseInt(ticketsRes.rows[0].count) || 0,
  };
}

async function getAllCustomersWithLeads(businessId) {
  const res = await pool.query(
    `SELECT c.*, row_to_json(l) as leads 
     FROM customers c
     LEFT JOIN leads l ON l.customer_id = c.id
     WHERE c.business_id = $1
     ORDER BY c.created_at DESC`,
    [businessId]
  );
  return res.rows;
}

async function getAllTickets(businessId) {
  const res = await pool.query(
    `SELECT t.*, row_to_json(c) as customers 
     FROM tickets t
     LEFT JOIN customers c ON t.customer_id = c.id
     WHERE t.business_id = $1
     ORDER BY t.created_at DESC`,
    [businessId]
  );
  return res.rows;
}

async function getAllLeads(businessId) {
  const res = await pool.query(
    `SELECT l.*, row_to_json(c) as customers 
     FROM leads l
     LEFT JOIN customers c ON l.customer_id = c.id
     WHERE l.business_id = $1
     ORDER BY l.last_activity DESC`,
    [businessId]
  );
  return res.rows;
}

// ══════════════════════════════════════════════════════════════
//  AUTO-REPLY RULES
// ══════════════════════════════════════════════════════════════

async function getAllAutoReplies(businessId) {
  const res = await pool.query(
    'SELECT * FROM auto_replies WHERE business_id = $1 ORDER BY created_at ASC',
    [businessId]
  );
  return res.rows;
}

async function createAutoReply(businessId, { keyword, response, enabled = true, matchType = 'contains' }) {
  const res = await pool.query(
    `INSERT INTO auto_replies (business_id, keyword, response, enabled, match_type) 
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [businessId, keyword.trim().toLowerCase(), response, enabled, matchType]
  );
  return res.rows[0];
}

async function updateAutoReply(businessId, ruleId, fields) {
  const setClauses = [];
  const values = [];
  let index = 1;
  for (const [key, val] of Object.entries(fields)) {
    if (key === 'id' || key === 'business_id' || key === 'created_at') continue;
    setClauses.push(`${key} = $${index}`);
    values.push(key === 'keyword' ? val.trim().toLowerCase() : val);
    index++;
  }
  values.push(businessId, ruleId);
  const res = await pool.query(
    `UPDATE auto_replies SET ${setClauses.join(', ')}, updated_at = NOW() 
     WHERE business_id = $${index} AND id = $${index + 1} RETURNING *`,
    values
  );
  return res.rows[0];
}

async function deleteAutoReply(businessId, ruleId) {
  await pool.query(
    'DELETE FROM auto_replies WHERE business_id = $1 AND id = $2',
    [businessId, ruleId]
  );
  return true;
}

async function matchAutoReply(businessId, text) {
  const lower = text.toLowerCase().trim();
  const rules = await getAllAutoReplies(businessId);
  const enabled = rules.filter(r => r.enabled);

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

async function getContactMode(businessId, phone) {
  const res = await pool.query(
    'SELECT contact_mode FROM customers WHERE business_id = $1 AND phone = $2',
    [businessId, phone]
  );
  return res.rows[0] ? (res.rows[0].contact_mode || 'ai') : 'ai';
}

async function setContactMode(businessId, phone, mode) {
  await pool.query(
    'UPDATE customers SET contact_mode = $1, updated_at = NOW() WHERE business_id = $2 AND phone = $3',
    [mode, businessId, phone]
  );
}

module.exports = {
  supabase: null,
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
