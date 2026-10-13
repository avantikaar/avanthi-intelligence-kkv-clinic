import { db, config } from "hatchable";
export const access = "admin";
export const methods = ["GET","POST","PUT"];
export default async function(req,res){
 if(req.method==="GET"){
  const q=await db.query("SELECT * FROM clinic_sync_settings WHERE id=1");
  const h=await db.query("SELECT * FROM clinic_sync_runs ORDER BY created_at DESC LIMIT 50");
  return res.json({settings:q.rows[0]||{connected:false,mode:"demo",status:"not_configured",polling_minutes:15},history:h.rows});
 }
 const b=req.body||{};
 const spreadsheetUrl=String(b.spreadsheet_url||"").trim();
 const spreadsheetId=String(b.spreadsheet_id||"").trim() || (spreadsheetUrl.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)||[])[1] || null;
 if(spreadsheetUrl && !/^https:\/\/docs\.google\.com\/spreadsheets\//.test(spreadsheetUrl)) return res.status(400).json({error:"Use a Google Sheets spreadsheet URL"});
 const mins=Math.min(60,Math.max(1,Number(b.polling_minutes)||15));
 const mode=b.mode==="google"?"google":"demo";
 const q=await db.query("INSERT INTO clinic_sync_settings (id,spreadsheet_id,spreadsheet_url,connected,mode,polling_minutes,status,last_error,updated_at) VALUES (1,$1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT (id) DO UPDATE SET spreadsheet_id=EXCLUDED.spreadsheet_id,spreadsheet_url=EXCLUDED.spreadsheet_url,connected=EXCLUDED.connected,mode=EXCLUDED.mode,polling_minutes=EXCLUDED.polling_minutes,status=EXCLUDED.status,last_error=EXCLUDED.last_error,updated_at=NOW() RETURNING *",[spreadsheetId,spreadsheetUrl||null,mode==="google" && Boolean(spreadsheetId),mode,mins,mode==="google"&&spreadsheetId?"pending_authorization":"demo",mode==="google"?"Spreadsheet saved. Provider credential and access test are still required.":null]);
 await db.query("INSERT INTO clinic_audit_logs (actor,action,entity_type,details) VALUES ($1,'update_sync_settings','integration',$2::jsonb)",[req.member?.email||"admin",JSON.stringify({mode,spreadsheetId,polling_minutes:mins})]);
 return res.json({settings:q.rows[0],message:mode==="google"?"Saved configuration. Run connection test after adding Google credentials and sharing the sheet with the service account.":"Demo mode configured. No external Google reads have been performed."});
}