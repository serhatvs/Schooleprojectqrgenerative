# Attendance QR MVP

Minimal Node.js + Express backend for the attendance QR generator, admin panel, and public scan endpoints for mobile and web clients.

## Endpoints

- `/admin` is the admin panel.
- `/scan-web` is the public iOS-compatible web scanner and PWA entry.
- `POST /api/attendance/scan` is the public student scan endpoint.
- Session management endpoints remain unchanged and stay admin-protected.
- Attendance reporting endpoints remain admin-protected:
  - `GET /api/attendance/daily-view?date=YYYY-MM-DD`
  - `GET /api/attendance/monthly-view?month=YYYY-MM`
  - `GET /api/attendance/daily-summary`
  - `GET /api/attendance/monthly-summary`
  - `GET /api/attendance/daily-export?date=YYYY-MM-DD`
  - `GET /api/attendance/monthly-export?month=YYYY-MM`

## How It Works

- The server keeps only one session in memory.
- `Start Session` creates a random `session_id`, current `start_time`, `expires_at` 10 minutes later, and marks the session as active.
- The QR payload is encoded as JSON with `session_id`, `timestamp`, and `nonce`.
- The server turns that payload into a QR image and sends it to the page as a data URL.
- Session metadata is synchronized into PostgreSQL and the latest valid active session is restored on startup.
- `End Session` marks the session inactive in memory and in PostgreSQL.
- `POST /api/attendance/scan` persists attendance to PostgreSQL and returns `success`, `expired`, `duplicate_student`, `duplicate_device`, or `invalid_qr`.
- Attendance scans outside the 600 meter radius of `38.73884317007882, 35.47434393140808` are still recorded, but flagged for admin/audit review, while the student still receives `success`.
- Duplicate protection is enforced by the current in-memory decision order plus PostgreSQL unique constraints on `(session_id, user_id)` and `(session_id, device_install_id)`.
- Attendance reporting/export endpoints read directly from `attendance_records`.
- Daily/monthly view and export outputs include `is_in_school`, `distance_meters`, and `flag_reason` for admin review.
- Daily and monthly filtering/grouping use Turkey-local `scan_time`.
- View endpoints return `scan_time` and `created_at` in `Europe/Istanbul` formatted as `YYYY-MM-DD HH:mm`.
- Export endpoints return BOM-prefixed CSV downloads with the same timestamp formatting.

## Local Run

In PowerShell:

```powershell
$env:ADMIN_SECRET="supersecret123"
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/attendance"
npm.cmd install
npm.cmd start
```

Then open `http://localhost:3000/admin`.

## Railway Deployment

Required Railway variables:

```text
ADMIN_SECRET=<your-secret>
DATABASE_URL=<provided-by-railway-postgresql>
```

Deployment notes:

- PostgreSQL is required.
- Add Railway PostgreSQL to the project so `DATABASE_URL` is available to the backend service.
- `ADMIN_SECRET` must be set.
- `DATABASE_URL` must be set.
- `/admin` is the admin panel.
- `POST /api/attendance/scan` is the public student scan endpoint.
- The backend service can remain public.
- Admin routes remain protected by the current secret-based approach.
- Volume-based NDJSON storage is no longer used after this migration.

Production URLs:

- Backend base URL: `https://schooleprojectqrgenerative-production.up.railway.app`
- Admin panel: `https://schooleprojectqrgenerative-production.up.railway.app/admin`

## How To Use

Admin:

1. Open `/admin`.
2. Enter the current `ADMIN_SECRET`.
3. Start a session.
4. Show the generated QR code to students.
5. End the session when attendance is finished.

Student / mobile scanner:

1. Open the mobile scanner app configured with the production backend URL.
2. Enter the student `user_id`.
3. Scan the active QR code from the admin panel.
4. The app sends the request to `POST /api/attendance/scan`.
5. The app displays the backend result message.

Student / web scanner / PWA:

1. Open `/scan-web` on the same HTTPS backend origin.
2. Enter the student `user_id`.
3. Tap `Tarayiciyi Baslat` and allow camera access.
4. Scan the active QR code from the admin panel.
5. The page sends the request to `POST /api/attendance/scan` with browser geolocation in `konum`.
6. The page displays the backend result message and resumes scanning automatically.
7. On iPhone Safari, optionally use `Share -> Add to Home Screen` to install it like an app.

## Web Scanner / PWA Notes

- The web scanner is available at `/scan-web`.
- HTTPS is required for browser camera and geolocation access.
- This web/PWA flow is the iOS-compatible scanner path and does not require a native iOS app.
- The web scanner now relies on browser geolocation only; `wifi` has been removed from the system.
- iPhone Safari users must allow location access before a scan can be submitted.
- Browser storage is used to persist:
  - the last entered `user_id`
  - `device_install_id`
  - `device_install_password`
- Backend contracts remain unchanged; the web client only reuses the existing `POST /api/attendance/scan` endpoint.

Reporting / export:

1. Send the existing `x-admin-secret` header with each request.
2. Use `/api/attendance/daily-view?date=2026-03-18` for detailed rows from a single Turkey-local day.
3. Use `/api/attendance/monthly-view?month=2026-03` for detailed rows from a single Turkey-local month.
4. Use `/api/attendance/daily-summary` for grouped daily totals.
5. Use `/api/attendance/monthly-summary` for grouped monthly totals.
6. Use `/api/attendance/daily-export?date=2026-03-18` to download a CSV export for one day.
7. Use `/api/attendance/monthly-export?month=2026-03` to download a CSV export for one month.

Example curl usage:

```bash
curl -H "x-admin-secret: supersecret123" -OJ "http://localhost:3000/api/attendance/daily-export?date=2026-03-18"
curl -H "x-admin-secret: supersecret123" -OJ "http://localhost:3000/api/attendance/monthly-export?month=2026-03"
```

## Persistence

- Attendance records are now stored in PostgreSQL, not NDJSON files.
- The backend creates the minimal `sessions` and `attendance_records` tables automatically on startup.
- Database initialization safely runs `ALTER TABLE attendance_records DROP COLUMN IF EXISTS wifi;`.
- Database initialization also safely adds `is_in_school`, `distance_meters`, and `flag_reason` if they are missing.
- Session start/end updates the `sessions` table to keep PostgreSQL synchronized with the current in-memory session.
- On startup, the backend restores the newest still-valid active session from PostgreSQL and rebuilds in-memory duplicate tracking from `attendance_records`.
