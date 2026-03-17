const crypto = require("node:crypto");
const path = require("node:path");

const express = require("express");
const QRCode = require("qrcode");

const PORT = Number(process.env.PORT) || 3000;
const SESSION_DURATION_MS = 10 * 60 * 1000;

function createActiveSessionError(session) {
  const error = new Error("An active session already exists.");
  error.code = "ACTIVE_SESSION_EXISTS";
  error.session = session;
  return error;
}

async function buildSession() {
  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + SESSION_DURATION_MS);
  const qrPayload = {
    session_id: crypto.randomUUID(),
    timestamp: startedAt.toISOString(),
    nonce: crypto.randomBytes(12).toString("hex"),
  };

  const qrDataUrl = await QRCode.toDataURL(JSON.stringify(qrPayload), {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 420,
  });

  return {
    session_id: qrPayload.session_id,
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

function createSessionStore() {
  let currentSession = null;

  function normalizeSession() {
    if (!currentSession) {
      return null;
    }

    const hasExpired =
      currentSession.active &&
      Date.now() >= Date.parse(currentSession.expires_at);

    if (hasExpired) {
      currentSession = {
        ...currentSession,
        active: false,
        status: "expired",
        qr_data_url: null,
      };
    }

    return currentSession;
  }

  return {
    get() {
      return normalizeSession();
    },
    async start(replaceActive = false) {
      const session = normalizeSession();

      if (session?.active && !replaceActive) {
        throw createActiveSessionError(session);
      }

      currentSession = await buildSession();
      return currentSession;
    },
    end() {
      const session = normalizeSession();

      if (!session) {
        return null;
      }

      if (session.active) {
        currentSession = {
          ...session,
          active: false,
          status: "ended",
          qr_data_url: null,
        };
      }

      return currentSession;
    },
    recordScan(payload) {
      const session = normalizeSession();

      if (
        !session ||
        !hasValidScanPayload(payload) ||
        payload.session_id !== session.session_id
      ) {
        return { status: "invalid_qr" };
      }

      if (!session.active || session.status === "expired") {
        return { status: "expired" };
      }

      if (session.studentIds.has(payload.user_id)) {
        return { status: "duplicate_student" };
      }

      if (session.deviceIds.has(payload.device_install_id)) {
        return { status: "duplicate_device" };
      }

      session.studentIds.add(payload.user_id);
      session.deviceIds.add(payload.device_install_id);
      session.scanRecords.push({
        user_id: payload.user_id,
        device_install_id: payload.device_install_id,
        scan_time: payload.scan_time,
        wifi: payload.wifi,
        konum: payload.konum,
      });
      console.log("SCAN:", payload.user_id, payload.device_install_id);

      return { status: "success" };
    },
  };
}

function serializeSession(session) {
  return session ? { ...session } : null;
}

function createApp() {
  const app = express();
  const store = createSessionStore();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, "public")));

  app.get("/favicon.ico", (req, res) => {
    res.status(204).end();
  });

  app.get("/api/session", (req, res) => {
    res.json(serializeSession(store.get()));
  });

  app.post("/api/session/start", async (req, res) => {
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

  app.post("/api/session/end", (req, res) => {
    res.json(serializeSession(store.end()));
  });

  app.post("/api/attendance/scan", (req, res) => {
    res.json(store.recordScan(req.body));
  });

  return app;
}

if (require.main === module) {
  const app = createApp();

  app.listen(PORT, () => {
    console.log(`Attendance QR Panel running at http://localhost:${PORT}`);
  });
}

module.exports = { createApp };
