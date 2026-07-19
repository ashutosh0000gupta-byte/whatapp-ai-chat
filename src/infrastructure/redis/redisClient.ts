import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

// ══════════════════════════════════════════════════════════════
//  REDIS CLIENT SINGLETON
//  Connects to the Railway Redis service for caching, locking,
//  deduplication, and distributed coordination.
// ══════════════════════════════════════════════════════════════

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let redis: Redis;

try {
  redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 5000);
      console.log(`[Redis] Retry #${times} in ${delay}ms...`);
      return delay;
    },
    reconnectOnError(err: Error) {
      const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
      return targetErrors.some(e => err.message.includes(e));
    },
    lazyConnect: false,
    enableReadyCheck: true,
  });

  redis.on('connect', () => console.log('[Redis] ✅ Connected to Railway Redis'));
  redis.on('error', (err: Error) => console.error('[Redis] ❌ Connection error:', err.message));
  redis.on('close', () => console.warn('[Redis] ⚠️ Connection closed'));
} catch (err: any) {
  console.error('[Redis] Failed to initialize Redis client:', err.message);
  // Create a dummy Redis that throws on operations — fail fast, fail loud
  redis = new Proxy({} as Redis, {
    get: (_, prop) => {
      if (typeof prop === 'string' && ['on', 'once', 'removeListener'].includes(prop)) {
        return () => {};
      }
      return () => { throw new Error('[Redis] Redis is not available'); };
    }
  });
}

export { redis };

// ══════════════════════════════════════════════════════════════
//  MESSAGE DEDUPLICATION (Replaces in-memory Set)
// ══════════════════════════════════════════════════════════════

const DEDUP_PREFIX = 'dedup:msg:';
const DEDUP_TTL_SECONDS = 120; // 2 minutes

/**
 * Check if a WhatsApp message has already been processed.
 * Uses Redis SET NX with a TTL to prevent duplicate processing
 * across multiple container instances.
 * 
 * @returns true if the message is a duplicate (already seen)
 */
export async function isDuplicateMessage(messageId: string): Promise<boolean> {
  try {
    // SET key value NX EX ttl — only sets if key does NOT exist
    const result = await redis.set(`${DEDUP_PREFIX}${messageId}`, '1', 'EX', DEDUP_TTL_SECONDS, 'NX');
    // result is 'OK' if the key was set (first time seeing this message)
    // result is null if the key already existed (duplicate)
    return result === null;
  } catch (err: any) {
    console.error('[Redis] Dedup check failed, allowing message through:', err.message);
    return false; // fail-open: allow processing if Redis is down
  }
}

// ══════════════════════════════════════════════════════════════
//  DISTRIBUTED SESSION LOCKS
//  Ensures only one container instance manages a given
//  Baileys WhatsApp session at any time.
// ══════════════════════════════════════════════════════════════

const LOCK_PREFIX = 'lock:session:';
const LOCK_TTL_SECONDS = 300; // 5 minute lock, renewed periodically
const LOCK_RENEW_INTERVAL_MS = 60_000; // renew every 60s

// Store renewal timers so we can cancel them on unlock
const renewalTimers = new Map<string, NodeJS.Timeout>();

/**
 * Acquire a distributed lock for a Baileys session.
 * Returns true if the lock was successfully acquired.
 * Returns false if another instance already holds the lock.
 */
export async function acquireSessionLock(businessId: string, instanceId: string): Promise<boolean> {
  try {
    const key = `${LOCK_PREFIX}${businessId}`;
    const result = await redis.set(key, instanceId, 'EX', LOCK_TTL_SECONDS, 'NX');
    
    if (result === 'OK') {
      // Start periodic renewal
      const timer = setInterval(async () => {
        try {
          // Only renew if we still own the lock
          const currentOwner = await redis.get(key);
          if (currentOwner === instanceId) {
            await redis.expire(key, LOCK_TTL_SECONDS);
          } else {
            // Someone else took the lock, stop renewing
            clearInterval(timer);
            renewalTimers.delete(businessId);
          }
        } catch (err: any) {
          console.error(`[Redis] Lock renewal failed for ${businessId}:`, err.message);
        }
      }, LOCK_RENEW_INTERVAL_MS);
      
      renewalTimers.set(businessId, timer);
      console.log(`[Redis] 🔒 Session lock acquired for business ${businessId}`);
      return true;
    }
    
    console.log(`[Redis] ⏳ Session lock denied for business ${businessId} — held by another instance`);
    return false;
  } catch (err: any) {
    console.error('[Redis] Lock acquisition failed:', err.message);
    return true; // fail-open: allow session if Redis is down
  }
}

/**
 * Release a distributed session lock.
 * Only releases if the current instance owns the lock.
 */
export async function releaseSessionLock(businessId: string, instanceId: string): Promise<void> {
  try {
    const key = `${LOCK_PREFIX}${businessId}`;
    
    // Atomic check-and-delete via Lua script
    const luaScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await redis.eval(luaScript, 1, key, instanceId);
    
    // Stop renewal timer
    const timer = renewalTimers.get(businessId);
    if (timer) {
      clearInterval(timer);
      renewalTimers.delete(businessId);
    }
    
    console.log(`[Redis] 🔓 Session lock released for business ${businessId}`);
  } catch (err: any) {
    console.error('[Redis] Lock release failed:', err.message);
  }
}

// ══════════════════════════════════════════════════════════════
//  BUSINESS CONFIG CACHING
// ══════════════════════════════════════════════════════════════

const CACHE_PREFIX = 'cache:biz:';
const CACHE_TTL_SECONDS = 300; // 5 minutes

/**
 * Cache a business configuration object in Redis.
 */
export async function cacheBusinessConfig(businessId: string, config: Record<string, any>): Promise<void> {
  try {
    await redis.set(`${CACHE_PREFIX}${businessId}`, JSON.stringify(config), 'EX', CACHE_TTL_SECONDS);
  } catch (err: any) {
    console.error('[Redis] Cache set failed:', err.message);
  }
}

/**
 * Retrieve a cached business configuration. Returns null on miss.
 */
export async function getCachedBusinessConfig(businessId: string): Promise<Record<string, any> | null> {
  try {
    const data = await redis.get(`${CACHE_PREFIX}${businessId}`);
    return data ? JSON.parse(data) : null;
  } catch (err: any) {
    console.error('[Redis] Cache get failed:', err.message);
    return null;
  }
}

/**
 * Invalidate a cached business configuration (e.g. after update).
 */
export async function invalidateBusinessCache(businessId: string): Promise<void> {
  try {
    await redis.del(`${CACHE_PREFIX}${businessId}`);
  } catch (err: any) {
    console.error('[Redis] Cache invalidation failed:', err.message);
  }
}

// ══════════════════════════════════════════════════════════════
//  RATE LIMITING (per-customer message throttle)
// ══════════════════════════════════════════════════════════════

const RATE_PREFIX = 'rate:msg:';

/**
 * Check if a customer has exceeded the message rate limit.
 * Allows `maxMessages` per `windowSeconds`.
 * Returns true if rate limit is exceeded.
 */
export async function isRateLimited(
  businessId: string, 
  phone: string, 
  maxMessages: number = 30, 
  windowSeconds: number = 60
): Promise<boolean> {
  try {
    const key = `${RATE_PREFIX}${businessId}:${phone}`;
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, windowSeconds);
    }
    return current > maxMessages;
  } catch (err: any) {
    console.error('[Redis] Rate limit check failed:', err.message);
    return false; // fail-open
  }
}
