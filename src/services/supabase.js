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
//  BUSINESS MANAGEMENT
// ══════════════════════════════════════════════════════════════

async function getAllBusinesses() {
  const { data, error } = await supabase.from('businesses').select('*').order('name', { ascending: true });
  if (error) throw new Error(`getAllBusinesses: ${error.message}`);
  return data || [];
}

async function getBusinessById(businessId) {
  const { data, error } = await supabase.from('businesses').select('*').eq('id', businessId).maybeSingle();
  if (error) throw new Error(`getBusinessById: ${error.message}`);
  return data;
}

async function getBusinessByPhone(phone) {
  const normalized = phone.replace(/^\+/, '').trim();
  // Find matching business (exact match on wa_phone_number)
  // We can select all and match in JS to handle leading '+' variations safely
  const { data, error } = await supabase.from('businesses').select('*');
  if (error) throw new Error(`getBusinessByPhone: ${error.message}`);
  return (data || []).find(b => b.wa_phone_number.replace(/^\+/, '').trim() === normalized) || null;
}

async function createBusiness(fields) {
  const { data, error } = await supabase.from('businesses').insert(fields).select().single();
  if (error) throw new Error(`createBusiness: ${error.message}`);
  return data;
}

async function updateBusiness(businessId, fields) {
  const { data, error } = await supabase.from('businesses').update(fields).eq('id', businessId).select().single();
  if (error) throw new Error(`updateBusiness: ${error.message}`);
  return data;
}

async function deleteBusiness(businessId) {
  const { error } = await supabase.from('businesses').delete().eq('id', businessId);
  if (error) throw new Error(`deleteBusiness: ${error.message}`);
  return true;
}

// ══════════════════════════════════════════════════════════════
//  WHATSAPP SESSION MANAGEMENT
// ══════════════════════════════════════════════════════════════

async function getSessionByBusinessId(businessId) {
  const { data: existing, error: selectError } = await supabase
    .from('whatsapp_sessions')
    .select('*')
    .eq('business_id', businessId)
    .maybeSingle();

  if (selectError) throw new Error(`getSessionByBusinessId: ${selectError.message}`);
  if (existing) return existing;

  const { data: created, error: insertError } = await supabase
    .from('whatsapp_sessions')
    .insert({ business_id: businessId })
    .select()
    .single();

  if (insertError) throw new Error(`getSessionByBusinessId (create): ${insertError.message}`);
  return created;
}

