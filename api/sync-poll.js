import { db } from "hatchable";
export const access = "scheduler";
export const schedule = "0 * * * *";
export default async function(req,res) {
  const q=await db.query("SELECT mode,spreadsheet_id FROM clinic_sync_settings WHERE id=1");
  const s=q.rows[0];
  if(!s || s.mode!=="google" || !s.spreadsheet_id) return res.json({ok:true,status:"not_configured",message:"Save the spreadsheet URL and choose Google mode before scheduled sync can run."});
  const msg="Scheduled sync is not yet wired to the shared Google Sheets service. Use the admin manual sync endpoint after credentials are configured.";
  await db.query("INSERT INTO clinic_sync_runs (source_tab,operation,result,message,rows_skipped) VALUES ('*','scheduled_poll','blocked',$1,1)",[msg]);
  return res.json({ok:true,status:"blocked",message:msg});
}