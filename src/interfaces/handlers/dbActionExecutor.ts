import * as db from '../../infrastructure/database/database';

/**
 * Interprets the db_action object returned by Gemini or n8n and executes
 * the appropriate database operation scoped by businessId.
 *
 * Supported operations: insert | update | fetch
 * Tables: customers | leads | reservations | orders | tickets
 */
export async function executeDbAction(
  businessId: string, 
  dbAction: Record<string, any> | null, 
  customerId: string
): Promise<any | null> {
  if (!dbAction) return null;

  const operation = Object.keys(dbAction)[0]; // insert | update | fetch
  if (!operation) return null;

  const { table, data = {}, where = {} } = dbAction[operation];

  // Always inject customer_id for insert operations on relational tables
  const relationalTables = ['reservations', 'orders', 'tickets', 'leads', 'messages'];
  if (operation === 'insert' && relationalTables.includes(table)) {
    data.customer_id = customerId;
  }

  console.log(`[DBAction - ${businessId}] ${operation.toUpperCase()} → ${table}`, JSON.stringify(data));

  try {
    switch (operation) {
      // ── INSERT ───────────────────────────────────────────────
      case 'insert': {
        switch (table) {
          case 'reservations':
            return await db.createReservation(businessId, customerId, data);

          case 'orders':
            // Also update lead stage to qualified
            await db.updateLeadStage(businessId, customerId, data.lead_stage || 'qualified', data.service || null);
            return await db.createOrder(businessId, customerId, data);

          case 'tickets':
            await db.updateLeadStage(businessId, customerId, 'qualified');
            return await db.createTicket(businessId, customerId, data);

          case 'customers':
            return await db.updateCustomer(businessId, customerId, data);

          default:
            console.warn(`[DBAction - ${businessId}] Unhandled insert table: ${table} — skipping`);
            return null;
        }
      }

      // ── UPDATE ───────────────────────────────────────────────
      case 'update': {
        switch (table) {
          case 'leads':
            return await db.updateLeadStage(businessId, customerId, data.stage, data.interest);

          case 'reservations': {
            if (where.id) {
              return await db.updateReservation(businessId, where.id, data);
            }
            // Update latest reservation for this customer
            const res = await db.getReservationsByCustomer(businessId, customerId);
            if (res.length > 0) return await db.updateReservation(businessId, res[0].id, data);
            break;
          }

          case 'customers':
            return await db.updateCustomer(businessId, customerId, data);

          case 'tickets': {
            if (where.id) return await db.updateTicket(businessId, where.id, data);
            break;
          }

          default:
            console.warn(`[DBAction - ${businessId}] Unhandled update table: ${table} — skipping`);
            return null;
        }
        break;
      }

      // ── FETCH ────────────────────────────────────────────────
      case 'fetch': {
        switch (table) {
          case 'reservations':
            return await db.getReservationsByCustomer(businessId, customerId);
          case 'messages':
            return await db.getMessageHistory(businessId, customerId, 20);
          default:
            console.warn(`[DBAction - ${businessId}] Unhandled fetch table: ${table} — skipping`);
            return null;
        }
      }

      default:
        console.warn(`[DBAction - ${businessId}] Unknown operation: ${operation}`);
        return null;
    }
  } catch (err: any) {
    console.error(`[DBAction - ${businessId}] Error executing ${operation} on ${table}:`, err.message);
    return null;
  }
}
