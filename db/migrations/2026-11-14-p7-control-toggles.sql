-- General/POS control toggles (idempotent)
INSERT INTO app_settings (setting_key, setting_value, updated_at)
SELECT 'KitchenPrinterName', '', now() WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE setting_key='KitchenPrinterName');
INSERT INTO app_settings (setting_key, setting_value, updated_at)
SELECT 'DefaultPaymentType', '1', now() WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE setting_key='DefaultPaymentType');
INSERT INTO app_settings (setting_key, setting_value, updated_at)
SELECT 'ItemCodeAuto', 'false', now() WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE setting_key='ItemCodeAuto');
INSERT INTO app_settings (setting_key, setting_value, updated_at)
SELECT 'RequireRepOnSale', 'false', now() WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE setting_key='RequireRepOnSale');
INSERT INTO app_settings (setting_key, setting_value, updated_at)
SELECT 'BlockBelowCostSale', 'false', now() WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE setting_key='BlockBelowCostSale');
