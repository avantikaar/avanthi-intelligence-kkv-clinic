import { db } from "hatchable";

export const access = "public";
export const methods = ["GET","POST"];

const VERIFY_TOKEN = (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "").trim();
const API_VERSION = (process.env.WHATSAPP_API_VERSION || "v26.0").trim();
const TOKEN = (process.env.WHATSAPP_ACCESS_TOKEN || "").trim();
const PHONE_NUMBER_ID = (process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();

async function sendText(to, text) {
  if (!TOKEN || !PHONE_NUMBER_ID) throw new Error("WhatsApp API credentials not configured");
  const r = await fetch("https://graph.facebook.com/" + API_VERSION + "/" + PHONE_NUMBER_ID + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text } })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || "WhatsApp send failed");
  return data;
}

function digits(v) { return String(v || "").replace(/\D/g, ""); }
function makeId(prefix) { return prefix + "-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2,7).toUpperCase(); }
function todayIST() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function reply(to, text) {
  try { await sendText(to, text); }
  catch (e) { console.error("Webhook reply failed:", String(e.message || e)); }
}

export default async function(req, res) {
  if (req.method === "GET") {
    const mode = req.query?.["hub.mode"];
    const token = req.query?.["hub.verify_token"];
    const challenge = req.query?.["hub.challenge"];
    if (mode === "subscribe" && VERIFY_TOKEN && token === VERIFY_TOKEN) return res.status(200).send(String(challenge || ""));
    return res.status(403).send("Webhook verification failed");
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const body = req.body || {};
  if (body.object !== "whatsapp_business_account") return res.status(404).json({ ok: false });
  try {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        for (const message of value.messages || []) {
          if (!message.from || message.type !== "text") continue;
          const phone = digits(message.from);
          const text = String(message.text?.body || "").trim();
          const lower = text.toLowerCase();
          if (!phone || !text) continue;

          const current = await db.query("SELECT state, data FROM clinic_whatsapp_booking_sessions WHERE phone=$1", [phone]);
          let state = current.rows[0]?.state || "start";
          let data = current.rows[0]?.data || {};
          if (["hi","hello","hey","book","booking","appointment","book appointment","start","restart"].includes(lower)) {
            state = "name"; data = {};
            await db.query("INSERT INTO clinic_whatsapp_booking_sessions (phone,state,data,updated_at) VALUES ($1,$2,$3::jsonb,NOW()) ON CONFLICT (phone) DO UPDATE SET state=EXCLUDED.state,data=EXCLUDED.data,updated_at=NOW()", [phone,state,JSON.stringify(data)]);
            await reply(phone, "Welcome to KKV Ortho Clinic! I can help you request an appointment.\n\nPlease enter your full name.");
            continue;
          }
          if (lower === "cancel") {
            await db.query("DELETE FROM clinic_whatsapp_booking_sessions WHERE phone=$1", [phone]);
            await reply(phone, "Your booking request has been cancelled. Message us anytime to start again.");
            continue;
          }
          if (state === "start") {
            await reply(phone, "Welcome to KKV Ortho Clinic. To begin appointment booking, reply BOOK.\nReply CANCEL anytime to stop.");
            continue;
          }
          if (state === "name") {
            data.name = text.slice(0,120); state = "type";
            await reply(phone, "Thank you, " + data.name + ". What type of appointment do you need?\nReply: Consultation or Physiotherapy");
          } else if (state === "type") {
            data.type = text.slice(0,120); state = "date";
            await reply(phone, "Please enter your preferred date in YYYY-MM-DD format (for example, 2026-11-20).");
          } else if (state === "date") {
            const date = text;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < todayIST()) {
              await reply(phone, "Please enter a valid future date in YYYY-MM-DD format.");
              continue;
            }
            data.date = date; state = "time";
            await reply(phone, "Please enter your preferred time (for example, 10:30 AM). We will confirm availability with the clinic.");
          } else if (state === "time") {
            data.time = text.slice(0,40); state = "confirm";
            await reply(phone, "Please confirm your appointment request:\nName: " + data.name + "\nType: " + data.type + "\nDate: " + data.date + "\nTime: " + data.time + "\n\nReply YES to submit the request, or CANCEL to stop.");
          } else if (state === "confirm") {
            if (!["yes","y","confirm"].includes(lower)) {
              await reply(phone, "Please reply YES to submit this request, or CANCEL to stop.");
              continue;
            }
            const conflict = await db.query("SELECT id FROM clinic_appointments WHERE appointment_date=$1 AND LOWER(TRIM(COALESCE(appointment_time,'')))=LOWER(TRIM($2)) AND LOWER(COALESCE(status,'')) NOT IN ('cancelled','missed') AND archived_at IS NULL LIMIT 1", [data.date,data.time]);
            if (conflict.rows.length) {
              state = "time";
              await db.query("INSERT INTO clinic_whatsapp_booking_sessions (phone,state,data,updated_at) VALUES ($1,$2,$3::jsonb,NOW()) ON CONFLICT (phone) DO UPDATE SET state=EXCLUDED.state,data=EXCLUDED.data,updated_at=NOW()", [phone,state,JSON.stringify(data)]);
              await reply(phone, "That time appears to be already booked. Please send another preferred time.");
              continue;
            }
            const patientQ = await db.query("SELECT id,patient_name FROM clinic_patients WHERE regexp_replace(COALESCE(phone,''),'[^0-9]','','g')=$1 AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1", [phone]);
            let patientId = patientQ.rows[0]?.id;
            if (!patientId) {
              patientId = makeId("WA-PAT");
              await db.query("INSERT INTO clinic_patients (id,patient_name,phone,registration_date,patient_type,lead_source,record_status,whatsapp_opt_in,whatsapp_opt_in_at) VALUES ($1,$2,$3,CURRENT_DATE,'New','WhatsApp','Active',TRUE,NOW())", [patientId,data.name,phone]);
            } else {
              await db.query("UPDATE clinic_patients SET patient_name=$2,whatsapp_opt_in=TRUE,whatsapp_opt_in_at=COALESCE(whatsapp_opt_in_at,NOW()),updated_at=NOW() WHERE id=$1", [patientId,data.name]);
            }
            const apptId = makeId("WA-APPT");
            await db.query("INSERT INTO clinic_appointments (id,patient_id,appointment_date,appointment_time,appointment_type,booking_source,status) VALUES ($1,$2,$3,$4,$5,'WhatsApp','Booked')", [apptId,patientId,data.date,data.time,data.type]);
            await db.query("DELETE FROM clinic_whatsapp_booking_sessions WHERE phone=$1", [phone]);
            await reply(phone, "Your appointment request has been recorded!\n\n" + data.name + "\n" + data.type + "\n" + data.date + " at " + data.time + "\n\nThe clinic will contact you if the requested slot needs adjustment. Thank you!");
          }
          if (state !== "confirm") {
            await db.query("INSERT INTO clinic_whatsapp_booking_sessions (phone,state,data,updated_at) VALUES ($1,$2,$3::jsonb,NOW()) ON CONFLICT (phone) DO UPDATE SET state=EXCLUDED.state,data=EXCLUDED.data,updated_at=NOW()", [phone,state,JSON.stringify(data)]);
          }
        }
      }
    }
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error("WhatsApp webhook error:", String(e.message || e));
    return res.status(200).json({ received: true });
  }
}