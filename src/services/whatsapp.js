const axios = require('axios');
require('dotenv').config();

// Lazily load db to avoid circular dependencies
let db = null;
function getDb() {
  if (!db) db = require('./supabase');
  return db;
}

// ── Helper to resolve credentials per business ────────────────
async function getCredentials(businessId) {
  const biz = await getDb().getBusinessById(businessId);
  if (!biz) throw new Error(`Business not found: ${businessId}`);

  const apiKeys = biz.api_keys || {};
  const accessToken = apiKeys.meta_access_token || process.env.META_ACCESS_TOKEN;
  const phoneNumberId = apiKeys.meta_phone_number_id || process.env.META_PHONE_NUMBER_ID;
  const apiVersion = process.env.META_API_VERSION || 'v20.0';

  if (!accessToken || !phoneNumberId) {
    throw new Error(`Meta Cloud API credentials missing for business: ${biz.name}`);
  }

  return {
    url: `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  };
}

// ══════════════════════════════════════════════════════════════
//  SEND TEXT MESSAGE
// ══════════════════════════════════════════════════════════════
async function sendMessage(businessId, to, text) {
  try {
    const { url, headers } = await getCredentials(businessId);
    const { data } = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: text },
      },
      { headers }
    );
    return data;
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error(`[WhatsApp - ${businessId}] sendMessage failed:`, JSON.stringify(detail, null, 2));
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════
//  SEND INTERACTIVE BUTTONS
// ══════════════════════════════════════════════════════════════
async function sendButtons(businessId, to, bodyText, buttons) {
  try {
    const { url, headers } = await getCredentials(businessId);
    const { data } = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: {
            buttons: buttons.map(b => ({
              type: 'reply',
              reply: { id: b.id, title: b.title },
            })),
          },
        },
      },
      { headers }
    );
    return data;
  } catch (err) {
    console.error(`[WhatsApp - ${businessId}] sendButtons failed:`, err.response?.data || err.message);
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════
//  SEND TEMPLATE
// ══════════════════════════════════════════════════════════════
async function sendTemplate(businessId, to, templateName, languageCode = 'en', components = []) {
  try {
    const { url, headers } = await getCredentials(businessId);
    const { data } = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components,
        },
      },
      { headers }
    );
    return data;
  } catch (err) {
    console.error(`[WhatsApp - ${businessId}] sendTemplate failed:`, err.response?.data || err.message);
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════
//  MARK MESSAGE AS READ
// ══════════════════════════════════════════════════════════════
async function markAsRead(businessId, messageId) {
  try {
    const { url, headers } = await getCredentials(businessId);
    await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      },
      { headers }
    );
  } catch (err) {
    console.warn(`[WhatsApp - ${businessId}] markAsRead failed:`, err.response?.data || err.message);
  }
}

// ══════════════════════════════════════════════════════════════
//  PARSE INCOMING WEBHOOK PAYLOAD
// ══════════════════════════════════════════════════════════════
function parseWebhookMessage(body) {
  try {
    const entry   = body.entry?.[0];
    const change  = entry?.changes?.[0];
    const value   = change?.value;

    if (!value?.messages?.[0]) return null;

    const message = value.messages[0];
    const contact = value.contacts?.[0];
    const recipientPhone = value.metadata?.display_phone_number || null;

    return {
      recipientPhone,                                      // Business's phone number
      from:       message.from,                            // Customer's phone number
      name:       contact?.profile?.name || null,
      messageId:  message.id,
      type:       message.type,
      text:       message.text?.body || '',
      buttonReply: message.interactive?.button_reply || null,
      timestamp:  new Date(parseInt(message.timestamp) * 1000).toISOString(),
    };
  } catch (e) {
    console.error('[WhatsApp] parseWebhookMessage error:', e.message);
    return null;
  }
}

module.exports = { sendMessage, sendButtons, sendTemplate, markAsRead, parseWebhookMessage };
