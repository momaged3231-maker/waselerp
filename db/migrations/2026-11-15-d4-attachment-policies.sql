-- D4: attachment policies — configurable limits (applied server-side on every upload).
INSERT INTO app_settings (setting_key, setting_value)
VALUES
    ('AttachmentMaxKb', '5120'),
    ('AttachmentMaxPerEntity', '20')
ON CONFLICT (setting_key) DO NOTHING;
