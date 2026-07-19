import { 
  AuthenticationState, 
  AuthenticationCreds, 
  SignalDataTypeMap, 
  initAuthCreds, 
  BufferJSON 
} from '@whiskeysockets/baileys';
import { pool } from '../database/database';

/**
 * Custom PostgreSQL-backed authentication state provider for Baileys.
 * Dynamically loads and saves credentials and encryption keys from the database,
 * making sessions robust against Railway ephemeral container wrings.
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

  // 2. Build the state object matching Baileys state contract
  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        const data: Record<string, any> = {};
        const res = await pool.query(
          'SELECT key_id, key_data FROM baileys_keys WHERE business_id = $1 AND key_type = $2 AND key_id = ANY($3)',
          [businessId, type, ids]
        );
        for (const row of res.rows) {
          data[row.key_id] = JSON.parse(JSON.stringify(row.key_data), BufferJSON.reviver);
        }
        return data;
      },
      set: async (data) => {
        for (const type in data) {
          const typeData = data[type];
          for (const id in typeData) {
            const val = typeData[id];
            if (val === null) {
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
    }
  };

  // 3. Save credentials function
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
