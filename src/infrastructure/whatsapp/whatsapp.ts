import axios from 'axios';
import dotenv from 'dotenv';
import * as db from '../database/database';

dotenv.config();

// ── Helper to resolve credentials per business ────────────────
async function getCredentials(businessId: string) {
  const biz = await db.getBusinessById(businessId);
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
export async function sendMessage(businessId: string, to: string, text: string): Promise<any> {
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
  } catch (err: any) {
    const detail = err.response?.data || err.message;
    console.error(`[WhatsApp - ${businessId}] sendMessage failed:`, JSON.stringify(detail, null, 2));
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════
//  SEND INTERACTIVE BUTTONS
// ══════════════════════════════════════════════════════════════
export async function sendButtons(businessId: string, to: string, bodyText: string, buttons: Array<{ id: string; title: string }>): Promise<any> {
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
  } catch (err: any) {
    console.error(`[WhatsApp - ${businessId}] sendButtons failed:`, err.response?.data || err.message);
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════
//  SEND TEMPLATE
// ══════════════════════════════════════════════════════════════
export async function sendTemplate(businessId: string, to: string, templateName: string, languageCode = 'en', components: any[] = []): Promise<any> {
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
  } catch (err: any) {
    console.error(`[WhatsApp - ${businessId}] sendTemplate failed:`, err.response?.data || err.message);
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════
//  MARK MESSAGE AS READ
// ══════════════════════════════════════════════════════════════
export async function markAsRead(businessId: string, messageId: string): Promise<void> {
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
  } catch (err: any) {
    console.warn(`[WhatsApp - ${businessId}] markAsRead failed:`, err.response?.data || err.message);
  }
}

// ══════════════════════════════════════════════════════════════
//  PARSE INCOMING WEBHOOK PAYLOAD
// ══════════════════════════════════════════════════════════════
export function parseWebhookMessage(body: any): any {
  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value?.messages?.[0]) return null;

    const message = value.messages[0];
    const contact = value.contacts?.[0];
    const recipientPhone = value.metadata?.display_phone_number || null;

    return {
      recipientPhone, // Business's phone number
      from: message.from, // Customer's phone number
      name: contact?.profile?.name || null,
      messageId: message.id,
      type: message.type,
      text: message.text?.body || '',
      buttonReply: message.interactive?.button_reply || null,
      timestamp: new Date(parseInt(message.timestamp) * 1000).toISOString(),
    };
  } catch (e: any) {
    console.error('[WhatsApp] parseWebhookMessage error:', e.message);
    return null;
  }
}
