const db = require('../services/supabase');

/**
 * Interprets the db_action object returned by Gemini and executes
 * the appropriate Supabase operation.
 *
 * Supported operations: insert | update | fetch
 * Tables: customers | leads | reservations | orders | tickets
 *
 * @param {object|null} dbAction   The db_action from Gemini response
 * @param {string}      customerId The resolved Supabase customer UUID
 * @returns {object|null}          Result of the DB operation (if any)
 */
async function executeDbAction(dbAction, customerId) {
  if (!dbAction) return null;

  const operation = Object.keys(dbAction)[0]; // insert | update | fetch
  if (!operation) return null;

  const { table, data = {}, where = {} } = dbAction[operation];

  // Always inject customer_id for insert operations on relational tables
  const relationalTables = ['reservations', 'orders', 'tickets', 'leads', 'messages'];
  if (operation === 'insert' && relationalTables.includes(table)) {
    data.customer_id = customerId;
  }

  console.log(`[DBAction] ${operation.toUpperCase()} → ${table}`, JSON.stringify(data));

  try {
    switch (operation) {
      // ── INSERT ───────────────────────────────────────────────
      case 'insert': {
        switch (table) {
          case 'reservations':
            return await db.createReservation(customerId, data);

          case 'orders':
            // Also update lead stage to qualified
            await db.updateLeadStage(customerId, data.lead_stage || 'qualified', data.service || null);
            return await db.createOrder(customerId, data);

          case 'tickets':
            await db.updateLeadStage(customerId, 'qualified');
            return await db.createTicket(customerId, data);

          case 'customers':
            return await db.updateCustomer(customerId, data);

          default:
            console.warn(`[DBAction] Unhandled insert table: ${table} — skipping`);
            return null;
        }
      }

      // ── UPDATE ───────────────────────────────────────────────
      case 'update': {
        switch (table) {
          case 'leads':
            return await db.updateLeadStage(customerId, data.stage, data.interest);

          case 'reservations': {
            if (where.id) {
              return await db.updateReservation(where.id, data);
            }
            // Update latest reservation for this customer
            const res = await db.getReservationsByCustomer(customerId);
            if (res.length > 0) return await db.updateReservation(res[0].id, data);
            break;
          }

          case 'customers':
            return await db.updateCustomer(customerId, data);

          case 'tickets': {
            if (where.id) return await db.updateTicket(where.id, data);
            break;
          }

          default:
            console.warn(`[DBAction] Unhandled update table: ${table} — skipping`);
            return null;
        }
        break;
      }

      // ── FETCH ────────────────────────────────────────────────
      case 'fetch': {
        switch (table) {
          case 'reservations':
            return await db.getReservationsByCustomer(customerId);
          case 'messages':
            return await db.getMessageHistory(customerId, 20);
          default:
            console.warn(`[DBAction] Unhandled fetch table: ${table} — skipping`);
            return null;
        }
      }

      default:
        console.warn(`[DBAction] Unknown operation: ${operation}`);
        return null;
    }
  } catch (err) {
    console.error(`[DBAction] Error executing ${operation} on ${table}:`, err.message);
    return null;
  }
}

module.exports = { executeDbAction };
