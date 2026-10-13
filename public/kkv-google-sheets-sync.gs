/**
 * KKV 360 Google Sheets -> Hatchable sync bridge.
 * Run installKKVTrigger() once and kkvSyncAll() for initial import.
 * Script Properties required:
 * KKV_WEBHOOK_URL = https://avanthi.hatchable.site/api/sheets-webhook
 * KKV_WEBHOOK_SECRET = the value stored in Hatchable as GOOGLE_APPS_SCRIPT_WEBHOOK_SECRET
 */
const KKV_TABS = ["Patients","Appointments","Physiotherapy","Physio_Sessions","Leads","Follow_Ups","Payments","Campaigns"];
function installKKVTrigger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Open this script from Extensions > Apps Script inside the clinic spreadsheet.");
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "kkvOnEdit").forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("kkvOnEdit").forSpreadsheet(ss).onEdit().create();
  Logger.log("KKV sync trigger installed successfully. Do not run kkvSyncAll on a large sheet yet; test one edited row first.");
}
function kkvTestConnection() {
  const props=PropertiesService.getScriptProperties();
  const url=props.getProperty("KKV_WEBHOOK_URL");
  const secret=props.getProperty("KKV_WEBHOOK_SECRET");
  if(!url || !secret) throw new Error("Set KKV_WEBHOOK_URL and KKV_WEBHOOK_SECRET in Project Settings > Script properties.");
  const response=UrlFetchApp.fetch(url,{method:"post",contentType:"application/json",headers:{"x-kkv-webhook-secret":secret},payload:JSON.stringify({action:"ping"}),muteHttpExceptions:true});
  const body=response.getContentText();
  Logger.log("KKV webhook test HTTP "+response.getResponseCode()+": "+body);
  if(response.getResponseCode()!==200) throw new Error("Webhook test failed. HTTP "+response.getResponseCode()+": "+body);
  return body;
}
function kkvOnEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (!KKV_TABS.includes(sh.getName()) || e.range.getRow() === 1) return;
  const rowNum = e.range.getRow();
  const lastCol = sh.getLastColumn();
  if (lastCol < 1) return;
  const headers = sh.getRange(1,1,1,lastCol).getDisplayValues()[0].map(v=>String(v).trim());
  const values = sh.getRange(rowNum,1,1,lastCol).getDisplayValues()[0];
  const row = {};
  headers.forEach((h,i)=>{ if(h) row[h] = values[i]; });
  if (Object.values(row).every(v=>String(v||"").trim()==="")) return;
  kkvSendRow(sh.getName(), row, rowNum);
}
function kkvSyncAll() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let created=0, updated=0, rejected=0, scanned=0;
  KKV_TABS.forEach(tab => {
    const sh=ss.getSheetByName(tab);
    if(!sh) { Logger.log("Skipped missing tab: "+tab); return; }
    const values=sh.getDataRange().getDisplayValues();
    if(values.length<2) return;
    const headers=values[0].map(v=>String(v).trim());
    values.slice(1).forEach((vals,i)=>{
      if(vals.every(v=>String(v||"").trim()==="")) return;
      const row={}; headers.forEach((h,j)=>{if(h) row[h]=vals[j];});
      scanned++;
      const result=kkvSendRow(tab,row,i+2);
      if(result && result.ok) { if(result.created) created++; else if(result.updated) updated++; }
      else rejected++;
    });
  });
  const msg="KKV initial sync finished. Scanned="+scanned+", created="+created+", updated="+updated+", rejected="+rejected+". Check Hatchable Sync history for details.";
  Logger.log(msg);
  SpreadsheetApp.getUi().alert(msg);
}
function kkvSendRow(module,row,rowNumber) {
  const props=PropertiesService.getScriptProperties();
  const url=props.getProperty("KKV_WEBHOOK_URL");
  const secret=props.getProperty("KKV_WEBHOOK_SECRET");
  if(!url || !secret) throw new Error("Set KKV_WEBHOOK_URL and KKV_WEBHOOK_SECRET in Apps Script > Project Settings > Script properties.");
  const response=UrlFetchApp.fetch(url,{
    method:"post",
    contentType:"application/json",
    headers:{"x-kkv-webhook-secret":secret},
    payload:JSON.stringify({module:module,row:row,row_number:rowNumber}),
    muteHttpExceptions:true
  });
  const code=response.getResponseCode();
  let data={}; try { data=JSON.parse(response.getContentText()); } catch(e) {}
  if(code<200 || code>=300 || !data.ok) {
    console.error("KKV sync failed tab="+module+" row="+rowNumber+" HTTP="+code+" "+response.getContentText());
    return {ok:false,error:data.error||response.getContentText()};
  }
  return data;
}