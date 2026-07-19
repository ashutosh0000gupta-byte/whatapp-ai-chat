import { 
  AuthenticationState, 
  AuthenticationCreds, 
  SignalDataTypeMap, 
  SignalDataSet,
  SignalKeyStore,
  initAuthCreds, 
  BufferJSON 
} from '@whiskeysockets/baileys';
import { pool } from '../database/database';

/**
 * Custom PostgreSQL-backed authentication state provider for Baileys.
 * Dynamically loads and saves credentials and encryption keys from the database,
 * making sessions robust against Railway ephemeral container restarts.
 */
export async function useDbAuthState(businessId: string): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  
  // 1. Fetch credentials from whatsapp_sessions table
  const fetchCreds = async (): Promise<AuthenticationCreds> => {
    const res = await pool.query('SELECT creds FROM whatsapp_sessions WHERE business_id = $1', [businessId]);
    const row = res.rows[0];
    if (row && row.creds) {
      // Deserialize keys and buffers correctly using Baileys BufferJSON reviver
      return JSON.parse(JSON.stringify(row.creds), BufferJSON.reviver);
    }
    // Return fresh credentials if none exist in the database
    return initAuthCreds();
  };

  const creds = await fetchCreds();

  // 2. Build the keys object matching Baileys SignalKeyStore contract
  const keys: SignalKeyStore = {
    get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
      const data: { [id: string]: SignalDataTypeMap[T] } = {};
      const res = await pool.query(
        'SELECT key_id, key_data FROM baileys_keys WHERE business_id = $1 AND key_type = $2 AND key_id = ANY($3)',
        [businessId, type, ids]
      );
      for (const row of res.rows) {
        data[row.key_id] = JSON.parse(JSON.stringify(row.key_data), BufferJSON.reviver);
      }
      return data;
    },
    set: async (data: SignalDataSet): Promise<void> => {
      // Use Object.entries to iterate the mapped type safely
      for (const [type, typeData] of Object.entries(data) as [string, Record<string, unknown> | undefined][]) {
        if (!typeData) continue;
        for (const [id, val] of Object.entries(typeData)) {
          if (val === null || val === undefined) {
            // Delete key if set to null
            await pool.query(
              'DELETE FROM baileys_keys WHERE business_id = $1 AND key_type = $2 AND key_id = $3',
              [businessId, type, id]
            );
          } else {
            // Upsert key
            const jsonStr = JSON.stringify(val, BufferJSON.replacer);
            await pool.query(
              `INSERT INTO baileys_keys (business_id, key_type, key_id, key_data, updated_at) 
               VALUES ($1, $2, $3, $4, NOW()) 
               ON CONFLICT (business_id, key_type, key_id) 
               DO UPDATE SET key_data = EXCLUDED.key_data, updated_at = NOW()`,
              [businessId, type, id, jsonStr]
            );
          }
        }
      }
    }
  };

  // 3. Build the state object
  const state: AuthenticationState = { creds, keys };

  // 4. Save credentials function
  const saveCreds = async () => {
    const jsonStr = JSON.stringify(state.creds, BufferJSON.replacer);
    await pool.query(
      `INSERT INTO whatsapp_sessions (business_id, creds, updated_at) 
       VALUES ($1, $2, NOW()) 
       ON CONFLICT (business_id) 
       DO UPDATE SET creds = EXCLUDED.creds, updated_at = NOW()`,
      [businessId, jsonStr]
    );
  };

  return {
    state,
    saveCreds
  };
}
