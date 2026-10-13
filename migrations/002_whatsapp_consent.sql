ALTER TABLE clinic_patients ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clinic_patients ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at TIMESTAMPTZ;
ALTER TABLE clinic_patients ADD COLUMN IF NOT EXISTS whatsapp_opt_out_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_clinic_patients_whatsapp_opt_in ON clinic_patients(whatsapp_opt_in) WHERE archived_at IS NULL;