-- ──────────────────────────────────────────────────────────────
--  Migration: Baileys Auth State Persistence
--  Run this script on your PostgreSQL database to support
--  database-backed WhatsApp sessions.
-- ──────────────────────────────────────────────────────────────

-- 1. Add creds column to whatsapp_sessions to persist connection credentials
ALTER TABLE whatsapp_sessions 
ADD COLUMN IF NOT EXISTS creds JSONB;

-- 2. Create baileys_keys table to persist session encryption keys relationally
CREATE TABLE IF NOT EXISTS baileys_keys (
  business_id   UUID REFERENCES businesses(id) ON DELETE CASCADE,
  key_type      TEXT NOT NULL,
  key_id        TEXT NOT NULL,
  key_data      JSONB NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (business_id, key_type, key_id)
);

-- Index for fast key searches
CREATE INDEX IF NOT EXISTS idx_baileys_keys_lookup 
ON baileys_keys(business_id, key_type);