async function updateSessionStatus(businessId, phoneNumber, connectionStatus) {
  // First ensure session exists
  await getSessionByBusinessId(businessId);

  const fields = { connection_status: connectionStatus, updated_at: new Date().toISOString() };
  if (phoneNumber) fields.phone_number = phoneNumber;
  if (connectionStatus === 'connected') {
    fields.last_connected_time = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('whatsapp_sessions')
    .update(fields)
    .eq('business_id', businessId)
    .select()
    .single();

  if (error) throw new Error(`updateSessionStatus: ${error.message}`);
  return data;
}

// ══════════════════════════════════════════════════════════════
//  CUSTOMER
// ══════════════════════════════════════════════════════════════

async function upsertCustomer(businessId, phone, name = null) {
  const { data: existing } = await supabase
    .from('customers')
    .select('*')
    .eq('business_id', businessId)
    .eq('phone', phone)
    .maybeSingle();

  if (existing) {
    if (name && !existing.name) {
      await supabase.from('customers').update({ name }).eq('id', existing.id);
      existing.name = name;
    }
    return { customer: existing, isNew: false };
  }

  const { data: customer, error } = await supabase
    .from('customers')
    .insert({ business_id: businessId, phone, name })
    .select()
    .single();

  if (error) throw new Error(`upsertCustomer: ${error.message}`);

  await supabase.from('leads').insert({
    business_id: businessId,
    customer_id: customer.id,
    stage: 'new',
    source: 'whatsapp',
  });

  return { customer, isNew: true };
}

async function updateCustomer(businessId, customerId, fields) {
  const { data, error } = await supabase
    .from('customers')
    .update(fields)
    .eq('business_id', businessId)
    .eq('id', customerId)
    .select()
    .single();
  if (error) throw new Error(`updateCustomer: ${error.message}`);
  return data;
}

// ══════════════════════════════════════════════════════════════
//  LEAD PIPELINE
// ──────────────────────────────────────────────────────────────

async function updateLeadStage(businessId, customerId, stage, interest = null) {
  const update = { stage, last_activity: new Date().toISOString() };
  if (interest) update.interest = interest;

  const { error } = await supabase
    .from('leads')
    .update(update)
    .eq('business_id', businessId)
    .eq('customer_id', customerId);
  if (error) throw new Error(`updateLeadStage: ${error.message}`);
}

async function updateLeadById(businessId, leadId, fields) {
  const { data, error } = await supabase
    .from('leads')
    .update(fields)
    .eq('business_id', businessId)
    .eq('id', leadId)
    .select()
    .single();
  if (error) throw new Error(`updateLeadById: ${error.message}`);
  return data;
}

async function getLeadByCustomer(businessId, customerId) {
  const { data } = await supabase
    .from('leads')
    .select('*')
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .maybeSingle();
  return data;
}

// ══════════════════════════════════════════════════════════════
//  MESSAGES
// ──────────────────────────────────────────────────────────────

async function logMessage(businessId, { customerId, direction, content, intent, waMessageId, aiResponse }) {
  const { error } = await supabase.from('messages').insert({
    business_id: businessId,
    customer_id: customerId,
    direction,
    content,
    intent: intent || null,
    wa_message_id: waMessageId || null,
    ai_response: aiResponse || null,
  });
  if (error) throw new Error(`logMessage: ${error.message}`);
}

async function getMessageHistory(businessId, customerId, limit = 10) {
  const { data } = await supabase
    .from('messages')
    .select('direction, content, created_at')
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data || []).reverse();
}

// ══════════════════════════════════════════════════════════════
//  RESERVATIONS
// ──────────────────────────────────────────────────────────────

async function createReservation(businessId, customerId, details) {
  const { data, error } = await supabase
    .from('reservations')
    .insert({ business_id: businessId, customer_id: customerId, ...details })
    .select()
    .single();
  if (error) throw new Error(`createReservation: ${error.message}`);

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
  const { error } = await supabase
    .from('reservations')
    .update(fields)
    .eq('business_id', businessId)
    .eq('id', reservationId);
  if (error) throw new Error(`updateReservation: ${error.message}`);
}

async function getReservationsByCustomer(businessId, customerId) {
  const { data } = await supabase
    .from('reservations')
    .select('*')
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .order('reserved_date', { ascending: false });
  return data || [];
}

async function getAllReservations(businessId) {
  const { data } = await supabase
    .from('reservations')
    .select('*, customers(phone, name)')
    .eq('business_id', businessId)
    .order('reserved_date', { ascending: true });
  return data || [];
}

// ══════════════════════════════════════════════════════════════
//  ORDERS
// ──────────────────────────────────────────────────────────────

async function createOrder(businessId, customerId, details) {
  const { data, error } = await supabase
    .from('orders')
    .insert({ business_id: businessId, customer_id: customerId, ...details })
    .select()
    .single();
  if (error) throw new Error(`createOrder: ${error.message}`);
  return data;
}

async function updateOrder(businessId, orderId, fields) {
  const { error } = await supabase
    .from('orders')
    .update(fields)
    .eq('business_id', businessId)
    .eq('id', orderId);
  if (error) throw new Error(`updateOrder: ${error.message}`);
}

// ══════════════════════════════════════════════════════════════
//  TICKETS
// ──────────────────────────────────────────────────────────────

async function createTicket(businessId, customerId, { issue, category = 'general', priority = 'normal' }) {
  const { data, error } = await supabase
    .from('tickets')
    .insert({ business_id: businessId, customer_id: customerId, issue, category, priority })
    .select()
    .single();
  if (error) throw new Error(`createTicket: ${error.message}`);
  return data;
}

async function updateTicket(businessId, ticketId, fields) {
  const { error } = await supabase
    .from('tickets')
    .update(fields)
    .eq('business_id', businessId)
    .eq('id', ticketId);
  if (error) throw new Error(`updateTicket: ${error.message}`);
}

