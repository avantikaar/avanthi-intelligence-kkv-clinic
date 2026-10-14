import { db } from "hatchable";
export const access = "user";
export const methods = ["GET","POST","PUT"];
export default async function(req,res){
 if(req.method==="GET"){
  const q=await db.query("SELECT f.*,p.patient_name FROM clinic_follow_ups f LEFT JOIN clinic_patients p ON p.id=f.patient_id WHERE f.archived_at IS NULL ORDER BY CASE WHEN f.status IN ('Completed','Closed') THEN 1 ELSE 0 END, f.due_date NULLS FIRST LIMIT 500");
  return res.json({rows:q.rows});
 }
 const b=req.body||{};
 const id=String(b.id||b.Task_ID||"").trim();
 if(!id) return res.status(400).json({error:"Task ID is required"});
 const allowed=["Open","In Progress","Completed","Closed","On Hold"];
 if(b.status && !allowed.includes(b.status)) return res.status(400).json({error:"Invalid status",allowed});
 const q=await db.query("UPDATE clinic_follow_ups SET status=COALESCE($2,status), outcome=COALESCE($3,outcome), assigned_staff=COALESCE($4,assigned_staff), completed_at=CASE WHEN $2 IN ('Completed','Closed') THEN NOW() ELSE completed_at END, updated_at=NOW() WHERE id=$1 AND archived_at IS NULL RETURNING *",[id,b.status||null,b.outcome||null,b.assigned_staff||null]);
 if(!q.rows.length) return res.status(404).json({error:"Task not found"});
 await db.query("INSERT INTO clinic_audit_logs (actor,action,entity_type,entity_id) VALUES ($1,'update_follow_up','follow_up',$2)",[req.user?.email||"staff",id]);
 return res.json({row:q.rows[0]});
}