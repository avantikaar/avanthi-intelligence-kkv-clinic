import { db } from "hatchable";
export const access = "admin";
export const methods = ["POST"];
export default async function(req,res) {
  const msg = "This Hatchable runtime does not support RSA signatures required by Google service-account OAuth. Use the Google Apps Script bridge: install public/kkv-google-sheets-sync.gs in the spreadsheet, configure KKV_WEBHOOK_URL and KKV_WEBHOOK_SECRET in Apps Script properties, then run kkvSyncAll().";
  await db.query("INSERT INTO clinic_sync_runs (source_tab,operation,result,message,rows_skipped) VALUES ('*','manual_sync','blocked',$1,1)",[msg]);
  return res.status(501).json({ok:false,status:"apps_script_required",message:msg});
}