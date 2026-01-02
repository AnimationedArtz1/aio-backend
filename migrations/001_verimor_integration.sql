-- ================================================================
-- AIO ASISTAN - VERIMOR MIGRATION SCRIPT
-- ================================================================
-- This script adds Verimor integration tables and updates existing tables
-- No data will be deleted - only new columns and tables are added
-- ================================================================

-- 1. CREATE verimor_numbers TABLE
-- Stores purchased/assigned phone numbers from Verimor
CREATE TABLE IF NOT EXISTS verimor_numbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    did_number VARCHAR(20) UNIQUE NOT NULL,  -- +90850XXXXXXXX format
    status VARCHAR(20) DEFAULT 'available',  -- 'available', 'assigned', 'blocked'
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    webhook_secret VARCHAR(255),             -- Security for webhook verification
    assigned_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- Index for faster lookups by DID number
CREATE INDEX IF NOT EXISTS idx_verimor_numbers_did ON verimor_numbers(did_number);
-- Index for queries by tenant
CREATE INDEX IF NOT EXISTS idx_verimor_numbers_tenant ON verimor_numbers(tenant_id);
-- Index for queries by status
CREATE INDEX IF NOT EXISTS idx_verimor_numbers_status ON verimor_numbers(status);


-- 2. CREATE call_logs TABLE
-- Stores call history and transcripts
CREATE TABLE IF NOT EXISTS call_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    did_number VARCHAR(20) NOT NULL,         -- The called number (agent's DID)
    caller_number VARCHAR(20),               -- The calling number
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    call_sid VARCHAR(255),                   -- Unique call identifier
    duration INTEGER DEFAULT 0,               -- Call duration in seconds
    call_status VARCHAR(50),                 -- 'completed', 'no-answer', 'busy', 'failed'
    direction VARCHAR(20) DEFAULT 'inbound',   -- 'inbound' or 'outbound'
    transcript TEXT,                          -- AI transcript of the call
    recording_url TEXT,                       -- URL to audio recording
    sentiment VARCHAR(20),                    -- 'positive', 'neutral', 'negative'
    summary TEXT,                            -- AI-generated summary
    started_at TIMESTAMP,
    ended_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now()
);

-- Indexes for call_logs
CREATE INDEX IF NOT EXISTS idx_call_logs_did ON call_logs(did_number);
CREATE INDEX IF NOT EXISTS idx_call_logs_tenant ON call_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_agent ON call_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_started_at ON call_logs(started_at);
CREATE INDEX IF NOT EXISTS idx_call_logs_call_sid ON call_logs(call_sid);


-- 3. CREATE purchases TABLE
-- Stores package/plan purchases via Paynet
CREATE TABLE IF NOT EXISTS purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    paynet_ref_code VARCHAR(100) UNIQUE,     -- Unique reference from Paynet
    transaction_id VARCHAR(100),             -- Payment gateway transaction ID
    package_name VARCHAR(100) NOT NULL,      -- 'starter', 'pro', 'enterprise'
    package_details JSONB,                   -- Flexible storage for package features
    price NUMERIC(10, 2),                    -- Price in TL
    currency VARCHAR(3) DEFAULT 'TRY',
    payment_status VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'completed', 'failed', 'refunded'
    payment_method VARCHAR(50),              -- 'credit_card', 'bank_transfer'
    billing_info JSONB,                      -- Store billing address, etc.
    metadata JSONB,                          -- Additional payment data
    expires_at TIMESTAMP,                    -- When this purchase expires (for subscriptions)
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- Indexes for purchases
CREATE INDEX IF NOT EXISTS idx_purchases_tenant ON purchases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchases_ref_code ON purchases(paynet_ref_code);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(payment_status);
CREATE INDEX IF NOT EXISTS idx_purchases_created_at ON purchases(created_at);


-- 4. CREATE n8n_webhooks TABLE
-- Stores n8n webhook URLs for agents
CREATE TABLE IF NOT EXISTS n8n_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    webhook_url VARCHAR(500) NOT NULL,       -- Full n8n webhook URL
    webhook_type VARCHAR(50) NOT NULL,       -- 'voice', 'sms', 'callback'
    is_active BOOLEAN DEFAULT true,
    retry_count INTEGER DEFAULT 0,
    last_triggered_at TIMESTAMP,
    last_status VARCHAR(20),                 -- 'success', 'error'
    error_message TEXT,
    config JSONB,                            -- Additional webhook config
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- Add constraint: one active webhook per agent per type
CREATE UNIQUE INDEX IF NOT EXISTS idx_n8n_webhooks_active ON n8n_webhooks(agent_id, webhook_type)
WHERE is_active = true;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_n8n_webhooks_agent ON n8n_webhooks(agent_id);
CREATE INDEX IF NOT EXISTS idx_n8n_webhooks_type ON n8n_webhooks(webhook_type);


-- 5. ALTER TABLE agents - Add new columns
-- Existing Twilio columns are NOT removed
-- These new columns support Verimor integration

-- Check if column exists before adding (PostgreSQL 9.6+)
DO $$
BEGIN
    -- Add verimor_did column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agents' AND column_name = 'verimor_did'
    ) THEN
        ALTER TABLE agents ADD COLUMN verimor_did VARCHAR(20);
    END IF;

    -- Add is_active column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agents' AND column_name = 'is_active'
    ) THEN
        ALTER TABLE agents ADD COLUMN is_active BOOLEAN DEFAULT true;
    END IF;

    -- Add updated_at column (if not exists)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agents' AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE agents ADD COLUMN updated_at TIMESTAMP DEFAULT now();
    END IF;
END $$;

-- Add foreign key constraint from agents.verimor_did to verimor_numbers.did_number
-- This makes the relationship explicit
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'agents_verimor_did_fkey'
        AND table_name = 'agents'
    ) THEN
        ALTER TABLE agents
        ADD CONSTRAINT agents_verimor_did_fkey
        FOREIGN KEY (verimor_did) REFERENCES verimor_numbers(did_number)
        ON DELETE SET NULL;
    END IF;
END $$;

-- Add index for verimor_did
CREATE INDEX IF NOT EXISTS idx_agents_verimor_did ON agents(verimor_did);
-- Add index for is_active
CREATE INDEX IF NOT EXISTS idx_agents_is_active ON agents(is_active);


-- 6. ADD updated_at TRIGGER
-- Automatically update updated_at timestamp on row changes

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to tables with updated_at column
DROP TRIGGER IF EXISTS update_verimor_numbers_updated_at ON verimor_numbers;
CREATE TRIGGER update_verimor_numbers_updated_at
    BEFORE UPDATE ON verimor_numbers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_purchases_updated_at ON purchases;
CREATE TRIGGER update_purchases_updated_at
    BEFORE UPDATE ON purchases
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_n8n_webhooks_updated_at ON n8n_webhooks;
CREATE TRIGGER update_n8n_webhooks_updated_at
    BEFORE UPDATE ON n8n_webhooks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_agents_updated_at ON agents;
CREATE TRIGGER update_agents_updated_at
    BEFORE UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================
-- Summary of changes:
-- ✅ Created verimor_numbers table
-- ✅ Created call_logs table
-- ✅ Created purchases table
-- ✅ Created n8n_webhooks table
-- ✅ Added verimor_did column to agents
-- ✅ Added is_active column to agents
-- ✅ Added updated_at column to agents
-- ✅ Added foreign key constraints
-- ✅ Created indexes for performance
-- ✅ Added updated_at trigger
-- ================================================================
