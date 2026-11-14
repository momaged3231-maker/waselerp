-- D7: warranty tracking for maintenance tickets (تحت الضمان).
-- is_warranty marks a ticket as covered by warranty (free/chargeable at the
-- operator's discretion — the flag drives display and reports, not the
-- accounting engine); warranty_ref links to the reference (sale invoice /
-- warranty contract / original ticket).
ALTER TABLE maintenance_tickets ADD COLUMN IF NOT EXISTS is_warranty boolean NOT NULL DEFAULT false;
ALTER TABLE maintenance_tickets ADD COLUMN IF NOT EXISTS warranty_ref varchar(120);
