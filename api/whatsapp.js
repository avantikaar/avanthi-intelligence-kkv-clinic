import { db } from "hatchable";
import { whatsappStatus, sendWhatsAppTemplate, normalizeWhatsAppNumber } from "lib/whatsapp.js";
export const access = "user";
export const methods = ["GET","POST"];

export default async function(req,res) {
  const status = whatsappStatus();
  if (req.method === "GET") {
    const q = await db.query("SELECT id,related_record_id,recipient,mode,status,provider_message_id,error_message,attempted_at FROM clinic_notification_attempts WHERE channel='whatsapp' ORDER BY attempted_at DESC LIMIT 100");
    return res.json({status, attempts:q.rows});
  }
  if (!req.user) return res.status(401).json({error:"Sign in to the clinic app before sending a test message."});
  const b = req.body || {};
  if (b.action === "resend_confirmation") {
    const appointmentId = String(b.appointment_id || "").trim();
    if (!appointmentId) return res.status(400).json({error:"Appointment ID is required."});
    const a = await db.query("SELECT a.id,a.patient_id,a.appointment_date,a.appointment_time,a.status,p.patient_name,p.phone,p.whatsapp_opt_in FROM clinic_appointments a JOIN clinic_patients p ON p.id=a.patient_id WHERE a.id=$1 AND a.archived_at IS NULL AND p.archived_at IS NULL",[appointmentId]);
    if (!a.rows.length) return res.status(404).json({error:"Appointment or linked patient not found."});
    const record = a.rows[0];
    if (!record.whatsapp_opt_in || !record.phone) return res.status(409).json({error:"Patient has not opted in to WhatsApp or has no phone number."});
    if (!["Booked","Confirmed","Rescheduled"].includes(String(record.status))) return res.status(409).json({error:"Only booked, confirmed, or rescheduled appointments can receive a confirmation."});
    const prior = await db.query("SELECT id FROM clinic_notification_attempts WHERE related_record_id=$1 AND channel='whatsapp' AND status='accepted' LIMIT 1",[appointmentId]);
    if (prior.rows.length) return res.json({ok:true,already_accepted:true,message:"A WhatsApp confirmation for this appointment was already accepted by Meta; no duplicate was sent."});
    if (!status.configured) return res.status(409).json({error:"WhatsApp credentials are not configured."});
    try {
      const sent = await sendWhatsAppTemplate({to:record.phone,templateName:status.confirmation_template,parameters:[record.patient_name||"Patient",String(record.appointment_date||""),String(record.appointment_time||"Please contact the clinic")]});
      await db.query("INSERT INTO clinic_notification_attempts (related_record_id,channel,recipient,mode,status,provider_message_id) VALUES ($1,'whatsapp',$2,'live','accepted',$3)",[appointmentId,sent.recipient,sent.message_id]);
      await db.query("INSERT INTO clinic_automation_logs (rule_id,record_id,dedupe_key,action,status,message) VALUES ('appointment_confirmation',$1,$2,'send_whatsapp_template','accepted','Retried confirmation accepted by Meta') ON CONFLICT (dedupe_key) DO NOTHING",[appointmentId,"whatsapp:appointment_confirmation_retry:"+appointmentId+":"+Date.now()]);
      await db.query("INSERT INTO clinic_audit_logs (actor,action,entity_type,entity_id,details) VALUES ($1,'whatsapp_confirmation_retry','appointment',$2,$3::jsonb)",[req.user?.email||"clinic-user",appointmentId,JSON.stringify({recipient_last4:sent.recipient.slice(-4),status:"accepted"})]);
      return res.json({ok:true,message:"Meta accepted the appointment confirmation. Delivery status may update asynchronously.",message_id:sent.message_id});
    } catch(e) {
      await db.query("INSERT INTO clinic_notification_attempts (related_record_id,channel,recipient,mode,status,error_message) VALUES ($1,'whatsapp',$2,'live','failed',$3)",[appointmentId,record.phone,String(e.message||e).slice(0,500)]);
      return res.status(502).json({error:"WhatsApp confirmation retry failed: "+String(e.message||e).slice(0,300)});
    }
  }
  if (b.action !== "test") return res.status(400).json({error:"Supported actions are test and resend_confirmation."});
  const to = normalizeWhatsAppNumber(b.to);
  if (!to) return res.status(400).json({error:"Enter a valid international phone number or a 10-digit Indian mobile number."});
  if (!status.configured) return res.status(409).json({error:"WhatsApp credentials are not configured. Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in Hatchable Setup."});
  const templateName = status.confirmation_template;
  try {
    const sent = await sendWhatsAppTemplate({to,templateName,parameters:["Clinic test","14 Oct 2026","10:30 AM"]});
    await db.query("INSERT INTO clinic_notification_attempts (related_record_id,channel,recipient,mode,status,provider_message_id) VALUES ('manual-test','whatsapp',$1,'live','accepted',$2)",[sent.recipient,sent.message_id]);
    await db.query("INSERT INTO clinic_audit_logs (actor,action,entity_type,entity_id,details) VALUES ($1,'whatsapp_test_send','integration','whatsapp',$2::jsonb)",[req.user?.email||"clinic-user",JSON.stringify({recipient_last4:sent.recipient.slice(-4),template:templateName,status:"accepted"})]);
    return res.json({ok:true,message:"Meta accepted the test template message. Delivery status may update asynchronously.",message_id:sent.message_id});
  } catch(e) {
    await db.query("INSERT INTO clinic_notification_attempts (related_record_id,channel,recipient,mode,status,error_message) VALUES ('manual-test','whatsapp',$1,'live','failed',$2)",[to,String(e.message||e).slice(0,500)]);
    return res.status(502).json({error:"WhatsApp send failed: "+String(e.message||e).slice(0,300)});
  }
}