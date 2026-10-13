import { db } from "hatchable";
export const access = "scheduler";
export const schedule = "0 * * * *";
export default async function(req,res){
 const results=[];
 const rules=await db.query("SELECT id,name,trigger_type,settings FROM clinic_automation_rules WHERE enabled=TRUE");
 const enabled=new Set(rules.rows.map(r=>r.id));
 // Seed only the overdue-missed task flow, without inferring attendance from the clock.
 if(enabled.has("missed_followup")){
  const missed=await db.query("SELECT a.id,a.patient_id FROM clinic_appointments a WHERE a.archived_at IS NULL AND a.status='Missed' AND a.appointment_date >= CURRENT_DATE - INTERVAL '30 days'");
  for(const a of missed.rows){
   const key="missed:"+a.id;
   const exists=await db.query("SELECT id FROM clinic_automation_logs WHERE dedupe_key=$1",[key]);
   if(exists.rows.length) continue;
   const taskId="auto-missed-"+a.id;
   const made=await db.query("INSERT INTO clinic_follow_ups (id,patient_id,related_record_id,task_type,due_date,priority,status) VALUES ($1,$2,$3,'Missed appointment outreach',CURRENT_DATE,'High','Open') ON CONFLICT (id) DO NOTHING RETURNING id",[taskId,a.patient_id,a.id]);
   await db.query("INSERT INTO clinic_automation_logs (rule_id,record_id,dedupe_key,action,status,message) VALUES ('missed_followup',$1,$2,'create_follow_up',$3,$4)",[a.id,key,made.rows.length?"success":"skipped",made.rows.length?"Created a follow-up for a marked-missed appointment":"A follow-up already exists"]);
   results.push({rule:"missed_followup",record_id:a.id,status:made.rows.length?"created":"skipped"});
  }
 }
 if(enabled.has("low_sessions")){
  const packs=await db.query("SELECT p.id,p.patient_id,p.total_sessions,COUNT(s.id) FILTER (WHERE LOWER(COALESCE(s.attendance_status,'')) IN ('attended','completed','present'))::int AS used FROM clinic_physio_packages p LEFT JOIN clinic_physio_sessions s ON s.package_id=p.id AND s.archived_at IS NULL WHERE p.archived_at IS NULL AND LOWER(COALESCE(p.package_status,'')) IN ('active','ongoing') GROUP BY p.id HAVING p.total_sessions-COUNT(s.id) FILTER (WHERE LOWER(COALESCE(s.attendance_status,'')) IN ('attended','completed','present')) <= 2");
  for(const p of packs.rows){
   const key="low-sessions:"+p.id;
   const exists=await db.query("SELECT id FROM clinic_automation_logs WHERE dedupe_key=$1",[key]);
   if(exists.rows.length) continue;
   const taskId="auto-physio-"+p.id;
   const made=await db.query("INSERT INTO clinic_follow_ups (id,patient_id,related_record_id,task_type,due_date,priority,status,outcome) VALUES ($1,$2,$3,'Physiotherapy package renewal',CURRENT_DATE,'Normal','Open',$4) ON CONFLICT (id) DO NOTHING RETURNING id",[taskId,p.patient_id,p.id,JSON.stringify({remaining:Math.max(0,Number(p.total_sessions)-Number(p.used))})]);
   await db.query("INSERT INTO clinic_automation_logs (rule_id,record_id,dedupe_key,action,status,message) VALUES ('low_sessions',$1,$2,'create_renewal_task',$3,$4)",[p.id,key,made.rows.length?"success":"skipped","Remaining sessions calculated from allocated sessions minus attended/completed records"]);
   results.push({rule:"low_sessions",record_id:p.id,status:made.rows.length?"created":"skipped"});
  }
 }
 await db.query("INSERT INTO clinic_audit_logs (actor,action,entity_type,details) VALUES ('scheduler','automation_run','system',$1::jsonb)",[JSON.stringify({results:results.length})]);
 res.json({ok:true,checked_rules:rules.rows.length,actions:results});
}