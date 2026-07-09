const express  = require('express');
const router   = express.Router();
const { parseWebhookMessage } = require('../services/whatsapp');
const { handleIncomingMessage } = require('../handlers/messageHandler');
require('dotenv').config();

// ── GET /webhook — Meta verification handshake ───────────────
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('[Webhook] ✅ Meta verification passed');
    return res.status(200).send(challenge);
  }

  console.warn('[Webhook] ❌ Meta verification failed — check WEBHOOK_VERIFY_TOKEN');
  res.sendStatus(403);
});

// ── POST /webhook — Incoming WhatsApp messages ───────────────
router.post('/', (req, res) => {
  // Respond to Meta immediately (must reply within 5s or Meta retries)
  res.sendStatus(200);

  const body = req.body;

  // Filter: only handle WhatsApp Business Account messages
  if (body.object !== 'whatsapp_business_account') return;

  const parsed = parseWebhookMessage(body);
  if (!parsed || !parsed.text && !parsed.buttonReply) {
    console.log('[Webhook] Non-text message or status update — skipping.');
    return;
  }

  // Process asynchronously (don't block the 200 response)
  handleIncomingMessage(parsed).catch(err =>
    console.error('[Webhook] Unhandled error in handleIncomingMessage:', err)
  );
});

module.exports = router;
