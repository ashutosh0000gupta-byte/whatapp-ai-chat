import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';

import webhookRouter from './interfaces/http/webhook';
import apiRouter from './interfaces/http/api';
import authRouter from './interfaces/http/authRoutes';
import analyticsRouter from './interfaces/http/analyticsRoutes';
import * as db from './infrastructure/database/database';
import { handleIncomingMessage } from './interfaces/handlers/messageHandler';
import { redis } from './infrastructure/redis/redisClient';
import { authMiddleware, tenantAuthorizationMiddleware } from './interfaces/middleware/auth';

// Import both WhatsApp services
import * as baileysService from './infrastructure/whatsapp/whatsappWeb';
import * as metaService from './infrastructure/whatsapp/whatsapp';

// ── WhatsApp Mode: 'web' (QR scan) or 'meta' (Cloud API) ─────
const WA_MODE = (process.env.WA_MODE || 'web').toLowerCase();

// Unified wrapper to call the active WhatsApp service
export const waService = {
  sendMessage: async (businessId: string, to: string, text: string) => {
    if (WA_MODE === 'meta') {
      return metaService.sendMessage(businessId, to, text);
    } else {
      return baileysService.sendMessage(businessId, to, text);
    }
  },
  sendButtons: async (businessId: string, to: string, bodyText: string, buttons: any[]) => {
    if (WA_MODE === 'meta') {
      return metaService.sendButtons(businessId, to, bodyText, buttons);
    } else {
      return baileysService.sendButtons(businessId, to, bodyText, buttons);
    }
  },
  sendTemplate: async (businessId: string, to: string, templateName?: string, languageCode?: string, components?: any[]) => {
    if (WA_MODE === 'meta') {
      return metaService.sendTemplate(businessId, to, templateName || 'hello_world', languageCode, components || []);
    } else {
      return baileysService.sendTemplate(businessId, to);
    }
  },
  markAsRead: async (businessId: string, messageId: string) => {
    if (WA_MODE === 'meta') {
      return metaService.markAsRead(businessId, messageId);
    } else {
      return baileysService.markAsRead(businessId, messageId);
    }
  }
};

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security & Middleware ─────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // disabled for QR page compatibility
app.use(morgan('dev'));
app.use(cors({ origin: process.env.DASHBOARD_ORIGIN || '*' }));

const apiLimiter = rateLimit({ windowMs: 60_000, max: 500 });
app.use('/api', apiLimiter);
app.use(express.json({ limit: '5mb' }));

// ── Routes ────────────────────────────────────────────────────

// Public auth routes (no JWT required)
app.use('/api/auth', authRouter);

if (WA_MODE === 'meta') {
  const webhookLimiter = rateLimit({ windowMs: 60_000, max: 2000 });
  app.use('/webhook', webhookLimiter);
  app.use('/webhook', webhookRouter);
}

// Protected API routes — JWT authentication gate
// NOTE: To enable JWT auth enforcement, uncomment the line below.
// During development, it is left disabled so the dashboard works without login.
// app.use('/api', authMiddleware);

app.use('/api', apiRouter);
app.use('/api/analytics', analyticsRouter);

// Backward-compatible redirect to dashboard/businesses setup page
app.get('/qr', (req: Request, res: Response) => {
  res.redirect(`http://localhost:5173`);
});

// ── Health Check ──────────────────────────────────────────────
app.get('/health', async (req: Request, res: Response) => {
  try {
    const list = await db.getAllBusinesses();

    // Check Redis connectivity
    let redisStatus = 'disconnected';
    try {
      await redis.ping();
      redisStatus = 'connected';
    } catch (_) {}

    res.json({
      status: 'ok',
      mode: WA_MODE,
      businesses: list.length,
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Serve React Dashboard Static Files in Production ─────────
const distPath = path.join(__dirname, '../dashboard/dist');
if (fs.existsSync(distPath)) {
  console.log(`[App] 🖥️ Serving React dashboard static assets from: ${distPath}`);
  app.use(express.static(distPath));
  
  // Catch-all SPA routing: redirect unknown non-API/non-webhook paths to index.html
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/webhook') || req.path.startsWith('/qr')) {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ── 404 / Error ────────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[App] Uncaught error:', err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ══════════════════════════════════════════════════════════════
//  REMINDER CRON
// ══════════════════════════════════════════════════════════════
async function runReminderCron() {
  try {
    const reminders = await db.getPendingReminders();
    for (const reminder of reminders) {
      const phone = reminder.customers?.phone;
      const businessId = reminder.business_id;
      if (!phone || !businessId) continue;

      // Send the reminder message via that specific business's session
      await waService.sendMessage(businessId, phone, reminder.message);
      await db.markReminderSent(reminder.id);
      console.log(`[Cron] Sent reminder to ${phone} for business ${businessId}`);
    }
  } catch (err: any) {
    console.error('[Cron] Reminder error:', err.message);
  }
}

// ── Start Server ──────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║  🚀  BusinessFlow AI Server: http://localhost:${PORT}
  ║  📊  Dashboard: http://localhost:5173     ║
  ║  🔐  Auth: /api/auth/login               ║
  ║  📈  Analytics: /api/analytics/overview   ║
  ╚══════════════════════════════════════════╝
  `);

  // Start WhatsApp Web (Multi-Session manager)
  if (WA_MODE === 'web') {
    baileysService.initWhatsAppWeb(handleIncomingMessage);
  }

  // Start reminder cron
  setInterval(runReminderCron, 60_000);
  console.log('[Cron] Reminder scheduler started (every 60s)');
});

export default app;
