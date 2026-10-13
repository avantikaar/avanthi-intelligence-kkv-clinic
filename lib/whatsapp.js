const API_VERSION = (process.env.WHATSAPP_API_VERSION || "v26.0").trim();
const TOKEN = (process.env.WHATSAPP_ACCESS_TOKEN || "").trim();
const PHONE_NUMBER_ID = (process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();

export function whatsappStatus() {
  return {
    configured: Boolean(TOKEN && PHONE_NUMBER_ID),
    token_present: Boolean(TOKEN),
    phone_number_id_present: Boolean(PHONE_NUMBER_ID),
    api_version: API_VERSION,
    confirmation_template: (process.env.WHATSAPP_TEMPLATE_CONFIRMATION || "appointment_confirmation").trim(),
    reminder_template: (process.env.WHATSAPP_TEMPLATE_REMINDER || "appointment_reminder").trim()
  };
}

export function normalizeWhatsAppNumber(value) {
  let digits = String(value || "").replace(/[^0-9]/g, "");
  if (digits.length === 10) digits = "91" + digits;
  if (digits.length < 11 || digits.length > 15) return null;
  return digits;
}

export async function sendWhatsAppTemplate({to, templateName, parameters = []}) {
  if (!TOKEN || !PHONE_NUMBER_ID) throw new Error("WhatsApp is not configured. Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in Hatchable Setup.");
  const recipient = normalizeWhatsAppNumber(to);
  if (!recipient) throw new Error("Recipient phone number is invalid. Use an international number or a 10-digit Indian mobile number.");
  if (!/^[a-zA-Z0-9_]+$/.test(String(templateName || ""))) throw new Error("Approved template name is invalid.");
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipient,
    type: "template",
    template: {
      name: templateName,
      language: { code: (process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en").trim() },
      ...(parameters.length ? { components: [{ type: "body", parameters: parameters.map(text => ({type:"text",text:String(text ?? "")})) }] } : {})
    }
  };
  const response = await fetch("https://graph.facebook.com/" + API_VERSION + "/" + encodeURIComponent(PHONE_NUMBER_ID) + "/messages", {
    method: "POST",
    headers: {"Authorization":"Bearer " + TOKEN, "Content-Type":"application/json"},
    body: JSON.stringify(body)
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const msg = data?.error?.message || ("Meta WhatsApp API returned HTTP " + response.status);
    throw new Error(msg);
  }
  return {recipient, message_id:data?.messages?.[0]?.id || null, provider_status:data?.messages?.[0]?.message_status || "accepted"};
}