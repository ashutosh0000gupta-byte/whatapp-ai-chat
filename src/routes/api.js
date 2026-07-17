const express = require('express');
const router  = express.Router();
const db      = require('../services/supabase');
const { callGemini } = require('../services/gemini');
require('dotenv').config();

// ── Tenant Resolution Middleware ──────────────────────────────
const tenantMiddleware = (req, res, next) => {
  const businessId = req.headers['x-business-id'] || req.query.businessId;
  if (!businessId) {
    return res.status(400).json({ error: 'x-business-id header or businessId query parameter is required' });
  }
  req.businessId = businessId;
  next();
};

// ════════════════════════════════════════════════════════════════
//  BUSINESS MANAGEMENT ROUTES (Tenant CRUD — No tenant header required)
// ════════════════════════════════════════════════════════════════

// GET /api/businesses
router.get('/businesses', async (req, res) => {
  try {
    const list = await db.getAllBusinesses();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/businesses/:id
router.get('/businesses/:id', async (req, res) => {
  try {
    const biz = await db.getBusinessById(req.params.id);
    if (!biz) return res.status(404).json({ error: 'Business not found' });
    res.json(biz);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/businesses
router.post('/businesses', async (req, res) => {
  try {
    const biz = await db.createBusiness(req.body);
    // Dynamically trigger session connect in Baileys if mode is web
    const ws = global.waService;
    const mode = (process.env.WA_MODE || 'web').toLowerCase();
    if (mode === 'web' && ws && typeof ws.initBusinessSession === 'function') {
      ws.initBusinessSession(biz.id).catch(err =>
        console.error(`[App] Failed to auto-start session for new business ${biz.name}:`, err.message)
      );
    }
    res.status(201).json(biz);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/businesses/:id
router.patch('/businesses/:id', async (req, res) => {
  try {
    const biz = await db.updateBusiness(req.params.id, req.body);
    if (!biz) return res.status(404).json({ error: 'Business not found' });
    res.json(biz);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/businesses/:id
router.delete('/businesses/:id', async (req, res) => {
  try {
    const success = await db.deleteBusiness(req.params.id);
    if (!success) return res.status(404).json({ error: 'Business not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/businesses/:id/qr — Render Baileys connection state
router.get('/businesses/:id/qr', async (req, res) => {
  const { id } = req.params;
  const ws = global.waService;
  if (!ws) {
    return res.status(500).json({ error: 'WhatsApp service not initialized' });
  }

  try {
    const biz = await db.getBusinessById(id);
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const session = await db.getSessionByBusinessId(id);

    const ready = typeof ws.isReady === 'function' ? ws.isReady(id) : false;
    const qr = typeof ws.getQRDataUrl === 'function' ? ws.getQRDataUrl(id) : null;
    const info = typeof ws.getClientInfo === 'function' ? ws.getClientInfo(id) : null;

    res.json({
      businessId: id,
      businessName: biz.name,
      connected: ready,
      info,
      qrReady: !!qr,
      qr,
      sessionStatus: session ? session.connection_status : 'disconnected',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  TENANT-ISOLATED API ROUTES (Requires X-Business-ID Header)
// ════════════════════════════════════════════════════════════════

router.use(tenantMiddleware);

// GET /api/stats — KPI Summary
router.get('/stats', async (req, res) => {
  try {
    const stats = await db.getDashboardStats(req.businessId);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/customers — CRM Customer Pipelines
router.get('/customers', async (req, res) => {
  try {
    const data = await db.getAllCustomersWithLeads(req.businessId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leads
router.get('/leads', async (req, res) => {
  try {
    const data = await db.getAllLeads(req.businessId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/leads/:id
router.patch('/leads/:id', async (req, res) => {
  const { id }    = req.params;
  const { stage } = req.body;
  const validStages = ['new', 'qualified', 'converted', 'lost'];
  if (!validStages.includes(stage)) {
    return res.status(400).json({ error: 'Invalid stage' });
  }
  try {
    await db.updateLeadById(req.businessId, id, { stage, last_activity: new Date().toISOString() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/:customerId
router.get('/messages/:customerId', async (req, res) => {
  try {
    const data = await db.getMessageHistory(req.businessId, req.params.customerId, 50);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tickets
router.get('/tickets', async (req, res) => {
  try {
    const data = await db.getAllTickets(req.businessId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tickets/:id
router.patch('/tickets/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.updateTicket(req.businessId, id, { ...req.body, updated_at: new Date().toISOString() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reservations
router.get('/reservations', async (req, res) => {
  try {
    const data = await db.getAllReservations(req.businessId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reminders/pending
router.get('/reminders/pending', async (req, res) => {
  try {
    const data = await db.getPendingReminders();
    const filtered = data.filter(r => r.business_id === req.businessId);
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/send-manual — Agent sends a message manually
router.post('/send-manual', async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'phone and message required' });
  try {
    // Send message via Baileys socket/Meta
    await global.waService.sendMessage(req.businessId, phone, message);

    // Upsert customer & log manual outbound message to audit log
    const { customer } = await db.upsertCustomer(req.businessId, phone);
    await db.logMessage(req.businessId, {
      customerId: customer.id,
      direction:  'outbound',
      content:    message,
      intent:     'manual',
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/wa-status — Specific WhatsApp connection status
router.get('/wa-status', async (req, res) => {
  const ws = global.waService;
  const businessId = req.businessId;

  const ready = typeof ws?.isReady === 'function' ? ws.isReady(businessId) : false;
  const info  = typeof ws?.getClientInfo === 'function' ? ws.getClientInfo(businessId) : null;
  const qr    = typeof ws?.getQRDataUrl === 'function' ? ws.getQRDataUrl(businessId) : null;

  res.json({
    mode:      process.env.WA_MODE || 'web',
    connected: ready,
    info:      info,
    qrReady:   !!qr,
    qrUrl:     `http://localhost:3000/api/businesses/${businessId}/qr`,
  });
});

// GET /api/auto-replies
router.get('/auto-replies', async (req, res) => {
  try {
    const rules = await db.getAllAutoReplies(req.businessId);
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
    const rule = await db.createAutoReply(req.businessId, { keyword, response, enabled, matchType });
    res.status(201).json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/auto-replies/:id
router.patch('/auto-replies/:id', async (req, res) => {
  try {
    const rule = await db.updateAutoReply(req.businessId, req.params.id, req.body);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/auto-replies/:id
router.delete('/auto-replies/:id', async (req, res) => {
  try {
    const deleted = await db.deleteAutoReply(req.businessId, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Rule not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/contact-mode/:phone
router.get('/contact-mode/:phone', async (req, res) => {
  try {
    const mode = await db.getContactMode(req.businessId, decodeURIComponent(req.params.phone));
    res.json({ phone: req.params.phone, mode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/contact-mode
router.post('/contact-mode', async (req, res) => {
  const { phone, mode } = req.body;
  if (!phone || !['ai', 'manual'].includes(mode)) {
    return res.status(400).json({ error: 'phone and mode (ai|manual) are required' });
  }
  try {
    await db.setContactMode(req.businessId, phone, mode);
    res.json({ success: true, phone, mode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai-preview
router.post('/ai-preview', async (req, res) => {
  const { phone, message, customerId } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });
  try {
    let history  = [];
    let customer = { phone, name: 'Unknown' };
    if (customerId) {
      try { history  = await db.getMessageHistory(req.businessId, customerId, 10); } catch (_) {}
      try {
        const customers = await db.getAllCustomersWithLeads(req.businessId);
        customer = customers.find(c => c.id === customerId) || customer;
      } catch (_) {}
    }

    const biz = await db.getBusinessById(req.businessId);
    const aiResponse = await callGemini(biz?.ai_system_prompt || '', message, history, customer);
    res.json({ reply: aiResponse.reply, intent: aiResponse.intent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
