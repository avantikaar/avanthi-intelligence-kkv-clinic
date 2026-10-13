import { db, config } from "hatchable";
import { MODULES } from "lib/clinic.js";
export const access = "admin";
export const methods = ["POST"];
export default async function(req,res){
 const secret=await config.get("GOOGLE_APPS_SCRIPT_WEBHOOK_SECRET").catch(()=>null);
 const got=String(req.headers["x-kkv-webhook-secret"]||"");
 if(!secret || got!==secret) return res.status(401).json({error:"Webhook authentication failed or secret not configured"});
 const b=req.body||{};
 const allowed=Object.keys(MODULES);
 const moduleName=String(b.module||b.tab||"");
 if(!allowed.includes(moduleName)) return res.status(400).json({error:"Unknown module/tab",allowed});
 const run=await db.query("INSERT INTO clinic_sync_runs (source_tab,operation,record_id,result,message,rows_skipped) VALUES ($1,'webhook_received',$2,'received','Authenticated webhook received. This receiver logs change hints; it does not yet fetch or upsert Google Sheets rows.',1) RETURNING id",[moduleName,String(b.record_id||b.row_id||"")]);
 res.json({ok:true,received:true,run_id:run.rows[0].id,module:moduleName,note:"Change hint logged; a full authorized sheet fetch/upsert is not active yet."});
}