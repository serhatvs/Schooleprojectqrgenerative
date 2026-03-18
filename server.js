const crypto = require("node:crypto");
const path = require("node:path");

const ExcelJS = require("exceljs");
const express = require("express");
const QRCode = require("qrcode");

const {
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
} = require("./db");

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_SESSION_DURATION_MINUTES = 180;
const parsedSessionDurationMinutes = Number(process.env.SESSION_DURATION_MINUTES);
const SESSION_DURATION_MINUTES =
  Number.isFinite(parsedSessionDurationMinutes) && parsedSessionDurationMinutes > 0
    ? parsedSessionDurationMinutes
    : DEFAULT_SESSION_DURATION_MINUTES;
const SESSION_DURATION_MS = SESSION_DURATION_MINUTES * 60 * 1000;
const DATE_QUERY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_QUERY_REGEX = /^\d{4}-\d{2}$/;
const SCHOOL_LATITUDE = 38.73884317007882;
const SCHOOL_LONGITUDE = 35.47434393140808;
const SCHOOL_RADIUS_METERS = 600;
const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function createActiveSessionError(session) {
  const error = new Error("An active session already exists.");
  error.code = "ACTIVE_SESSION_EXISTS";
  error.session = session;
  return error;
}

function toIsoString(value) {
  return new Date(value).toISOString();
}

async function createQrDataUrl(sessionId) {
  const qrPayload = {
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    nonce: crypto.randomBytes(12).toString("hex"),
  };

  return QRCode.toDataURL(JSON.stringify(qrPayload), {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 420,
  });
}

async function buildSession() {
  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + SESSION_DURATION_MS);
  const sessionId = crypto.randomUUID();
  const qrDataUrl = await createQrDataUrl(sessionId);

  return {
    session_id: sessionId,
    start_time: startedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    active: true,
    status: "active",
    qr_data_url: qrDataUrl,
    studentIds: new Set(),
    deviceIds: new Set(),
    scanRecords: [],
  };
}

