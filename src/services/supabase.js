require('dotenv').config();

const useLocal = process.env.DB_MODE === 'local' || 
                 !process.env.SUPABASE_URL || 
                 process.env.SUPABASE_URL.includes('your-supabase-project') ||
                 process.env.SUPABASE_URL.includes('placeholder');

if (useLocal) {
  console.log('[Database] 💾 Running in local JSON database mode (db.json)');
  module.exports = {
    ...require('./localDb'),
    supabase: {
      from: (table) => ({
        select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [] }) }) }) }),
        update: (data) => ({ eq: () => Promise.resolve({ error: null, data }) }),
        insert: (data) => ({ select: () => ({ single: () => Promise.resolve({ data }) }) })
      })
    }
  };
  return;
}

const { createClient } = require('@supabase/supabase-js');

// ── Supabase client (service role — bypasses RLS) ─────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

// ══════════════════════════════════════════════════════════════
//  CUSTOMER
// ══════════════════════════════════════════════════════════════

/**
 * Find or create a customer by WhatsApp phone number.
 * @param {string} phone  e.g. "+919876543210"
 * @param {string} [name] Display name from WhatsApp profile
 */
async function upsertCustomer(phone, name = null) {
  // Try to find existing
  const { data: existing } = await supabase
    .from('customers')
    .select('*')
    .eq('phone', phone)
    .single();

  if (existing) {
    // Update name if we now know it
    if (name && !existing.name) {
      await supabase.from('customers').update({ name }).eq('id', existing.id);
      existing.name = name;
    }
    return { customer: existing, isNew: false };
  }

  // Create new customer + lead record
  const { data: customer, error } = await supabase
    .from('customers')
    .insert({ phone, name })
    .select()
    .single();

  if (error) throw new Error(`upsertCustomer: ${error.message}`);

  // Create initial lead stage
  await supabase.from('leads').insert({
    customer_id: customer.id,
    stage: 'new',
    source: 'whatsapp',
  });

  return { customer, isNew: true };
}

/**
 * Update customer profile fields.
 */
async function updateCustomer(customerId, fields) {
  const { error } = await supabase
    .from('customers')
    .update(fields)
    .eq('id', customerId);
  if (error) throw new Error(`updateCustomer: ${error.message}`);
}

// ══════════════════════════════════════════════════════════════
//  LEAD PIPELINE
// ══════════════════════════════════════════════════════════════

/**
 * Move a customer's lead to a new stage.
 * @param {string} customerId
 * @param {'new'|'qualified'|'converted'|'lost'} stage
 */
async function updateLeadStage(customerId, stage, interest = null) {
  const update = { stage, last_activity: new Date().toISOString() };
  if (interest) update.interest = interest;

  const { error } = await supabase
    .from('leads')
    .update(update)
    .eq('customer_id', customerId);
  if (error) throw new Error(`updateLeadStage: ${error.message}`);
}

async function getLeadByCustomer(customerId) {
  const { data } = await supabase
    .from('leads')
    .select('*')
    .eq('customer_id', customerId)
    .single();
  return data;
}

// ══════════════════════════════════════════════════════════════
//  MESSAGES (audit log)
// ══════════════════════════════════════════════════════════════

async function logMessage({ customerId, direction, content, intent, waMessageId, aiResponse }) {
  const { error } = await supabase.from('messages').insert({
    customer_id: customerId,
    direction,
    content,
    intent: intent || null,
    wa_message_id: waMessageId || null,
    ai_response: aiResponse || null,
  });
  if (error) throw new Error(`logMessage: ${error.message}`);
}

/**
 * Fetch last N messages for a customer (for AI context).
 */
