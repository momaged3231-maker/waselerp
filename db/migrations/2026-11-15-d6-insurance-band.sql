-- D6: insurance policies for payroll (consumed by hr.slice generatePayroll).
INSERT INTO app_settings (setting_key, setting_value)
VALUES
    ('InsuranceEmployeePct', '11'),
    ('InsuranceEmployerPct', '18.75'),
    ('InsuranceInsurableMin', '0'),
    ('InsuranceInsurableMax', '0')
ON CONFLICT (setting_key) DO NOTHING;
