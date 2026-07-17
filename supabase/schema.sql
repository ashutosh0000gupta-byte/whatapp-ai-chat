-- ================================================================
--  BusinessFlow AI — Supabase Schema (Multi-Tenant SaaS)
--  Run this entire file in your Supabase SQL Editor.
-- ================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ──────────────────────────────────────────────────────────────
-- 1. BUSINESSES (Tenants)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS businesses (
  id                UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name              TEXT NOT NULL,
  wa_phone_number   TEXT UNIQUE NOT NULL,          -- WhatsApp phone e.g. +919876543210
  workflow_name     TEXT,                          -- n8n webhook workflow name e.g. "restaurant"
  ai_system_prompt  TEXT,                          -- Business-specific AI system instruction
  knowledge_base    TEXT,                          -- Optional text knowledge base
  working_hours     JSONB,                         -- Business operating hours
  subscription_plan TEXT DEFAULT 'free',           -- free | starter | growth | enterprise
  status            TEXT DEFAULT 'active',         -- active | suspended | pending
  crm_settings      JSONB DEFAULT '{}'::jsonb,
  memory_settings   JSONB DEFAULT '{}'::jsonb,
  payment_config    JSONB DEFAULT '{}'::jsonb,
  api_keys          JSONB DEFAULT '{}'::jsonb,
  feature_flags     JSONB DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────────
-- 2. WHATSAPP SESSIONS (Baileys Sessions)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  business_id         UUID REFERENCES businesses(id) ON DELETE CASCADE,
  phone_number        TEXT,
  connection_status   TEXT DEFAULT 'disconnected'
                        CHECK (connection_status IN ('disconnected', 'connecting', 'connected')),
  last_connected_time TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id)
);

-- ──────────────────────────────────────────────────────────────
-- 3. CUSTOMERS
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  business_id   UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  phone         TEXT NOT NULL,                 -- WhatsApp phone e.g. +919876543210
  name          TEXT,
  language      TEXT DEFAULT 'en',             -- en | hi | regional
  preferred_time TEXT,                          -- e.g. "7pm-9pm"
  dietary_prefs TEXT[],                         -- e.g. ['veg','no-onion']
  visit_count   INT DEFAULT 0,
  total_spent   NUMERIC(10,2) DEFAULT 0,
  loyalty_points INT DEFAULT 0,
  notes         TEXT,
  contact_mode  TEXT DEFAULT 'ai' CHECK (contact_mode IN ('ai', 'manual')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, phone)
);

-- ──────────────────────────────────────────────────────────────
-- 4. LEADS (CRM Pipeline)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  business_id   UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  customer_id   UUID REFERENCES customers(id) ON DELETE CASCADE,
  stage         TEXT DEFAULT 'new'
                  CHECK (stage IN ('new','qualified','converted','lost')),
  source        TEXT DEFAULT 'whatsapp',       -- whatsapp | instagram | walk-in
  interest      TEXT,                          -- what they enquired about
  follow_up_at  TIMESTAMPTZ,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────────
