-- Print agents + cloud print jobs (cross-location printing).
-- A print agent runs on a cashier PC, registers itself, heartbeats its
-- printer list, and polls for pending jobs to execute locally.

CREATE TABLE IF NOT EXISTS print_agents (
  agent_id      SERIAL PRIMARY KEY,
  agent_uid     VARCHAR(64) NOT NULL UNIQUE,
  machine_name  VARCHAR(120) NOT NULL,
  ip_address    VARCHAR(64),
  token         VARCHAR(120) NOT NULL,
  printers      JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_online     BOOLEAN NOT NULL DEFAULT false,
  last_seen     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS print_jobs (
  job_id        SERIAL PRIMARY KEY,
  agent_id      INTEGER NOT NULL REFERENCES print_agents(agent_id) ON DELETE CASCADE,
  printer_name  VARCHAR(200) NOT NULL,
  printer_type  VARCHAR(20) NOT NULL DEFAULT 'windows',
  payload       JSONB NOT NULL,
  copies        INTEGER NOT NULL DEFAULT 1,
  width         INTEGER NOT NULL DEFAULT 42,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',
  error         TEXT,
  created_by    INTEGER REFERENCES users(user_id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_print_jobs_agent_status ON print_jobs(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_print_jobs_created ON print_jobs(created_at);
