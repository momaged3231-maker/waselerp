-- GAP-02: a lead cannot be closed as lost (stage=6) without a reason.
-- Defense in depth: the API returns a clear Arabic 400; this CHECK is the
-- last line of defence for imports/scripts/future code paths.
-- NO silent backfill: if legacy rows violate the rule, ABORT and escalate.

DO $$
DECLARE bad integer;
BEGIN
  SELECT COUNT(*) INTO bad
    FROM crm_leads
   WHERE stage = 6 AND (lost_reason IS NULL OR length(trim(lost_reason)) = 0);
  IF bad > 0 THEN
    RAISE EXCEPTION 'GAP-02 migration aborted: % closed-lost leads have no lost_reason — escalate, no silent backfill', bad;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_crm_leads_lost_reason') THEN
    ALTER TABLE crm_leads
      ADD CONSTRAINT ck_crm_leads_lost_reason
      CHECK (stage <> 6 OR (lost_reason IS NOT NULL AND length(trim(lost_reason)) > 0));
  END IF;
END $$;
