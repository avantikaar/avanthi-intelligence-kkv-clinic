import { db } from "hatchable";
export const access = "member";
export const methods = ["GET"];
export default async function(req,res){
 const q=await db.query("SELECT id,source_tab,operation,record_id,result,message,rows_created,rows_updated,rows_skipped,rows_rejected,created_at FROM clinic_sync_runs ORDER BY created_at DESC LIMIT 200");
 res.json({rows:q.rows});
}