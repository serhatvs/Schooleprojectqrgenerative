const crypto = require("node:crypto");
const path = require("node:path");

const express = require("express");
const QRCode = require("qrcode");

const {
  expireStaleSessions,
  findDuplicateDevice,
  findDuplicateStudent,
  initDatabase,
  insertAttendanceRecord,
  markSessionEnded,
  replaceActiveSessionRecord,
  restoreSessionFromDatabase,
  upsertSessionRecord,
} = require("./db");

const PORT = Number(process.env.PORT) || 3000;
const SESSION_DURATION_MS = 10 * 60 * 1000;

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
      wifi: record.wifi,
      konum: record.konum,
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
    isNonEmptyString(payload?.wifi) &&
    isNonEmptyString(payload?.konum) &&
    isNonEmptyString(payload?.session_id)
  );
}

function requireAdminSecret(req, res, next) {
  const secret = req.headers["x-admin-secret"];

  if (!secret || secret !== process.env.ADMIN_SECRET) {
    console.log("Unauthorized admin access attempt:", req.method, req.path);
    return res.status(403).json({ error: "unauthorized" });
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

      const scanRecord = {
        user_id: payload.user_id,
        device_install_id: payload.device_install_id,
        device_install_password: payload.device_install_password,
        scan_time: payload.scan_time,
        wifi: payload.wifi,
        konum: payload.konum,
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

function createApp() {
  const app = express();
  const store = createSessionStore();
  const publicDir = path.join(__dirname, "public");

  app.locals.store = store;
  app.use(express.json());

  app.get("/admin", (req, res) => {
    res.type("html").send(renderAdminBootstrapPage());
  });

  app.get("/favicon.ico", (req, res) => {
    res.status(204).end();
  });

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
