-- B5.4 — Sales Credit Note — financial-only settlement, no stock / COGS.
-- Additive only. Uses invoice_type=6 with prefix CN (next free value after
-- 1 sale, 2 purchase, 3 sales return, 4 purchase return, 5 gift return).

-- Line-level link back to the ORIGINAL sale line (separate from
-- returned_from_line_id used by B5.2 physical returns).
ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS cn_parent_line_id bigint REFERENCES invoice_lines(invoice_line_id);

CREATE INDEX IF NOT EXISTS ix_invoice_lines_cn_parent
  ON invoice_lines(cn_parent_line_id);

-- Dedicated contra-revenue account; 4104 is "other income" and 4103 is a
-- cash discount, so neither is suitable for a general sales allowance.
INSERT INTO gl_accounts (code, name, name_en, account_type, parent_id, is_group, is_active, normal_side, currency_code)
SELECT '4108', 'مخصصات المبيعات — إشعارات دائن', 'Sales Allowances / Credit Notes', 4,
       (SELECT account_id FROM gl_accounts WHERE code = '41'), false, true, 2, 'EGP'
WHERE NOT EXISTS (SELECT 1 FROM gl_accounts WHERE code = '4108');

INSERT INTO gl_mappings (mapping_key, account_id, description)
SELECT 'SALES_ALLOWANCES', account_id, 'مخصصات المبيعات — إشعارات دائن'
  FROM gl_accounts WHERE code = '4108'
ON CONFLICT (mapping_key) DO NOTHING;
