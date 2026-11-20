-- B5.2 — Sales Returns — DEC-SALES-009/010/011.
-- Additive only: a line-level link back to the original sale line so that
-- per-line return quantities and original cost can be traced deterministically.
-- No new damaged table (scope decision): damaged portion is deferred.
ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS returned_from_line_id bigint REFERENCES invoice_lines(invoice_line_id);

CREATE INDEX IF NOT EXISTS ix_invoice_lines_returned_from
  ON invoice_lines(returned_from_line_id);
