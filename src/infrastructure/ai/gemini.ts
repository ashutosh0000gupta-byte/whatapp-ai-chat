import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { Customer } from '../../core/models/types';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn('[Gemini] GEMINI_API_KEY environment variable is not set.');
}

const genAI = new GoogleGenerativeAI(apiKey || '');
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

// ── Default System Prompt ─────────────────────────────────────────────
const DEFAULT_SYSTEM_PROMPT = `
You are an AI-powered WhatsApp CRM assistant for our business.
Your role: help customers with reservations, menu inquiries, orders, feedback, and support.

## Rules
1. Always respond in the same language the customer uses (English or Hindi).
2. Be warm, concise, and action-oriented (≤200 characters for 'reply').
3. Greet by name if known.
4. Detect intent from the message: booking | inquiry | order | payment | feedback | escalation | greeting | unknown.
5. If intent is unclear → ask one clarifying question.

## Response Format (STRICT JSON — no markdown, no extra text)
{
  "intent": "<detected_intent>",
  "reply": "<WhatsApp message for the customer>",
  "db_action": {
    "<operation>": {
      "table": "<table_name>",
      "data": { <fields> }
    }
  }
}

## db_action operations
- "insert": create a new record
- "update": update an existing record (include "where" key with filter)
- "fetch": retrieve data (include "where" key)
- null: no database action needed

## Tables available
- customers: { phone, name, language, dietary_prefs, notes }
- reservations: { customer_id, party_size, reserved_date, reserved_time, occasion, special_notes, status }
- orders: { customer_id, order_type, items, total_amount, status, delivery_addr }
- tickets: { customer_id, issue, category, priority }
- leads: { customer_id, stage, interest }
`.trim();

export interface AiResponse {
  intent: string;
  reply: string;
  db_action: Record<string, any> | null;
}

/**
 * Call Gemini with conversation history + new message.
 * @param systemPrompt System instruction prompt for this business
 * @param newMessage   Latest customer message
 * @param history      [{ direction, content }] last N messages
 * @param customer     Customer record from Database
 * @returns {AiResponse}
 */
export async function callGemini(
  systemPrompt: string | null,
  newMessage: string,
  history: Array<{ direction: 'inbound' | 'outbound'; content: string }> = [],
  customer: Customer | null = null
): Promise<AiResponse> {
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: systemPrompt || DEFAULT_SYSTEM_PROMPT,
  });

  // Build context block
  const historyText = history.length
    ? history.map(m => `[${m.direction === 'inbound' ? 'Customer' : 'Assistant'}]: ${m.content}`).join('\n')
    : 'No previous messages.';

  const customerContext = customer
    ? `Customer: ${customer.name || 'Unknown'} | Phone: ${customer.phone} | Visits: ${customer.visit_count || 0}`
    : '';

  const prompt = `
${customerContext}

## Conversation History
${historyText}

## New Customer Message
${newMessage}

Respond ONLY with the JSON object described in your instructions.
`.trim();

  const result = await model.generateContent(prompt);
  const raw = result.response.text().trim();

  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();

  let parsed: AiResponse;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error('[Gemini] Failed to parse JSON:', cleaned);
    // Fallback response
    parsed = {
      intent: 'unknown',
      reply: `Thank you for reaching out to us! How can I help you today? 😊`,
      db_action: null,
    };
  }

  return parsed;
}