async function buildRestoredSession(restoredSession) {
  const qrDataUrl = await createQrDataUrl(restoredSession.session.session_id);
  const studentIds = new Set();
  const deviceIds = new Set();
  const scanRecords = restoredSession.attendanceRecords.map((record) => {
    studentIds.add(record.user_id);
    deviceIds.add(record.device_install_id);

    return {
      user_id: record.user_id,
      device_install_id: record.device_install_id,
      device_install_password: record.device_install_password,
      scan_time: toIsoString(record.scan_time),
      konum: record.konum,
      is_in_school: record.is_in_school,
      distance_meters: record.distance_meters,
      flag_reason: record.flag_reason,
      session_id: record.session_id,
    };
  });

  return {
    session_id: restoredSession.session.session_id,
    start_time: toIsoString(restoredSession.session.start_time),
    expires_at: toIsoString(restoredSession.session.expires_at),
    active: restoredSession.session.active,
    status: restoredSession.session.status,
    qr_data_url: qrDataUrl,
    studentIds,
    deviceIds,
    scanRecords,
  };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasValidScanPayload(payload) {
  return (
    isNonEmptyString(payload?.user_id) &&
    isNonEmptyString(payload?.device_install_id) &&
    isNonEmptyString(payload?.device_install_password) &&
    isNonEmptyString(payload?.scan_time) &&
    isNonEmptyString(payload?.konum) &&
    isNonEmptyString(payload?.session_id)
  );
}

function isValidDateQuery(value) {
  if (!isNonEmptyString(value) || !DATE_QUERY_REGEX.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidMonthQuery(value) {
  if (!isNonEmptyString(value) || !MONTH_QUERY_REGEX.test(value)) {
    return false;
  }

  const month = Number(value.slice(5, 7));

  return month >= 1 && month <= 12;
}

function parseKonum(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const parts = value.split(",");

  if (parts.length !== 2) {
    return null;
  }

  const latitude = Number(parts[0].trim());
  const longitude = Number(parts[1].trim());

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }

  return { latitude, longitude };
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function getDistanceMeters(from, to) {
  const earthRadiusMeters = 6371000;
  const deltaLatitude = toRadians(to.latitude - from.latitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);
  const fromLatitudeRadians = toRadians(from.latitude);
  const toLatitudeRadians = toRadians(to.latitude);
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(fromLatitudeRadians) *
      Math.cos(toLatitudeRadians) *
      Math.sin(deltaLongitude / 2) ** 2;

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function getLocationAudit(konum) {
  const parsedKonum = parseKonum(konum);

  if (!parsedKonum) {
    return null;
  }

  const distanceMeters = getDistanceMeters(parsedKonum, {
    latitude: SCHOOL_LATITUDE,
    longitude: SCHOOL_LONGITUDE,
  });

  const isInSchool = distanceMeters <= SCHOOL_RADIUS_METERS;

  return {
    isInSchool,
    distanceMeters,
    flagReason: isInSchool ? null : "out_of_school",
  };
}

function requireAdminSecret(req, res, next) {
  const secret = req.headers["x-admin-secret"];

  if (!secret || secret !== process.env.ADMIN_SECRET) {
    console.log("Unauthorized admin access attempt:", req.method, req.path);
    return res.status(403).json({ error: "unauthorized" });
  }

  next();
}

function requireAdmin(req, res, next) {
  if (!process.env.ADMIN_SECRET) {
    return res.status(500).json({ error: "server_error" });
  }

  const secret = req.headers["x-admin-secret"];

  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "forbidden" });
  }

  next();
}

function renderAdminBootstrapPage() {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Attendance QR Panel Access</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        background:
          radial-gradient(circle at top, rgba(23, 103, 255, 0.08), transparent 28%),
          linear-gradient(180deg, #f7f9fb 0%, #f4f6f8 100%);
        color: #162033;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }

      .bootstrap-card {
        width: min(100%, 420px);
        padding: 28px;
        border-radius: 20px;
        background: rgba(255, 255, 255, 0.96);
        border: 1px solid rgba(15, 23, 42, 0.08);
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.08);
        text-align: center;
      }

      h1 {
        margin: 0;
        font-size: 1.8rem;
      }

      p {
        margin: 12px 0 0;
        color: #667085;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <main class="bootstrap-card">
      <h1>Attendance QR Panel</h1>
      <p id="bootstrap-message">Checking admin access...</p>
    </main>
    <script>
      const messageElement = document.getElementById("bootstrap-message");

      function showMessage(message) {
        messageElement.textContent = message;
      }

      async function fetchProtectedText(pathname, secret) {
        const response = await fetch(pathname, {
          headers: { "x-admin-secret": secret },
        });

        return {
          response,
          text: await response.text(),
        };
      }

      async function loadAdminPanel() {
        const secret = window.prompt(
          "Enter the admin secret to open the Attendance QR Panel."
        );

        if (!secret || !secret.trim()) {
          showMessage(
            "Admin secret is required. Refresh the page and enter the secret to continue."
          );
          return;
        }

        const trimmedSecret = secret.trim();

        try {
          const pageResult = await fetchProtectedText("/", trimmedSecret);

          if (pageResult.response.status === 403) {
            showMessage("The admin secret is missing or incorrect.");
            return;
          }

          if (!pageResult.response.ok) {
            showMessage("Failed to load the admin panel.");
            return;
          }

          const [stylesResult, scriptResult] = await Promise.all([
            fetchProtectedText("/styles.css", trimmedSecret),
            fetchProtectedText("/app.js", trimmedSecret),
          ]);

          if (
            stylesResult.response.status === 403 ||
            scriptResult.response.status === 403
          ) {
            showMessage("The admin secret is missing or incorrect.");
            return;
          }

          if (!stylesResult.response.ok || !scriptResult.response.ok) {
            showMessage("Failed to load the admin panel.");
            return;
          }

          const parser = new DOMParser();
          const panelDocument = parser.parseFromString(
            pageResult.text,
            "text/html"
          );
          const stylesheetLink = panelDocument.querySelector(
            'link[href="/styles.css"]'
          );
          const scriptTag = panelDocument.querySelector('script[src="/app.js"]');

          if (stylesheetLink) {
            const styleTag = panelDocument.createElement("style");
            styleTag.textContent = stylesResult.text;
            stylesheetLink.replaceWith(styleTag);
          }

          if (scriptTag) {
            scriptTag.remove();
          }

          const hydratedHtml =
            "<!DOCTYPE html>" + panelDocument.documentElement.outerHTML;

          document.open();
          document.write(hydratedHtml);
          document.close();

          window.__ADMIN_SECRET = trimmedSecret;

          const appScript = document.createElement("script");
          appScript.text = scriptResult.text;
          document.body.appendChild(appScript);
        } catch (error) {
          showMessage("Failed to load the admin panel.");
        }
      }

      loadAdminPanel();
    </script>
  </body>
</html>`;
}

function createSessionStore() {
  let currentSession = null;

  async function normalizeSession() {
    if (!currentSession) {
      return null;
    }

    const hasExpired =
      currentSession.active &&
      Date.now() >= Date.parse(currentSession.expires_at);

    if (hasExpired) {
      await markSessionEnded(currentSession.session_id, "expired");
      currentSession = {
        ...currentSession,
        active: false,
        status: "expired",
        qr_data_url: null,
      };
    }

    return currentSession;
  }

  function rollbackScanRecord(session, scanRecord) {
    session.studentIds.delete(scanRecord.user_id);
    session.deviceIds.delete(scanRecord.device_install_id);
    session.scanRecords.pop();
  }

  return {
    async get() {
      return normalizeSession();
    },
    restore(session) {
      currentSession = session;
    },
    async start(replaceActive = false) {
      const session = await normalizeSession();

      if (session?.active && !replaceActive) {
        throw createActiveSessionError(session);
      }

      const nextSession = await buildSession();

      if (session?.active && replaceActive) {
        await replaceActiveSessionRecord(session.session_id, nextSession);
      } else {
        await upsertSessionRecord(nextSession);
      }
      currentSession = nextSession;
      return currentSession;
    },
    async end() {
      const session = await normalizeSession();

      if (!session) {
        return null;
      }

      if (session.active) {
        await markSessionEnded(session.session_id, "ended");
        currentSession = {
          ...session,
          active: false,
          status: "ended",
          qr_data_url: null,
        };
      }

      return currentSession;
    },
    async recordScan(payload) {
      const session = await normalizeSession();

      if (
        !session ||
        !hasValidScanPayload(payload) ||
        payload.session_id !== session.session_id
      ) {
        return { status: "invalid_qr" };
      }

      if (session.status === "expired") {
        return { status: "expired" };
      }

      if (!session.active) {
        return { status: "invalid_qr" };
      }

      if (session.studentIds.has(payload.user_id)) {
        return { status: "duplicate_student" };
      }

      if (session.deviceIds.has(payload.device_install_id)) {
        return { status: "duplicate_device" };
      }

      const locationAudit = getLocationAudit(payload.konum);

      if (locationAudit == null) {
        return { status: "invalid_qr" };
      }

      const scanRecord = {
        user_id: payload.user_id,
        device_install_id: payload.device_install_id,
        device_install_password: payload.device_install_password,
        scan_time: payload.scan_time,
        konum: payload.konum,
        is_in_school: locationAudit.isInSchool,
        distance_meters: locationAudit.distanceMeters,
        flag_reason: locationAudit.flagReason,
        session_id: payload.session_id,
      };

      session.studentIds.add(scanRecord.user_id);
      session.deviceIds.add(scanRecord.device_install_id);
      session.scanRecords.push(scanRecord);

      try {
        await insertAttendanceRecord(scanRecord);
      } catch (error) {
        rollbackScanRecord(session, scanRecord);

        if (error.code === "23505") {
          if (await findDuplicateStudent(session.session_id, payload.user_id)) {
            return { status: "duplicate_student" };
          }

          if (
            await findDuplicateDevice(
              session.session_id,
              payload.device_install_id
            )
          ) {
            return { status: "duplicate_device" };
          }
        }

        console.error("Failed to persist attendance scan:", error);
        throw error;
      }

      return { status: "success" };
    },
  };
}

function serializeSession(session) {
  if (!session) {
    return null;
  }

  return {
    session_id: session.session_id,
    start_time: session.start_time,
    expires_at: session.expires_at,
    active: session.active,
    status: session.status,
    qr_data_url: session.qr_data_url,
  };
}

function escapeCsvValue(value) {
  const stringValue = value == null ? "" : String(value);

  return `"${stringValue.replace(/"/g, "\"\"")}"`;
}

