CREATE TABLE IF NOT EXISTS clinic_patients (
 id TEXT PRIMARY KEY,
 patient_name TEXT NOT NULL,
 phone TEXT,
 registration_date DATE,
 patient_type TEXT,
 lead_source TEXT,
 record_status TEXT,
 assigned_staff TEXT,
 source_updated_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 archived_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS clinic_appointments (
 id TEXT PRIMARY KEY,
 patient_id TEXT NOT NULL REFERENCES clinic_patients(id),
 appointment_date DATE NOT NULL,
 appointment_time TEXT,
 appointment_type TEXT,
 provider TEXT,
 booking_source TEXT,
 status TEXT NOT NULL DEFAULT 'Booked',
 reminder_status TEXT,
 last_reminder_at TIMESTAMPTZ,
 source_updated_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 archived_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS clinic_physio_packages (
 id TEXT PRIMARY KEY,
 patient_id TEXT NOT NULL REFERENCES clinic_patients(id),
 referral_date DATE,
 referral_status TEXT,
 package_name TEXT,
 total_sessions INTEGER NOT NULL DEFAULT 0,
 package_start_date DATE,
 package_expiry_date DATE,
 assigned_physiotherapist TEXT,
 package_status TEXT,
 renewal_status TEXT,
 source_updated_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 archived_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS clinic_physio_sessions (
 id TEXT PRIMARY KEY,
 package_id TEXT NOT NULL REFERENCES clinic_physio_packages(id),
 patient_id TEXT NOT NULL REFERENCES clinic_patients(id),
 session_date DATE,
 attendance_status TEXT,
 recorded_by TEXT,
 source_updated_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 archived_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS clinic_leads (
 id TEXT PRIMARY KEY,
 enquiry_date DATE,
 lead_name TEXT NOT NULL,
 contact_number TEXT,
 source TEXT,
 enquiry_category TEXT,
 assigned_owner TEXT,
 first_response_at TIMESTAMPTZ,
 appointment_id TEXT,
 lead_status TEXT,
 follow_up_date DATE,
 outcome TEXT,
 source_updated_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 archived_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS clinic_follow_ups (
 id TEXT PRIMARY KEY,
 patient_id TEXT REFERENCES clinic_patients(id),
 related_record_id TEXT,
 task_type TEXT,
 due_date DATE,
 assigned_staff TEXT,
 priority TEXT DEFAULT 'Normal',
 status TEXT DEFAULT 'Open',
 outcome TEXT,
 completed_at TIMESTAMPTZ,
 source_updated_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 archived_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS clinic_payments (
 id TEXT PRIMARY KEY,
 patient_id TEXT NOT NULL REFERENCES clinic_patients(id),
 related_record_id TEXT,
 service_category TEXT,
 amount NUMERIC(12,2) NOT NULL DEFAULT 0,
 payment_date DATE,
 payment_method TEXT,
 payment_status TEXT,
 source_updated_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 archived_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS clinic_campaigns (
 id TEXT PRIMARY KEY,
 campaign_name TEXT NOT NULL,
 channel TEXT,
 start_date DATE,
 end_date DATE,
 campaign_cost NUMERIC(12,2) DEFAULT 0,
 leads_generated INTEGER DEFAULT 0,
 attributed_appointments INTEGER DEFAULT 0,
 notes TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 archived_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS clinic_sync_settings (
 id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
 spreadsheet_id TEXT,
 spreadsheet_url TEXT,
 connected BOOLEAN NOT NULL DEFAULT FALSE,
 mode TEXT NOT NULL DEFAULT 'demo',
 polling_minutes INTEGER NOT NULL DEFAULT 15,
 last_success_at TIMESTAMPTZ,
 last_attempt_at TIMESTAMPTZ,
 status TEXT NOT NULL DEFAULT 'not_configured',
 last_error TEXT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS clinic_sync_runs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 source_tab TEXT,
 operation TEXT,
 record_id TEXT,
 result TEXT NOT NULL,
 message TEXT,
 rows_created INTEGER NOT NULL DEFAULT 0,
 rows_updated INTEGER NOT NULL DEFAULT 0,
 rows_skipped INTEGER NOT NULL DEFAULT 0,
 rows_rejected INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS clinic_automation_rules (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 trigger_type TEXT NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT TRUE,
 settings JSONB NOT NULL DEFAULT '{}'::jsonb,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS clinic_automation_logs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 rule_id TEXT,
 record_id TEXT,
 dedupe_key TEXT UNIQUE,
 action TEXT NOT NULL,
 status TEXT NOT NULL,
 message TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS clinic_notification_attempts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 related_record_id TEXT,
 channel TEXT NOT NULL,
 recipient TEXT,
 mode TEXT NOT NULL DEFAULT 'demo',
 status TEXT NOT NULL,
 provider_message_id TEXT,
 error_message TEXT,
 attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS clinic_audit_logs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 actor TEXT,
 action TEXT NOT NULL,
 entity_type TEXT,
 entity_id TEXT,
 details JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clinic_appt_date_status ON clinic_appointments(appointment_date, status);
CREATE INDEX IF NOT EXISTS idx_clinic_followups_due_status ON clinic_follow_ups(due_date, status);
CREATE INDEX IF NOT EXISTS idx_clinic_physio_patient ON clinic_physio_packages(patient_id);
CREATE INDEX IF NOT EXISTS idx_clinic_sync_runs_created ON clinic_sync_runs(created_at DESC);