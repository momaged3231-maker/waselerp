-- TD-53/54 Phase 1 (P1-01) — Claim Receivable account (TD-67).
-- Supplier claim = an asset owed BY the supplier (party+branch dimension).
-- Verified on clean DB: 2101/2103-2107 exist; 2108/2109 are FREE.
-- No other schema touched. posting.ts untouched.

INSERT INTO gl_accounts
  (code, name, name_en, account_type, parent_id, is_group, is_active, normal_side, currency_code, require_cost_center, notes)
SELECT '2108', 'ذمم مطالبات الموردين', 'Supplier Claim Receivable', 1,
       (SELECT account_id FROM gl_accounts WHERE code = '2'), false, true, 1, 'EGP', false,
       'TD-53/54: DEC-PURCH-027(v2) — أصل مطالبة عند المورد (party+branch)'
WHERE NOT EXISTS (SELECT 1 FROM gl_accounts WHERE code = '2108');

INSERT INTO gl_mappings (mapping_key, account_id)
SELECT 'SUPPLIER_CLAIM_RECEIVABLE',
       (SELECT account_id FROM gl_accounts WHERE code = '2108')
WHERE NOT EXISTS (SELECT 1 FROM gl_mappings WHERE mapping_key = 'SUPPLIER_CLAIM_RECEIVABLE');