function buildAttendanceCsv(rows) {
  const header = [
    "session_id",
    "user_id",
    "device_install_id",
    "scan_time",
    "created_at",
    "konum",
    "is_in_school",
    "distance_meters",
    "flag_reason",
  ].join(",");
  const lines = rows.map((row) =>
    [
      row.session_id,
      row.user_id,
      row.device_install_id,
      row.scan_time,
      row.created_at,
      row.konum,
      row.is_in_school,
      row.distance_meters,
      row.flag_reason,
    ]
      .map(escapeCsvValue)
      .join(",")
  );

  return `\uFEFF${[header, ...lines].join("\r\n")}`;
}

const ATTENDANCE_EXPORT_COLUMNS = [
  { header: "session_id", key: "session_id", width: 38 },
  { header: "user_id", key: "user_id", width: 18 },
  { header: "device_install_id", key: "device_install_id", width: 38 },
  { header: "scan_time", key: "scan_time", width: 18, horizontal: "center" },
  { header: "created_at", key: "created_at", width: 18, horizontal: "center" },
  { header: "konum", key: "konum", width: 24, wrapText: true },
  {
    header: "is_in_school",
    key: "is_in_school",
    width: 14,
    horizontal: "center",
    value: (row) => (row.is_in_school === false ? "No" : "Yes"),
  },
  {
    header: "distance_meters",
    key: "distance_meters",
    width: 16,
    horizontal: "center",
    numFmt: "0.0",
    value: (row) => {
      const numericValue = Number(row.distance_meters);

      return Number.isFinite(numericValue) ? numericValue : null;
    },
  },
  { header: "flag_reason", key: "flag_reason", width: 20, wrapText: true },
];

