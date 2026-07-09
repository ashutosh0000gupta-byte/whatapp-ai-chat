const axios = require('axios');
require('dotenv').config();

const BASE_URL = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v20.0'}/${process.env.META_PHONE_NUMBER_ID}`;

const headers = () => ({
  Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
  'Content-Type': 'application/json',
});

// ══════════════════════════════════════════════════════════════
//  SEND TEXT MESSAGE
// ══════════════════════════════════════════════════════════════
async function sendMessage(to, text) {
  try {
    const { data } = await axios.post(
      `${BASE_URL}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: text },
      },
      { headers: headers() }
    );
    return data;
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('[WhatsApp] sendMessage failed:', JSON.stringify(detail, null, 2));
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════
//  SEND INTERACTIVE BUTTONS (up to 3 quick-reply buttons)
// ══════════════════════════════════════════════════════════════
async function sendButtons(to, bodyText, buttons) {
  // buttons: [{ id: 'btn_1', title: 'Confirm' }, ...]
  try {
    const { data } = await axios.post(
      `${BASE_URL}/messages`,
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
      { headers: headers() }
    );
    return data;
  } catch (err) {
    console.error('[WhatsApp] sendButtons failed:', err.response?.data || err.message);
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════
//  SEND TEMPLATE (e.g. reservation confirmation)
//  Template must be pre-approved in Meta Business Manager.
// ══════════════════════════════════════════════════════════════
async function sendTemplate(to, templateName, languageCode = 'en', components = []) {
  try {
    const { data } = await axios.post(
      `${BASE_URL}/messages`,
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
      { headers: headers() }
    );
    return data;
  } catch (err) {
    console.error('[WhatsApp] sendTemplate failed:', err.response?.data || err.message);
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════
//  MARK MESSAGE AS READ
// ══════════════════════════════════════════════════════════════
async function markAsRead(messageId) {
  try {
    await axios.post(
      `${BASE_URL}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      },
      { headers: headers() }
    );
  } catch (err) {
    // Non-critical — log and continue
    console.warn('[WhatsApp] markAsRead failed:', err.response?.data || err.message);
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

    return {
      from:       message.from,                        // phone e.g. "919876543210"
      name:       contact?.profile?.name || null,
      messageId:  message.id,
      type:       message.type,                        // text | image | interactive
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
