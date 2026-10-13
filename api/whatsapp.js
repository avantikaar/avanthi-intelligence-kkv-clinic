import { db } from "hatchable";
import { whatsappStatus, sendWhatsAppTemplate, normalizeWhatsAppNumber } from "lib/whatsapp.js";
export const access = "member";
export const methods = ["GET","POST"];

export default async function(req,res) {
  const status = whatsappStatus();
  if (req.method === "GET") {
    const q = await db.query("SELECT id,related_record_id,recipient,mode,status,provider_message_id,error_message,attempted_at FROM clinic_notification_attempts WHERE channel='whatsapp' ORDER BY attempted_at DESC LIMIT 100");
    return res.json({status, attempts:q.rows});
  }
  if (req.member?.role !== "admin") return res.status(403).json({error:"Only clinic admins can send a test message."});
  const b = req.body || {};
  if (b.action !== "test") return res.status(400).json({error:"Supported action is test."});
  const to = normalizeWhatsAppNumber(b.to);
  if (!to) return res.status(400).json({error:"Enter a valid international phone number or a 10-digit Indian mobile number."});
  if (!status.configured) return res.status(409).json({error:"WhatsApp credentials are not configured. Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in Hatchable Setup."});
  const templateName = status.confirmation_template;
  try {
    const sent = await sendWhatsAppTemplate({to,templateName,parameters:["Clinic test","14 Oct 2026","10:30 AM"]});
    await db.query("INSERT INTO clinic_notification_attempts (related_record_id,channel,recipient,mode,status,provider_message_id) VALUES ('manual-test','whatsapp',$1,'live','accepted',$2)",[sent.recipient,sent.message_id]);
    await db.query("INSERT INTO clinic_audit_logs (actor,action,entity_type,entity_id,details) VALUES ($1,'whatsapp_test_send','integration','whatsapp',$2::jsonb)",[req.member?.email||"admin",JSON.stringify({recipient_last4:sent.recipient.slice(-4),template:templateName,status:"accepted"})]);
    return res.json({ok:true,message:"Meta accepted the test template message. Delivery status may update asynchronously.",message_id:sent.message_id});
  } catch(e) {
    await db.query("INSERT INTO clinic_notification_attempts (related_record_id,channel,recipient,mode,status,error_message) VALUES ('manual-test','whatsapp',$1,'live','failed',$2)",[to,String(e.message||e).slice(0,500)]);
    return res.status(502).json({error:"WhatsApp send failed: "+String(e.message||e).slice(0,300)});
  }
}