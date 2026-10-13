# Google Sheets API connection for KKV 360°

## One-time setup
1. In Google Cloud Console, create or select a project and enable the **Google Sheets API**.
2. Create a service account and generate a JSON key. Keep the key private.
3. Copy the service account's `client_email`.
4. Open the clinic spreadsheet's Share dialog and share it with that exact service-account email as **Viewer**. The app only reads from Google Sheets.
5. In Hatchable → project → Setup, set `GOOGLE_SERVICE_ACCOUNT_JSON` to the complete contents of the downloaded service-account JSON key. Never paste it into chat or into a sheet.
6. In the app, open Google Sheets settings, paste the spreadsheet URL, choose Google mode, and save.
7. Use the app's manual sync action. Verify sync history and confirm the test row appears. The scheduled sync runs hourly after setup.

## Supported tabs and headers
Use these exact tab names: Patients, Appointments, Physiotherapy, Physio_Sessions, Leads, Follow_Ups, Payments, Campaigns. Row 1 must contain the field headers used by the app's CSV templates. Each record needs a stable unique ID (e.g. Patient_ID). Keep parent records (Patients, then Physiotherapy packages) before dependent appointments, sessions, follow-ups and payments.

## Safety and sync behavior
- Google credentials are stored in Hatchable Setup, never in source files.
- OAuth requests only the read-only Sheets scope.
- Rows are upserted by stable ID; repeating a sync does not create duplicates.
- Invalid rows and per-tab failures are recorded in sync history.
- Removing a spreadsheet row does not delete the database record.
- This is Sheets → app only; changes in the app are not written back to Sheets.
- The private application remains private; Google access is server-to-server.
- Keep patient data minimal and only share the spreadsheet with people and service accounts that need access.