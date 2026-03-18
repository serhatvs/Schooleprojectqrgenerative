const { Pool } = require("pg");

let pool = null;

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }

  return pool;
}

async function query(text, params = []) {
  return getPool().query(text, params);
}

async function initDatabase() {
  await query("SELECT 1");
  await query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      start_time TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS attendance_records (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      device_install_id TEXT NOT NULL,
      device_install_password TEXT NOT NULL,
      scan_time TIMESTAMPTZ NOT NULL,
      konum TEXT NOT NULL,
      is_in_school BOOLEAN NOT NULL DEFAULT TRUE,
      distance_meters DOUBLE PRECISION,
      flag_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (session_id, user_id),
      UNIQUE (session_id, device_install_id)
    );
  `);
  await query(`
    ALTER TABLE attendance_records
    DROP COLUMN IF EXISTS wifi;
  `);
  await query(`
    ALTER TABLE attendance_records
    ADD COLUMN IF NOT EXISTS is_in_school BOOLEAN NOT NULL DEFAULT TRUE;
  `);
  await query(`
    ALTER TABLE attendance_records
    ADD COLUMN IF NOT EXISTS distance_meters DOUBLE PRECISION;
  `);
  await query(`
    ALTER TABLE attendance_records
    ADD COLUMN IF NOT EXISTS flag_reason TEXT;
  `);
}

async function expireStaleSessions() {
  await query(
    `
      UPDATE sessions
      SET active = FALSE, status = 'expired'
      WHERE active = TRUE
        AND status = 'active'
        AND expires_at <= NOW();
    `
  );
}

async function upsertSessionRecord(session) {
  await query(
    `
      INSERT INTO sessions (
        session_id,
        start_time,
        expires_at,
        status,
        active
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (session_id)
      DO UPDATE SET
        start_time = EXCLUDED.start_time,
        expires_at = EXCLUDED.expires_at,
        status = EXCLUDED.status,
        active = EXCLUDED.active;
    `,
    [
      session.session_id,
      session.start_time,
      session.expires_at,
      session.status,
      session.active,
    ]
  );
}

async function replaceActiveSessionRecord(previousSessionId, nextSession) {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `
        UPDATE sessions
        SET active = FALSE, status = 'ended'
        WHERE session_id = $1;
      `,
      [previousSessionId]
    );
    await client.query(
      `
        INSERT INTO sessions (
          session_id,
          start_time,
          expires_at,
          status,
          active
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (session_id)
        DO UPDATE SET
          start_time = EXCLUDED.start_time,
          expires_at = EXCLUDED.expires_at,
          status = EXCLUDED.status,
          active = EXCLUDED.active;
      `,
      [
        nextSession.session_id,
        nextSession.start_time,
        nextSession.expires_at,
        nextSession.status,
        nextSession.active,
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function markSessionEnded(sessionId, status) {
  await query(
    `
      UPDATE sessions
      SET active = FALSE, status = $2
      WHERE session_id = $1;
    `,
    [sessionId, status]
  );
}

async function insertAttendanceRecord(record) {
  await query(
    `
      INSERT INTO attendance_records (
        session_id,
        user_id,
        device_install_id,
        device_install_password,
        scan_time,
        konum,
        is_in_school,
        distance_meters,
        flag_reason
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
    `,
    [
      record.session_id,
      record.user_id,
      record.device_install_id,
      record.device_install_password,
      record.scan_time,
      record.konum,
      record.is_in_school,
      record.distance_meters,
      record.flag_reason,
    ]
  );
}

async function findDuplicateStudent(sessionId, userId) {
  const result = await query(
    `
      SELECT 1
      FROM attendance_records
      WHERE session_id = $1 AND user_id = $2
      LIMIT 1;
    `,
    [sessionId, userId]
  );

  return result.rowCount > 0;
}

async function findDuplicateDevice(sessionId, deviceInstallId) {
  const result = await query(
    `
      SELECT 1
      FROM attendance_records
      WHERE session_id = $1 AND device_install_id = $2
      LIMIT 1;
    `,
    [sessionId, deviceInstallId]
  );

  return result.rowCount > 0;
}

async function getDailyAttendanceView(date) {
  const result = await query(
    `
      SELECT
        session_id,
        user_id,
        device_install_id,
        TO_CHAR(scan_time AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI') AS scan_time,
        TO_CHAR(created_at AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI') AS created_at,
        konum,
        is_in_school,
        distance_meters,
        flag_reason
      FROM attendance_records
      WHERE TO_CHAR(scan_time AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD') = $1
      ORDER BY attendance_records.created_at ASC, attendance_records.id ASC;
    `,
    [date]
  );

  return result.rows;
}

async function getMonthlyAttendanceView(month) {
  const result = await query(
    `
      SELECT
        session_id,
        user_id,
        device_install_id,
        TO_CHAR(scan_time AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI') AS scan_time,
        TO_CHAR(created_at AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI') AS created_at,
        konum,
        is_in_school,
        distance_meters,
        flag_reason
      FROM attendance_records
      WHERE TO_CHAR(scan_time AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM') = $1
      ORDER BY attendance_records.created_at ASC, attendance_records.id ASC;
    `,
    [month]
  );

  return result.rows;
}

async function getDailyAttendanceSummary() {
  const result = await query(`
    SELECT
      TO_CHAR(scan_time AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD') AS date,
      COUNT(DISTINCT session_id)::int AS session_count,
      COUNT(*)::int AS attendance_count,
      COUNT(*) FILTER (WHERE is_in_school = FALSE OR flag_reason IS NOT NULL)::int AS flagged_count
    FROM attendance_records
    GROUP BY TO_CHAR(scan_time AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD')
    ORDER BY date DESC;
  `);

  return result.rows;
}

async function getMonthlyAttendanceSummary() {
  const result = await query(`
    SELECT
      TO_CHAR(scan_time AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM') AS month,
      COUNT(DISTINCT session_id)::int AS session_count,
      COUNT(*)::int AS attendance_count,
      COUNT(*) FILTER (WHERE is_in_school = FALSE OR flag_reason IS NOT NULL)::int AS flagged_count
    FROM attendance_records
    GROUP BY TO_CHAR(scan_time AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM')
    ORDER BY month DESC;
  `);

  return result.rows;
}

async function getDailyAttendanceExportRows(date) {
  const result = await query(
    `
      SELECT
        session_id,
        user_id,
        device_install_id,
        TO_CHAR(scan_time AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI') AS scan_time,
        TO_CHAR(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI') AS created_at,
        konum,
        is_in_school,
        distance_meters,
        flag_reason
      FROM attendance_records
      WHERE TO_CHAR(scan_time AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD') = $1
      ORDER BY created_at ASC, id ASC;
    `,
    [date]
  );

  return result.rows;
}

async function getMonthlyAttendanceExportRows(month) {
  const result = await query(
    `
      SELECT
        session_id,
        user_id,
        device_install_id,
        TO_CHAR(scan_time AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI') AS scan_time,
        TO_CHAR(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI') AS created_at,
        konum,
        is_in_school,
        distance_meters,
        flag_reason
      FROM attendance_records
      WHERE TO_CHAR(scan_time AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM') = $1
      ORDER BY created_at ASC, id ASC;
    `,
    [month]
  );

  return result.rows;
}

async function getTotalAttendanceExportRows() {
  const result = await query(`
    SELECT
      session_id,
      user_id,
      device_install_id,
      TO_CHAR(scan_time AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI') AS scan_time,
      TO_CHAR(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI') AS created_at,
      konum,
      is_in_school,
      distance_meters,
      flag_reason
    FROM attendance_records
    ORDER BY created_at ASC, id ASC;
  `);

  return result.rows;
}

async function restoreSessionFromDatabase() {
  const sessionResult = await query(
    `
      SELECT session_id, start_time, expires_at, status, active
      FROM sessions
      WHERE active = TRUE
        AND status = 'active'
        AND expires_at > NOW()
      ORDER BY start_time DESC
      LIMIT 1;
    `
  );

  if (sessionResult.rowCount === 0) {
    return null;
  }

  const session = sessionResult.rows[0];
  // Keep raw timestamps for internal session restoration.
  // If a future public/export/debug query exposes attendance_records rows,
  // format timestamps as:
  // TO_CHAR(scan_time AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI') AS scan_time
  // TO_CHAR(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI') AS created_at
  const attendanceResult = await query(
    `
      SELECT
        session_id,
        user_id,
        device_install_id,
        device_install_password,
        scan_time,
        konum,
        is_in_school,
        distance_meters,
        flag_reason
      FROM attendance_records
      WHERE session_id = $1
      ORDER BY created_at ASC, id ASC;
    `,
    [session.session_id]
  );

  return {
    session,
    attendanceRecords: attendanceResult.rows,
  };
}

module.exports = {
  expireStaleSessions,
  findDuplicateDevice,
  findDuplicateStudent,
  getDailyAttendanceExportRows,
  getDailyAttendanceSummary,
  getDailyAttendanceView,
  getMonthlyAttendanceExportRows,
  getMonthlyAttendanceSummary,
  getMonthlyAttendanceView,
  getTotalAttendanceExportRows,
  initDatabase,
  insertAttendanceRecord,
  markSessionEnded,
  replaceActiveSessionRecord,
  restoreSessionFromDatabase,
  upsertSessionRecord,
};
