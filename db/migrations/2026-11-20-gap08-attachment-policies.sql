-- GAP-08: attachment policies — per-entity configurable size/count limits
-- Correct entity types per apps/api/src/modules/attachments/attachments.slice.ts:
--   invoice, item, party, maintenance_ticket, employee, lead

CREATE TABLE IF NOT EXISTS attachment_policies (
  entity_type          varchar(40) PRIMARY KEY,
  max_size_mb          integer NOT NULL DEFAULT 5 CHECK (max_size_mb BETWEEN 1 AND 100),
  max_count_per_entity integer NOT NULL DEFAULT 10 CHECK (max_count_per_entity >= 1),
  updated_by           integer REFERENCES users(user_id),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

INSERT INTO attachment_policies (entity_type) VALUES
  ('invoice'),
  ('item'),
  ('party'),
  ('maintenance_ticket'),
  ('employee'),
  ('lead')
ON CONFLICT (entity_type) DO NOTHING;

-- Admin permission to manage attachment policies (PUT/GET under /admin).
INSERT INTO permissions (code, module, name)
VALUES ('admin.manage_attachments', 'الإدارة', 'إدارة سياسات المرفقات')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
  FROM roles r
  JOIN permissions p ON p.code = 'admin.manage_attachments'
 WHERE r.name_en = 'Administrator'
ON CONFLICT DO NOTHING;
