import { Router, Response } from 'express';
import { TenantRequest } from './types';
import { pool } from '../../infrastructure/database/database';

// ══════════════════════════════════════════════════════════════
//  ANALYTICS ROUTES
//  Real-time metrics for the dashboard: message volume,
//  AI response performance, lead conversion, and revenue.
// ══════════════════════════════════════════════════════════════

const router = Router();

/**
 * GET /api/analytics/overview
 * Returns high-level KPIs for the business.
 */
router.get('/overview', async (req: TenantRequest, res: Response) => {
  const businessId = req.businessId!;

  try {
    // Total customers
    const customersRes = await pool.query(
      'SELECT COUNT(*) as total FROM customers WHERE business_id = $1',
      [businessId]
    );

    // Messages today
    const messagesTodayRes = await pool.query(
      `SELECT 
         COUNT(*) FILTER (WHERE direction = 'inbound') as inbound,
         COUNT(*) FILTER (WHERE direction = 'outbound') as outbound
       FROM messages WHERE business_id = $1 AND created_at >= CURRENT_DATE`,
      [businessId]
    );

    // Lead pipeline counts
    const pipelineRes = await pool.query(
      `SELECT stage, COUNT(*) as count FROM leads 
       WHERE business_id = $1 GROUP BY stage`,
      [businessId]
    );
    const pipeline: Record<string, number> = {};
    pipelineRes.rows.forEach((r: any) => { pipeline[r.stage] = parseInt(r.count); });

    // Open tickets
    const ticketsRes = await pool.query(
      `SELECT COUNT(*) as total FROM tickets 
       WHERE business_id = $1 AND status IN ('open', 'escalated')`,
      [businessId]
    );

    // Confirmed reservations (upcoming)
    const reservationsRes = await pool.query(
      `SELECT COUNT(*) as total FROM reservations 
       WHERE business_id = $1 AND status = 'confirmed' AND reserved_date >= CURRENT_DATE`,
      [businessId]
    );

    // Revenue (total from orders)
    const revenueRes = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total_revenue,
              COUNT(*) as total_orders
       FROM orders WHERE business_id = $1`,
      [businessId]
    );

    res.json({
      customers: {
        total: parseInt(customersRes.rows[0].total) || 0,
      },
      messages: {
        today_inbound: parseInt(messagesTodayRes.rows[0].inbound) || 0,
        today_outbound: parseInt(messagesTodayRes.rows[0].outbound) || 0,
      },
      leads: {
        pipeline,
        total: Object.values(pipeline).reduce((a: number, b: number) => a + b, 0),
      },
      tickets: {
        open: parseInt(ticketsRes.rows[0].total) || 0,
      },
      reservations: {
        upcoming_confirmed: parseInt(reservationsRes.rows[0].total) || 0,
      },
      revenue: {
        total: parseFloat(revenueRes.rows[0].total_revenue) || 0,
        total_orders: parseInt(revenueRes.rows[0].total_orders) || 0,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/analytics/messages?days=7
 * Returns daily message volume for the past N days (default 7).
 */
router.get('/messages', async (req: TenantRequest, res: Response) => {
  const businessId = req.businessId!;
  const days = Math.min(parseInt(req.query.days as string) || 7, 90);

  try {
    const result = await pool.query(
      `SELECT 
         DATE(created_at) as date,
         COUNT(*) FILTER (WHERE direction = 'inbound') as inbound,
         COUNT(*) FILTER (WHERE direction = 'outbound') as outbound
       FROM messages 
       WHERE business_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '1 day' * $2
       GROUP BY DATE(created_at) 
       ORDER BY date ASC`,
      [businessId, days]
    );

    res.json({
      period_days: days,
      daily: result.rows.map((r: any) => ({
        date: r.date,
        inbound: parseInt(r.inbound) || 0,
        outbound: parseInt(r.outbound) || 0,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/analytics/intents?days=30
 * Returns breakdown of AI-detected intents over a time period.
 */
router.get('/intents', async (req: TenantRequest, res: Response) => {
  const businessId = req.businessId!;
  const days = Math.min(parseInt(req.query.days as string) || 30, 90);

  try {
    const result = await pool.query(
      `SELECT intent, COUNT(*) as count 
       FROM messages 
       WHERE business_id = $1 
         AND direction = 'outbound' 
         AND intent IS NOT NULL 
         AND created_at >= CURRENT_DATE - INTERVAL '1 day' * $2
       GROUP BY intent 
       ORDER BY count DESC
       LIMIT 20`,
      [businessId, days]
    );

    res.json({
      period_days: days,
      intents: result.rows.map((r: any) => ({
        intent: r.intent,
        count: parseInt(r.count) || 0,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/analytics/leads?days=30
 * Returns lead conversion funnel data.
 */
router.get('/leads', async (req: TenantRequest, res: Response) => {
  const businessId = req.businessId!;
  const days = Math.min(parseInt(req.query.days as string) || 30, 90);

  try {
    // Current pipeline
    const pipelineRes = await pool.query(
      `SELECT stage, COUNT(*) as count FROM leads 
       WHERE business_id = $1 GROUP BY stage`,
      [businessId]
    );

    // New leads per day
    const dailyRes = await pool.query(
      `SELECT DATE(created_at) as date, COUNT(*) as count 
       FROM leads 
       WHERE business_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '1 day' * $2
       GROUP BY DATE(created_at) 
       ORDER BY date ASC`,
      [businessId, days]
    );

    // Conversion rate (converted / total)
    const totalLeads = pipelineRes.rows.reduce((sum: number, r: any) => sum + parseInt(r.count), 0);
    const convertedLeads = pipelineRes.rows.find((r: any) => r.stage === 'converted');
    const conversionRate = totalLeads > 0 
      ? ((parseInt(convertedLeads?.count || '0') / totalLeads) * 100).toFixed(1) 
      : '0.0';

    res.json({
      period_days: days,
      pipeline: Object.fromEntries(pipelineRes.rows.map((r: any) => [r.stage, parseInt(r.count)])),
      daily_new_leads: dailyRes.rows.map((r: any) => ({
        date: r.date,
        count: parseInt(r.count) || 0,
      })),
      conversion_rate_percent: parseFloat(conversionRate),
      total_leads: totalLeads,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/analytics/customers/top?limit=10
 * Returns top customers by engagement (message count).
 */
router.get('/customers/top', async (req: TenantRequest, res: Response) => {
  const businessId = req.businessId!;
  const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

  try {
    const result = await pool.query(
      `SELECT c.id, c.name, c.phone, c.visit_count, c.total_spent, c.loyalty_points,
              COUNT(m.id) as message_count,
              MAX(m.created_at) as last_message
       FROM customers c
       LEFT JOIN messages m ON m.customer_id = c.id AND m.business_id = c.business_id
       WHERE c.business_id = $1
       GROUP BY c.id
       ORDER BY message_count DESC
       LIMIT $2`,
      [businessId, limit]
    );

    res.json(result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      visit_count: r.visit_count,
      total_spent: parseFloat(r.total_spent) || 0,
      loyalty_points: r.loyalty_points,
      message_count: parseInt(r.message_count) || 0,
      last_message: r.last_message,
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