-- 5. RESERVATIONS
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reservations (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  business_id   UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  customer_id   UUID REFERENCES customers(id) ON DELETE CASCADE,
  party_size    INT NOT NULL DEFAULT 1,
  reserved_date DATE NOT NULL,
  reserved_time TIME NOT NULL,
  table_number  INT,
  occasion      TEXT,                          -- birthday | anniversary | business
  special_notes TEXT,
  status        TEXT DEFAULT 'pending'
                  CHECK (status IN ('pending','confirmed','cancelled','completed','no-show')),
  reminder_sent BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────────
-- 6. ORDERS (Delivery / Takeaway)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  business_id   UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  customer_id   UUID REFERENCES customers(id) ON DELETE CASCADE,
  order_type    TEXT DEFAULT 'dine-in'
                  CHECK (order_type IN ('dine-in','takeaway','delivery')),
  items         JSONB,                         -- [{ name, qty, price }]
  total_amount  NUMERIC(10,2),
  status        TEXT DEFAULT 'received'
                  CHECK (status IN ('received','preparing','ready','delivered','cancelled')),
  payment_status TEXT DEFAULT 'pending'
                  CHECK (payment_status IN ('pending','paid','refunded')),
  payment_link  TEXT,
  delivery_addr TEXT,
  lead_stage    TEXT DEFAULT 'qualified',
  metadata      JSONB,                         -- flexible extra fields
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────────
-- 7. TICKETS (Escalations / Support)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  business_id   UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  customer_id   UUID REFERENCES customers(id) ON DELETE CASCADE,
  issue         TEXT NOT NULL,
  category      TEXT DEFAULT 'general'
                  CHECK (category IN ('complaint','refund','feedback','general','urgent')),
  status        TEXT DEFAULT 'open'
                  CHECK (status IN ('open','escalated','in-progress','resolved','closed')),
  priority      TEXT DEFAULT 'normal'
                  CHECK (priority IN ('low','normal','high','urgent')),
  assigned_to   TEXT,
  resolution    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────────
-- 8. MESSAGES (Full Audit Log)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  business_id   UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  customer_id   UUID REFERENCES customers(id) ON DELETE CASCADE,
  direction     TEXT CHECK (direction IN ('inbound','outbound')),
  content       TEXT NOT NULL,
  intent        TEXT,                          -- booking | inquiry | support | payment | feedback
  wa_message_id TEXT,                          -- Meta message ID for dedup
  ai_response   JSONB,                         -- full { reply, db_action } from Gemini
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────────
-- 9. REMINDERS (Scheduled Notifications)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reminders (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  business_id   UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  customer_id   UUID REFERENCES customers(id) ON DELETE CASCADE,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  message       TEXT NOT NULL,
  scheduled_at  TIMESTAMPTZ NOT NULL,
  sent          BOOLEAN DEFAULT FALSE,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────────
-- 10. AUTO-REPLIES
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auto_replies (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  business_id   UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  keyword       TEXT NOT NULL,
  response      TEXT NOT NULL,
  match_type    TEXT DEFAULT 'contains'
                  CHECK (match_type IN ('contains','exact','startsWith')),
  enabled       BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, keyword)
);

-- ──────────────────────────────────────────────────────────────
-- INDEXES (performance)
-- ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_businesses_phone       ON businesses(wa_phone_number);
CREATE INDEX IF NOT EXISTS idx_customers_phone        ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_business     ON customers(business_id);
CREATE INDEX IF NOT EXISTS idx_leads_customer         ON leads(customer_id);
CREATE INDEX IF NOT EXISTS idx_leads_business         ON leads(business_id);
CREATE INDEX IF NOT EXISTS idx_reservations_customer  ON reservations(customer_id);
CREATE INDEX IF NOT EXISTS idx_reservations_business  ON reservations(business_id);
CREATE INDEX IF NOT EXISTS idx_reservations_date      ON reservations(reserved_date);
CREATE INDEX IF NOT EXISTS idx_orders_customer        ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_business        ON orders(business_id);
CREATE INDEX IF NOT EXISTS idx_messages_customer      ON messages(customer_id);
CREATE INDEX IF NOT EXISTS idx_messages_business      ON messages(business_id);
CREATE INDEX IF NOT EXISTS idx_reminders_scheduled    ON reminders(scheduled_at) WHERE sent = FALSE;
CREATE INDEX IF NOT EXISTS idx_reminders_business     ON reminders(business_id);
CREATE INDEX IF NOT EXISTS idx_auto_replies_business   ON auto_replies(business_id);

-- ──────────────────────────────────────────────────────────────
-- AUTO-UPDATE updated_at trigger
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_businesses_updated_at
  BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_whatsapp_sessions_updated_at
  BEFORE UPDATE ON whatsapp_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_reservations_updated_at
  BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_auto_replies_updated_at
  BEFORE UPDATE ON auto_replies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ──────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY (enable + allow service role full access)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE businesses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads             ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_replies      ENABLE ROW LEVEL SECURITY;
