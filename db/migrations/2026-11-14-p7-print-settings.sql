-- Receipt + kitchen print presentation settings (idempotent)
INSERT INTO app_settings (setting_key, setting_value, updated_at)
SELECT 'ReceiptShowBranchName', 'true', now() WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE setting_key='ReceiptShowBranchName');
INSERT INTO app_settings (setting_key, setting_value, updated_at)
SELECT 'ReceiptShowPartyName', 'true', now() WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE setting_key='ReceiptShowPartyName');
INSERT INTO app_settings (setting_key, setting_value, updated_at)
SELECT 'ReceiptShowTotals', 'true', now() WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE setting_key='ReceiptShowTotals');
INSERT INTO app_settings (setting_key, setting_value, updated_at)
SELECT 'ReceiptCopies', '1', now() WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE setting_key='ReceiptCopies');
INSERT INTO app_settings (setting_key, setting_value, updated_at)
SELECT 'ReceiptPaperSize', 'thermal80', now() WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE setting_key='ReceiptPaperSize');
INSERT INTO app_settings (setting_key, setting_value, updated_at)
SELECT 'KitchenTicketEnabled', 'false', now() WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE setting_key='KitchenTicketEnabled');
INSERT INTO app_settings (setting_key, setting_value, updated_at)
SELECT 'KitchenTicketCopies', '1', now() WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE setting_key='KitchenTicketCopies');
