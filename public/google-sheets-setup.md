# KKV 360° Google Sheets connection

This integration sends edits from the clinic Google Sheet to the KKV 360° app using an authenticated Google Apps Script trigger. The app does not get unrestricted access to your Google account.

## One-time setup

1. Deploy the latest Hatchable project.
2. In Hatchable project Settings/Secrets, set `GOOGLE_APPS_SCRIPT_WEBHOOK_SECRET` to a long random secret. Do not share it in chat or put it in the spreadsheet cells.
3. In your clinic spreadsheet, open **Extensions → Apps Script**.
4. Copy the contents of `https://avanthi.hatchable.site/kkv-google-sheets-sync.gs` into the Apps Script editor and save.
5. In Apps Script, open **Project Settings → Script Properties** and add:
   - `KKV_WEBHOOK_URL` = `https://avanthi.hatchable.site/api/sheets-webhook`
   - `KKV_WEBHOOK_SECRET` = the same secret stored in Hatchable
6. Select `installKKVTrigger` in Apps Script and click Run. Google will ask you to authorize this script to read the spreadsheet and make requests. Review and approve it only in your own Google account.
7. Run `kkvSyncAll` once to send existing rows, then edit one test row and verify that the app's sync history and module reflect it.

## Required sheet structure

Use these exact tab names: Patients, Appointments, Physiotherapy, Physio_Sessions, Leads, Follow_Ups, Payments, Campaigns. Row 1 must contain the exact column headers for that tab. Use unique stable IDs such as Patient_ID and Appointment_ID. Related Patient_IDs and Package_IDs must already exist in the corresponding parent tabs before syncing dependent rows. Use dates in YYYY-MM-DD format for best results.

## Important behavior

- New/edited rows are upserted by their stable ID; duplicates are not created for the same ID.
- Invalid rows are rejected and logged. Correct the row and edit it again, or run `kkvSyncAll`.
- Removing a row from Sheets does not delete/archive the app's database record.
- This bridge synchronizes Sheets → app. App → Sheets write-back is not enabled.
- This creates staff follow-up tasks for reminders; it does not send WhatsApp/SMS messages. Configure and test an approved messaging provider before enabling actual delivery.
- Keep this spreadsheet private and share it only with staff who need access. Avoid putting sensitive clinical notes into the operational tabs.