async function getMessageHistory(customerId, limit = 10) {
  const { data } = await supabase
    .from('messages')
    .select('direction, content, created_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data || []).reverse(); // chronological order
}

// ══════════════════════════════════════════════════════════════
//  RESERVATIONS
// ══════════════════════════════════════════════════════════════

async function createReservation(customerId, details) {
  const { data, error } = await supabase
    .from('reservations')
    .insert({ customer_id: customerId, ...details })
    .select()
    .single();
  if (error) throw new Error(`createReservation: ${error.message}`);

  // Schedule a reminder 2h before reservation
  if (data && details.reserved_date && details.reserved_time) {
    const dt = new Date(`${details.reserved_date}T${details.reserved_time}`);
    dt.setHours(dt.getHours() - 2);
    await createReminder({
      customerId,
      reservationId: data.id,
      message: `Reminder: Your table is booked for ${details.reserved_time} today at ${process.env.RESTAURANT_NAME}. See you soon! 🍽️`,
      scheduledAt: dt.toISOString(),
    });
  }
  return data;
}

async function updateReservation(reservationId, fields) {
  const { error } = await supabase
    .from('reservations')
    .update(fields)
    .eq('id', reservationId);
  if (error) throw new Error(`updateReservation: ${error.message}`);
}

async function getReservationsByCustomer(customerId) {
  const { data } = await supabase
    .from('reservations')
    .select('*')
    .eq('customer_id', customerId)
    .order('reserved_date', { ascending: false });
  return data || [];
}

// ══════════════════════════════════════════════════════════════
//  ORDERS
// ══════════════════════════════════════════════════════════════

async function createOrder(customerId, details) {
  const { data, error } = await supabase
    .from('orders')
    .insert({ customer_id: customerId, ...details })
    .select()
    .single();
  if (error) throw new Error(`createOrder: ${error.message}`);
  return data;
}

async function updateOrder(orderId, fields) {
  const { error } = await supabase
    .from('orders')
    .update(fields)
    .eq('id', orderId);
  if (error) throw new Error(`updateOrder: ${error.message}`);
}

// ══════════════════════════════════════════════════════════════
//  TICKETS (Escalations)
// ══════════════════════════════════════════════════════════════

async function createTicket(customerId, { issue, category = 'general', priority = 'normal' }) {
  const { data, error } = await supabase
    .from('tickets')
    .insert({ customer_id: customerId, issue, category, priority })
    .select()
    .single();
  if (error) throw new Error(`createTicket: ${error.message}`);
  return data;
}

async function updateTicket(ticketId, fields) {
  const { error } = await supabase
    .from('tickets')
    .update(fields)
    .eq('id', ticketId);
  if (error) throw new Error(`updateTicket: ${error.message}`);
}

// ══════════════════════════════════════════════════════════════
//  REMINDERS
// ══════════════════════════════════════════════════════════════

async function createReminder({ customerId, reservationId = null, message, scheduledAt }) {
  await supabase.from('reminders').insert({
    customer_id: customerId,
    reservation_id: reservationId,
    message,
    scheduled_at: scheduledAt,
  });
}

async function getPendingReminders() {
  const { data } = await supabase
    .from('reminders')
    .select('*, customers(phone, name)')
    .eq('sent', false)
    .lte('scheduled_at', new Date().toISOString());
  return data || [];
}

async function markReminderSent(reminderId) {
  await supabase
    .from('reminders')
    .update({ sent: true, sent_at: new Date().toISOString() })
    .eq('id', reminderId);
}

// ══════════════════════════════════════════════════════════════
//  DASHBOARD QUERIES
// ══════════════════════════════════════════════════════════════

async function getDashboardStats() {
  const [customers, leads, reservations, tickets] = await Promise.all([
    supabase.from('customers').select('id', { count: 'exact', head: true }),
    supabase.from('leads').select('stage'),
    supabase.from('reservations').select('status').eq('status', 'confirmed'),
    supabase.from('tickets').select('status').eq('status', 'open'),
  ]);

  const stageCount = {};
  (leads.data || []).forEach(l => {
    stageCount[l.stage] = (stageCount[l.stage] || 0) + 1;
  });

  return {
    totalCustomers: customers.count || 0,
    pipeline: stageCount,
    confirmedReservations: reservations.data?.length || 0,
    openTickets: tickets.data?.length || 0,
  };
}

async function getAllCustomersWithLeads() {
  const { data } = await supabase
    .from('customers')
    .select(`*, leads(stage, interest, last_activity)`)
    .order('created_at', { ascending: false });
  return data || [];
}

async function getAllTickets() {
  const { data } = await supabase
    .from('tickets')
    .select(`*, customers(phone, name)`)
    .order('created_at', { ascending: false });
  return data || [];
}

async function getAllLeads() {
  const { data } = await supabase
    .from('leads')
    .select(`*, customers(phone, name, visit_count)`)
    .order('last_activity', { ascending: false });
  return data || [];
}

module.exports = {
  supabase,
  upsertCustomer, updateCustomer,
  updateLeadStage, getLeadByCustomer,
  logMessage, getMessageHistory,
  createReservation, updateReservation, getReservationsByCustomer,
  createOrder, updateOrder,
  createTicket, updateTicket,
  createReminder, getPendingReminders, markReminderSent,
  getDashboardStats, getAllCustomersWithLeads, getAllTickets, getAllLeads,
};
