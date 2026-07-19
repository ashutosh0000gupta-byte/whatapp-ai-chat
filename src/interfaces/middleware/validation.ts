import { z } from 'zod';

// ══════════════════════════════════════════════════════════════
//  ZOD VALIDATION SCHEMAS
//  Strict runtime validation for all incoming API payloads
//  and AI-generated database actions.
// ══════════════════════════════════════════════════════════════

// ── Business Schemas ─────────────────────────────────────────

export const CreateBusinessSchema = z.object({
  name: z.string().min(1, 'Business name is required').max(200),
  wa_phone_number: z.string().min(10, 'Phone number must be at least 10 digits').max(20),
  workflow_name: z.string().nullable().optional(),
  ai_system_prompt: z.string().optional().default(''),
  knowledge_base: z.string().optional().default(''),
  working_hours: z.record(z.any()).optional().default({}),
  subscription_plan: z.enum(['free', 'starter', 'professional', 'enterprise']).optional().default('free'),
  status: z.enum(['active', 'inactive', 'suspended']).optional().default('active'),
  crm_settings: z.record(z.any()).optional().default({}),
  memory_settings: z.record(z.any()).optional().default({}),
  payment_config: z.record(z.any()).optional().default({}),
  api_keys: z.record(z.any()).optional().default({}),
  feature_flags: z.record(z.any()).optional().default({}),
});

export const UpdateBusinessSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  wa_phone_number: z.string().min(10).max(20).optional(),
  workflow_name: z.string().nullable().optional(),
  ai_system_prompt: z.string().optional(),
  knowledge_base: z.string().optional(),
  working_hours: z.record(z.any()).optional(),
  subscription_plan: z.enum(['free', 'starter', 'professional', 'enterprise']).optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
  crm_settings: z.record(z.any()).optional(),
  memory_settings: z.record(z.any()).optional(),
  payment_config: z.record(z.any()).optional(),
  api_keys: z.record(z.any()).optional(),
  feature_flags: z.record(z.any()).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field must be provided for update' });

// ── Lead Schemas ─────────────────────────────────────────────

export const UpdateLeadSchema = z.object({
  stage: z.enum(['new', 'qualified', 'converted', 'lost']),
});

// ── Ticket Schemas ───────────────────────────────────────────

export const UpdateTicketSchema = z.object({
  status: z.enum(['open', 'escalated', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  category: z.string().max(100).optional(),
  issue: z.string().max(2000).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field must be provided for update' });

// ── Auto-Reply Schemas ───────────────────────────────────────

export const CreateAutoReplySchema = z.object({
  keyword: z.string().min(1, 'Keyword is required').max(200),
  response: z.string().min(1, 'Response is required').max(2000),
  enabled: z.boolean().optional().default(true),
  matchType: z.enum(['exact', 'startsWith', 'contains']).optional().default('contains'),
});

export const UpdateAutoReplySchema = z.object({
  keyword: z.string().min(1).max(200).optional(),
  response: z.string().min(1).max(2000).optional(),
  enabled: z.boolean().optional(),
  matchType: z.enum(['exact', 'startsWith', 'contains']).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field must be provided for update' });

// ── Manual Message Schemas ───────────────────────────────────

export const SendManualMessageSchema = z.object({
  phone: z.string().min(10, 'Phone number is required').max(20),
  message: z.string().min(1, 'Message content is required').max(5000),
});

// ── Contact Mode Schemas ─────────────────────────────────────

export const SetContactModeSchema = z.object({
  phone: z.string().min(10, 'Phone number is required').max(20),
  mode: z.enum(['ai', 'manual']),
});

// ── AI Preview Schema ────────────────────────────────────────

export const AiPreviewSchema = z.object({
  phone: z.string().optional(),
  message: z.string().min(1, 'Message is required').max(5000),
  customerId: z.string().uuid().optional(),
});

// ── DB Action Validation (from Gemini / n8n responses) ───────

export const DbActionSchema = z.object({
  action: z.enum([
    'create_reservation',
    'update_reservation',
    'cancel_reservation',
    'create_order',
    'update_order',
    'create_ticket',
    'update_ticket',
    'update_lead',
    'update_customer',
    'create_reminder',
    'none',
  ]),
  data: z.record(z.any()).optional().default({}),
}).nullable();

// ── Auth Schemas ─────────────────────────────────────────────

export const LoginSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const RegisterSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  name: z.string().min(1, 'Name is required').max(100),
  role: z.enum(['admin', 'agent', 'viewer']).optional().default('agent'),
});

// ── UUID Param Validation ────────────────────────────────────

export const UuidParamSchema = z.object({
  id: z.string().uuid('Invalid ID format'),
});

// ══════════════════════════════════════════════════════════════
//  VALIDATION MIDDLEWARE FACTORY
// ══════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';

/**
 * Express middleware factory that validates req.body against a Zod schema.
 * Returns 400 with structured error messages on validation failure.
 * 
 * Usage: router.post('/businesses', validateBody(CreateBusinessSchema), handler);
 */
export function validateBody(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.errors.map(e => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      res.status(400).json({ error: 'Validation failed', details: errors });
      return;
    }
    // Replace body with validated (and coerced/defaulted) data
    req.body = result.data;
    next();
  };
}

/**
 * Express middleware factory that validates req.params against a Zod schema.
 * 
 * Usage: router.get('/:id', validateParams(UuidParamSchema), handler);
 */
export function validateParams(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      const errors = result.error.errors.map(e => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      res.status(400).json({ error: 'Invalid parameters', details: errors });
      return;
    }
    next();
  };
}
