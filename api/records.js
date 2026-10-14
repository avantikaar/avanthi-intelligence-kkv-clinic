import { db } from "hatchable";
import { MODULES, validate, clean, isoDate } from "lib/clinic.js";
import { sendWhatsAppTemplate, whatsappStatus } from "lib/whatsapp.js";
export const access = "user";
export const methods = ["GET","POST","PUT"];
function mapRow(moduleName,row) {
 const s=MODULES[moduleName]; const out={id:clean(row[s.id])};
 for(const [header,col] of Object.entries(s.fields)) {
  let v=clean(row[header]);
  if(col==="whatsapp_opt_in" && v===null) continue;
  if(col==="whatsapp_opt_in") { out[col]=["true","yes","y","1","opted in"].includes(String(v||"").trim().toLowerCase()); continue; }
  if(v===null) out[col]=null;
  else if(col.endsWith("_date")) { const d=isoDate(v); if(!d) throw new Error("Invalid date in "+header); out[col]=d; }
  else if(col==="source_updated_at" || col==="last_reminder_at" || col==="first_response_at" || col==="completed_at") { const d=new Date(v); if(Number.isNaN(d.getTime())) throw new Error("Invalid timestamp in "+header); out[col]=d.toISOString(); }
  else if(["amount","total_sessions","campaign_cost","leads_generated","attributed_appointments"].includes(col)) out[col]=Number(v);
  else out[col]=v;
 }
 return out;
}
export default async function(req,res) {
 if(req.method==="GET") {
  const moduleName=String(req.query?.module||"Patients");
  const spec=MODULES[moduleName];
  if(!spec) return res.status(400).json({error:"Unknown module",modules:Object.keys(MODULES)});
  const q=await db.query("SELECT * FROM "+spec.table+" WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT 500");
  if(moduleName==="Physiotherapy"){
   for(const row of q.rows){
    const used=await db.query("SELECT COUNT(*)::int AS used FROM clinic_physio_sessions WHERE package_id=$1 AND archived_at IS NULL AND LOWER(COALESCE(attendance_status,'')) IN ('attended','completed','present')",[row.id]);
    row.sessions_used=Number(used.rows[0]?.used||0);
    row.sessions_remaining=Math.max(0,Number(row.total_sessions||0)-row.sessions_used);
   }
  }
  return res.json({module:moduleName,rows:q.rows,fields:[spec.id,...Object.keys(spec.fields)]});
 }
 const body=req.body||{};
 const moduleName=String(body.module||"");
 const rows=Array.isArray(body.rows)?body.rows:[body.row||body];
 const spec=MODULES[moduleName];
 if(!spec) return res.status(400).json({error:"Unknown module",modules:Object.keys(MODULES)});
 if(rows.length>500) return res.status(413).json({error:"Import is limited to 500 rows per request. Split larger files into batches."});
 const results={created:0,updated:0,skipped:0,rejected:0,errors:[]};
 for(let i=0;i<rows.length;i++){
  const row=rows[i]||{};
  const errs=validate(moduleName,row);
  if(errs.length){results.rejected++;results.errors.push({row:i+1,id:row[spec.id]||null,errors:errs});continue;}
  let mapped;
  try{mapped=mapRow(moduleName,row)}catch(e){results.rejected++;results.errors.push({row:i+1,id:row[spec.id]||null,errors:[e.message]});continue;}
  if(moduleName==="Appointments" && !["Booked","Confirmed","Arrived","In Consultation","Completed","Cancelled","Missed","Rescheduled"].includes(String(row.Status||"Booked"))) { results.rejected++; results.errors.push({row:i+1,id:mapped.id,errors:["Invalid appointment Status"]}); continue; }
  if(moduleName==="Physio_Sessions" && row.Attendance_Status && !["Scheduled","Attended","Completed","Absent","Cancelled"].includes(String(row.Attendance_Status))) { results.rejected++; results.errors.push({row:i+1,id:mapped.id,errors:["Invalid Attendance_Status"]}); continue; }
  if(moduleName==="Follow_Ups" && row.Status && !["Open","In Progress","Completed","Closed","On Hold"].includes(String(row.Status))) { results.rejected++; results.errors.push({row:i+1,id:mapped.id,errors:["Invalid Follow_Up Status"]}); continue; }
  if(moduleName==="Patients" && row.Patient_Type && !["New","Repeat"].includes(String(row.Patient_Type))) { results.rejected++; results.errors.push({row:i+1,id:mapped.id,errors:["Patient_Type must be New or Repeat"]}); continue; }
  if(["Appointments","Physiotherapy","Physio_Sessions","Follow_Ups","Payments"].includes(moduleName) && mapped.patient_id){
   const exists=await db.query("SELECT id FROM clinic_patients WHERE id=$1 AND archived_at IS NULL",[mapped.patient_id]);
   if(!exists.rows.length){results.rejected++;results.errors.push({row:i+1,id:mapped.id,errors:["Patient_ID does not exist in Patients"]});continue;}
  }
  if(moduleName==="Physio_Sessions") {
   const p=await db.query("SELECT id FROM clinic_physio_packages WHERE id=$1 AND archived_at IS NULL",[mapped.package_id]);
   if(!p.rows.length){results.rejected++;results.errors.push({row:i+1,id:mapped.id,errors:["Package_ID does not exist in Physiotherapy"]});continue;}
  }
  const cols=Object.keys(mapped);
  const vals=cols.map(k=>mapped[k]);
  const updates=cols.filter(k=>k!=="id").map(k=>k+"=EXCLUDED."+k).join(",");
  const existing=await db.query("SELECT id FROM "+spec.table+" WHERE id=$1",[mapped.id]);
  const sql="INSERT INTO "+spec.table+" ("+cols.join(",")+") VALUES ("+cols.map((_,n)=>"$"+(n+1)).join(",")+") ON CONFLICT (id) DO UPDATE SET "+updates+", updated_at=NOW(), archived_at=NULL RETURNING id";
  await db.query(sql,vals);
  if(existing.rows.length) results.updated++; else results.created++;
  // Send a confirmation only for a newly created single appointment from the staff form.
  // Bulk imports and sheet syncs never trigger outbound messages.
  if(moduleName==="Appointments" && body.row && !existing.rows.length && ["Booked","Confirmed","Rescheduled"].includes(String(row.Status||"Booked"))) {
   const patient=await db.query("SELECT id,patient_name,phone,whatsapp_opt_in FROM clinic_patients WHERE id=$1 AND archived_at IS NULL",[mapped.patient_id]);
   const p=patient.rows[0];
   if(p?.whatsapp_opt_in && p.phone && whatsappStatus().configured) {
    const dedupe="whatsapp:appointment_confirmation:"+mapped.id;
    const prior=await db.query("SELECT id FROM clinic_automation_logs WHERE dedupe_key=$1",[dedupe]);
    if(!prior.rows.length) {
     try {
      const sent=await sendWhatsAppTemplate({to:p.phone,templateName:whatsappStatus().confirmation_template,parameters:[p.patient_name||"Patient",String(mapped.appointment_date||""),String(mapped.appointment_time||"Please contact the clinic")]});
      await db.query("INSERT INTO clinic_notification_attempts (related_record_id,channel,recipient,mode,status,provider_message_id) VALUES ($1,'whatsapp',$2,'live','accepted',$3)",[mapped.id,sent.recipient,sent.message_id]);
      await db.query("INSERT INTO clinic_automation_logs (rule_id,record_id,dedupe_key,action,status,message) VALUES ('appointment_confirmation',$1,$2,'send_whatsapp_template','accepted','Appointment confirmation accepted by Meta')",[mapped.id,dedupe]);
     } catch(err) {
      await db.query("INSERT INTO clinic_notification_attempts (related_record_id,channel,recipient,mode,status,error_message) VALUES ($1,'whatsapp',$2,'live','failed',$3)",[mapped.id,p.phone,String(err.message||err).slice(0,500)]);
      await db.query("INSERT INTO clinic_automation_logs (rule_id,record_id,dedupe_key,action,status,message) VALUES ('appointment_confirmation',$1,$2,'send_whatsapp_template','failed',$3)",[mapped.id,dedupe,String(err.message||err).slice(0,500)]);
     }
    }
   } else if(p?.whatsapp_opt_in && p.phone) {
    await db.query("INSERT INTO clinic_notification_attempts (related_record_id,channel,recipient,mode,status,error_message) VALUES ($1,'whatsapp',$2,'demo','skipped','WhatsApp credentials not configured')",[mapped.id,p.phone]);
   }
  }
 }
 await db.query("INSERT INTO clinic_sync_runs (source_tab,operation,result,message,rows_created,rows_updated,rows_skipped,rows_rejected) VALUES ($1,'csv_import',$2,$3,$4,$5,$6,$7)",[moduleName,results.rejected?"completed_with_errors":"success","CSV import summary",results.created,results.updated,results.skipped,results.rejected]);
 await db.query("INSERT INTO clinic_audit_logs (actor,action,entity_type,details) VALUES ($1,$2,$3,$4::jsonb)",[req.user?.email||"staff","record_import",moduleName,JSON.stringify(results)]);
 return res.json(results);
}