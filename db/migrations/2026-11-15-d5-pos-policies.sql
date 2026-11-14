-- D5: configurable POS policies (all consumed by code — see docs/EEYES-STEPS.md).
INSERT INTO app_settings (setting_key, setting_value)
VALUES
    ('RequireCustomerOnSale', 'false'),
    ('AutoPrintReceipt', 'true'),
    ('DefaultOrderType', '1')
ON CONFLICT (setting_key) DO NOTHING;