function styleWorksheetHeader(row) {
  row.font = {
    bold: true,
    color: { argb: "FF1F2937" },
  };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE5E7EB" },
  };
  row.alignment = {
    vertical: "middle",
    horizontal: "center",
  };
}

function getAttendanceWorksheetRowValues(row) {
  return ATTENDANCE_EXPORT_COLUMNS.reduce((values, column) => {
    values[column.key] =
      typeof column.value === "function" ? column.value(row) : (row[column.key] ?? "");
    return values;
  }, {});
}

function styleAttendanceWorksheetRow(worksheetRow, row) {
  ATTENDANCE_EXPORT_COLUMNS.forEach((column, index) => {
    const cell = worksheetRow.getCell(index + 1);
    cell.alignment = {
      vertical: "middle",
      horizontal: column.horizontal ?? "left",
      wrapText: Boolean(column.wrapText),
    };

    if (column.numFmt) {
      cell.numFmt = column.numFmt;
    }
  });

  if (row.is_in_school === false) {
    worksheetRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFF7D6" },
      };
    });
  }
}

function addAttendanceWorksheet(workbook, sheetName, rows) {
  const worksheet = workbook.addWorksheet(sheetName);
  worksheet.columns = ATTENDANCE_EXPORT_COLUMNS.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
  }));
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: ATTENDANCE_EXPORT_COLUMNS.length },
  };
  styleWorksheetHeader(worksheet.getRow(1));

  rows.forEach((row) => {
    const worksheetRow = worksheet.addRow(getAttendanceWorksheetRowValues(row));
    styleAttendanceWorksheetRow(worksheetRow, row);
  });

  return worksheet;
}

function addTotalSummaryWorksheet(workbook, rows) {
  const worksheet = workbook.addWorksheet("Summary");
  const flaggedCount = rows.filter(
    (row) => row.is_in_school === false || Boolean(row.flag_reason)
  ).length;
  const summaryRows = [
    { metric: "total_attendance_count", value: rows.length },
    { metric: "flagged_count", value: flaggedCount },
    { metric: "in_school_count", value: rows.length - flaggedCount },
    { metric: "session_count", value: new Set(rows.map((row) => row.session_id)).size },
  ];

  worksheet.columns = [
    { header: "metric", key: "metric", width: 24 },
    { header: "value", key: "value", width: 16 },
  ];
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 2 },
  };
  styleWorksheetHeader(worksheet.getRow(1));
  summaryRows.forEach((row) => worksheet.addRow(row));
  worksheet.getColumn("value").alignment = {
    vertical: "middle",
    horizontal: "center",
  };
}

async function buildAttendanceWorkbookBuffer(rows, options) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Attendance QR Admin Panel";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.subject = options.subject;
  workbook.title = options.title;

  if (options.includeSummarySheet) {
    addTotalSummaryWorksheet(workbook, rows);
  }

  addAttendanceWorksheet(workbook, options.sheetName, rows);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

