# KKV 360° Google Sheets integration — Apps Script bridge

The Hatchable runtime does not support RSA signatures required by Google service-account OAuth. Use the spreadsheet-bound Google Apps Script bridge instead of direct service-account API sync.

## Setup
1. In Hatchable Setup, keep the clinic app private. The `/api/sheets-webhook` endpoint is public at the API-access layer but checks the shared secret on every POST.
2. Create a strong random secret. In Hatchable Setup, replace `GOOGLE_APPS_SCRIPT_WEBHOOK_SECRET` with this value. Keep it private; do not put it in sheet cells or chat.
3. Open the clinic spreadsheet → Extensions → Apps Script.
4. In Hatchable Code, open `public/kkv-google-sheets-sync.gs`, copy the complete script into the spreadsheet-bound Apps Script editor, and save.
5. In Apps Script, open Project Settings → Script Properties and add:
   - `KKV_WEBHOOK_URL` = `https://avanthi.hatchable.site/api/sheets-webhook`
   - `KKV_WEBHOOK_SECRET` = the exact same secret saved in Hatchable
6. Select `installKKVTrigger` in the function dropdown and click Run. Review Google's permissions prompt and authorize.
7. Run `kkvSyncAll` once for the initial import. Check Apps Script execution logs and the app's Sync history.
8. Edit a non-sensitive test row and confirm the app reflects it.

## Required tabs and headers
Exact tabs: Patients, Appointments, Physiotherapy, Physio_Sessions, Leads, Follow_Ups, Payments, Campaigns. Row 1 must use the app's header templates. Use stable unique IDs. Sync parent records (Patients and Physiotherapy packages) before dependent records.

## Notes
- Sheets → app only; changes in the app are not written back to Sheets.
- Repeated IDs are upserted; deleting a sheet row does not delete the app record.
- The public webhook requires the shared secret over HTTPS. Rotate it if exposed.
- Do not sync real patient data until a synthetic test passes.
- This bridge runs on edits plus manual initial sync; Hatchable's hourly polling is not the active sync mechanism.