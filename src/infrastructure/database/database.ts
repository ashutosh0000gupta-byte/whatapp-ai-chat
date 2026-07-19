import { Pool } from 'pg';
import dotenv from 'dotenv';
import { 
  Business, WhatsAppSession, Customer, Lead, Reservation, 
  Order, Ticket, Reminder, AutoReply, DashboardStats 
} from '../../core/models/types';

dotenv.config();

console.log('[Database] 🐘 Connecting directly to Railway PostgreSQL...');

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

// ══════════════════════════════════════════════════════════════
//  BUSINESS MANAGEMENT
// ══════════════════════════════════════════════════════════════

export async function getAllBusinesses(): Promise<Business[]> {
  const res = await pool.query('SELECT * FROM businesses ORDER BY name ASC');
  return res.rows;
}

export async function getBusinessById(businessId: string): Promise<Business | null> {
  const res = await pool.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
  return res.rows[0] || null;
}

export async function getBusinessByPhone(phone: string): Promise<Business | null> {
  const normalized = phone.replace(/^\+/, '').trim();
  const res = await pool.query('SELECT * FROM businesses');
  return res.rows.find((b: Business) => b.wa_phone_number.replace(/^\+/, '').trim() === normalized) || null;
}

export async function createBusiness(fields: Partial<Business>): Promise<Business> {
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

export async function updateBusiness(businessId: string, fields: Partial<Business>): Promise<Business | null> {
  const setClauses: string[] = [];
  const values: any[] = [];
  let index = 1;
  for (const [key, val] of Object.entries(fields)) {
    if (key === 'id' || key === 'created_at' || key === 'updated_at') continue;
    setClauses.push(`${key} = $${index}`);
    values.push(val);
    index++;
  }
  if (setClauses.length === 0) return await getBusinessById(businessId);
  values.push(businessId);
  const query = `UPDATE businesses SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${index} RETURNING *`;
  const res = await pool.query(query, values);
  return res.rows[0] || null;
}

export async function deleteBusiness(businessId: string): Promise<boolean> {
  const res = await pool.query('DELETE FROM businesses WHERE id = $1', [businessId]);
  return (res.rowCount ?? 0) > 0;
}

// ══════════════════════════════════════════════════════════════
//  WHATSAPP SESSION MANAGEMENT
// ══════════════════════════════════════════════════════════════

export async function getSessionByBusinessId(businessId: string): Promise<WhatsAppSession> {
  const selectRes = await pool.query('SELECT * FROM whatsapp_sessions WHERE business_id = $1', [businessId]);
  if (selectRes.rows[0]) return selectRes.rows[0];

  const insertRes = await pool.query(
    'INSERT INTO whatsapp_sessions (business_id) VALUES ($1) RETURNING *',
    [businessId]
  );
  return insertRes.rows[0];
}

export async function updateSessionStatus(
  businessId: string, 
  phoneNumber: string | null, 
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
): Promise<WhatsAppSession> {
  await getSessionByBusinessId(businessId);

  let query = 'UPDATE whatsapp_sessions SET connection_status = $1, updated_at = NOW()';
  const params: any[] = [connectionStatus];
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

export async function upsertCustomer(
  businessId: string, 
  phone: string, 
  name: string | null = null
): Promise<{ customer: Customer; isNew: boolean }> {
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

export async function updateCustomer(businessId: string, customerId: string, fields: Partial<Customer>): Promise<Customer | null> {
  const setClauses: string[] = [];
  const values: any[] = [];
  let index = 1;
  for (const [key, val] of Object.entries(fields)) {
    if (key === 'id' || key === 'business_id' || key === 'created_at' || key === 'updated_at') continue;
    setClauses.push(`${key} = $${index}`);
    values.push(val);
    index++;
  }
  if (setClauses.length === 0) {
    const selectRes = await pool.query('SELECT * FROM customers WHERE business_id = $1 AND id = $2', [businessId, customerId]);
    return selectRes.rows[0] || null;
  }
  values.push(businessId, customerId);
  const query = `UPDATE customers SET ${setClauses.join(', ')}, updated_at = NOW() WHERE business_id = $${index} AND id = $${index + 1} RETURNING *`;
  const res = await pool.query(query, values);
  return res.rows[0] || null;
}

// ══════════════════════════════════════════════════════════════
//  LEAD PIPELINE
// ══════════════════════════════════════════════════════════════

export async function updateLeadStage(businessId: string, customerId: string, stage: string, interest: string | null = null): Promise<void> {
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

export async function updateLeadById(businessId: string, leadId: string, fields: Partial<Lead>): Promise<Lead | null> {
  const setClauses: string[] = [];
  const values: any[] = [];
  let index = 1;
  for (const [key, val] of Object.entries(fields)) {
    if (key === 'id' || key === 'business_id' || key === 'customer_id' || key === 'created_at') continue;
    setClauses.push(`${key} = $${index}`);
    values.push(val);
    index++;
  }
  if (setClauses.length === 0) {
    const selectRes = await pool.query('SELECT * FROM leads WHERE business_id = $1 AND id = $2', [businessId, leadId]);
    return selectRes.rows[0] || null;
  }
  values.push(businessId, leadId);
  const query = `UPDATE leads SET ${setClauses.join(', ')} WHERE business_id = $${index} AND id = $${index + 1} RETURNING *`;
  const res = await pool.query(query, values);
  return res.rows[0] || null;
}

export async function getLeadByCustomer(businessId: string, customerId: string): Promise<Lead | null> {
  const res = await pool.query(
    'SELECT * FROM leads WHERE business_id = $1 AND customer_id = $2',
    [businessId, customerId]
  );
  return res.rows[0] || null;
}

// ══════════════════════════════════════════════════════════════
//  MESSAGES
// ══════════════════════════════════════════════════════════════

export async function logMessage(
  businessId: string, 
  params: { customerId: string; direction: 'inbound' | 'outbound'; content: string; intent?: string | null; waMessageId?: string | null; aiResponse?: any }
): Promise<void> {
  await pool.query(
    `INSERT INTO messages (business_id, customer_id, direction, content, intent, wa_message_id, ai_response) 
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      businessId, 
      params.customerId, 
      params.direction, 
      params.content, 
      params.intent || null, 
      params.waMessageId || null, 
      params.aiResponse ? JSON.stringify(params.aiResponse) : null
    ]
  );
}

export async function getMessageHistory(businessId: string, customerId: string, limit: number = 10): Promise<any[]> {
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

export async function createReservation(businessId: string, customerId: string, details: Partial<Reservation>): Promise<Reservation> {
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
  const data: Reservation = res.rows[0];

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

export async function updateReservation(businessId: string, reservationId: string, fields: Partial<Reservation>): Promise<void> {
  const setClauses: string[] = [];
  const values: any[] = [];
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

export async function getReservationsByCustomer(businessId: string, customerId: string): Promise<Reservation[]> {
  const res = await pool.query(
    'SELECT * FROM reservations WHERE business_id = $1 AND customer_id = $2 ORDER BY reserved_date DESC',
    [businessId, customerId]
  );
  return res.rows;
}

export async function getAllReservations(businessId: string): Promise<Reservation[]> {
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

export async function createOrder(businessId: string, customerId: string, details: Partial<Order>): Promise<Order> {
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

export async function updateOrder(businessId: string, orderId: string, fields: Partial<Order>): Promise<void> {
  const setClauses: string[] = [];
  const values: any[] = [];
  let index = 1;
  for (const [key, val] of Object.entries(fields)) {
    if (key === 'id' || key === 'business_id' || key === 'customer_id' || key === 'created_at' || key === 'updated_at') continue;
    setClauses.push(`${key} = $${index}`);
    values.push(key === 'items' || key === 'metadata' ? JSON.stringify(val) : val);
    index++;
  }
  if (setClauses.length === 0) return;
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

export async function createTicket(businessId: string, customerId: string, ticketData: Partial<Ticket>): Promise<Ticket> {
  const res = await pool.query(
    `INSERT INTO tickets (business_id, customer_id, issue, category, priority) 
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [businessId, customerId, ticketData.issue, ticketData.category || 'general', ticketData.priority || 'normal']
  );
  return res.rows[0];
}

export async function updateTicket(businessId: string, ticketId: string, fields: Partial<Ticket>): Promise<void> {
  const setClauses: string[] = [];
  const values: any[] = [];
  let index = 1;
  for (const [key, val] of Object.entries(fields)) {
    if (key === 'id' || key === 'business_id' || key === 'customer_id' || key === 'created_at' || key === 'updated_at') continue;
    setClauses.push(`${key} = $${index}`);
    values.push(val);
    index++;
  }
  if (setClauses.length === 0) return;
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

export async function createReminder(businessId: string, params: { customerId: string; reservationId?: string | null; message: string; scheduledAt: string }): Promise<void> {
  await pool.query(
    `INSERT INTO reminders (business_id, customer_id, reservation_id, message, scheduled_at) 
     VALUES ($1, $2, $3, $4, $5)`,
    [businessId, params.customerId, params.reservationId || null, params.message, params.scheduledAt]
  );
}

export async function getPendingReminders(): Promise<Reminder[]> {
  const res = await pool.query(
    `SELECT r.*, row_to_json(c) as customers 
     FROM reminders r
     LEFT JOIN customers c ON r.customer_id = c.id
     WHERE r.sent = false AND r.scheduled_at <= NOW()`
  );
  return res.rows;
}

export async function markReminderSent(reminderId: string): Promise<void> {
  await pool.query(
    'UPDATE reminders SET sent = true, sent_at = NOW() WHERE id = $1',
    [reminderId]
  );
}

// ══════════════════════════════════════════════════════════════
//  DASHBOARD QUERIES
// ══════════════════════════════════════════════════════════════

export async function getDashboardStats(businessId: string): Promise<DashboardStats> {
  const customersRes = await pool.query('SELECT COUNT(*) FROM customers WHERE business_id = $1', [businessId]);
  const leadsRes = await pool.query('SELECT stage FROM leads WHERE business_id = $1', [businessId]);
  const reservationsRes = await pool.query("SELECT COUNT(*) FROM reservations WHERE business_id = $1 AND status = 'confirmed'", [businessId]);
  const ticketsRes = await pool.query("SELECT COUNT(*) FROM tickets WHERE business_id = $1 AND status IN ('open', 'escalated')", [businessId]);

  const stageCount = { new: 0, qualified: 0, converted: 0, lost: 0 };
  leadsRes.rows.forEach((l: any) => {
    if (stageCount[l.stage as keyof typeof stageCount] !== undefined) {
      stageCount[l.stage as keyof typeof stageCount]++;
    }
  });

  return {
    totalCustomers: parseInt(customersRes.rows[0].count) || 0,
    pipeline: stageCount,
    confirmedReservations: parseInt(reservationsRes.rows[0].count) || 0,
    openTickets: parseInt(ticketsRes.rows[0].count) || 0,
  };
}

export async function getAllCustomersWithLeads(businessId: string): Promise<Customer[]> {
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

export async function getAllTickets(businessId: string): Promise<Ticket[]> {
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

export async function getAllLeads(businessId: string): Promise<Lead[]> {
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

export async function getAllAutoReplies(businessId: string): Promise<AutoReply[]> {
  const res = await pool.query(
    'SELECT * FROM auto_replies WHERE business_id = $1 ORDER BY created_at ASC',
    [businessId]
  );
  return res.rows;
}

export async function createAutoReply(
  businessId: string, 
  data: { keyword: string; response: string; enabled?: boolean; matchType?: 'exact' | 'startsWith' | 'contains' }
): Promise<AutoReply> {
  const res = await pool.query(
    `INSERT INTO auto_replies (business_id, keyword, response, enabled, match_type) 
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [businessId, data.keyword.trim().toLowerCase(), data.response, data.enabled ?? true, data.matchType ?? 'contains']
  );
  return res.rows[0];
}

export async function updateAutoReply(businessId: string, ruleId: string, fields: Partial<AutoReply>): Promise<AutoReply | null> {
  const setClauses: string[] = [];
  const values: any[] = [];
  let index = 1;
  for (const [key, val] of Object.entries(fields)) {
    if (key === 'id' || key === 'business_id' || key === 'created_at') continue;
    setClauses.push(`${key} = $${index}`);
    values.push(key === 'keyword' ? (val as string).trim().toLowerCase() : val);
    index++;
  }
  if (setClauses.length === 0) return null;
  values.push(businessId, ruleId);
  const res = await pool.query(
    `UPDATE auto_replies SET ${setClauses.join(', ')}, updated_at = NOW() 
     WHERE business_id = $${index} AND id = $${index + 1} RETURNING *`,
    values
  );
  return res.rows[0] || null;
}

export async function deleteAutoReply(businessId: string, ruleId: string): Promise<boolean> {
  const res = await pool.query(
    'DELETE FROM auto_replies WHERE business_id = $1 AND id = $2',
    [businessId, ruleId]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function matchAutoReply(businessId: string, text: string): Promise<string | null> {
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

export async function getContactMode(businessId: string, phone: string): Promise<'ai' | 'manual'> {
  const res = await pool.query(
    'SELECT contact_mode FROM customers WHERE business_id = $1 AND phone = $2',
    [businessId, phone]
  );
  return res.rows[0] ? (res.rows[0].contact_mode || 'ai') : 'ai';
}

export async function setContactMode(businessId: string, phone: string, mode: 'ai' | 'manual'): Promise<void> {
  await pool.query(
    'UPDATE customers SET contact_mode = $1, updated_at = NOW() WHERE business_id = $2 AND phone = $3',
    [mode, businessId, phone]
  );
}
