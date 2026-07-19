import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
  isJidGroup,
  WASocket,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import * as db from '../database/database';
import { useDbAuthState } from './baileysDbAuth';
import { pool } from '../database/database';

const logger = pino({ level: 'silent' });

interface SessionState {
  sock: WASocket | null;
  clientReady: boolean;
  qrDataUrl: string | null;
  connectedName: string | null;
  connectedPhone: string | null;
}

// ── In-memory Sessions Store ──────────────────────────────────
const sessions = new Map<string, SessionState>();
let onMessageCallback: ((businessId: string, parsedMsg: any) => Promise<void>) | null = null;

// ── JID helpers ───────────────────────────────────────────────
function normalizePhone(jid: string): string {
  return '+' + jid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace('@lid', '');
}

function toJid(phone: string): string {
  const num = phone.replace(/^\+/, '').replace(/[^0-9]/g, '');
  return `${num}@s.whatsapp.net`;
}

// ── Session Accessors ─────────────────────────────────────────
export function getSessionState(businessId: string): SessionState | null {
  return sessions.get(businessId) || null;
}

export function isReady(businessId: string): boolean {
  return !!sessions.get(businessId)?.clientReady;
}

export function getQRDataUrl(businessId: string): string | null {
  return sessions.get(businessId)?.qrDataUrl || null;
}

export function getClientInfo(businessId: string): { name: string | null; phone: string | null } | null {
  const s = sessions.get(businessId);
  if (!s || !s.clientReady) return null;
  return { name: s.connectedName, phone: s.connectedPhone };
}

// ── Send Messages ─────────────────────────────────────────────
export async function sendMessage(businessId: string, to: string, text: string): Promise<void> {
  const s = sessions.get(businessId);
  if (!s || !s.sock || !s.clientReady) {
    throw new Error(`WhatsApp session for business ${businessId} is not connected yet`);
  }
  const jid = to.includes('@') ? to : toJid(to);
  await s.sock.sendMessage(jid, { text });
  console.log(`[Baileys - ${businessId}] ↑ OUTBOUND to ${jid}: "${text.substring(0, 80)}"`);
}

export async function sendButtons(businessId: string, to: string, bodyText: string, buttons: Array<{ title: string }>): Promise<void> {
  const btnText = buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
  await sendMessage(businessId, to, `${bodyText}\n\n${btnText}`);
}

export async function sendTemplate(businessId: string, to: string): Promise<void> {
  await sendMessage(businessId, to, `Thank you for contacting us! How can we help?`);
}

export async function markAsRead(businessId: string, messageId: string): Promise<void> {
  // Handled automatically or optionally by calling readMessages if needed
}

// ── Connect Business Session ──────────────────────────────────
export async function connectSession(businessId: string): Promise<void> {
  // Clear existing session context in memory if any
  const existing = sessions.get(businessId);
  if (existing && existing.sock) {
    try {
      existing.sock.ev.removeAllListeners();
    } catch (_) {}
  }

  const sessionObj: SessionState = {
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
    const { state, saveCreds } = await useDbAuthState(businessId);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      browser: ['BusinessFlow CRM', 'Chrome', '122.0.0'],
      syncFullHistory: false,
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
        } catch (e: any) {
          console.error(`[SessionManager - ${businessId}] QR gen error:`, e.message);
        }
      }

      if (connection === 'open') {
        sessionObj.clientReady = true;
        sessionObj.qrDataUrl = null;
        const info = sock.user;
        sessionObj.connectedName = info?.name || 'Business User';
        sessionObj.connectedPhone = info?.id?.split(':')[0] || info?.id || 'Unknown';

        console.log(`[SessionManager - ${businessId}] 🟢 Connected (+${sessionObj.connectedPhone})`);
        await db.updateSessionStatus(businessId, sessionObj.connectedPhone, 'connected');
      }

      if (connection === 'close') {
        sessionObj.clientReady = false;
        const code = (lastDisconnect?.error as any)?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;

        console.warn(`[SessionManager - ${businessId}] ⚠️ Disconnected (code ${code}). LoggedOut: ${loggedOut}`);

        if (loggedOut) {
          console.log(`[SessionManager - ${businessId}] 🔑 Session invalidated — clearing database auth credentials.`);
          sessions.delete(businessId);
          
          // Clear credentials and keys in Postgres database
          await pool.query('DELETE FROM baileys_keys WHERE business_id = $1', [businessId]);
          await pool.query('UPDATE whatsapp_sessions SET creds = NULL WHERE business_id = $1', [businessId]);
          
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
        if (!msg.key.remoteJid) continue;
        if (isJidBroadcast(msg.key.remoteJid)) continue;
        if (isJidGroup(msg.key.remoteJid)) continue;

        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.documentMessage?.caption ||
          '';

        if (!text) continue;

        const phone = normalizePhone(msg.key.remoteJid);
        const name = msg.pushName || null;

        const parsed = {
          from: phone,
          name,
          messageId: msg.key.id,
          type: 'text',
          text,
          buttonReply: null,
          timestamp: new Date(Number(msg.messageTimestamp) * 1000).toISOString(),
          _rawJid: msg.key.remoteJid,
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

  } catch (err: any) {
    console.error(`[SessionManager - ${businessId}] Connection setup error:`, err.message);
    await db.updateSessionStatus(businessId, null, 'disconnected');
  }
}

// ── Startup & Initialization ──────────────────────────────────
export async function initAllActiveSessions(): Promise<void> {
  try {
    const businesses = await db.getAllBusinesses();
    console.log(`[SessionManager] Found ${businesses.length} businesses. Initializing sessions...`);
    for (const biz of businesses) {
      // Connect each business session in background
      connectSession(biz.id).catch(err =>
        console.error(`[SessionManager] Failed to start business ${biz.name}:`, err.message)
      );
    }
  } catch (err: any) {
    console.error('[SessionManager] initAllActiveSessions error:', err.message);
  }
}

export function initWhatsAppWeb(messageHandler: (businessId: string, parsedMsg: any) => Promise<void>): void {
  onMessageCallback = messageHandler;
  console.log('[SessionManager] Initializing Multi-Tenant WhatsApp Sessions...');
  initAllActiveSessions();
}
