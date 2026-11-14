-- P7/Ezees-settings — receipt presentation keys (idempotent)
-- New keys consumed by the POS receipt print path (both print agent and browser preview):
--   ShowTaxOnReceipt: show or hide the tax line on the printed receipt (default true)
--   TaxName:          label printed for the tax line (default "ضريبة القيمة المضافة")
INSERT INTO app_settings (setting_key, setting_value, updated_at)
SELECT 'ShowTaxOnReceipt', 'true', now()
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE setting_key = 'ShowTaxOnReceipt');

INSERT INTO app_settings (setting_key, setting_value, updated_at)
SELECT 'TaxName', 'ضريبة القيمة المضافة', now()
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE setting_key = 'TaxName');
