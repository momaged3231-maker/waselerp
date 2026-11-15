-- D15 — «مطاعم» settings tab: service-charge percentage mode + new app_settings keys
-- Mode 3 (serviceChargePct) computes the charge as orderTotal × pct% at table-order close time.
ALTER TABLE restaurant_settings
  ADD COLUMN IF NOT EXISTS service_charge_pct numeric(18,4) NOT NULL DEFAULT 0;

INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES
  ('KitchenTicketPerCategory', 'false', now()),
  ('KitchenTicketShowPrice', 'false', now()),
  ('KitchenDisplayAutoRefresh', 'true', now()),
  ('RestaurantDefaultTableCount', '20', now()),
  ('RestaurantAutoPay', 'false', now()),
  ('RestaurantHideHall', 'false', now()),
  ('RestaurantHideDelivery', 'false', now())
ON CONFLICT (setting_key) DO NOTHING;
