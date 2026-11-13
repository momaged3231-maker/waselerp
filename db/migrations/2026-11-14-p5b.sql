ALTER TABLE installment_plans ADD COLUMN IF NOT EXISTS guarantor_party_id integer REFERENCES parties(party_id);
ALTER TABLE installment_plans ADD COLUMN IF NOT EXISTS guarantor_name varchar(200);
ALTER TABLE installment_plans ADD COLUMN IF NOT EXISTS guarantor_phone varchar(50);
ALTER TABLE installment_plans ADD COLUMN IF NOT EXISTS guarantor_id_number varchar(60);
