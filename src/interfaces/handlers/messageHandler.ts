import * as db from '../../infrastructure/database/database';
import { callGemini } from '../../infrastructure/ai/gemini';
import { executeDbAction } from './dbActionExecutor';
import * as waService from '../../infrastructure/whatsapp/whatsappWeb';
import { isDuplicateMessage, isRateLimited } from '../../infrastructure/redis/redisClient';
import { checkMessageQuota } from '../../services/provisioning';
import axios from 'axios';
import { Business, Customer } from '../../core/models/types';

/**
 * Triggers an n8n webhook workflow for the tenant.
 */
async function triggerN8nWorkflow(
  business: Business, 
  message: string, 
  history: any[], 
  customer: Customer
): Promise<{ intent: string; reply: string; db_action: Record<string, any> | null }> {
  const webhookBase = process.env.N8N_WEBHOOK_BASE_URL || 'http://localhost:5678/webhook';
  // Standard format is {webhookBase}/{workflow_name}
  const url = `${webhookBase}/${business.workflow_name}`;

  const payload = {
    message,
    customer: {
      id: customer.id,
      phone: customer.phone,
      name: customer.name,
      language: customer.language,
      dietary_prefs: customer.dietary_prefs,
      notes: customer.notes,
      visit_count: customer.visit_count,
      total_spent: customer.total_spent,
      loyalty_points: customer.loyalty_points,
    },
    business: {
      id: business.id,
      name: business.name,
      wa_phone_number: business.wa_phone_number,
      system_prompt: business.ai_system_prompt,
      knowledge_base: business.knowledge_base,
      working_hours: business.working_hours,
      feature_flags: business.feature_flags,
      crm_settings: business.crm_settings,
      payment_config: business.payment_config,
    },
    history,
  };

  console.log(`[n8n - ${business.name}] Triggering workflow at: ${url}`);
  const { data } = await axios.post(url, payload, { timeout: 10000 });

  if (!data || typeof data !== 'object') {
    throw new Error('Invalid response from n8n (must be an object)');
  }

  return {
    intent: data.intent || 'unknown',
    reply: data.reply || 'Hello! How can I help you?',
    db_action: data.db_action || null,
  };
}

/**
 * Main orchestrator: receives a parsed WhatsApp message,
 * runs it through the multi-tenant CRM pipeline, and sends a reply.
 */
