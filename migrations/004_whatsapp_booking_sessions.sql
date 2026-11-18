CREATE TABLE IF NOT EXISTS clinic_whatsapp_booking_sessions (
  phone TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'start',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clinic_whatsapp_sessions_updated ON clinic_whatsapp_booking_sessions(updated_at);