// ══════════════════════════════════════════════════════════════
//  REMINDERS
// ──────────────────────────────────────────────────────────────

async function createReminder(businessId, { customerId, reservationId = null, message, scheduledAt }) {
  await supabase.from('reminders').insert({
    business_id: businessId,
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
// ──────────────────────────────────────────────────────────────

async function getDashboardStats(businessId) {
  const [customers, leads, reservations, tickets] = await Promise.all([
    supabase.from('customers').select('id', { count: 'exact', head: true }).eq('business_id', businessId),
    supabase.from('leads').select('stage').eq('business_id', businessId),
    supabase.from('reservations').select('status').eq('business_id', businessId).eq('status', 'confirmed'),
    supabase.from('tickets').select('status').eq('business_id', businessId).eq('status', 'open'),
  ]);

  const stageCount = { new: 0, qualified: 0, converted: 0, lost: 0 };
  (leads.data || []).forEach(l => {
    if (stageCount[l.stage] !== undefined) {
      stageCount[l.stage]++;
    }
  });

  return {
    totalCustomers: customers.count || 0,
    pipeline: stageCount,
    confirmedReservations: reservations.data?.length || 0,
    openTickets: tickets.data?.length || 0,
  };
}

async function getAllCustomersWithLeads(businessId) {
  const { data } = await supabase
    .from('customers')
    .select(`*, leads(stage, interest, last_activity)`)
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });
  return data || [];
}

async function getAllTickets(businessId) {
  const { data } = await supabase
    .from('tickets')
    .select(`*, customers(phone, name)`)
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });
  return data || [];
}

async function getAllLeads(businessId) {
  const { data } = await supabase
    .from('leads')
    .select(`*, customers(phone, name, visit_count)`)
    .eq('business_id', businessId)
    .order('last_activity', { ascending: false });
  return data || [];
}

// ══════════════════════════════════════════════════════════════
//  AUTO-REPLY RULES
// ──────────────────────────────────────────────────────────────

async function getAllAutoReplies(businessId) {
  const { data, error } = await supabase
    .from('auto_replies')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`getAllAutoReplies: ${error.message}`);
  return data || [];
}

async function createAutoReply(businessId, { keyword, response, enabled = true, matchType = 'contains' }) {
  const { data, error } = await supabase
    .from('auto_replies')
    .insert({
      business_id: businessId,
      keyword: keyword.trim().toLowerCase(),
      response,
      enabled,
      matchType
    })
    .select()
    .single();
  if (error) throw new Error(`createAutoReply: ${error.message}`);
  return data;
}

async function updateAutoReply(businessId, ruleId, fields) {
  const update = { ...fields };
  if (fields.keyword) update.keyword = fields.keyword.trim().toLowerCase();

  const { data, error } = await supabase
    .from('auto_replies')
    .update(update)
    .eq('business_id', businessId)
    .eq('id', ruleId)
    .select()
    .single();
  if (error) throw new Error(`updateAutoReply: ${error.message}`);
  return data;
}

async function deleteAutoReply(businessId, ruleId) {
  const { error } = await supabase
    .from('auto_replies')
    .delete()
    .eq('business_id', businessId)
    .eq('id', ruleId);
  if (error) throw new Error(`deleteAutoReply: ${error.message}`);
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
// ──────────────────────────────────────────────────────────────

async function getContactMode(businessId, phone) {
  const { data } = await supabase
    .from('customers')
    .select('contact_mode')
    .eq('business_id', businessId)
    .eq('phone', phone)
    .maybeSingle();
  return data ? (data.contact_mode || 'ai') : 'ai';
}

async function setContactMode(businessId, phone, mode) {
  if (!['ai', 'manual'].includes(mode)) throw new Error('Invalid mode');
  const { error } = await supabase
    .from('customers')
    .update({ contact_mode: mode, updated_at: new Date().toISOString() })
    .eq('business_id', businessId)
    .eq('phone', phone);
  if (error) throw new Error(`setContactMode: ${error.message}`);
}

module.exports = {
  supabase,
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
