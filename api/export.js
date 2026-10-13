import { db } from "hatchable";
import { MODULES } from "lib/clinic.js";
export const access = "member";
export const methods = ["GET"];
export default async function(req,res){
 const moduleName=String(req.query?.module||"Patients");
 const spec=MODULES[moduleName];
 if(!spec)return res.status(400).json({error:"Unknown module",modules:Object.keys(MODULES)});
 const q=await db.query("SELECT * FROM "+spec.table+" WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT 5000");
 const headers=Object.keys(spec.fields);
 const safe=v=>{if(v===null||v===undefined)return "";let s=String(v);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
 const csv=[["id",...headers.map(h=>h)].map(safe).join(",")];
 for(const r of q.rows){
  const row=[r.id,...Object.values(spec.fields).map(col=>r[col])];
  csv.push(row.map(safe).join(","));
 }
 res.setHeader("content-type","text/csv; charset=utf-8");
 res.setHeader("content-disposition",'attachment; filename="'+moduleName+'.csv"');
 res.send(csv.join("\r\n"));
}