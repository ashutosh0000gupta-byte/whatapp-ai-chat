const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL  = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

// ── System Prompt ─────────────────────────────────────────────
const SYSTEM_PROMPT = `
You are an AI-powered WhatsApp CRM assistant for ${process.env.RESTAURANT_NAME || 'our restaurant'}.
Your role: help customers with table reservations, menu inquiries, delivery/takeaway orders, feedback, and support.

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

## Examples

Customer: "Hi I want to book a table for 4 on Saturday 7pm"
Response:
{
  "intent": "booking",
  "reply": "Great! Table for 4 on Saturday at 7pm 🍽️ May I have your name and any special occasion?",
  "db_action": {
    "insert": {
      "table": "reservations",
      "data": {
        "party_size": 4,
        "reserved_time": "19:00:00",
        "status": "pending"
      }
    }
  }
}

Customer: "My order was cold and late!"
Response:
{
  "intent": "escalation",
  "reply": "So sorry about that! 😔 Your feedback matters. I'm raising this to our team right away. We'll make it right!",
  "db_action": {
    "insert": {
      "table": "tickets",
      "data": {
        "issue": "Order delivered cold and late",
        "category": "complaint",
        "priority": "high"
      }
    }
  }
}
`.trim();

/**
 * Call Gemini with conversation history + new message.
 * @param {string}   systemPrompt System instruction prompt for this business
 * @param {string}   newMessage   Latest customer message
 * @param {Array}    history      [{ direction, content }] last N messages
 * @param {object}   customer     Customer record from Supabase
 * @returns {{ intent, reply, db_action }}
 */
async function callGemini(systemPrompt, newMessage, history = [], customer = {}) {
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: systemPrompt || SYSTEM_PROMPT,
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

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error('[Gemini] Failed to parse JSON:', cleaned);
    // Fallback response
    parsed = {
      intent: 'unknown',
      reply: `Thank you for reaching out to ${process.env.RESTAURANT_NAME || 'us'}! How can I help you today? 😊`,
      db_action: null,
    };
  }

  return parsed;
}

module.exports = { callGemini };
