import { db } from "hatchable";
export const access = "scheduler";
export const schedule = "0 * * * *";

async function makeTask({rule,recordId,patientId,type,dueDate,priority="Normal",message,dayKey=""}) {
  const key=rule+":"+recordId+(dayKey?":"+dayKey:"");
  const seen=await db.query("SELECT id FROM clinic_automation_logs WHERE dedupe_key=$1",[key]);
  if(seen.rows.length) return {rule,record_id:recordId,status:"already_processed"};
  const taskId="auto-"+rule.replace(/[^a-z0-9]/gi,"-")+"-"+String(recordId).replace(/[^a-z0-9]/gi,"-")+"-"+(dayKey||"once");
  const made=await db.query("INSERT INTO clinic_follow_ups (id,patient_id,related_record_id,task_type,due_date,priority,status,outcome) VALUES ($1,$2,$3,$4,$5,$6,'Open',$7) ON CONFLICT (id) DO NOTHING RETURNING id",[taskId,patientId||null,String(recordId),type,dueDate||new Date().toISOString().slice(0,10),priority,JSON.stringify({automation:rule,message})]);
  await db.query("INSERT INTO clinic_automation_logs (rule_id,record_id,dedupe_key,action,status,message) VALUES ($1,$2,$3,'create_follow_up',$4,$5)",[rule,String(recordId),key,made.rows.length?"success":"skipped",made.rows.length?message:"Task already exists"]);
  return {rule,record_id:recordId,status:made.rows.length?"created":"skipped"};
}

export default async function(req,res) {
  const rules=await db.query("SELECT id,name,settings FROM clinic_automation_rules WHERE enabled=TRUE");
  const enabled=new Set(rules.rows.map(r=>r.id));
  const actions=[];
  const today=new Date().toISOString().slice(0,10);
  const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
  const expiryEnd=new Date(Date.now()+7*86400000).toISOString().slice(0,10);

  if(enabled.has("missed_followup")) {
    const q=await db.query("SELECT id,patient_id,appointment_date FROM clinic_appointments WHERE archived_at IS NULL AND status='Missed' AND appointment_date >= CURRENT_DATE - INTERVAL '30 days'");
    for(const a of q.rows) actions.push(await makeTask({rule:"missed_followup",recordId:a.id,patientId:a.patient_id,type:"Missed appointment outreach",dueDate:today,priority:"High",message:"Appointment is marked Missed; contact patient and record outcome."}));
  }
  if(enabled.has("appointment_reminders")) {
    const q=await db.query("SELECT id,patient_id,appointment_date,appointment_time,status FROM clinic_appointments WHERE archived_at IS NULL AND appointment_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '1 day' AND status IN ('Booked','Confirmed','Rescheduled') AND COALESCE(reminder_status,'') NOT IN ('Sent','sent')");
    for(const a of q.rows) actions.push(await makeTask({rule:"appointment_reminders",recordId:a.id,patientId:a.patient_id,type:"Appointment reminder",dueDate:a.appointment_date,priority:"Normal",message:"Reminder due for appointment on "+a.appointment_date+" at "+(a.appointment_time||"time not recorded")+". Task only; no message was sent."}));
  }
  if(enabled.has("physio_reminders")) {
    const q=await db.query("SELECT id,patient_id,session_date,attendance_status FROM clinic_physio_sessions WHERE archived_at IS NULL AND session_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '1 day' AND COALESCE(attendance_status,'Scheduled')='Scheduled'");
    for(const s of q.rows) actions.push(await makeTask({rule:"physio_reminders",recordId:s.id,patientId:s.patient_id,type:"Physiotherapy session reminder",dueDate:s.session_date,priority:"Normal",message:"Physiotherapy session reminder due for "+s.session_date+". Task only; no message was sent."}));
  }
  if(enabled.has("low_sessions")) {
    const q=await db.query("SELECT p.id,p.patient_id,p.total_sessions,COUNT(s.id) FILTER (WHERE LOWER(COALESCE(s.attendance_status,'')) IN ('attended','completed','present'))::int AS used FROM clinic_physio_packages p LEFT JOIN clinic_physio_sessions s ON s.package_id=p.id AND s.archived_at IS NULL WHERE p.archived_at IS NULL AND LOWER(COALESCE(p.package_status,'')) IN ('active','ongoing') GROUP BY p.id HAVING p.total_sessions-COUNT(s.id) FILTER (WHERE LOWER(COALESCE(s.attendance_status,'')) IN ('attended','completed','present')) <= 2");
    for(const p of q.rows) actions.push(await makeTask({rule:"low_sessions",recordId:p.id,patientId:p.patient_id,type:"Physiotherapy package renewal",dueDate:today,priority:"Normal",message:"Only "+Math.max(0,Number(p.total_sessions)-Number(p.used))+" sessions remain; review renewal with patient."}));
  }
  if(enabled.has("package_expiry")) {
    const q=await db.query("SELECT id,patient_id,package_expiry_date FROM clinic_physio_packages WHERE archived_at IS NULL AND LOWER(COALESCE(package_status,'')) IN ('active','ongoing') AND package_expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'");
    for(const p of q.rows) actions.push(await makeTask({rule:"package_expiry",recordId:p.id,patientId:p.patient_id,type:"Physiotherapy package expiry",dueDate:p.package_expiry_date,priority:"High",message:"Package expires on "+p.package_expiry_date+"; contact patient to review next steps."}));
  }
  if(enabled.has("lead_followup")) {
    const q=await db.query("SELECT id,lead_name,follow_up_date,assigned_owner FROM clinic_leads WHERE archived_at IS NULL AND follow_up_date <= CURRENT_DATE AND LOWER(COALESCE(lead_status,'')) NOT IN ('converted','closed','lost','not interested')");
    for(const l of q.rows) actions.push(await makeTask({rule:"lead_followup",recordId:l.id,patientId:null,type:"Lead follow-up",dueDate:l.follow_up_date||today,priority:"Normal",message:"Follow up with lead "+l.lead_name+(l.assigned_owner?" (owner: "+l.assigned_owner+")":"")+" and update outcome.",dayKey:today}));
  }
  await db.query("INSERT INTO clinic_audit_logs (actor,action,entity_type,details) VALUES ('scheduler','automation_run','system',$1::jsonb)",[JSON.stringify({enabled_rules:rules.rows.length,actions:actions.length,created:actions.filter(a=>a.status==="created").length})]);
  return res.json({ok:true,checked_rules:rules.rows.length,actions});
}