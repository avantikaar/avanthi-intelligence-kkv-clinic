import { db } from "hatchable";
export const access = "scheduler";
// Google Sheets sync is push-based through the installable Apps Script edit trigger.
// This endpoint is intentionally not scheduled: it does not pretend to poll Google APIs.
export default async function(req,res) {
  const q=await db.query("SELECT mode,spreadsheet_id,status FROM clinic_sync_settings WHERE id=1");
  const s=q.rows[0];
  if(!s || s.mode!=="google" || !s.spreadsheet_id) return res.json({ok:true,status:"not_configured",message:"Choose Google Sheets mode and save the spreadsheet URL."});
  return res.json({ok:true,status:"push_trigger_required",message:"This build uses the Google Apps Script on-edit trigger for row-level synchronization. Install public/kkv-google-sheets-sync.gs in the spreadsheet and set the webhook URL and shared secret. No polling or outbound message is claimed by this endpoint."});
}