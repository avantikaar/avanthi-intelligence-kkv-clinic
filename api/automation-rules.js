import { db } from "hatchable";
export const access = "user";
export const methods = ["GET","POST","PUT"];
const defaults=[
 {id:"appointment_reminders",name:"Appointment reminders",trigger_type:"appointment_created_or_changed",settings:{hours_before:24,mode:"demo"}},
 {id:"missed_followup",name:"Missed appointment follow-up",trigger_type:"appointment_missed",settings:{grace_hours:2,mode:"task"}},
 {id:"physio_reminders",name:"Physiotherapy session reminders",trigger_type:"physio_session_scheduled",settings:{hours_before:24,mode:"demo"}},
 {id:"low_sessions",name:"Low physiotherapy sessions",trigger_type:"remaining_sessions_lte",settings:{threshold:2,mode:"task"}},
 {id:"package_expiry",name:"Package expiry alert",trigger_type:"package_expiry_soon",settings:{days_before:7,mode:"task"}},
 {id:"lead_followup",name:"Lead follow-up due",trigger_type:"lead_followup_due",settings:{mode:"task"}}
];
export default async function(req,res){
 if(req.method==="GET"){
  for(const d of defaults) await db.query("INSERT INTO clinic_automation_rules (id,name,trigger_type,enabled,settings) VALUES ($1,$2,$3,TRUE,$4::jsonb) ON CONFLICT (id) DO NOTHING",[d.id,d.name,d.trigger_type,JSON.stringify(d.settings)]);
  const q=await db.query("SELECT * FROM clinic_automation_rules ORDER BY name");
  const logs=await db.query("SELECT * FROM clinic_automation_logs ORDER BY created_at DESC LIMIT 50");
  return res.json({rules:q.rows,logs:logs.rows});
 }
 const b=req.body||{};
 const id=String(b.id||"").trim();
 if(!defaults.some(x=>x.id===id)) return res.status(400).json({error:"Unknown built-in automation rule"});
 const enabled=Boolean(b.enabled);
 const q=await db.query("UPDATE clinic_automation_rules SET enabled=$2,updated_at=NOW() WHERE id=$1 RETURNING *",[id,enabled]);
 await db.query("INSERT INTO clinic_audit_logs (actor,action,entity_type,entity_id,details) VALUES ($1,'toggle_automation','automation_rule',$2,$3::jsonb)",[req.user?.email||"staff",id,JSON.stringify({enabled})]);
 res.json({rule:q.rows[0]});
}