async function sendAttendanceWorkbook(res, rows, options) {
  const workbookBuffer = await buildAttendanceWorkbookBuffer(rows, options);
  res.setHeader("Content-Type", XLSX_CONTENT_TYPE);
  res.setHeader("Content-Disposition", `attachment; filename="${options.filename}"`);
  res.send(workbookBuffer);
}

function createApp() {
  const app = express();
  const store = createSessionStore();
  const publicDir = path.join(__dirname, "public");
  const scanWebDir = path.join(publicDir, "scan-web");
  const scanWebBundlePath = path.join(
    __dirname,
    "node_modules",
    "html5-qrcode",
    "html5-qrcode.min.js"
  );

  app.locals.store = store;
  app.use(express.json());

  app.get("/admin", (req, res) => {
    res.type("html").send(renderAdminBootstrapPage());
  });

  app.get("/favicon.ico", (req, res) => {
    res.status(204).end();
  });

  app.get(["/scan-web", "/scan-web/"], (req, res) => {
    res.sendFile(path.join(scanWebDir, "index.html"));
  });

  app.get("/sw.js", (req, res) => {
    res.setHeader("Service-Worker-Allowed", "/scan-web");
    res.type("application/javascript").sendFile(path.join(scanWebDir, "sw.js"));
  });

  app.get("/scan-web/vendor/html5-qrcode.min.js", (req, res) => {
    res
      .type("application/javascript")
      .setHeader("Cache-Control", "public, max-age=31536000, immutable")
      .sendFile(scanWebBundlePath);
  });

  app.use("/scan-web", express.static(scanWebDir, { index: false }));

  app.get("/", requireAdminSecret, (req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  app.get("/api/session", requireAdminSecret, async (req, res) => {
    try {
      res.json(serializeSession(await store.get()));
    } catch (error) {
      console.error("Failed to load session:", error);
      res.status(500).json({ error: "Failed to load session." });
    }
  });

  app.post("/api/session/start", requireAdminSecret, async (req, res) => {
    try {
      const replaceActive = Boolean(req.body?.replaceActive);
      const session = await store.start(replaceActive);
      res.json(serializeSession(session));
    } catch (error) {
      if (error.code === "ACTIVE_SESSION_EXISTS") {
        return res.status(409).json(serializeSession(error.session));
      }

      console.error("Failed to start session:", error);
      res.status(500).json({ error: "Failed to start session." });
    }
  });

  app.post("/api/session/end", requireAdminSecret, async (req, res) => {
    try {
      res.json(serializeSession(await store.end()));
    } catch (error) {
      console.error("Failed to end session:", error);
      res.status(500).json({ error: "Failed to end session." });
    }
  });

  app.get("/api/attendance/daily-view", requireAdmin, async (req, res) => {
    const { date } = req.query;

    if (!isValidDateQuery(date)) {
      return res.status(400).json({ error: "invalid_date" });
    }

    try {
      res.json(await getDailyAttendanceView(date));
    } catch (error) {
      console.error("Failed to load daily attendance view:", error);
      res.status(500).json({ error: "server_error" });
    }
  });

  app.get("/api/attendance/monthly-view", requireAdmin, async (req, res) => {
    const { month } = req.query;

    if (!isValidMonthQuery(month)) {
      return res.status(400).json({ error: "invalid_month" });
    }

    try {
      res.json(await getMonthlyAttendanceView(month));
    } catch (error) {
      console.error("Failed to load monthly attendance view:", error);
      res.status(500).json({ error: "server_error" });
    }
  });

  app.get("/api/attendance/daily-summary", requireAdmin, async (req, res) => {
    try {
      res.json(await getDailyAttendanceSummary());
    } catch (error) {
      console.error("Failed to load daily attendance summary:", error);
      res.status(500).json({ error: "server_error" });
    }
  });

  app.get("/api/attendance/monthly-summary", requireAdmin, async (req, res) => {
    try {
      res.json(await getMonthlyAttendanceSummary());
    } catch (error) {
      console.error("Failed to load monthly attendance summary:", error);
      res.status(500).json({ error: "server_error" });
    }
  });

  app.get("/api/attendance/daily-export", requireAdmin, async (req, res) => {
    const { date } = req.query;

    if (!isValidDateQuery(date)) {
      return res.status(400).json({ error: "invalid_date" });
    }

    try {
      const rows = await getDailyAttendanceExportRows(date);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="attendance_${date}.csv"`
      );
      res.send(buildAttendanceCsv(rows));
    } catch (error) {
      console.error("Failed to export daily attendance:", error);
      res.status(500).json({ error: "server_error" });
    }
  });

  app.get("/api/attendance/daily-export-xlsx", requireAdmin, async (req, res) => {
    const { date } = req.query;

    if (!isValidDateQuery(date)) {
      return res.status(400).json({ error: "invalid_date" });
    }

    try {
      const rows = await getDailyAttendanceExportRows(date);
      await sendAttendanceWorkbook(res, rows, {
        filename: `attendance_${date}.xlsx`,
        sheetName: "Attendance",
        subject: `Daily attendance export for ${date}`,
        title: `Attendance ${date}`,
      });
    } catch (error) {
      console.error("Failed to export daily attendance workbook:", error);
      res.status(500).json({ error: "server_error" });
    }
  });

  app.get("/api/attendance/monthly-export", requireAdmin, async (req, res) => {
    const { month } = req.query;

    if (!isValidMonthQuery(month)) {
      return res.status(400).json({ error: "invalid_month" });
    }

    try {
      const rows = await getMonthlyAttendanceExportRows(month);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="attendance_${month}.csv"`
      );
      res.send(buildAttendanceCsv(rows));
    } catch (error) {
      console.error("Failed to export monthly attendance:", error);
      res.status(500).json({ error: "server_error" });
    }
  });

  app.get("/api/attendance/monthly-export-xlsx", requireAdmin, async (req, res) => {
    const { month } = req.query;

    if (!isValidMonthQuery(month)) {
      return res.status(400).json({ error: "invalid_month" });
    }

    try {
      const rows = await getMonthlyAttendanceExportRows(month);
      await sendAttendanceWorkbook(res, rows, {
        filename: `attendance_${month}.xlsx`,
        sheetName: "Attendance",
        subject: `Monthly attendance export for ${month}`,
        title: `Attendance ${month}`,
      });
    } catch (error) {
      console.error("Failed to export monthly attendance workbook:", error);
      res.status(500).json({ error: "server_error" });
    }
  });

  app.get("/api/attendance/total-export", requireAdmin, async (req, res) => {
    try {
      const rows = await getTotalAttendanceExportRows();
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="attendance_total.csv"'
      );
      res.send(buildAttendanceCsv(rows));
    } catch (error) {
      console.error("Failed to export total attendance:", error);
      res.status(500).json({ error: "server_error" });
    }
  });

  app.get("/api/attendance/total-export-xlsx", requireAdmin, async (req, res) => {
    try {
      const rows = await getTotalAttendanceExportRows();
      await sendAttendanceWorkbook(res, rows, {
        filename: "attendance_all.xlsx",
        sheetName: "Attendance",
        subject: "Total attendance export",
        title: "Attendance All",
        includeSummarySheet: true,
      });
    } catch (error) {
      console.error("Failed to export total attendance workbook:", error);
      res.status(500).json({ error: "server_error" });
    }
  });

  app.post("/api/attendance/scan", async (req, res) => {
    try {
      res.json(await store.recordScan(req.body));
    } catch (error) {
      res.status(500).json({ status: "server_error" });
    }
  });

  app.use(requireAdminSecret, express.static(publicDir, { index: false }));

  return app;
}

async function restoreCurrentSession(store) {
  try {
    const restoredSession = await restoreSessionFromDatabase();

    if (!restoredSession) {
      console.log("No active session to restore");
      return;
    }

    const currentSession = await buildRestoredSession(restoredSession);
    store.restore(currentSession);
    console.log("Session restored successfully", {
      session_id: currentSession.session_id,
      restored_students: currentSession.studentIds.size,
    });
  } catch (error) {
    console.error("Failed to restore session from database:", error);
  }
}

async function bootstrap() {
  await initDatabase();
  await expireStaleSessions();

  const app = createApp();
  await restoreCurrentSession(app.locals.store);

  app.listen(PORT, () => {
    console.log(`Attendance QR Panel running at http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  bootstrap().catch((error) => {
    console.error("Failed to initialize server:", error);
    process.exit(1);
  });
}

module.exports = { bootstrap, buildRestoredSession, buildSession, createApp };
