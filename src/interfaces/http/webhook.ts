import express, { Request, Response, Router } from 'express';
import { parseWebhookMessage } from '../../infrastructure/whatsapp/whatsapp';
import { handleIncomingMessage } from '../handlers/messageHandler';
import * as db from '../../infrastructure/database/database';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();

// ── GET /webhook — Meta verification handshake ───────────────
router.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('[Webhook] ✅ Meta verification passed');
    return res.status(200).send(challenge);
  }

  console.warn('[Webhook] ❌ Meta verification failed — check WEBHOOK_VERIFY_TOKEN');
  res.sendStatus(403);
});

// ── POST /webhook — Incoming WhatsApp messages ───────────────
router.post('/', (req: Request, res: Response) => {
  // Respond to Meta immediately (must reply within 5s or Meta retries)
  res.sendStatus(200);

  const body = req.body;

  // Filter: only handle WhatsApp Business Account messages
  if (body.object !== 'whatsapp_business_account') return;

  const parsed = parseWebhookMessage(body);
  if (!parsed || (!parsed.text && !parsed.buttonReply)) {
    console.log('[Webhook] Non-text message or status update — skipping.');
    return;
  }

  // Process asynchronously
  (async () => {
    if (!parsed.recipientPhone) {
      console.warn('[Webhook] Missing recipient display phone number in message payload.');
      return;
    }
    
    // Look up business by wa_phone_number matching the recipient display phone
    const business = await db.getBusinessByPhone(parsed.recipientPhone);
    if (!business) {
      console.warn(`[Webhook] No registered business found matching phone: ${parsed.recipientPhone}`);
      return;
    }

    await handleIncomingMessage(business.id, parsed);
  })().catch(err =>
    console.error('[Webhook] Unhandled error in webhook processor:', err)
  );
});

export default router;
