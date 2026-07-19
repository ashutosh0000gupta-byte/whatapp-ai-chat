-- ──────────────────────────────────────────────────────────────
--  Migration: Users, Auth & SaaS Tables
--  Run this AFTER migration_auth_state.sql
-- ──────────────────────────────────────────────────────────────

-- 1. Users table for JWT authentication
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'agent', 'viewer')),
  last_login    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 2. User <-> Business association table (many-to-many)
CREATE TABLE IF NOT EXISTS user_businesses (
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  business_id   UUID REFERENCES businesses(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('owner', 'admin', 'agent', 'viewer')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, business_id)
);

-- 3. Subscription tracking table
CREATE TABLE IF NOT EXISTS subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  plan            TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'professional', 'enterprise')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'cancelled', 'trialing')),
  stripe_customer_id    TEXT,
  stripe_subscription_id TEXT,
  current_period_start  TIMESTAMPTZ,
  current_period_end    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_business ON subscriptions(business_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe ON subscriptions(stripe_customer_id);

-- 4. Audit log table for tracking important events
CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID REFERENCES businesses(id) ON DELETE SET NULL,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     TEXT,
  metadata      JSONB,
  ip_address    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_business ON audit_log(business_id, created_at DESC);

-- 5. Add indexes for analytics performance
CREATE INDEX IF NOT EXISTS idx_messages_analytics 
ON messages(business_id, created_at DESC, direction);

CREATE INDEX IF NOT EXISTS idx_messages_intent 
ON messages(business_id, intent) WHERE intent IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_stage 
ON leads(business_id, stage);

CREATE INDEX IF NOT EXISTS idx_customers_business 
ON customers(business_id, created_at DESC);
