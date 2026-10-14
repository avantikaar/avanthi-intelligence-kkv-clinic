import { db } from "hatchable";
export const access = "user";
export const methods = ["GET"];
export default async function(req,res) {
  const specs = [
    ["patients","SELECT COUNT(*)::int AS count FROM clinic_patients WHERE archived_at IS NULL"],
    ["appointments_today","SELECT COUNT(*)::int AS count FROM clinic_appointments WHERE archived_at IS NULL AND appointment_date = CURRENT_DATE"],
    ["upcoming_appointments","SELECT COUNT(*)::int AS count FROM clinic_appointments WHERE archived_at IS NULL AND appointment_date >= CURRENT_DATE AND status NOT IN ('Cancelled','Completed','Missed')"],
    ["open_followups","SELECT COUNT(*)::int AS count FROM clinic_follow_ups WHERE archived_at IS NULL AND status NOT IN ('Completed','Closed')"],
    ["active_physio_packages","SELECT COUNT(*)::int AS count FROM clinic_physio_packages WHERE archived_at IS NULL AND LOWER(COALESCE(package_status,'')) IN ('active','ongoing')"],
    ["missed_appointments","SELECT COUNT(*)::int AS count FROM clinic_appointments WHERE archived_at IS NULL AND status='Missed' AND appointment_date >= CURRENT_DATE - INTERVAL '30 days'"],
    ["revenue_month","SELECT COALESCE(SUM(amount),0)::numeric(12,2) AS amount FROM clinic_payments WHERE archived_at IS NULL AND payment_status IN ('Paid','Completed','Success') AND payment_date >= date_trunc('month', CURRENT_DATE)"],
    ["leads_open","SELECT COUNT(*)::int AS count FROM clinic_leads WHERE archived_at IS NULL AND LOWER(COALESCE(lead_status,'')) NOT IN ('converted','closed','lost')"]
  ];
  const result = {};
  for (const [key,sql] of specs) { const q = await db.query(sql); result[key] = q.rows[0]; }
  const appts = await db.query("SELECT a.id, a.patient_id, p.patient_name, a.appointment_date, a.appointment_time, a.appointment_type, a.provider, a.status FROM clinic_appointments a JOIN clinic_patients p ON p.id=a.patient_id WHERE a.archived_at IS NULL AND a.appointment_date >= CURRENT_DATE ORDER BY a.appointment_date, a.appointment_time LIMIT 8");
  const tasks = await db.query("SELECT f.id, f.patient_id, p.patient_name, f.task_type, f.due_date, f.assigned_staff, f.priority, f.status FROM clinic_follow_ups f LEFT JOIN clinic_patients p ON p.id=f.patient_id WHERE f.archived_at IS NULL AND f.status NOT IN ('Completed','Closed') ORDER BY f.due_date NULLS FIRST LIMIT 8");
  const sync = await db.query("SELECT connected, mode, polling_minutes, last_success_at, last_attempt_at, status, last_error, spreadsheet_url FROM clinic_sync_settings WHERE id=1");
  res.json({kpis:result, upcoming_appointments:appts.rows, open_tasks:tasks.rows, sync:sync.rows[0] || {connected:false,mode:"demo",status:"not_configured"}, clinic:"KKV Ortho Clinic", brand:"Avanthi Intelligence"});
}