import express, { Response, NextFunction, Router } from 'express';
import * as db from '../../infrastructure/database/database';
import { callGemini } from '../../infrastructure/ai/gemini';
import * as ws from '../../infrastructure/whatsapp/whatsappWeb';
import { invalidateBusinessCache } from '../../infrastructure/redis/redisClient';
import { provisionNewBusiness } from '../../services/provisioning';
import { 
  validateBody, 
  CreateBusinessSchema, 
  UpdateBusinessSchema, 
  UpdateLeadSchema,
  UpdateTicketSchema,
  CreateAutoReplySchema,
  UpdateAutoReplySchema,
  SendManualMessageSchema,
  SetContactModeSchema,
  AiPreviewSchema,
} from '../middleware/validation';
import dotenv from 'dotenv';
import { TenantRequest } from './types';

dotenv.config();

const router = Router();

// ── Tenant Resolution Middleware ──────────────────────────────
const tenantMiddleware = (req: TenantRequest, res: Response, next: NextFunction) => {
  const businessId = req.headers['x-business-id'] || req.query.businessId;
  if (!businessId) {
    return res.status(400).json({ error: 'x-business-id header or businessId query parameter is required' });
  }
  req.businessId = businessId as string;
  next();
};

// ════════════════════════════════════════════════════════════════
//  BUSINESS MANAGEMENT ROUTES (Tenant CRUD — No tenant header required)
// ════════════════════════════════════════════════════════════════

