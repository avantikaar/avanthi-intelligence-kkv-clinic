import { db, config } from "hatchable";
import { MODULES, validate, clean, isoDate } from "lib/clinic.js";
export const access = "public";
export const methods = ["POST"];

function mapRow(moduleName,row) {
  const spec=MODULES[moduleName];
  const out={id:clean(row[spec.id])};
  for(const [header,col] of Object.entries(spec.fields)) {
    let v=clean(row[header]);
    if(v===null) { out[col]=null; continue; }
    if(col.endsWith("_date")) {
      const d=isoDate(v);
      if(!d) throw new Error("Invalid date in "+header+"; use YYYY-MM-DD");
      out[col]=d;
    } else if(["source_updated_at","last_reminder_at","first_response_at","completed_at"].includes(col)) {
      const d=new Date(v);
      if(Number.isNaN(d.getTime())) throw new Error("Invalid timestamp in "+header);
      out[col]=d.toISOString();
    } else if(["amount","total_sessions","campaign_cost","leads_generated","attributed_appointments"].includes(col)) {
      const n=Number(v);
      if(!Number.isFinite(n)) throw new Error("Invalid number in "+header);
      out[col]=n;
    } else out[col]=v;
  }
  return out;
}

export default async function(req,res) {
  const secret=await config.get("GOOGLE_APPS_SCRIPT_WEBHOOK_SECRET").catch(()=>null);
  const got=String(req.headers["x-kkv-webhook-secret"]||"");
  if(!secret || got!==secret) return res.status(401).json({ok:false,error:"Webhook authentication failed or secret not configured"});
  const b=req.body||{};
  const moduleName=String(b.module||b.tab||"");
  const spec=MODULES[moduleName];
  if(!spec) return res.status(400).json({ok:false,error:"Unknown module/tab",allowed:Object.keys(MODULES)});
  const row=b.row;
  if(!row || typeof row!=="object" || Array.isArray(row)) return res.status(400).json({ok:false,error:"Expected row object keyed by the sheet's header row"});
  const errs=validate(moduleName,row);
  if(errs.length) {
    await db.query("INSERT INTO clinic_sync_runs (source_tab,operation,result,message,rows_rejected) VALUES ($1,'webhook_upsert','rejected',$2,1)",[moduleName,errs.join("; ")]);
    return res.status(422).json({ok:false,rejected:true,errors:errs});
  }
  let mapped;
  try { mapped=mapRow(moduleName,row); }
  catch(e) {
    await db.query("INSERT INTO clinic_sync_runs (source_tab,operation,result,message,rows_rejected) VALUES ($1,'webhook_upsert','rejected',$2,1)",[moduleName,e.message]);
    return res.status(422).json({ok:false,rejected:true,errors:[e.message]});
  }
  if(["Appointments","Physiotherapy","Physio_Sessions","Follow_Ups","Payments"].includes(moduleName) && mapped.patient_id) {
    const q=await db.query("SELECT id FROM clinic_patients WHERE id=$1 AND archived_at IS NULL",[mapped.patient_id]);
    if(!q.rows.length) return res.status(422).json({ok:false,rejected:true,errors:["Patient_ID must already exist in Patients"]});
  }
  if(moduleName==="Physio_Sessions") {
    const q=await db.query("SELECT id FROM clinic_physio_packages WHERE id=$1 AND archived_at IS NULL",[mapped.package_id]);
    if(!q.rows.length) return res.status(422).json({ok:false,rejected:true,errors:["Package_ID must already exist in Physiotherapy"]});
  }
  if(moduleName==="Appointments" && mapped.status && !["Booked","Confirmed","Arrived","In Consultation","Completed","Cancelled","Missed","Rescheduled"].includes(mapped.status)) return res.status(422).json({ok:false,rejected:true,errors:["Invalid appointment Status"]});
  if(moduleName==="Physio_Sessions" && mapped.attendance_status && !["Scheduled","Attended","Completed","Absent","Cancelled"].includes(mapped.attendance_status)) return res.status(422).json({ok:false,rejected:true,errors:["Invalid Attendance_Status"]});
  if(moduleName==="Follow_Ups" && mapped.status && !["Open","In Progress","Completed","Closed","On Hold"].includes(mapped.status)) return res.status(422).json({ok:false,rejected:true,errors:["Invalid Follow_Up Status"]});
  const cols=Object.keys(mapped);
  const updates=cols.filter(k=>k!=="id").map(k=>k+"=EXCLUDED."+k).join(",");
  const existing=await db.query("SELECT id FROM "+spec.table+" WHERE id=$1",[mapped.id]);
  await db.query("INSERT INTO "+spec.table+" ("+cols.join(",")+") VALUES ("+cols.map((_,i)=>"$"+(i+1)).join(",")+") ON CONFLICT (id) DO UPDATE SET "+updates+",updated_at=NOW(),archived_at=NULL",cols.map(k=>mapped[k]));
  const created=!existing.rows.length;
  await db.query("INSERT INTO clinic_sync_runs (source_tab,operation,record_id,result,message,rows_created,rows_updated) VALUES ($1,'webhook_upsert',$2,'success',$3,$4,$5)",[moduleName,mapped.id,created?"Created from Google Sheets":"Updated from Google Sheets",created?1:0,created?0:1]);
  await db.query("INSERT INTO clinic_audit_logs (actor,action,entity_type,entity_id,details) VALUES ('google_sheets','sheet_upsert',$1,$2,$3::jsonb)",[moduleName,mapped.id,JSON.stringify({source:"google_apps_script",row_number:b.row_number||null})]);
  return res.json({ok:true,created,updated:!created,module:moduleName,record_id:mapped.id});
}