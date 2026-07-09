/**
 * WhatsApp Service using @whiskeysockets/baileys
 * - No Chrome/Puppeteer needed
 * - Saves session to .baileys_auth/ folder (survives restarts)
 * - Scans QR only once — auto-reconnects forever after
 * - Much more stable than whatsapp-web.js
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

const AUTH_DIR = path.join(__dirname, '../../.baileys_auth');

// ── State ─────────────────────────────────────────────────────
let sock           = null;
let clientReady    = false;
let qrDataUrl      = null;
let connectedName  = null;
let connectedPhone = null;
let onMessageCallback = null;

// Quiet logger (suppress Baileys noise)
const logger = pino({ level: 'silent' });

// ── JID helpers ───────────────────────────────────────────────
function normalizePhone(jid) {
  return '+' + jid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace('@lid', '');
}

function toJid(phone) {
  const num = phone.replace(/^\+/, '').replace(/[^0-9]/g, '');
  return `${num}@s.whatsapp.net`;
}

// ── Send text message ─────────────────────────────────────────
async function sendMessage(to, text) {
  if (!sock || !clientReady) throw new Error('WhatsApp not connected yet');
  const jid = to.includes('@') ? to : toJid(to);
  await sock.sendMessage(jid, { text });
  console.log(`[Baileys] ↑ OUTBOUND to ${jid}: "${text.substring(0, 80)}"`);
}

// ── Stubs for compatibility ───────────────────────────────────
async function sendButtons(to, bodyText, buttons) {
  const btnText = buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
  await sendMessage(to, `${bodyText}\n\n${btnText}`);
}
async function sendTemplate(to) {
  await sendMessage(to, `Thank you for contacting us! How can we help? 🍽️`);
}
async function markAsRead() { /* handled automatically */ }

// ── Status accessors ──────────────────────────────────────────
function isReady()      { return clientReady; }
function getQRDataUrl() { return qrDataUrl; }
function getClientInfo() {
  if (!clientReady) return null;
  return { name: connectedName, phone: connectedPhone };
}

// ── Main connection logic ─────────────────────────────────────
async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version }          = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys:  makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: true,
    browser:           ['RestoCRM', 'Chrome', '122.0.0'],
    syncFullHistory:   false,
    generateHighQualityLinkPreview: false,
  });

  // ── Credentials updated — save immediately ────────────────
  sock.ev.on('creds.update', saveCreds);

  // ── Connection state changes ──────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // New QR generated
    if (qr) {
      clientReady = false;
      console.log('\n[Baileys] 📱 QR ready — scan at http://localhost:3000/qr\n');
      try {
        qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
      } catch (e) {
        console.error('[Baileys] QR gen error:', e.message);
      }
    }

    // Connected
    if (connection === 'open') {
      clientReady    = true;
      qrDataUrl      = null;
      const info     = sock.user;
      connectedName  = info?.name || 'Unknown';
      connectedPhone = info?.id?.split(':')[0] || info?.id;
      console.log(`\n[Baileys] 🟢 Connected as: ${connectedName} (+${connectedPhone})\n`);
    }

    // Disconnected
    if (connection === 'close') {
      clientReady = false;
      const code  = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;

      console.warn(`[Baileys] ⚠️  Disconnected (code ${code}). Logged out: ${loggedOut}`);

      if (loggedOut) {
        // Session invalidated — need fresh QR
        console.log('[Baileys] 🔑 Session invalidated — generating new QR...');
        const fs = require('fs');
        if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        setTimeout(connect, 2000);
      } else {
        // Network drop or timeout — auto-reconnect with saved session (no QR)
        console.log('[Baileys] 🔄 Auto-reconnecting in 5s...');
        setTimeout(connect, 5000);
      }
    }
  });

  // ── Incoming messages ─────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      // Skip: own messages, broadcasts, groups, status
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

      console.log(`[Baileys] ↓ INBOUND from ${phone}: "${text}"`);

      // Mark as read
      try {
        await sock.readMessages([msg.key]);
      } catch (_) {}

      if (onMessageCallback) {
        onMessageCallback(parsed).catch(err =>
          console.error('[Baileys] Handler error:', err.message)
        );
      }
    }
  });
}

// ── Initialize ────────────────────────────────────────────────
function initWhatsAppWeb(messageHandler) {
  onMessageCallback = messageHandler;
  console.log('[Baileys] Starting WhatsApp connection (no Chrome needed)...');
  connect().catch(err => console.error('[Baileys] Init error:', err.message));
}

module.exports = {
  initWhatsAppWeb,
  sendMessage,
  sendButtons,
  sendTemplate,
  markAsRead,
  isReady,
  getQRDataUrl,
  getClientInfo,
};
