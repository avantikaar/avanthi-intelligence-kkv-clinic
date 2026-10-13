/**
 * Google Apps Script — KKV 360 clinic sync
 * Install from Extensions > Apps Script, save, then run installKKVTrigger once.
 * Configure KKV_WEBHOOK_URL and KKV_WEBHOOK_SECRET in Script Properties.
 * Use the exact tab names: Patients, Appointments, Physiotherapy, Physio_Sessions,
 * Leads, Follow_Ups, Payments, Campaigns. Row 1 must contain the defined headers.
 */
const KKV_TABS = new Set(["Patients","Appointments","Physiotherapy","Physio_Sessions","Leads","Follow_Ups","Payments","Campaigns"]);

function installKKVTrigger() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "kkvOnEdit").forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("kkvOnEdit").forSpreadsheet(ss).onEdit().create();
  Logger.log("KKV edit trigger installed for " + ss.getName());
}

function kkvOnEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  const tab = sheet.getName();
  if (!KKV_TABS.has(tab) || e.range.getRow() < 2) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error("KKV sync is busy; edit again or run kkvSyncAll.");
  try {
    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(s => String(s).trim());
    const first = e.range.getRow();
    const count = e.range.getNumRows();
    const values = sheet.getRange(first, 1, count, lastCol).getDisplayValues();
    values.forEach((row, i) => {
      if (row.every(v => !String(v).trim())) return;
      const record = {};
      headers.forEach((h, j) => { if (h) record[h] = row[j]; });
      const updatedHeader = headers.indexOf("Updated_At");
      if (updatedHeader >= 0 && !record.Updated_At) record.Updated_At = new Date().toISOString();
      kkvPost(tab, record, first + i);
    });
  } finally {
    lock.releaseLock();
  }
}

function kkvSyncAll() {
  const ss = SpreadsheetApp.getActive();
  let sent = 0;
  ss.getSheets().forEach(sheet => {
    const tab = sheet.getName();
    if (!KKV_TABS.has(tab) || sheet.getLastRow() < 2) return;
    const values = sheet.getDataRange().getDisplayValues();
    const headers = values[0].map(s => String(s).trim());
    values.slice(1).forEach((row, i) => {
      if (row.every(v => !String(v).trim())) return;
      const record = {};
      headers.forEach((h, j) => { if (h) record[h] = row[j]; });
      kkvPost(tab, record, i + 2);
      sent++;
    });
  });
  Logger.log("Rows submitted to KKV sync: " + sent);
}

function kkvPost(tab, record, rowNumber) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty("KKV_WEBHOOK_URL");
  const secret = props.getProperty("KKV_WEBHOOK_SECRET");
  if (!url || !secret) throw new Error("Set KKV_WEBHOOK_URL and KKV_WEBHOOK_SECRET in Script Properties first.");
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { "x-kkv-webhook-secret": secret },
    payload: JSON.stringify({ module: tab, row: record, row_number: rowNumber, source: "google_apps_script" }),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error("KKV sync failed for " + tab + " row " + rowNumber + ": HTTP " + code + " " + response.getContentText());
  const result = JSON.parse(response.getContentText());
  if (!result.ok || result.rejected) throw new Error("KKV sync rejected " + tab + " row " + rowNumber + ": " + response.getContentText());
}