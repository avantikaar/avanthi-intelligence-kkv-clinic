import { db } from "hatchable";
export const access = "user";
export const methods = ["GET","POST"];
const money = n => Math.round((Number(n)||0)*100)/100;
const uid = p => p+"-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,7);
const today = () => new Date().toISOString().slice(0,10);
export default async function(req,res) {
 if(req.method==="GET") {
  const view=String(req.query?.view||"billing");
  if(view==="billing") {
   const q=await db.query("SELECT i.*,p.patient_name,p.phone FROM clinic_invoices i JOIN clinic_patients p ON p.id=i.patient_id ORDER BY i.created_at DESC LIMIT 200");
   return res.json({invoices:q.rows});
  }
  if(view==="invoice") {
   const id=String(req.query?.id||"");
   const q=await db.query("SELECT i.*,p.patient_name,p.phone FROM clinic_invoices i JOIN clinic_patients p ON p.id=i.patient_id WHERE i.id=$1",[id]);
   if(!q.rows.length)return res.status(404).json({error:"Invoice not found"});
   const items=await db.query("SELECT * FROM clinic_invoice_items WHERE invoice_id=$1 ORDER BY created_at",[id]);
   return res.json({invoice:q.rows[0],items:items.rows});
  }
  if(view==="inventory") {
   const q=await db.query("SELECT m.*,COALESCE(SUM(b.quantity_available),0)::int AS stock,MIN(b.expiry_date) FILTER (WHERE b.quantity_available>0) AS next_expiry FROM clinic_medicines m LEFT JOIN clinic_medicine_batches b ON b.medicine_id=m.id GROUP BY m.id ORDER BY m.name");
   const batches=await db.query("SELECT b.*,m.name AS medicine_name,m.unit FROM clinic_medicine_batches b JOIN clinic_medicines m ON m.id=b.medicine_id ORDER BY b.expiry_date NULLS LAST LIMIT 300");
   return res.json({medicines:q.rows,batches:batches.rows});
  }
  if(view==="queue") {
   const q=await db.query("SELECT q.*,p.patient_name,p.phone,a.appointment_time FROM clinic_physio_queue q JOIN clinic_patients p ON p.id=q.patient_id LEFT JOIN clinic_appointments a ON a.id=q.appointment_id WHERE q.scheduled_at >= NOW()-INTERVAL '1 day' ORDER BY q.scheduled_at LIMIT 200");
   const rows=q.rows.map((r,i)=>({...r,queue_position:i+1,wait_minutes:r.checked_in_at&&r.status==="Waiting"?Math.max(0,Math.round((Date.now()-new Date(r.checked_in_at).getTime())/60000)):0}));
   return res.json({queue:rows});
  }
  if(view==="lookups") {
   const p=await db.query("SELECT id,patient_name,phone FROM clinic_patients WHERE archived_at IS NULL ORDER BY patient_name LIMIT 500");
   const a=await db.query("SELECT id,patient_id,appointment_date,appointment_time,provider,status FROM clinic_appointments WHERE archived_at IS NULL AND appointment_date >= CURRENT_DATE-1 ORDER BY appointment_date,appointment_time LIMIT 200");
   return res.json({patients:p.rows,appointments:a.rows});
  }
  return res.status(400).json({error:"Unknown view"});
 }
 const b=req.body||{}, action=String(b.action||"");
 if(action==="create_invoice") {
  const patientId=String(b.patient_id||"");
  const items=Array.isArray(b.items)?b.items:[];
  if(!patientId||!items.length)return res.status(400).json({error:"Select a patient and add at least one invoice item."});
  const patient=await db.query("SELECT id FROM clinic_patients WHERE id=$1 AND archived_at IS NULL",[patientId]);
  if(!patient.rows.length)return res.status(400).json({error:"Patient not found."});
  const cleanItems=items.map(x=>({type:String(x.item_type||"Service"),description:String(x.description||"").trim(),qty:Number(x.quantity||1),price:money(x.unit_price)}));
  if(cleanItems.some(x=>!x.description||!Number.isFinite(x.qty)||x.qty<=0||!Number.isFinite(x.price)||x.price<0))return res.status(400).json({error:"Check each item description, quantity and price."});
  const subtotal=money(cleanItems.reduce((s,x)=>s+x.qty*x.price,0)),discount=money(b.discount),tax=money(b.tax),total=money(Math.max(0,subtotal-discount+tax));
  if(discount<0||tax<0||discount>subtotal)return res.status(400).json({error:"Discount/tax values are invalid."});
  const id=uid("inv"),number="KKV-"+today().replaceAll("-","")+"-"+Math.random().toString(36).slice(2,6).toUpperCase();
  await db.query("INSERT INTO clinic_invoices (id,invoice_number,patient_id,related_record_id,invoice_date,status,subtotal,discount,tax,total,balance,notes) VALUES ($1,$2,$3,$4,$5,'Issued',$6,$7,$8,$9,$9,$10)",[id,number,patientId,b.related_record_id||null,b.invoice_date||today(),subtotal,discount,tax,total,String(b.notes||"")]);
  for(const x of cleanItems) await db.query("INSERT INTO clinic_invoice_items (invoice_id,item_type,description,quantity,unit_price,line_total) VALUES ($1,$2,$3,$4,$5,$6)",[id,x.type,x.description,x.qty,x.price,money(x.qty*x.price)]);
  await db.query("INSERT INTO clinic_audit_logs (actor,action,entity_type,entity_id,details) VALUES ($1,'invoice_created','invoice',$2,$3::jsonb)",[req.user?.email||"clinic-staff",id,JSON.stringify({invoice_number:number,total})]);
  return res.json({ok:true,id,invoice_number:number,total});
 }
 if(action==="record_payment") {
  const invoiceId=String(b.invoice_id||""),amount=money(b.amount);
  if(!invoiceId||amount<=0)return res.status(400).json({error:"Choose an invoice and enter a payment amount greater than zero."});
  const q=await db.query("SELECT * FROM clinic_invoices WHERE id=$1",[invoiceId]);
  if(!q.rows.length)return res.status(404).json({error:"Invoice not found."});
  const inv=q.rows[0],paid=money(inv.amount_paid)+amount;
  if(amount>Number(inv.balance))return res.status(400).json({error:"Payment cannot exceed the outstanding balance."});
  const pid=uid("pay");
  await db.query("INSERT INTO clinic_payments (id,patient_id,related_record_id,service_category,amount,payment_date,payment_method,payment_status) VALUES ($1,$2,$3,'Invoice',$4,$5,$6,'Paid')",[pid,inv.patient_id,invoiceId,amount,b.payment_date||today(),b.payment_method||"UPI"]);
  await db.query("UPDATE clinic_invoices SET amount_paid=$2,balance=$3,status=$4,updated_at=NOW() WHERE id=$1",[invoiceId,paid,money(Number(inv.total)-paid),paid>=Number(inv.total)?"Paid":"Partially Paid"]);
  await db.query("INSERT INTO clinic_audit_logs (actor,action,entity_type,entity_id,details) VALUES ($1,'invoice_payment','invoice',$2,$3::jsonb)",[req.user?.email||"clinic-staff",invoiceId,JSON.stringify({payment_id:pid,amount})]);
  return res.json({ok:true,payment_id:pid,amount_paid:paid,balance:money(Number(inv.total)-paid)});
 }
 if(action==="add_medicine") {
  const id=uid("med"),name=String(b.name||"").trim();
  if(!name)return res.status(400).json({error:"Medicine name is required."});
  await db.query("INSERT INTO clinic_medicines (id,name,generic_name,strength,dosage_form,unit,reorder_level,selling_price) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",[id,name,b.generic_name||null,b.strength||null,b.dosage_form||null,b.unit||"tablet",Math.max(0,Number(b.reorder_level||10)),money(b.selling_price)]);
  if(Number(b.opening_stock||0)>0) {
   const batch=uid("batch");
   await db.query("INSERT INTO clinic_medicine_batches (id,medicine_id,batch_number,expiry_date,purchase_price,quantity_received,quantity_available,supplier) VALUES ($1,$2,$3,$4,$5,$6,$6,$7)",[batch,id,b.batch_number||"OPENING",b.expiry_date||null,money(b.purchase_price),Math.floor(Number(b.opening_stock)),b.supplier||null]);
   await db.query("INSERT INTO clinic_stock_movements (medicine_id,batch_id,movement_type,quantity,notes) VALUES ($1,$2,'Opening stock',$3,'Opening balance')",[id,batch,Math.floor(Number(b.opening_stock))]);
  }
  return res.json({ok:true,id});
 }
 if(action==="receive_stock") {
  const med=String(b.medicine_id||""),qty=Math.floor(Number(b.quantity||0));
  if(!med||qty<=0||!b.batch_number)return res.status(400).json({error:"Medicine, positive quantity and batch number are required."});
  const batch=uid("batch");
  await db.query("INSERT INTO clinic_medicine_batches (id,medicine_id,batch_number,expiry_date,purchase_price,quantity_received,quantity_available,supplier) VALUES ($1,$2,$3,$4,$5,$6,$6,$7)",[batch,med,String(b.batch_number),b.expiry_date||null,money(b.purchase_price),qty,b.supplier||null]);
  await db.query("INSERT INTO clinic_stock_movements (medicine_id,batch_id,movement_type,quantity,notes) VALUES ($1,$2,'Stock received',$3,$4)",[med,batch,qty,b.notes||null]);
  return res.json({ok:true,batch_id:batch});
 }
 if(action==="sell_medicine") {
  const med=String(b.medicine_id||""),qty=Math.floor(Number(b.quantity||0)),patientId=String(b.patient_id||"");
  if(!med||qty<=0||!patientId)return res.status(400).json({error:"Select patient, medicine and quantity."});
  const batches=await db.query("SELECT id,quantity_available FROM clinic_medicine_batches WHERE medicine_id=$1 AND quantity_available>0 AND (expiry_date IS NULL OR expiry_date>=CURRENT_DATE) ORDER BY expiry_date NULLS LAST,received_at",[med]);
  let remaining=qty,alloc=[];
  for(const batch of batches.rows){if(!remaining)break;const take=Math.min(remaining,Number(batch.quantity_available));alloc.push({id:batch.id,qty:take});remaining-=take;}
  if(remaining)return res.status(409).json({error:"Insufficient unexpired stock. Available quantity is "+(qty-remaining)+"."});
  const m=await db.query("SELECT * FROM clinic_medicines WHERE id=$1 AND active=TRUE",[med]);
  if(!m.rows.length)return res.status(404).json({error:"Medicine not found."});
  const invoiceId=String(b.invoice_id||"");
  if(!invoiceId)return res.status(400).json({error:"Create/select an invoice before dispensing so the sale is recorded against the patient."});
  const inv=await db.query("SELECT id,patient_id FROM clinic_invoices WHERE id=$1 AND patient_id=$2 AND status NOT IN ('Paid','Void')",[invoiceId,patientId]);
  if(!inv.rows.length)return res.status(400).json({error:"Invoice does not belong to this patient or is closed."});
  for(const x of alloc){
   const upd=await db.query("UPDATE clinic_medicine_batches SET quantity_available=quantity_available-$2 WHERE id=$1 AND quantity_available >= $2 RETURNING id",[x.id,x.qty]);
   if(!upd.rows.length)return res.status(409).json({error:"Stock changed during sale. Refresh inventory and retry."});
   await db.query("INSERT INTO clinic_stock_movements (medicine_id,batch_id,movement_type,quantity,reference_id,notes) VALUES ($1,$2,'Dispensed',$3,$4,'Patient medicine sale')",[med,x.id,-x.qty,invoiceId]);
   await db.query("INSERT INTO clinic_invoice_items (invoice_id,item_type,description,quantity,unit_price,line_total,medicine_batch_id) VALUES ($1,'Medicine',$2,$3,$4,$5,$6)",[invoiceId,m.rows[0].name,x.qty,m.rows[0].selling_price,money(x.qty*Number(m.rows[0].selling_price)),x.id]);
  }
  const totals=await db.query("SELECT COALESCE(SUM(line_total),0)::numeric AS subtotal FROM clinic_invoice_items WHERE invoice_id=$1",[invoiceId]);
  await db.query("UPDATE clinic_invoices SET subtotal=$2,total=$2-discount+tax,balance=$2-discount+tax-amount_paid,updated_at=NOW() WHERE id=$1",[invoiceId,totals.rows[0].subtotal]);
  return res.json({ok:true,dispensed:qty,invoice_id:invoiceId});
 }
 if(action==="queue_add") {
  const appt=String(b.appointment_id||"");
  const a=await db.query("SELECT id,patient_id,appointment_date,appointment_time,provider FROM clinic_appointments WHERE id=$1 AND archived_at IS NULL",[appt]);
  if(!a.rows.length)return res.status(404).json({error:"Appointment not found."});
  const r=a.rows[0],raw=String(r.appointment_time||"09:00").trim(),match=raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);let hh=match?Number(match[1]):9,mm=match?Number(match[2]):0;if(match&&match[3]){if(match[3].toUpperCase()==="PM"&&hh<12)hh+=12;if(match[3].toUpperCase()==="AM"&&hh===12)hh=0;}const scheduled=new Date(String(r.appointment_date)+"T"+String(String(hh).padStart(2,"0")+":"+String(mm).padStart(2,"0"))+":00+05:30");
  const id=uid("queue");
  await db.query("INSERT INTO clinic_physio_queue (id,appointment_id,patient_id,therapist,scheduled_at,status) VALUES ($1,$2,$3,$4,$5,'Expected') ON CONFLICT (appointment_id) DO NOTHING",[id,appt,r.patient_id,r.provider,scheduled.toISOString()]);
  return res.json({ok:true,id});
 }
 if(action==="queue_update") {
  const id=String(b.id||""),status=String(b.status||"");
  if(!["Expected","Arrived","Waiting","In Session","Completed","Delayed","No-show"].includes(status))return res.status(400).json({error:"Invalid queue status."});
  const updates=status==="Arrived"||status==="Waiting"?"checked_in_at=COALESCE(checked_in_at,NOW())":status==="In Session"?"session_started_at=COALESCE(session_started_at,NOW())":status==="Completed"?"session_ended_at=NOW()":"";
  const sql="UPDATE clinic_physio_queue SET status=$2,updated_at=NOW()"+(updates?","+updates:"")+" WHERE id=$1 RETURNING id";
  const q=await db.query(sql,[id,status]);
  if(!q.rows.length)return res.status(404).json({error:"Queue entry not found."});
  return res.json({ok:true});
 }
 return res.status(400).json({error:"Unknown action."});
}