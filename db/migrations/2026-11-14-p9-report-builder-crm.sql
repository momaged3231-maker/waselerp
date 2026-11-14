-- P9: Report builder definitions + CRM (leads, sources, activities, tickets)
CREATE TABLE IF NOT EXISTS report_definitions (
  definition_id serial PRIMARY KEY,
  name varchar(200) NOT NULL,
  dataset varchar(60) NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by integer REFERENCES users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_sources (
  source_id serial PRIMARY KEY,
  name varchar(120) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_leads (
  lead_id serial PRIMARY KEY,
  branch_id integer NOT NULL REFERENCES branches(branch_id),
  name varchar(200) NOT NULL,
  company varchar(200),
  phone varchar(50),
  email varchar(200),
  source_id integer REFERENCES crm_sources(source_id),
  stage smallint NOT NULL DEFAULT 1, -- 1 new,2 contacted,3 qualified,4 proposal,5 won,6 lost
  expected_value numeric(18,2) NOT NULL DEFAULT 0,
  assigned_to integer REFERENCES users(user_id),
  party_id integer REFERENCES parties(party_id),
  notes text,
  lost_reason text,
  created_by integer REFERENCES users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  converted_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_crm_leads_branch_stage ON crm_leads(branch_id, stage);
CREATE INDEX IF NOT EXISTS ix_crm_leads_assigned ON crm_leads(assigned_to);

CREATE TABLE IF NOT EXISTS crm_activities (
  activity_id serial PRIMARY KEY,
  lead_id integer NOT NULL REFERENCES crm_leads(lead_id) ON DELETE CASCADE,
  activity_type smallint NOT NULL DEFAULT 1, -- 1 call,2 meeting,3 note,4 task
  subject varchar(300) NOT NULL,
  notes text,
  due_at timestamptz,
  is_done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  created_by integer REFERENCES users(user_id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_crm_activities_lead ON crm_activities(lead_id, is_done);

CREATE TABLE IF NOT EXISTS crm_tickets (
  ticket_id serial PRIMARY KEY,
  branch_id integer NOT NULL REFERENCES branches(branch_id),
  lead_id integer REFERENCES crm_leads(lead_id) ON DELETE SET NULL,
  party_id integer REFERENCES parties(party_id),
  subject varchar(300) NOT NULL,
  description text,
  status smallint NOT NULL DEFAULT 1, -- 1 open,2 in_progress,3 resolved,4 closed
  priority smallint NOT NULL DEFAULT 2, -- 1 low,2 medium,3 high
  assigned_to integer REFERENCES users(user_id),
  created_by integer REFERENCES users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_crm_tickets_branch_status ON crm_tickets(branch_id, status);

INSERT INTO crm_sources (name) VALUES ('هاتف'), ('واتساب'), ('موقع'), ('إحالة'), ('معرض')
ON CONFLICT DO NOTHING;