// GET /api/businesses
router.get('/businesses', async (req: TenantRequest, res: Response) => {
  try {
    const list = await db.getAllBusinesses();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/businesses/:id
router.get('/businesses/:id', async (req: TenantRequest, res: Response) => {
  try {
    const biz = await db.getBusinessById(req.params.id);
    if (!biz) return res.status(404).json({ error: 'Business not found' });
    res.json(biz);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/businesses
router.post('/businesses', validateBody(CreateBusinessSchema), async (req: TenantRequest, res: Response) => {
  try {
    const biz = await db.createBusiness(req.body);
    // Auto-provision defaults (AI prompt, CRM settings, feature flags, auto-replies)
    await provisionNewBusiness(biz);
    // Dynamically trigger session connect in Baileys if mode is web
    const mode = (process.env.WA_MODE || 'web').toLowerCase();
    if (mode === 'web') {
      ws.connectSession(biz.id).catch((err: any) =>
        console.error(`[App] Failed to auto-start session for new business ${biz.name}:`, err.message)
      );
    }
    res.status(201).json(biz);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/businesses/:id
router.patch('/businesses/:id', validateBody(UpdateBusinessSchema), async (req: TenantRequest, res: Response) => {
  try {
    const biz = await db.updateBusiness(req.params.id, req.body);
    if (!biz) return res.status(404).json({ error: 'Business not found' });
    // Invalidate Redis cache so next read picks up fresh config
    await invalidateBusinessCache(req.params.id);
    res.json(biz);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/businesses/:id
router.delete('/businesses/:id', async (req: TenantRequest, res: Response) => {
  try {
    const success = await db.deleteBusiness(req.params.id);
    if (!success) return res.status(404).json({ error: 'Business not found' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/businesses/:id/qr — Render Baileys connection state
router.get('/businesses/:id/qr', async (req: TenantRequest, res: Response) => {
  const { id } = req.params;

  try {
    const biz = await db.getBusinessById(id);
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const session = await db.getSessionByBusinessId(id);

    const ready = ws.isReady(id);
    const qr = ws.getQRDataUrl(id);
    const info = ws.getClientInfo(id);

    res.json({
      businessId: id,
      businessName: biz.name,
      connected: ready,
      info,
      qrReady: !!qr,
      qr,
      sessionStatus: session ? session.connection_status : 'disconnected',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  TENANT-ISOLATED API ROUTES (Requires X-Business-ID Header)
// ════════════════════════════════════════════════════════════════

router.use(tenantMiddleware);

// GET /api/stats — KPI Summary
router.get('/stats', async (req: TenantRequest, res: Response) => {
  try {
    const stats = await db.getDashboardStats(req.businessId!);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/customers — CRM Customer Pipelines
router.get('/customers', async (req: TenantRequest, res: Response) => {
  try {
    const data = await db.getAllCustomersWithLeads(req.businessId!);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leads
router.get('/leads', async (req: TenantRequest, res: Response) => {
  try {
    const data = await db.getAllLeads(req.businessId!);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/leads/:id
router.patch('/leads/:id', validateBody(UpdateLeadSchema), async (req: TenantRequest, res: Response) => {
  const { id } = req.params;
  const { stage } = req.body;
  try {
    await db.updateLeadById(req.businessId!, id, { stage, last_activity: new Date().toISOString() });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/:customerId
router.get('/messages/:customerId', async (req: TenantRequest, res: Response) => {
  try {
    const data = await db.getMessageHistory(req.businessId!, req.params.customerId, 50);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tickets
router.get('/tickets', async (req: TenantRequest, res: Response) => {
  try {
    const data = await db.getAllTickets(req.businessId!);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tickets/:id
router.patch('/tickets/:id', validateBody(UpdateTicketSchema), async (req: TenantRequest, res: Response) => {
  const { id } = req.params;
  try {
    await db.updateTicket(req.businessId!, id, { ...req.body, updated_at: new Date().toISOString() });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reservations
router.get('/reservations', async (req: TenantRequest, res: Response) => {
  try {
    const data = await db.getAllReservations(req.businessId!);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reminders/pending
router.get('/reminders/pending', async (req: TenantRequest, res: Response) => {
  try {
    const data = await db.getPendingReminders();
    const filtered = data.filter(r => r.business_id === req.businessId);
    res.json(filtered);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/send-manual — Agent sends a message manually
router.post('/send-manual', validateBody(SendManualMessageSchema), async (req: TenantRequest, res: Response) => {
  const { phone, message } = req.body;
  try {
    // Send message via Baileys socket
    await ws.sendMessage(req.businessId!, phone, message);

    // Upsert customer & log manual outbound message to audit log
    const { customer } = await db.upsertCustomer(req.businessId!, phone);
    await db.logMessage(req.businessId!, {
      customerId: customer.id,
      direction: 'outbound',
      content: message,
      intent: 'manual',
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/wa-status — Specific WhatsApp connection status
router.get('/wa-status', async (req: TenantRequest, res: Response) => {
  const businessId = req.businessId!;

  const ready = ws.isReady(businessId);
  const info = ws.getClientInfo(businessId);
  const qr = ws.getQRDataUrl(businessId);

  res.json({
    mode: process.env.WA_MODE || 'web',
    connected: ready,
    info: info,
    qrReady: !!qr,
    qrUrl: `http://localhost:3000/api/businesses/${businessId}/qr`,
  });
});

// GET /api/auto-replies
router.get('/auto-replies', async (req: TenantRequest, res: Response) => {
  try {
    const rules = await db.getAllAutoReplies(req.businessId!);
    res.json(rules);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auto-replies
router.post('/auto-replies', validateBody(CreateAutoReplySchema), async (req: TenantRequest, res: Response) => {
  const { keyword, response, enabled, matchType } = req.body;
  try {
    const rule = await db.createAutoReply(req.businessId!, { keyword, response, enabled, matchType });
    res.status(201).json(rule);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/auto-replies/:id
router.patch('/auto-replies/:id', async (req: TenantRequest, res: Response) => {
  try {
    const rule = await db.updateAutoReply(req.businessId!, req.params.id, req.body);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json(rule);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/auto-replies/:id
router.delete('/auto-replies/:id', async (req: TenantRequest, res: Response) => {
  try {
    const deleted = await db.deleteAutoReply(req.businessId!, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Rule not found' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/contact-mode/:phone
router.get('/contact-mode/:phone', async (req: TenantRequest, res: Response) => {
  try {
    const mode = await db.getContactMode(req.businessId!, decodeURIComponent(req.params.phone));
    res.json({ phone: req.params.phone, mode });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/contact-mode
router.post('/contact-mode', validateBody(SetContactModeSchema), async (req: TenantRequest, res: Response) => {
  const { phone, mode } = req.body;
  try {
    await db.setContactMode(req.businessId!, phone, mode);
    res.json({ success: true, phone, mode });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai-preview
router.post('/ai-preview', validateBody(AiPreviewSchema), async (req: TenantRequest, res: Response) => {
  const { phone, message, customerId } = req.body;
  try {
    let history: any[] = [];
    let customer: any = { phone, name: 'Unknown' };
    if (customerId) {
      try { history = await db.getMessageHistory(req.businessId!, customerId, 10); } catch (_) {}
      try {
        const customers = await db.getAllCustomersWithLeads(req.businessId!);
        customer = customers.find(c => c.id === customerId) || customer;
      } catch (_) {}
    }

    const biz = await db.getBusinessById(req.businessId!);
    const aiResponse = await callGemini(biz?.ai_system_prompt || '', message, history, customer);
    res.json({ reply: aiResponse.reply, intent: aiResponse.intent });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
