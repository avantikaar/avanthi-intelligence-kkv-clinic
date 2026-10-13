export const MODULES = {
  Patients: { table: "clinic_patients", id: "Patient_ID", key: "id", fields: { Patient_Name:"patient_name", Phone:"phone", WhatsApp_Opt_In:"whatsapp_opt_in", Registration_Date:"registration_date", Patient_Type:"patient_type", Lead_Source:"lead_source", Record_Status:"record_status", Assigned_Staff:"assigned_staff", Updated_At:"source_updated_at" }, required:["Patient_ID","Patient_Name"] },
  Appointments: { table: "clinic_appointments", id: "Appointment_ID", key: "id", fields: { Patient_ID:"patient_id", Appointment_Date:"appointment_date", Appointment_Time:"appointment_time", Appointment_Type:"appointment_type", Provider:"provider", Booking_Source:"booking_source", Status:"status", Reminder_Status:"reminder_status", Last_Reminder_At:"last_reminder_at", Updated_At:"source_updated_at" }, required:["Appointment_ID","Patient_ID","Appointment_Date"] },
  Physiotherapy: { table: "clinic_physio_packages", id: "Package_ID", key: "id", fields: { Patient_ID:"patient_id", Referral_Date:"referral_date", Referral_Status:"referral_status", Package_Name:"package_name", Total_Sessions:"total_sessions", Package_Start_Date:"package_start_date", Package_Expiry_Date:"package_expiry_date", Assigned_Physiotherapist:"assigned_physiotherapist", Package_Status:"package_status", Renewal_Status:"renewal_status", Updated_At:"source_updated_at" }, required:["Package_ID","Patient_ID","Total_Sessions"] },
  Physio_Sessions: { table: "clinic_physio_sessions", id: "Session_ID", key: "id", fields: { Package_ID:"package_id", Patient_ID:"patient_id", Session_Date:"session_date", Attendance_Status:"attendance_status", Recorded_By:"recorded_by", Updated_At:"source_updated_at" }, required:["Session_ID","Package_ID","Patient_ID"] },
  Leads: { table: "clinic_leads", id: "Lead_ID", key: "id", fields: { Enquiry_Date:"enquiry_date", Lead_Name:"lead_name", Contact_Number:"contact_number", Source:"source", Enquiry_Category:"enquiry_category", Assigned_Owner:"assigned_owner", First_Response_At:"first_response_at", Appointment_ID:"appointment_id", Lead_Status:"lead_status", Follow_Up_Date:"follow_up_date", Outcome:"outcome", Updated_At:"source_updated_at" }, required:["Lead_ID","Lead_Name"] },
  Follow_Ups: { table: "clinic_follow_ups", id: "Task_ID", key: "id", fields: { Patient_ID:"patient_id", Related_Record_ID:"related_record_id", Task_Type:"task_type", Due_Date:"due_date", Assigned_Staff:"assigned_staff", Priority:"priority", Status:"status", Outcome:"outcome", Completed_At:"completed_at", Updated_At:"source_updated_at" }, required:["Task_ID","Task_Type"] },
  Payments: { table: "clinic_payments", id: "Payment_ID", key: "id", fields: { Patient_ID:"patient_id", Related_Record_ID:"related_record_id", Service_Category:"service_category", Amount:"amount", Payment_Date:"payment_date", Payment_Method:"payment_method", Payment_Status:"payment_status", Updated_At:"source_updated_at" }, required:["Payment_ID","Patient_ID","Amount"] },
  Campaigns: { table: "clinic_campaigns", id: "Campaign_ID", key: "id", fields: { Campaign_Name:"campaign_name", Channel:"channel", Start_Date:"start_date", End_Date:"end_date", Campaign_Cost:"campaign_cost", Leads_Generated:"leads_generated", Attributed_Appointments:"attributed_appointments", Notes:"notes" }, required:["Campaign_ID","Campaign_Name"] }
};
export const APPT_STATUSES = ["Booked","Confirmed","Arrived","In Consultation","Completed","Cancelled","Missed","Rescheduled"];
export function clean(v) { return v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim(); }
export function isoDate(v) {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim();
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0,10);
}
export function validate(moduleName, row) {
  const spec = MODULES[moduleName];
  if (!spec) return ["Unknown module/tab"];
  const errors = [];
  for (const f of spec.required) if (clean(row[f]) === null) errors.push("Missing required field: " + f);
  if (moduleName === "Appointments") {
    if (row.Status && !APPT_STATUSES.includes(String(row.Status).trim())) errors.push("Invalid Status. Allowed: " + APPT_STATUSES.join(", "));
    if (row.Appointment_Date && !isoDate(row.Appointment_Date)) errors.push("Invalid Appointment_Date; use YYYY-MM-DD");
  }
  if (moduleName === "Patients" && row.Patient_Type && !["New","Repeat"].includes(String(row.Patient_Type).trim())) errors.push("Patient_Type must be New or Repeat");
  if (moduleName === "Physiotherapy" && row.Total_Sessions && (!Number.isInteger(Number(row.Total_Sessions)) || Number(row.Total_Sessions) < 0)) errors.push("Total_Sessions must be a non-negative integer");
  if (moduleName === "Payments" && row.Amount && (!Number.isFinite(Number(row.Amount)) || Number(row.Amount) < 0)) errors.push("Amount must be a non-negative number");
  return errors;
}