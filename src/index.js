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
// Default: 'web' — no Meta credentials needed
const WA_MODE = (process.env.WA_MODE || 'web').toLowerCase();

let waService;
if (WA_MODE === 'meta') {
  waService = require('./services/whatsapp');
  console.log('[App] Mode: Meta WhatsApp Cloud API');
} else {
  waService = require('./services/whatsappWeb');
  console.log('[App] Mode: WhatsApp Web (QR scan)');
}

// Export so messageHandler can use it
global.waService = waService;

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security & Middleware ─────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // disabled for QR page
app.use(morgan('dev'));
app.use(cors({ origin: process.env.DASHBOARD_ORIGIN || '*' }));

const apiLimiter = rateLimit({ windowMs: 60_000, max: 300 });
app.use('/api', apiLimiter);
app.use(express.json({ limit: '5mb' }));

// ── Routes ────────────────────────────────────────────────────
// Only mount webhook route in Meta mode
if (WA_MODE === 'meta') {
  const webhookLimiter = rateLimit({ windowMs: 60_000, max: 1000 });
  app.use('/webhook', webhookLimiter);
  app.use('/webhook', webhookRouter);
}
app.use('/api', apiRouter);

// ── QR Code Page (WhatsApp Web mode) ─────────────────────────
app.get('/qr', (req, res) => {
  if (WA_MODE !== 'web') {
    return res.send('<h2>QR not applicable in Meta API mode</h2>');
  }

  const qr      = waService.getQRDataUrl?.();
  const ready   = waService.isReady?.();
  const info    = waService.getClientInfo?.();

  if (ready && info) {
    return res.send(`
      <!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>WhatsApp Connected</title>
      <style>body{font-family:Inter,sans-serif;background:#0a0f1e;color:#f0f4ff;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;}
      .card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:32px 40px;text-align:center;}
      h2{color:#25D366;font-size:22px;} p{color:#94a3b8;}</style></head>
      <body><div class="card">
        <div style="font-size:52px">🟢</div>
        <h2>WhatsApp Connected!</h2>
        <p>Logged in as: <strong style="color:#f0f4ff">${info.name}</strong></p>
        <p>Phone: <strong style="color:#63b3ed">+${info.phone}</strong></p>
        <p style="margin-top:16px;color:#4fd1c5">✅ Ready to receive & send messages</p>
        <a href="http://localhost:5173" style="display:inline-block;margin-top:20px;padding:10px 24px;background:#25D366;color:#fff;border-radius:8px;font-weight:700;text-decoration:none">Open Dashboard →</a>
      </div></body></html>
    `);
  }

  if (qr) {
    return res.send(`
      <!DOCTYPE html><html><head><meta charset="UTF-8">
      <meta http-equiv="refresh" content="5">
      <title>Scan QR — WhatsApp CRM</title>
      <style>body{font-family:Inter,sans-serif;background:#0a0f1e;color:#f0f4ff;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;}
      .card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:32px 40px;text-align:center;}
      h2{color:#25D366;font-size:22px;} p{color:#94a3b8;font-size:14px;}
      img{border-radius:12px;border:4px solid #25D366;display:block;margin:20px auto;}
      .step{background:rgba(37,211,102,.08);border:1px solid rgba(37,211,102,.2);border-radius:10px;padding:10px 18px;margin:6px 0;font-size:13px;text-align:left;}</style></head>
      <body><div class="card">
        <div style="font-size:42px">📱</div>
        <h2>Scan to Connect WhatsApp</h2>
        <img src="${qr}" width="260" alt="QR Code" />
        <div style="margin-top:20px;max-width:300px">
          <div class="step">1️⃣  Open <strong>WhatsApp</strong> on your phone</div>
          <div class="step">2️⃣  Tap <strong>Menu (⋮)</strong> → <strong>Linked Devices</strong></div>
          <div class="step">3️⃣  Tap <strong>Link a Device</strong></div>
          <div class="step">4️⃣  Point camera at QR above</div>
        </div>
        <p style="margin-top:16px">🔄 Page refreshes every 5s · QR expires in ~20s</p>
      </div></body></html>
    `);
  }

  // Still initializing
  res.send(`
    <!DOCTYPE html><html><head><meta charset="UTF-8">
    <meta http-equiv="refresh" content="3">
    <title>Starting — WhatsApp CRM</title>
    <style>body{font-family:Inter,sans-serif;background:#0a0f1e;color:#f0f4ff;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;}</style>
    </head><body>
      <div style="font-size:42px">⏳</div>
      <h2 style="color:#63b3ed">Starting WhatsApp Web...</h2>
      <p style="color:#94a3b8">Page refreshes automatically. QR code will appear shortly.</p>
    </body></html>
  `);
});

// ── Health Check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  const ready = WA_MODE === 'web' ? (waService.isReady?.() || false) : true;
  const info  = WA_MODE === 'web' ? (waService.getClientInfo?.() || null) : null;
  res.json({
    status:      'ok',
    mode:        WA_MODE,
    waConnected: ready,
    waInfo:      info,
    restaurant:  process.env.RESTAURANT_NAME || 'Restaurant CRM',
    timestamp:   new Date().toISOString(),
  });
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
      if (!phone) continue;
      await waService.sendMessage(phone, reminder.message);
      await db.markReminderSent(reminder.id);
      console.log(`[Cron] Sent reminder to ${phone}`);
    }
  } catch (err) {
    console.error('[Cron] Reminder error:', err.message);
  }
}

// ── Start Server ──────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║  🍽️  WhatsApp CRM — ${process.env.RESTAURANT_NAME || 'Restaurant'}
  ║  🚀  Server: http://localhost:${PORT}
  ║  📱  QR Page: http://localhost:${PORT}/qr
  ║  📊  Dashboard: http://localhost:5173
  ╚══════════════════════════════════════════╝
  `);

  // Start WhatsApp Web (QR mode) or Meta webhook
  if (WA_MODE === 'web') {
    const { handleIncomingMessage } = require('./handlers/messageHandler');
    waService.initWhatsAppWeb(handleIncomingMessage);
  }

  // Start reminder cron
  setInterval(runReminderCron, 60_000);
  console.log('[Cron] Reminder scheduler started (every 60s)');

  // Warm up DB
  db.getDashboardStats().catch(() => {});
});

module.exports = app;
