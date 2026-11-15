-- D29 — deletion gate: master switch + per-screen switches («الإعدادات ← الحذف»).
-- Consumed by common/delete-guard.ts on every delete endpoint.
-- Missing keys behave as ON (see delete-guard.ts) — this seed just makes the
-- switches visible in /admin/settings so admins can pause deletions.
INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES
  ('DeleteEnabled', 'true', now()),
  ('DeleteEnabled_items', 'true', now()),
  ('DeleteEnabled_parties', 'true', now()),
  ('DeleteEnabled_categories', 'true', now()),
  ('DeleteEnabled_units', 'true', now()),
  ('DeleteEnabled_customerGroups', 'true', now()),
  ('DeleteEnabled_customerClassifications', 'true', now()),
  ('DeleteEnabled_bankAccounts', 'true', now()),
  ('DeleteEnabled_attachments', 'true', now()),
  ('DeleteEnabled_hrDepartments', 'true', now()),
  ('DeleteEnabled_hrComponents', 'true', now()),
  ('DeleteEnabled_hrLatencyTiers', 'true', now()),
  ('DeleteEnabled_hrEarlyPermissions', 'true', now()),
  ('DeleteEnabled_hrAdvances', 'true', now()),
  ('DeleteEnabled_accountingAccounts', 'true', now()),
  ('DeleteEnabled_accountingRecurring', 'true', now()),
  ('DeleteEnabled_crmLeads', 'true', now()),
  ('DeleteEnabled_crmActivities', 'true', now()),
  ('DeleteEnabled_crmSources', 'true', now()),
  ('DeleteEnabled_reminders', 'true', now()),
  ('DeleteEnabled_printProfiles', 'true', now()),
  ('DeleteEnabled_priceLists', 'true', now()),
  ('DeleteEnabled_coupons', 'true', now()),
  ('DeleteEnabled_giftOffers', 'true', now()),
  ('DeleteEnabled_maintenanceProducts', 'true', now()),
  ('DeleteEnabled_maintenanceTickets', 'true', now()),
  ('DeleteEnabled_pos', 'true', now()),
  ('DeleteEnabled_stockVouchers', 'true', now()),
  ('DeleteEnabled_stockTransfers', 'true', now()),
  ('DeleteEnabled_stockCounts', 'true', now()),
  ('DeleteEnabled_reportDefinitions', 'true', now())
ON CONFLICT (setting_key) DO NOTHING;