export async function handleIncomingMessage(businessId: string, parsedMsg: any): Promise<void> {
  const { from, name, messageId, text, buttonReply } = parsedMsg;

  // ── Redis-based Deduplication (works across container instances) ──
  const isDuplicate = await isDuplicateMessage(messageId);
  if (isDuplicate) {
    console.log(`[Handler - ${businessId}] Duplicate message ${messageId} — skipping.`);
    return;
  }

  const phone = from.startsWith('+') ? from : `+${from}`;
  const incomingText = buttonReply?.title || text || '';

  console.log(`\n[Handler - ${businessId}] ↓ INBOUND from ${phone}: "${incomingText}"`);

  // ── Rate Limiting (per-customer, Redis-backed) ──
  const rateLimited = await isRateLimited(businessId, phone);
  if (rateLimited) {
    console.warn(`[Handler - ${businessId}] ⚠️ Rate limit exceeded for ${phone} — throttling.`);
    return;
  }

  // ── Message Quota Check (plan-based daily limit) ──
  const quota = await checkMessageQuota(businessId);
  if (!quota.allowed) {
    console.warn(`[Handler - ${businessId}] ⚠️ Daily message quota exceeded (${quota.used}/${quota.limit}).`);
    return;
  }

  // Load business configuration
  const business = await db.getBusinessById(businessId);
  if (!business) {
    console.error(`[Handler] Business not found for ID: ${businessId}. Aborting.`);
    return;
  }

  try {
    // ── Step 1: Upsert customer ──────────────────────────────
    const { customer, isNew } = await db.upsertCustomer(businessId, phone, name);
    console.log(`[Handler - ${businessId}] Customer ${isNew ? 'CREATED' : 'FOUND'}: ${customer.id} (${customer.name || 'unnamed'})`);

    // ── Step 2: Mark WhatsApp message as read ────────────────
    await waService.markAsRead(businessId, messageId);

    // ── Step 3: Log inbound message ──────────────────────────
    await db.logMessage(businessId, {
      customerId: customer.id,
      direction: 'inbound',
      content: incomingText,
      waMessageId: messageId,
    });

    // ── Step 4: Fetch message history for AI context ─────────
    const history = await db.getMessageHistory(businessId, customer.id, 10);

    // ── Step 5: Check if contact is in Manual mode ──────────
    const contactMode = await db.getContactMode(businessId, phone);
    if (contactMode === 'manual') {
      console.log(`[Handler - ${businessId}] 📋 Contact ${phone} is in MANUAL mode — AI suppressed.`);
      return; // Suppress auto reply
    }

    // ── Step 6: Check auto-reply rules (keyword match) ──────
    const autoReplyText = await db.matchAutoReply(businessId, incomingText);
    if (autoReplyText) {
      console.log(`[Handler - ${businessId}] ⚡ Auto-reply matched — sending rule response.`);
      await waService.sendMessage(businessId, phone, autoReplyText);
      await db.logMessage(businessId, {
        customerId: customer.id,
        direction: 'outbound',
        content: autoReplyText,
        intent: 'auto_reply',
      });
      return; // Skip n8n / Gemini
    }

    // ── Step 7: n8n Workflow Trigger or Fallback to Gemini ───
    let aiResponse = null;
    if (business.workflow_name && process.env.N8N_ENABLED !== 'false') {
      try {
        aiResponse = await triggerN8nWorkflow(business, incomingText, history, customer);
      } catch (err: any) {
        console.error(`[Handler - ${businessId}] n8n workflow execution failed, falling back to local Gemini:`, err.message);
      }
    }

    if (!aiResponse) {
      console.log(`[Handler - ${businessId}] Processing message via local Gemini engine...`);
      aiResponse = await callGemini(business.ai_system_prompt, incomingText, history, customer);
    }

    const { intent, reply, db_action } = aiResponse;
    console.log(`[Handler - ${businessId}] Response → intent: ${intent} | reply: "${reply}"`);

    // ── Step 8: Execute DB action from AI / n8n ─────────────
    const dbResult = await executeDbAction(businessId, db_action, customer.id);
    if (dbResult) {
      console.log(`[Handler - ${businessId}] DB action executed successfully`);
    }

    // ── Step 9: Update lead activity timestamp ───────────────
    const lead = await db.getLeadByCustomer(businessId, customer.id);
    if (lead && lead.stage !== 'converted' && lead.stage !== 'lost') {
      await db.updateLeadById(businessId, lead.id, { last_activity: new Date().toISOString() });
    }

    // ── Step 10: Send reply via WhatsApp ─────────────────────
    await waService.sendMessage(businessId, phone, reply);

    // ── Step 11: Log outbound message ────────────────────────
    await db.logMessage(businessId, {
      customerId: customer.id,
      direction: 'outbound',
      content: reply,
      intent,
      aiResponse,
    });

    // ── Step 12: Increment visit count on bookings ───────────
    if (intent === 'booking') {
      await db.updateCustomer(businessId, customer.id, { visit_count: (customer.visit_count || 0) + 1 });
    }

  } catch (err: any) {
    console.error(`[Handler - ${businessId}] Error processing message:`, err.message, err.stack);
    // Graceful fallback to customer
    try {
      await waService.sendMessage(businessId, phone,
        `Apologies, we're experiencing a technical issue. Please call us at ${business.wa_phone_number || 'our service line'} 🙏`
      );
    } catch (_) {}
  }
}
