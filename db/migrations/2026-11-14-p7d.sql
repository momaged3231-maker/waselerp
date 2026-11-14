/* P7.4 — per-user restrictions for warehouses and cash accounts. */
CREATE TABLE IF NOT EXISTS user_warehouses (
    user_id integer NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    warehouse_id integer NOT NULL REFERENCES warehouses(warehouse_id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, warehouse_id)
);
CREATE TABLE IF NOT EXISTS user_cash_accounts (
    user_id integer NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    cash_account_id integer NOT NULL REFERENCES cash_accounts(cash_account_id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, cash_account_id)
);
CREATE INDEX IF NOT EXISTS ix_user_warehouses_user ON user_warehouses(user_id);
CREATE INDEX IF NOT EXISTS ix_user_cash_accounts_user ON user_cash_accounts(user_id);
