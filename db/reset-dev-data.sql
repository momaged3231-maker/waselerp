/* Resets all transactional data (development only).
   Keeps: users, roles, permissions, branches, warehouses, units, categories,
           cash accounts, periods, settings, chart of accounts, cost centres,
           countries/cities/shipping, customer groups, maintenance master data.
   Deletes in dependency order so foreign keys never fail.
   Run with:  node tools/pg/run-sql.js wasel db/reset-dev-data.sql          */

-- maintenance / workshop
DELETE FROM maintenance_ticket_parts;
DELETE FROM maintenance_tickets;

-- sales/purchase documents and their children
DELETE FROM invoice_payments;
DELETE FROM invoice_allocations;
DELETE FROM eta_invoices;
DELETE FROM zatca_invoices;
DELETE FROM shipments;
DELETE FROM table_order_lines;
DELETE FROM table_orders;
DELETE FROM held_invoices;
DELETE FROM installment_schedule;
DELETE FROM installment_plans;
DELETE FROM quotation_lines;
DELETE FROM quotations;
DELETE FROM order_lines;
DELETE FROM orders;
DELETE FROM checks;
DELETE FROM vouchers;

-- inventory documents
DELETE FROM stock_transfer_lines;
DELETE FROM stock_transfers;
DELETE FROM stock_voucher_lines;
DELETE FROM stock_vouchers;
DELETE FROM stock_count_lines;
DELETE FROM stock_counts;
DELETE FROM stock_operation_lines;
DELETE FROM stock_operations;

-- financial documents (children first)
DELETE FROM invoice_lines;
DELETE FROM cash_transactions;
DELETE FROM ledger_entries;
DELETE FROM gl_entries;
DELETE FROM invoices;
DELETE FROM gl_journals;

-- operations
DELETE FROM shifts;
DELETE FROM reminders;
DELETE FROM attachments;

-- master data created by demo/seed runs
DELETE FROM gift_offers;
DELETE FROM coupons;
DELETE FROM price_list_lines;
DELETE FROM price_lists;
DELETE FROM item_modifiers;
DELETE FROM note_templates;
DELETE FROM restaurant_tables;
DELETE FROM restaurant_halls;

-- stock balances and items
DELETE FROM stock_movements;
DELETE FROM item_warehouse_qty;
DELETE FROM item_units;
DELETE FROM item_components;
DELETE FROM items;

-- HR
DELETE FROM attendances;
DELETE FROM leave_requests;
DELETE FROM salary_pays;
DELETE FROM employees;

-- parties last (referenced by many documents)
DELETE FROM parties;

DELETE FROM activity_log;
UPDATE number_sequences SET last_number = 0;
