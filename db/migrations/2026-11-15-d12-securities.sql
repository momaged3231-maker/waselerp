-- D12: securities instruments — Notes Receivable / Notes Payable GL accounts.
INSERT INTO gl_accounts (code, name, name_en, account_type, parent_id, is_group, is_active, normal_side, currency_code)
SELECT '1107', 'أوراق قبض', 'Notes Receivable', 1,
       (SELECT account_id FROM gl_accounts WHERE code = '11'), false, true, 1, 'EGP'
WHERE NOT EXISTS (SELECT 1 FROM gl_accounts WHERE code = '1107');

INSERT INTO gl_accounts (code, name, name_en, account_type, parent_id, is_group, is_active, normal_side, currency_code)
SELECT '2105', 'أوراق دفع', 'Notes Payable', 2,
       (SELECT account_id FROM gl_accounts WHERE code = '21'), false, true, 2, 'EGP'
WHERE NOT EXISTS (SELECT 1 FROM gl_accounts WHERE code = '2105');

INSERT INTO gl_mappings (mapping_key, account_id, description)
VALUES ('NOTES_RECEIVABLE', (SELECT account_id FROM gl_accounts WHERE code = '1107'), 'أوراق قبض')
ON CONFLICT (mapping_key) DO NOTHING;

INSERT INTO gl_mappings (mapping_key, account_id, description)
VALUES ('NOTES_PAYABLE', (SELECT account_id FROM gl_accounts WHERE code = '2105'), 'أوراق دفع')
ON CONFLICT (mapping_key) DO NOTHING;
