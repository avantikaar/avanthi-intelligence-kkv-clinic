import { db, config } from "hatchable";
export const access = "scheduler";
export const schedule = "30 * * * *";
export default async function(req,res){
 const s=await db.query("SELECT * FROM clinic_sync_settings WHERE id=1");
 const settings=s.rows[0];
 if(!settings || settings.mode!=="google" || !settings.spreadsheet_id){
  await db.query("INSERT INTO clinic_sync_runs (source_tab,operation,result,message,rows_skipped) VALUES ('*','scheduled_poll','skipped','Google Sheets sync is not configured; no external request was made.',1)");
  return res.json({ok:true,status:"skipped",reason:"Google Sheets integration not configured"});
 }
 const key=await config.get("GOOGLE_SERVICE_ACCOUNT_JSON").catch(()=>null);
 if(!key){
  const message="GOOGLE_SERVICE_ACCOUNT_JSON is missing. Add a Google service-account credential in Hatchable Setup, share the spreadsheet with the service-account email, then configure authenticated Sheets API reads.";
  await db.query("UPDATE clinic_sync_settings SET status='needs_credentials',last_attempt_at=NOW(),last_error=$1,updated_at=NOW() WHERE id=1",[message]);
  await db.query("INSERT INTO clinic_sync_runs (source_tab,operation,result,message,rows_rejected) VALUES ('*','scheduled_poll','blocked',$1,1)",[message]);
  return res.json({ok:false,status:"needs_credentials",message});
 }
 const message="Service-account JSON is present, but the Google OAuth token exchange and Sheets values read/upsert are not yet implemented. No operational data was synchronized.";
 await db.query("UPDATE clinic_sync_settings SET status='integration_incomplete',last_attempt_at=NOW(),last_error=$1,updated_at=NOW() WHERE id=1",[message]);
 await db.query("INSERT INTO clinic_sync_runs (source_tab,operation,result,message,rows_rejected) VALUES ('*','scheduled_poll','blocked',$1,1)",[message]);
 res.json({ok:false,status:"integration_incomplete",message});
}