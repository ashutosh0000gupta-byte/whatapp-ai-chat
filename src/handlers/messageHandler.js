const db = require('../services/supabase');
const { callGemini } = require('../services/gemini');
// waService is set globally in index.js (supports both 'web' and 'meta' modes)

// Auto-reply + contact-mode helpers always come from localDb regardless of DB_MODE
const localDb = require('../services/localDb');

const { executeDbAction } = require('./dbActionExecutor');

// Simple in-memory lock to prevent duplicate processing of same message
const processing = new Set();

/**
 * Main orchestrator: receives a parsed WhatsApp message,
 * runs it through the full CRM pipeline, and sends a reply.
 */
async function handleIncomingMessage(parsedMsg) {
  const { from, name, messageId, text, buttonReply, timestamp } = parsedMsg;

  // Deduplicate — Meta can deliver webhooks multiple times
  if (processing.has(messageId)) {
    console.log(`[Handler] Duplicate message ${messageId} — skipping.`);
    return;
  }
  processing.add(messageId);
  setTimeout(() => processing.delete(messageId), 60_000); // clear after 1 min

  const phone = from.startsWith('+') ? from : `+${from}`;
  const incomingText = buttonReply?.title || text || '';

  console.log(`\n[Handler] ↓ INBOUND from ${phone}: "${incomingText}"`);

  try {
    // ── Step 1: Upsert customer ──────────────────────────────
    const { customer, isNew } = await db.upsertCustomer(phone, name);
    console.log(`[Handler] Customer ${isNew ? 'CREATED' : 'FOUND'}: ${customer.id} (${customer.name || 'unnamed'})`);

    // ── Step 2: Mark WhatsApp message as read ────────────────
    if (global.waService?.markAsRead) await global.waService.markAsRead(messageId);

    // ── Step 3: Log inbound message ──────────────────────────
    await db.logMessage({
      customerId:  customer.id,
      direction:   'inbound',
      content:     incomingText,
      waMessageId: messageId,
    });

    // ── Step 4: Fetch message history for AI context ─────────
    const history = await db.getMessageHistory(customer.id, 10);

    // ── Step 4a: Check if contact is in Manual mode ──────────
    const contactMode = localDb.getContactMode(phone);
    if (contactMode === 'manual') {
      console.log(`[Handler] 📋 Contact ${phone} is in MANUAL mode — AI suppressed, agent will reply.`);
      return; // Don't auto-reply; let the human agent handle it
    }

    // ── Step 4b: Check auto-reply rules (keyword match) ──────
    const autoReplyText = localDb.matchAutoReply(incomingText);
    if (autoReplyText) {
      console.log(`[Handler] ⚡ Auto-reply matched for "${incomingText}" — sending rule response.`);
      await global.waService.sendMessage(phone, autoReplyText);
      await db.logMessage({
        customerId: customer.id,
        direction:  'outbound',
        content:    autoReplyText,
        intent:     'auto_reply',
      });
      return; // Skip Gemini
    }

    // ── Step 5: Call Gemini AI ───────────────────────────────
    const aiResponse = await callGemini(incomingText, history, customer);
    const { intent, reply, db_action } = aiResponse;

    console.log(`[Handler] Gemini → intent: ${intent} | reply: "${reply}"`);

    // ── Step 6: Execute DB action from AI ───────────────────
    const dbResult = await executeDbAction(db_action, customer.id);
    if (dbResult) {
      console.log(`[Handler] DB action executed successfully`);
    }

    // ── Step 7: Update lead activity timestamp ───────────────
    const lead = await db.getLeadByCustomer(customer.id);
    if (lead && lead.stage !== 'converted' && lead.stage !== 'lost') {
      // Works with both local and Supabase DB
      if (typeof db.updateLeadById === 'function') {
        await db.updateLeadById(lead.id, { last_activity: new Date().toISOString() });
      } else {
        await db.supabase
          .from('leads')
          .update({ last_activity: new Date().toISOString() })
          .eq('customer_id', customer.id);
      }
    }

    // ── Step 8: Send reply via WhatsApp ──────────────────────
    await global.waService.sendMessage(phone, reply);
    console.log(`[Handler] ↑ OUTBOUND to ${phone}: "${reply}"`);

    // ── Step 9: Log outbound message ─────────────────────────
    await db.logMessage({
      customerId: customer.id,
      direction:  'outbound',
      content:    reply,
      intent,
      aiResponse,
    });

    // ── Step 10: Increment visit count on bookings ───────────
    if (intent === 'booking') {
      await db.updateCustomer(customer.id, { visit_count: (customer.visit_count || 0) + 1 });
    }

  } catch (err) {
    console.error('[Handler] Error processing message:', err.message, err.stack);
    // Send a graceful fallback to the customer
    try {
      await global.waService.sendMessage(phone,
        `Apologies, we're experiencing a technical issue. Please call us at ${process.env.RESTAURANT_PHONE || 'our helpline'} 🙏`
      );
    } catch (_) { /* ignore send errors in error handler */ }
  }
}

module.exports = { handleIncomingMessage };
