-- D14 — «الإعدادات» hub: barcode label settings («طباعة الباركود» tab)
-- Consumed by LabelsScreen (/warehouses ← طباعة الباركود). Idempotent insert.
INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES
  ('BarcodeLabelFormat', 'medium', now()),
  ('BarcodeLabelCopies', '1', now()),
  ('BarcodeShowName', 'true', now()),
  ('BarcodeShowCode', 'true', now()),
  ('BarcodeShowPrice', 'true', now())
ON CONFLICT (setting_key) DO NOTHING;
