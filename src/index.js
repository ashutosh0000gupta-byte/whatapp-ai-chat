require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');

const webhookRouter = require('./routes/webhook');
const apiRouter     = require('./routes/api');
const db            = require('./services/supabase');

// ── WhatsApp Mode: 'web' (QR scan) or 'meta' (Cloud API) ─────
const WA_MODE = (process.env.WA_MODE || 'web').toLowerCase();

let waService;
if (WA_MODE === 'meta') {
  waService = require('./services/whatsapp');
  console.log('[App] Mode: Meta WhatsApp Cloud API');
} else {
  waService = require('./services/whatsappWeb');
  console.log('[App] Mode: WhatsApp Web Multi-Session (QR scan)');
}

// Export globally so messageHandler/api can access it
global.waService = waService;

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security & Middleware ─────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // disabled for QR page
app.use(morgan('dev'));
app.use(cors({ origin: process.env.DASHBOARD_ORIGIN || '*' }));

const apiLimiter = rateLimit({ windowMs: 60_000, max: 500 });
app.use('/api', apiLimiter);
app.use(express.json({ limit: '5mb' }));

// ── Routes ────────────────────────────────────────────────────
// Only mount webhook route in Meta mode
if (WA_MODE === 'meta') {
  const webhookLimiter = rateLimit({ windowMs: 60_000, max: 2000 });
  app.use('/webhook', webhookLimiter);
  app.use('/webhook', webhookRouter);
}
app.use('/api', apiRouter);

// Backward-compatible redirect to dashboard/businesses setup page
app.get('/qr', (req, res) => {
  res.redirect(`http://localhost:5173`);
});

// ── Health Check ──────────────────────────────────────────────
app.get('/health', async (req, res) => {
  const ready = WA_MODE === 'web';
  try {
    const list = await db.getAllBusinesses();
    res.json({
      status:      'ok',
      mode:        WA_MODE,
      businesses:  list.length,
      timestamp:   new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 404 / Error ────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => {
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
  } catch (err) {
    console.error('[Cron] Reminder error:', err.message);
  }
}

// ── Start Server ──────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║  🚀  BusinessFlow AI Server: http://localhost:${PORT}
  ║  📊  Dashboard: http://localhost:5173     ║
  ╚══════════════════════════════════════════╝
  `);

  // Start WhatsApp Web (Multi-Session manager)
  if (WA_MODE === 'web') {
    const { handleIncomingMessage } = require('./handlers/messageHandler');
    waService.initWhatsAppWeb(handleIncomingMessage);
  }

  // Start reminder cron
  setInterval(runReminderCron, 60_000);
  console.log('[Cron] Reminder scheduler started (every 60s)');
});

module.exports = app;
