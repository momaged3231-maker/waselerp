/* Resets all transactional data (development only).
   Keeps: users, roles, permissions, branches, warehouses, units, categories,
           cash accounts, periods, settings, chart of accounts, cost centres,
           price lists. */
DELETE FROM gl_entries;
DELETE FROM invoice_lines;
DELETE FROM invoice_allocations;
DELETE FROM shipments;
DELETE FROM table_order_lines;
DELETE FROM table_orders;
DELETE FROM held_invoices;
DELETE FROM cash_transactions;
DELETE FROM ledger_entries;
DELETE FROM installment_schedule;
DELETE FROM installment_plans;
DELETE FROM quotation_lines;
DELETE FROM quotations;
DELETE FROM order_lines;
DELETE FROM orders;
DELETE FROM checks;
DELETE FROM vouchers;
DELETE FROM invoices;
DELETE FROM gl_journals;
DELETE FROM stock_movements;
DELETE FROM shifts;
DELETE FROM stock_operation_lines;
DELETE FROM stock_operations;
DELETE FROM gift_offers;
DELETE FROM item_modifiers;
DELETE FROM restaurant_tables;
DELETE FROM item_warehouse_qty;
DELETE FROM item_units;
DELETE FROM item_components;
DELETE FROM items;
DELETE FROM parties;
DELETE FROM attendances;
DELETE FROM salary_pays;
DELETE FROM employees;
DELETE FROM activity_log;
UPDATE number_sequences SET last_number = 0;
