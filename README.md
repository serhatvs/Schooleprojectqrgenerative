# Attendance QR MVP

Minimal web-based admin page for starting one attendance session and displaying its QR code.

## Run

In PowerShell:

```powershell
$env:ADMIN_SECRET="supersecret123"
$env:ATTENDANCE_LOGS_DIR="./attendance_logs"
npm.cmd install
npm.cmd start
```

Then open `http://localhost:3000/admin`.

## Project Structure

```text
.
|-- package.json
|-- server.js
|-- public/
|   |-- index.html
|   |-- styles.css
|   `-- app.js
`-- README.md
```

## How It Works

- The server keeps only one session in memory.
- `Start Session` creates a random `session_id`, current `start_time`, `expires_at` 10 minutes later, and marks the session as active.
- The QR payload is encoded as JSON with `session_id`, `timestamp`, and `nonce`.
- The server turns that payload into a QR image and sends it to the page as a data URL.
- `End Session` marks the session inactive and removes the visible QR.
- If the session passes its expiration time, both server and client treat it as expired and hide the QR.
- `POST /api/attendance/scan` accepts mobile scan requests and returns `success`, `expired`, `duplicate_student`, `duplicate_device`, or `invalid_qr`.

## Deployment

Required environment variables:

- `ADMIN_SECRET`
- `ATTENDANCE_LOGS_DIR` (optional)

Railway setup:

- Set `ADMIN_SECRET` in Railway Variables, for example `ADMIN_SECRET=supersecret123`.
- Mount a volume at `/app/attendance_logs`.
- Leave `ATTENDANCE_LOGS_DIR` unset to use the default `/app/attendance_logs`, or set it explicitly if you prefer.
- The backend service can be public.
- `POST /api/attendance/scan` remains public.
- The admin panel and session endpoints require `x-admin-secret`.
- Open the browser panel at `/admin`, then enter the admin secret when prompted.

Local usage example:

```powershell
$env:ADMIN_SECRET="supersecret123"
$env:ATTENDANCE_LOGS_DIR="./attendance_logs"
npm.cmd start
```
