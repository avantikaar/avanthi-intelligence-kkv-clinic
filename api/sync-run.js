import { db, config } from "hatchable";
import { MODULES, validate, clean, isoDate } from "lib/clinic.js";
export const access = "admin";
export const methods = ["POST"];

function b64url(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function pemBytes(pem) {
  const body=String(pem).replace(/-----BEGIN PRIVATE KEY-----/g,"").replace(/-----END PRIVATE KEY-----/g,"").replace(/\s/g,"");
  const bin=atob(body); const out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
  return out;
}
async function googleToken(sa) {
  const now=Math.floor(Date.now()/1000);
  const header=b64url(JSON.stringify({alg:"RS256",typ:"JWT"}));
  const claim=b64url(JSON.stringify({iss:sa.client_email,scope:"https://www.googleapis.com/auth/spreadsheets.readonly",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3500}));
  const unsigned=header+"."+claim;
  const key=await crypto.subtle.importKey("pkcs8",pemBytes(sa.private_key),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const signature=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(unsigned));
  const assertion=unsigned+"."+b64url(new Uint8Array(signature));
  const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion}).toString()});
  const data=await response.json();
  if(!response.ok || !data.access_token) throw new Error("Google OAuth failed ("+response.status+"): "+(data.error_description||data.error||"No access token"));
  return data.access_token;
}
async function readTab(token,spreadsheetId,tab) {
  const range=encodeURIComponent("'"+tab.replace(/'/g,"''")+"'!A:AZ");
  const url="https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(spreadsheetId)+"/values/"+range+"?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING";
  const response=await fetch(url,{headers:{authorization:"Bearer "+token}});
  const data=await response.json();
  if(!response.ok) throw new Error("Google Sheets read failed for "+tab+" ("+response.status+"): "+(data.error?.message||"unknown error"));
  const values=Array.isArray(data.values)?data.values:[];
  if(values.length<2) return [];
  const headers=values[0].map(v=>String(v??"").trim());
  return values.slice(1).map((values,rowIndex)=>{
    const row={}; headers.forEach((h,i)=>{if(h) row[h]=values[i]===undefined?"":values[i]});
    return {row,rowNumber:rowIndex+2};
  }).filter(x=>Object.values(x.row).some(v=>String(v??"").trim()!==""));
}
function mapRow(moduleName,row) {
  const spec=MODULES[moduleName]; const out={id:clean(row[spec.id])};
  for(const [header,col] of Object.entries(spec.fields)) {
    const v=clean(row[header]);
    if(v===null){out[col]=null;continue;}
    if(col.endsWith("_date")){const d=isoDate(v);if(!d)throw new Error("Invalid date in "+header+"; use YYYY-MM-DD");out[col]=d;}
    else if(["source_updated_at","last_reminder_at","first_response_at","completed_at"].includes(col)){const d=new Date(v);if(Number.isNaN(d.getTime()))throw new Error("Invalid timestamp in "+header);out[col]=d.toISOString();}
    else if(["amount","total_sessions","campaign_cost","leads_generated","attributed_appointments"].includes(col)){const n=Number(v);if(!Number.isFinite(n))throw new Error("Invalid number in "+header);out[col]=n;}
    else out[col]=v;
  }
  return out;
}
async function upsert(moduleName,row,rowNumber) {
  const spec=MODULES[moduleName]; const errs=validate(moduleName,row);
  if(errs.length) return {rejected:1,error:errs.join("; ")};
  let mapped;
  try { mapped=mapRow(moduleName,row); } catch(e) { return {rejected:1,error:e.message}; }
  if(["Appointments","Physiotherapy","Physio_Sessions","Follow_Ups","Payments"].includes(moduleName) && mapped.patient_id){
    const q=await db.query("SELECT id FROM clinic_patients WHERE id=$1 AND archived_at IS NULL",[mapped.patient_id]);
    if(!q.rows.length) return {rejected:1,error:"Patient_ID must already exist in Patients"};
  }
  if(moduleName==="Physio_Sessions"){
    const q=await db.query("SELECT id FROM clinic_physio_packages WHERE id=$1 AND archived_at IS NULL",[mapped.package_id]);
    if(!q.rows.length) return {rejected:1,error:"Package_ID must already exist in Physiotherapy"};
  }
  if(moduleName==="Appointments" && mapped.status && !["Booked","Confirmed","Arrived","In Consultation","Completed","Cancelled","Missed","Rescheduled"].includes(mapped.status)) return {rejected:1,error:"Invalid appointment Status"};
  if(moduleName==="Physio_Sessions" && mapped.attendance_status && !["Scheduled","Attended","Completed","Absent","Cancelled"].includes(mapped.attendance_status)) return {rejected:1,error:"Invalid Attendance_Status"};
  if(moduleName==="Follow_Ups" && mapped.status && !["Open","In Progress","Completed","Closed","On Hold"].includes(mapped.status)) return {rejected:1,error:"Invalid Follow_Up Status"};
  const cols=Object.keys(mapped), updates=cols.filter(k=>k!=="id").map(k=>k+"=EXCLUDED."+k).join(",");
  const existing=await db.query("SELECT id FROM "+spec.table+" WHERE id=$1",[mapped.id]);
  await db.query("INSERT INTO "+spec.table+" ("+cols.join(",")+") VALUES ("+cols.map((_,i)=>"$"+(i+1)).join(",")+") ON CONFLICT (id) DO UPDATE SET "+updates+",updated_at=NOW(),archived_at=NULL",cols.map(k=>mapped[k]));
  const created=!existing.rows.length;
  await db.query("INSERT INTO clinic_audit_logs (actor,action,entity_type,entity_id,details) VALUES ('google_sheets','sheet_upsert',$1,$2,$3::jsonb)",[moduleName,mapped.id,JSON.stringify({source:"google_sheets_api",row_number:rowNumber})]);
  return {created:created?1:0,updated:created?0:1};
}
export async function runGoogleSync() {
  const settingsQ=await db.query("SELECT * FROM clinic_sync_settings WHERE id=1");
  const settings=settingsQ.rows[0];
  if(!settings?.spreadsheet_id || settings.mode!=="google") return {ok:false,status:"not_configured",message:"Save the Google spreadsheet URL and choose Google mode first."};
  const raw=await config.get("GOOGLE_SERVICE_ACCOUNT_JSON").catch(()=>null);
  if(!raw) return {ok:false,status:"credentials_missing",message:"Set GOOGLE_SERVICE_ACCOUNT_JSON in Hatchable Setup."};
  let sa;
  try { sa=JSON.parse(raw); } catch { return {ok:false,status:"credentials_invalid",message:"GOOGLE_SERVICE_ACCOUNT_JSON must contain the full service-account JSON."}; }
  if(!sa.client_email || !sa.private_key) return {ok:false,status:"credentials_invalid",message:"Service-account JSON is missing client_email or private_key."};
  const now=new Date().toISOString();
  await db.query("UPDATE clinic_sync_settings SET last_attempt_at=$1,updated_at=NOW() WHERE id=1",[now]);
  const summary={rows_created:0,rows_updated:0,rows_skipped:0,rows_rejected:0,errors:[],tabs:[]};
  try {
    const token=await googleToken(sa);
    for(const moduleName of Object.keys(MODULES)) {
      let rows;
      try { rows=await readTab(token,settings.spreadsheet_id,moduleName); }
      catch(e) {
        summary.rows_rejected++;
        summary.errors.push({tab:moduleName,error:e.message});
        await db.query("INSERT INTO clinic_sync_runs (source_tab,operation,result,message,rows_rejected) VALUES ($1,'google_sheets_sync','error',$2,1)",[moduleName,e.message]);
        continue;
      }
      const tabSummary={tab:moduleName,read:rows.length,created:0,updated:0,rejected:0};
      for(const item of rows) {
        try {
          const result=await upsert(moduleName,item.row,item.rowNumber);
          if(result.rejected){summary.rows_rejected++;tabSummary.rejected++;summary.errors.push({tab:moduleName,row:item.rowNumber,error:result.error});}
          else {summary.rows_created+=result.created;summary.rows_updated+=result.updated;tabSummary.created+=result.created;tabSummary.updated+=result.updated;}
        } catch(e) {
          summary.rows_rejected++;tabSummary.rejected++;summary.errors.push({tab:moduleName,row:item.rowNumber,error:e.message});
        }
      }
      summary.tabs.push(tabSummary);
      await db.query("INSERT INTO clinic_sync_runs (source_tab,operation,result,message,rows_created,rows_updated,rows_skipped,rows_rejected) VALUES ($1,'google_sheets_sync',$2,$3,$4,$5,$6,$7)",[moduleName,tabSummary.rejected?"completed_with_errors":"success","Read "+rows.length+" rows from Google Sheets",tabSummary.created,tabSummary.updated,0,tabSummary.rejected]);
    }
    const status=summary.rows_rejected?"connected_with_errors":"connected";
    await db.query("UPDATE clinic_sync_settings SET connected=TRUE,status=$1,last_success_at=NOW(),last_error=$2,updated_at=NOW() WHERE id=1",[status,summary.errors.length?JSON.stringify(summary.errors.slice(0,20)):null]);
    return {ok:true,status,spreadsheet_id:settings.spreadsheet_id,...summary};
  } catch(e) {
    await db.query("INSERT INTO clinic_sync_runs (source_tab,operation,result,message,rows_rejected) VALUES ('*','google_sheets_sync','error',$1,1)",[e.message]);
    await db.query("UPDATE clinic_sync_settings SET connected=FALSE,status='error',last_error=$1,updated_at=NOW() WHERE id=1",[e.message]);
    return {ok:false,status:"error",message:e.message,...summary};
  }
}
export default async function(req,res) {
  const result=await runGoogleSync();
  if(!result.ok) return res.status(result.status==="not_configured"?400:result.status==="credentials_missing"?400:502).json(result);
  return res.json(result);
}