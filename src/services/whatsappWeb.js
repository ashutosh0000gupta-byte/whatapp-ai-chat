/**
 * WhatsApp Session Manager using @whiskeysockets/baileys
 * - Manages multiple concurrent WhatsApp sessions (one per business tenant)
 * - Isolates session auth files under `.baileys_auth/business_<business_id>/`
 * - Saves session connection status to the database (whatsapp_sessions)
 * - Restores all active sessions on server boot
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
  isJidGroup,
} = require('@whiskeysockets/baileys');

const QRCode  = require('qrcode');
const path    = require('path');
const pino    = require('pino');
const fs      = require('fs');
const db      = require('./supabase'); // Multi-tenant db interface

// Quiet logger
const logger = pino({ level: 'silent' });

// ── In-memory Sessions Store ──────────────────────────────────
// Maps businessId -> { sock, clientReady, qrDataUrl, connectedName, connectedPhone }
const sessions = new Map();
let onMessageCallback = null;

// ── JID helpers ───────────────────────────────────────────────
function normalizePhone(jid) {
  return '+' + jid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace('@lid', '');
}

function toJid(phone) {
  const num = phone.replace(/^\+/, '').replace(/[^0-9]/g, '');
  return `${num}@s.whatsapp.net`;
}

// ── Session Accessors ─────────────────────────────────────────
function getSessionState(businessId) {
  return sessions.get(businessId) || null;
}

function isReady(businessId) {
  return !!sessions.get(businessId)?.clientReady;
}

function getQRDataUrl(businessId) {
  return sessions.get(businessId)?.qrDataUrl || null;
}

function getClientInfo(businessId) {
  const s = sessions.get(businessId);
  if (!s || !s.clientReady) return null;
  return { name: s.connectedName, phone: s.connectedPhone };
}

// ── Send Messages (parameterized by businessId) ───────────────
async function sendMessage(businessId, to, text) {
  const s = sessions.get(businessId);
  if (!s || !s.sock || !s.clientReady) {
    throw new Error(`WhatsApp session for business ${businessId} is not connected yet`);
  }
  const jid = to.includes('@') ? to : toJid(to);
  await s.sock.sendMessage(jid, { text });
  console.log(`[Baileys - ${businessId}] ↑ OUTBOUND to ${jid}: "${text.substring(0, 80)}"`);
}

async function sendButtons(businessId, to, bodyText, buttons) {
  const btnText = buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
  await sendMessage(businessId, to, `${bodyText}\n\n${btnText}`);
}

async function sendTemplate(businessId, to) {
  await sendMessage(businessId, to, `Thank you for contacting us! How can we help?`);
}

async function markAsRead() { /* Handled automatically by socket readEvents */ }

// ── Connect Business Session ──────────────────────────────────
async function connectSession(businessId) {
  const authDir = path.join(__dirname, `../../.baileys_auth/business_${businessId}`);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  // Clear existing session context in memory if any
  if (sessions.has(businessId)) {
    try { sessions.get(businessId).sock.ev.removeAllListeners(); } catch (_) {}
  }

  const sessionObj = {
    sock: null,
    clientReady: false,
    qrDataUrl: null,
    connectedName: null,
    connectedPhone: null,
  };
  sessions.set(businessId, sessionObj);

  console.log(`[SessionManager] 🔌 Starting session for Business: ${businessId}`);
  await db.updateSessionStatus(businessId, null, 'connecting');

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version }          = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys:  makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      browser:           ['BusinessFlow CRM', 'Chrome', '122.0.0'],
      syncFullHistory:   false,
      generateHighQualityLinkPreview: false,
    });

    sessionObj.sock = sock;

    // Credentials updated - save immediately
    sock.ev.on('creds.update', saveCreds);

    // Connection state changes
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        sessionObj.clientReady = false;
        try {
          sessionObj.qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
          console.log(`[SessionManager - ${businessId}] 📱 QR code refreshed`);
        } catch (e) {
          console.error(`[SessionManager - ${businessId}] QR gen error:`, e.message);
        }
      }

      if (connection === 'open') {
        sessionObj.clientReady = true;
        sessionObj.qrDataUrl = null;
        const info = sock.user;
        sessionObj.connectedName = info?.name || 'Business User';
        sessionObj.connectedPhone = info?.id?.split(':')[0] || info?.id;

        console.log(`[SessionManager - ${businessId}] 🟢 Connected (+${sessionObj.connectedPhone})`);
        await db.updateSessionStatus(businessId, sessionObj.connectedPhone, 'connected');
      }

      if (connection === 'close') {
        sessionObj.clientReady = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;

        console.warn(`[SessionManager - ${businessId}] ⚠️ Disconnected (code ${code}). LoggedOut: ${loggedOut}`);

        if (loggedOut) {
          console.log(`[SessionManager - ${businessId}] 🔑 Session invalidated — clearing files.`);
          sessions.delete(businessId);
          if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
          }
          await db.updateSessionStatus(businessId, null, 'disconnected');
          // Reconnect with fresh state
          setTimeout(() => connectSession(businessId), 2000);
        } else {
          await db.updateSessionStatus(businessId, null, 'disconnected');
          console.log(`[SessionManager - ${businessId}] 🔄 Auto-reconnecting in 5s...`);
          setTimeout(() => connectSession(businessId), 5000);
        }
      }
    });

    // Incoming messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        if (isJidBroadcast(msg.key.remoteJid)) continue;
        if (isJidGroup(msg.key.remoteJid))     continue;

        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.documentMessage?.caption ||
          '';

        if (!text) continue;

        const phone = normalizePhone(msg.key.remoteJid);
        const name  = msg.pushName || null;

        const parsed = {
          from:        phone,
          name,
          messageId:   msg.key.id,
          type:        'text',
          text,
          buttonReply: null,
          timestamp:   new Date(Number(msg.messageTimestamp) * 1000).toISOString(),
          _rawJid:     msg.key.remoteJid,
        };

        console.log(`[SessionManager - ${businessId}] ↓ INBOUND from ${phone}: "${text}"`);

        // Mark as read
        try {
          await sock.readMessages([msg.key]);
        } catch (_) {}

        if (onMessageCallback) {
          onMessageCallback(businessId, parsed).catch(err =>
            console.error(`[SessionManager - ${businessId}] Callback error:`, err.message)
          );
        }
      }
    });

  } catch (err) {
    console.error(`[SessionManager - ${businessId}] Connection setup error:`, err.message);
    await db.updateSessionStatus(businessId, null, 'disconnected');
  }
}

// ── Startup & Initialization ──────────────────────────────────
async function initAllActiveSessions() {
  try {
    const businesses = await db.getAllBusinesses();
    console.log(`[SessionManager] Found ${businesses.length} businesses. Initializing sessions...`);
    for (const biz of businesses) {
      // Connect each business session in background
      connectSession(biz.id).catch(err =>
        console.error(`[SessionManager] Failed to start business ${biz.name}:`, err.message)
      );
    }
  } catch (err) {
    console.error('[SessionManager] initAllActiveSessions error:', err.message);
  }
}

function initWhatsAppWeb(messageHandler) {
  onMessageCallback = messageHandler;
  console.log('[SessionManager] Initializing Multi-Tenant WhatsApp Sessions...');
  initAllActiveSessions();
}

module.exports = {
  initWhatsAppWeb,
  initBusinessSession: connectSession,
  sendMessage,
  sendButtons,
  sendTemplate,
  markAsRead,
  isReady,
  getQRDataUrl,
  getClientInfo,
  getSessionState,
};
