-- B5.3 review fix — gift/sample return (invoiceType=5) now posts a balanced
-- inventory reinstatement at the item's cost instead of a zero-value stock-only
-- movement. Keeps AR / revenue / VAT untouched.
INSERT INTO gl_accounts (code, name, name_en, account_type, parent_id, is_group, is_active, normal_side, currency_code)
SELECT '5115', 'هدايا وعينات', 'Gifts and Samples', 5,
       (SELECT account_id FROM gl_accounts WHERE code = '51'), false, true, 2, 'EGP'
WHERE NOT EXISTS (SELECT 1 FROM gl_accounts WHERE code = '5115');

INSERT INTO gl_mappings (mapping_key, account_id, description)
SELECT 'GIFT_EXPENSE', account_id, 'هدايا وعينات — عكس استلام هدية عائدة'
  FROM gl_accounts WHERE code = '5115'
ON CONFLICT (mapping_key) DO NOTHING;
