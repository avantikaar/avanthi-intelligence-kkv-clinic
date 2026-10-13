import { db } from "hatchable";
export const access = "admin";
export const methods = ["POST"];
export default async function(req,res){
 const s=await db.query("SELECT * FROM clinic_sync_settings WHERE id=1");
 const settings=s.rows[0];
 const now=new Date().toISOString();
 await db.query("UPDATE clinic_sync_settings SET last_attempt_at=$1,updated_at=NOW() WHERE id=1",[now]);
 if(!settings || settings.mode!=="google" || !settings.spreadsheet_id){
  const msg="No Google Sheets synchronization occurred. Save a spreadsheet ID and choose Google mode, then configure service-account credentials and implement/test the authenticated Sheets read/upsert flow.";
  await db.query("INSERT INTO clinic_sync_runs (source_tab,operation,result,message,rows_skipped) VALUES ('*','manual_sync','blocked',$1,1)",[msg]);
  await db.query("UPDATE clinic_sync_settings SET status='not_configured',last_error=$1 WHERE id=1",[msg]);
  return res.status(400).json({ok:false,status:"not_configured",message:msg});
 }
 const msg="Manual sync is blocked because service-account credentials and Google Sheets OAuth/read/upsert are not yet implemented. No sheet rows were fetched or changed.";
 await db.query("INSERT INTO clinic_sync_runs (source_tab,operation,result,message,rows_rejected) VALUES ('*','manual_sync','blocked',$1,1)",[msg]);
 await db.query("UPDATE clinic_sync_settings SET status='integration_incomplete',last_error=$1 WHERE id=1",[msg]);
 res.status(501).json({ok:false,status:"integration_incomplete",message:msg});
}