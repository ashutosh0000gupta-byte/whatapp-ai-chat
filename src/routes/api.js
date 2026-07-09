const express = require('express');
const router  = express.Router();
const db      = require('../services/supabase');
// Auto-reply and contact-mode always from localDb
const localDb = require('../services/localDb');
const { callGemini } = require('../services/gemini');
require('dotenv').config();

// ── GET /api/stats — Dashboard KPIs ─────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const stats = await db.getDashboardStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/customers — All customers with lead stage ───────
router.get('/customers', async (req, res) => {
  try {
    const data = await db.getAllCustomersWithLeads();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/leads — CRM Pipeline ───────────────────────────
router.get('/leads', async (req, res) => {
  try {
    const data = await db.getAllLeads();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/leads/:id — Update lead stage ─────────────────
router.patch('/leads/:id', async (req, res) => {
  const { id }    = req.params;
  const { stage } = req.body;
  const validStages = ['new', 'qualified', 'converted', 'lost'];
  if (!validStages.includes(stage)) {
    return res.status(400).json({ error: 'Invalid stage' });
  }
  try {
    // Works for both local and Supabase modes
    if (typeof db.updateLeadById === 'function') {
      await db.updateLeadById(id, { stage, last_activity: new Date().toISOString() });
    } else if (db.supabase?.from) {
      await db.supabase.from('leads').update({ stage, last_activity: new Date().toISOString() }).eq('id', id);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/messages/:customerId — Chat history ─────────────
router.get('/messages/:customerId', async (req, res) => {
  try {
    const data = await db.getMessageHistory(req.params.customerId, 50);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/tickets — Open support tickets ──────────────────
router.get('/tickets', async (req, res) => {
  try {
    const data = await db.getAllTickets();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/tickets/:id — Resolve ticket ──────────────────
router.patch('/tickets/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.updateTicket(id, { ...req.body, updated_at: new Date().toISOString() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/reservations — All reservations ─────────────────
router.get('/reservations', async (req, res) => {
  try {
    // Works for both local and Supabase modes
    if (typeof db.getAllReservations === 'function') {
      res.json(await db.getAllReservations());
    } else {
      const { data } = await db.supabase
        .from('reservations')
        .select('*, customers(phone, name)')
        .order('reserved_date', { ascending: true });
      res.json(data || []);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/reminders/pending — Due reminders ───────────────
router.get('/reminders/pending', async (req, res) => {
  try {
    const data = await db.getPendingReminders();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/send-manual — Agent sends manual message ───────
router.post('/send-manual', async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'phone and message required' });
  try {
    await global.waService.sendMessage(phone, message);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/wa-status — WhatsApp connection status ─────────
router.get('/wa-status', (req, res) => {
  const ws = global.waService;
  res.json({
    mode:      process.env.WA_MODE || 'web',
    connected: ws?.isReady?.() || false,
    info:      ws?.getClientInfo?.() || null,
    qrReady:   !!(ws?.getQRDataUrl?.()),
    qrUrl:     'http://localhost:3000/qr',
  });
});

// ════════════════════════════════════════════════════════════════
//  AUTO-REPLY RULES
// ════════════════════════════════════════════════════════════════

// GET /api/auto-replies
router.get('/auto-replies', async (req, res) => {
  try {
    const rules = await localDb.getAllAutoReplies();
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auto-replies
router.post('/auto-replies', async (req, res) => {
  const { keyword, response, enabled, matchType } = req.body;
  if (!keyword || !response) {
    return res.status(400).json({ error: 'keyword and response are required' });
  }
  try {
    const rule = await localDb.createAutoReply({ keyword, response, enabled, matchType });
    res.status(201).json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/auto-replies/:id
router.patch('/auto-replies/:id', async (req, res) => {
  try {
    const rule = await localDb.updateAutoReply(req.params.id, req.body);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/auto-replies/:id
router.delete('/auto-replies/:id', async (req, res) => {
  try {
    const deleted = await localDb.deleteAutoReply(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Rule not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  CONTACT MODES  (ai | manual)
// ════════════════════════════════════════════════════════════════

// GET /api/contact-mode/:phone
router.get('/contact-mode/:phone', (req, res) => {
  try {
    const mode = localDb.getContactMode(decodeURIComponent(req.params.phone));
    res.json({ phone: req.params.phone, mode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/contact-mode
router.post('/contact-mode', (req, res) => {
  const { phone, mode } = req.body;
  if (!phone || !['ai', 'manual'].includes(mode)) {
    return res.status(400).json({ error: 'phone and mode (ai|manual) are required' });
  }
  try {
    localDb.setContactMode(phone, mode);
    res.json({ success: true, phone, mode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  AI PREVIEW  — get Gemini's suggested reply without sending
// ════════════════════════════════════════════════════════════════

// POST /api/ai-preview
router.post('/ai-preview', async (req, res) => {
  const { phone, message, customerId } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });
  try {
    // Fetch history and customer if available
    let history  = [];
    let customer = { phone, name: 'Unknown' };
    if (customerId) {
      try { history  = await db.getMessageHistory(customerId, 10); } catch (_) {}
      try {
        const customers = await db.getAllCustomersWithLeads?.() || [];
        customer = customers.find(c => c.id === customerId) || customer;
      } catch (_) {}
    }
    const aiResponse = await callGemini(message, history, customer);
    res.json({ reply: aiResponse.reply, intent: aiResponse.intent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
