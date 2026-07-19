import { pool } from '../infrastructure/database/database';
import { Business } from '../core/models/types';

// ══════════════════════════════════════════════════════════════
//  TENANT PROVISIONING SERVICE
//  Automatically generates default configurations when a
//  new business signs up. Ensures every tenant starts with
//  sensible AI prompts, CRM settings, and feature flags.
// ══════════════════════════════════════════════════════════════

/**
 * Default AI system prompt template.
 * Uses {{business_name}} placeholder that gets replaced at provisioning time.
 */
const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant for {{business_name}}. 

Your role:
- Answer customer questions politely and professionally
- Help with bookings, orders, and general inquiries
- Collect relevant customer information
- Escalate complex issues when needed

Guidelines:
- Be concise but friendly
- Always confirm important details (dates, times, quantities)
- If you're unsure, ask clarifying questions
- Never share internal business information
- Respond in the same language the customer uses

When a customer wants to make a booking or order, extract:
- Date and time
- Number of people / quantity
- Any special requirements or preferences`;

/**
 * Default CRM settings for new tenants.
 */
const DEFAULT_CRM_SETTINGS = {
  auto_create_lead: true,
  default_lead_source: 'whatsapp',
  lead_stages: ['new', 'qualified', 'converted', 'lost'],
  ticket_categories: ['general', 'billing', 'technical', 'complaint'],
  ticket_priorities: ['low', 'normal', 'high', 'urgent'],
  max_message_history: 20,
};

/**
 * Default feature flags for new tenants.
 * Gated by subscription plan.
 */
const PLAN_FEATURES: Record<string, Record<string, any>> = {
  free: {
    ai_enabled: true,
    auto_replies: true,
    max_auto_replies: 5,
    n8n_workflows: false,
    knowledge_base: false,
    analytics: false,
    manual_takeover: true,
    max_messages_per_day: 100,
    custom_branding: false,
  },
  starter: {
    ai_enabled: true,
    auto_replies: true,
    max_auto_replies: 20,
    n8n_workflows: true,
    knowledge_base: true,
    analytics: true,
    manual_takeover: true,
    max_messages_per_day: 1000,
    custom_branding: false,
  },
  professional: {
    ai_enabled: true,
    auto_replies: true,
    max_auto_replies: 100,
    n8n_workflows: true,
    knowledge_base: true,
    analytics: true,
    manual_takeover: true,
    max_messages_per_day: 10000,
    custom_branding: true,
  },
  enterprise: {
    ai_enabled: true,
    auto_replies: true,
    max_auto_replies: -1, // unlimited
    n8n_workflows: true,
    knowledge_base: true,
    analytics: true,
    manual_takeover: true,
    max_messages_per_day: -1, // unlimited
    custom_branding: true,
  },
};

/**
 * Default working hours (Mon–Sat, 9am–9pm).
 */
const DEFAULT_WORKING_HOURS = {
  timezone: 'Asia/Kolkata',
  schedule: {
    monday: { open: '09:00', close: '21:00' },
    tuesday: { open: '09:00', close: '21:00' },
    wednesday: { open: '09:00', close: '21:00' },
    thursday: { open: '09:00', close: '21:00' },
    friday: { open: '09:00', close: '21:00' },
    saturday: { open: '09:00', close: '21:00' },
    sunday: null, // closed
  },
  off_hours_message: 'Thanks for reaching out! We are currently closed. Our working hours are Mon–Sat, 9 AM – 9 PM. We will get back to you as soon as possible! 🙏',
};

/**
 * Provision a newly created business with default configuration.
 * This is called after createBusiness() and ensures the tenant
 * has a complete, working configuration from day one.
 */
export async function provisionNewBusiness(business: Business): Promise<void> {
  const plan = business.subscription_plan || 'free';
  const features = PLAN_FEATURES[plan] || PLAN_FEATURES.free;

  console.log(`[Provisioning] 🏗️ Setting up defaults for business: ${business.name} (plan: ${plan})`);

  try {
    // 1. Apply default system prompt if none was provided
    if (!business.ai_system_prompt) {
      const prompt = DEFAULT_SYSTEM_PROMPT.replace(/\{\{business_name\}\}/g, business.name);
      await pool.query(
        'UPDATE businesses SET ai_system_prompt = $1 WHERE id = $2',
        [prompt, business.id]
      );
    }

    // 2. Apply default CRM settings if empty
    if (!business.crm_settings || Object.keys(business.crm_settings).length === 0) {
      await pool.query(
        'UPDATE businesses SET crm_settings = $1 WHERE id = $2',
        [JSON.stringify(DEFAULT_CRM_SETTINGS), business.id]
      );
    }

    // 3. Apply feature flags based on subscription plan
    if (!business.feature_flags || Object.keys(business.feature_flags).length === 0) {
      await pool.query(
        'UPDATE businesses SET feature_flags = $1 WHERE id = $2',
        [JSON.stringify(features), business.id]
      );
    }

    // 4. Apply default working hours if empty
    if (!business.working_hours || Object.keys(business.working_hours).length === 0) {
      await pool.query(
        'UPDATE businesses SET working_hours = $1 WHERE id = $2',
        [JSON.stringify(DEFAULT_WORKING_HOURS), business.id]
      );
    }

    // 5. Initialize a WhatsApp session row
    await pool.query(
      `INSERT INTO whatsapp_sessions (business_id, connection_status) 
       VALUES ($1, 'disconnected') 
       ON CONFLICT (business_id) DO NOTHING`,
      [business.id]
    );

    // 6. Create default auto-reply rules
    const defaultReplies = [
      { keyword: 'hi', response: `Hello! Welcome to ${business.name}. How can I help you today? 😊`, matchType: 'exact' },
      { keyword: 'hello', response: `Hi there! Welcome to ${business.name}. How can I assist you? 🙏`, matchType: 'exact' },
      { keyword: 'thanks', response: `You're welcome! Is there anything else I can help with? 😊`, matchType: 'contains' },
    ];

    for (const rule of defaultReplies) {
      await pool.query(
        `INSERT INTO auto_replies (business_id, keyword, response, enabled, match_type) 
         VALUES ($1, $2, $3, true, $4)`,
        [business.id, rule.keyword, rule.response, rule.matchType]
      );
    }

    console.log(`[Provisioning] ✅ Business ${business.name} fully provisioned.`);
  } catch (err: any) {
    console.error(`[Provisioning] ❌ Error provisioning business ${business.name}:`, err.message);
    // Don't throw — provisioning failures should not block business creation
  }
}

