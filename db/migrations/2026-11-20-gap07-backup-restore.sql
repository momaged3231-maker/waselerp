-- GAP-07: backup restore — restore_log + admin.restore_backup permission

CREATE TABLE IF NOT EXISTS restore_log (
  id            serial PRIMARY KEY,
  restored_at   timestamptz NOT NULL DEFAULT now(),
  restored_by   integer REFERENCES users(user_id),
  backup_version integer NOT NULL,
  table_counts  jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_ip     text
);

INSERT INTO permissions (code, module, name)
VALUES ('admin.restore_backup', 'الإدارة', 'استعادة النسخ الاحتياطية')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
  FROM roles r
  JOIN permissions p ON p.code = 'admin.restore_backup'
 WHERE r.name_en = 'Administrator'
ON CONFLICT DO NOTHING;
