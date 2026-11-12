CREATE TABLE IF NOT EXISTS clinic_invoices (
 id text PRIMARY KEY,
 invoice_number text NOT NULL UNIQUE,
 patient_id text NOT NULL REFERENCES clinic_patients(id),
 related_record_id text,
 invoice_date date NOT NULL DEFAULT CURRENT_DATE,
 status text NOT NULL DEFAULT 'Draft',
 subtotal numeric(12,2) NOT NULL DEFAULT 0,
 discount numeric(12,2) NOT NULL DEFAULT 0,
 tax numeric(12,2) NOT NULL DEFAULT 0,
 total numeric(12,2) NOT NULL DEFAULT 0,
 amount_paid numeric(12,2) NOT NULL DEFAULT 0,
 balance numeric(12,2) NOT NULL DEFAULT 0,
 notes text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clinic_invoices_patient ON clinic_invoices(patient_id, invoice_date DESC);
CREATE TABLE IF NOT EXISTS clinic_invoice_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_id text NOT NULL REFERENCES clinic_invoices(id) ON DELETE CASCADE,
 item_type text NOT NULL DEFAULT 'Service',
 description text NOT NULL,
 quantity numeric(12,2) NOT NULL DEFAULT 1,
 unit_price numeric(12,2) NOT NULL DEFAULT 0,
 line_total numeric(12,2) NOT NULL DEFAULT 0,
 medicine_batch_id text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS clinic_medicines (
 id text PRIMARY KEY,
 name text NOT NULL,
 generic_name text,
 strength text,
 dosage_form text,
 unit text NOT NULL DEFAULT 'tablet',
 reorder_level integer NOT NULL DEFAULT 10,
 selling_price numeric(12,2) NOT NULL DEFAULT 0,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS clinic_medicine_batches (
 id text PRIMARY KEY,
 medicine_id text NOT NULL REFERENCES clinic_medicines(id),
 batch_number text NOT NULL,
 expiry_date date,
 purchase_price numeric(12,2) NOT NULL DEFAULT 0,
 quantity_received integer NOT NULL DEFAULT 0,
 quantity_available integer NOT NULL DEFAULT 0,
 supplier text,
 received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(medicine_id,batch_number)
);
CREATE INDEX IF NOT EXISTS idx_clinic_batch_expiry ON clinic_medicine_batches(medicine_id,expiry_date);
CREATE TABLE IF NOT EXISTS clinic_stock_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 medicine_id text NOT NULL REFERENCES clinic_medicines(id),
 batch_id text REFERENCES clinic_medicine_batches(id),
 movement_type text NOT NULL,
 quantity integer NOT NULL,
 reference_id text,
 notes text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS clinic_physio_queue (
 id text PRIMARY KEY,
 appointment_id text UNIQUE,
 patient_id text NOT NULL REFERENCES clinic_patients(id),
 therapist text,
 scheduled_at timestamptz NOT NULL,
 checked_in_at timestamptz,
 session_started_at timestamptz,
 session_ended_at timestamptz,
 expected_duration_minutes integer NOT NULL DEFAULT 45,
 status text NOT NULL DEFAULT 'Expected',
 notes text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clinic_physio_queue_schedule ON clinic_physio_queue(scheduled_at,status);