/**
 * Update feature flags when a business changes subscription plan.
 */
export async function updatePlanFeatures(businessId: string, newPlan: string): Promise<void> {
  const features = PLAN_FEATURES[newPlan] || PLAN_FEATURES.free;
  
  await pool.query(
    'UPDATE businesses SET feature_flags = $1, subscription_plan = $2, updated_at = NOW() WHERE id = $3',
    [JSON.stringify(features), newPlan, businessId]
  );
  
  console.log(`[Provisioning] 📦 Updated feature flags for business ${businessId} to plan: ${newPlan}`);
}

/**
 * Check if a business has exceeded its daily message quota.
 * Returns true if the business can still send messages.
 */
export async function checkMessageQuota(businessId: string): Promise<{ allowed: boolean; used: number; limit: number }> {
  // Get the business feature flags
  const bizRes = await pool.query('SELECT feature_flags FROM businesses WHERE id = $1', [businessId]);
  if (bizRes.rows.length === 0) return { allowed: false, used: 0, limit: 0 };

  const features = bizRes.rows[0].feature_flags || {};
  const limit = features.max_messages_per_day || 100;

  if (limit === -1) return { allowed: true, used: 0, limit: -1 }; // unlimited

  // Count messages sent today
  const countRes = await pool.query(
    `SELECT COUNT(*) FROM messages 
     WHERE business_id = $1 AND direction = 'outbound' 
     AND created_at >= CURRENT_DATE`,
    [businessId]
  );
  const used = parseInt(countRes.rows[0].count) || 0;

  return {
    allowed: used < limit,
    used,
    limit,
  };
}
