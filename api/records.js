import { db } from "hatchable";
import { MODULES, validate, clean, isoDate } from "lib/clinic.js";
export const access = "member";
export const methods = ["GET","POST","PUT"];
const moduleToTable = Object.fromEntries(Object.entries(MODULES).map(([name,s])=>[name,s.table]));
function mapRow(moduleName,row) {
 const s=MODULES[moduleName]; const out={id:clean(row[s.id])};
 for(const [header,col] of Object.entries(s.fields)) {
  let v=clean(row[header]);
  if(v===null) out[col]=null;
  else if(col.endsWith("_date") || col==="source_updated_at" || col==="last_reminder_at" || col==="first_response_at" || col==="completed_at") out[col]=col.endsWith("_date")?isoDate(v):v;
  else if(col==="amount" || col==="total_sessions" || col==="campaign_cost" || col==="leads_generated" || col==="attributed_appointments") out[col]=Number(v);
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
  return res.json({module:moduleName,rows:q.rows,fields:[spec.id,...Object.keys(spec.fields)]});
 }
 const body=req.body||{};
 const moduleName=String(body.module||"");
 const rows=Array.isArray(body.rows)?body.rows:[body.row||body];
 const spec=MODULES[moduleName];
 if(!spec) return res.status(400).json({error:"Unknown module",modules:Object.keys(MODULES)});
 const results={created:0,updated:0,skipped:0,rejected:0,errors:[]};
 for(let i=0;i<rows.length;i++){
  const row=rows[i]||{};
  const errs=validate(moduleName,row);
  if(errs.length){results.rejected++;results.errors.push({row:i+1,id:row[spec.id]||null,errors:errs});continue;}
  const mapped=mapRow(moduleName,row);
  if(moduleName==="Appointments" && !["Booked","Confirmed","Arrived","In Consultation","Completed","Cancelled","Missed","Rescheduled"].includes(String(row.Status||"Booked"))) { results.rejected++; results.errors.push({row:i+1,id:mapped.id,errors:["Invalid appointment Status"]}); continue; }
  if(moduleName==="Physio_Sessions" && row.Attendance_Status && !["Scheduled","Attended","Completed","Absent","Cancelled"].includes(String(row.Attendance_Status))) { results.rejected++; results.errors.push({row:i+1,id:mapped.id,errors:["Invalid Attendance_Status"]}); continue; }
  if(moduleName==="Follow_Ups" && row.Status && !["Open","In Progress","Completed","Closed","On Hold"].includes(String(row.Status))) { results.rejected++; results.errors.push({row:i+1,id:mapped.id,errors:["Invalid Follow_Up Status"]}); continue; }
  if(moduleName!=="Patients" && moduleName!=="Leads" && moduleName!=="Campaigns" && mapped.patient_id){
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
  const q=await db.query(sql,vals);
  if(existing.rows.length) results.updated++; else results.created++;
 }
 await db.query("INSERT INTO clinic_audit_logs (actor,action,entity_type,details) VALUES ($1,$2,$3,$4::jsonb)",[req.member?.email||"staff","record_import",moduleName,JSON.stringify(results)]);
 return res.json(results);
}