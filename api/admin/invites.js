import { db } from "hatchable";
export const access = "admin";
export const methods = ["GET","POST","DELETE"];
export default async function(req,res){
 if(req.method==="GET"){
  const q=await db.query("SELECT email,invited_at FROM invited_users ORDER BY invited_at DESC");
  return res.json({pending:q.rows});
 }
 const email=String(req.body?.email||"").trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:"Enter a valid email address"});
 if(req.method==="POST"){
  await db.query("INSERT INTO invited_users (email) VALUES (lower($1)) ON CONFLICT DO NOTHING",[email]);
  await db.query("INSERT INTO clinic_audit_logs (actor,action,entity_type,details) VALUES ($1,'invite_staff','access',$2::jsonb)",[req.member?.email||"admin",JSON.stringify({email})]);
  return res.json({ok:true,email,message:"Staff invitation permission recorded. The user can start the platform email-code sign-in flow."});
 }
 await db.query("DELETE FROM invited_users WHERE email=lower($1)",[email]);
 await db.query("INSERT INTO clinic_audit_logs (actor,action,entity_type,details) VALUES ($1,'revoke_pending_invite','access',$2::jsonb)",[req.member?.email||"admin",JSON.stringify({email})]);
 res.json({ok:true,email});
}