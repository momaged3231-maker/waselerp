-- P7 — grant attachments permissions to operational roles (idempotent)
-- attachments permissions were seeded for Administrator and StoreKeeper only.
-- Cashiers / sales reps / accountants need them to attach documents to invoices.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE p.code IN ('attachments.view', 'attachments.manage')
  AND r.name_en IN ('Cashier', 'SalesRep', 'Accountant')
ON CONFLICT DO NOTHING;
