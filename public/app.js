const startButton = document.getElementById("start-button");
const endButton = document.getElementById("end-button");
const qrImage = document.getElementById("qr-image");
const qrPlaceholder = document.getElementById("qr-placeholder");
const placeholderTitle = document.getElementById("placeholder-title");
const placeholderCopy = document.getElementById("placeholder-copy");
const sessionIdValue = document.getElementById("session-id");
const startTimeValue = document.getElementById("start-time");
const expirationTimeValue = document.getElementById("expiration-time");
const statusBadge = document.getElementById("status-badge");

let currentSession = null;
let adminSecret =
  typeof window.__ADMIN_SECRET === "string" ? window.__ADMIN_SECRET.trim() : "";
let panelMessage = null;

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

function normalizeClientSession(session) {
  if (
    session?.active &&
    Date.now() >= Date.parse(session.expires_at)
  ) {
    return {
      ...session,
      active: false,
      status: "expired",
      qr_data_url: null,
    };
  }

  return session;
}

function setPanelMessage(title, copy) {
  panelMessage = { title, copy };
}

function clearPanelMessage() {
  panelMessage = null;
}

function ensureAdminSecret() {
  if (adminSecret) {
    return true;
  }

  const enteredSecret = window.prompt(
    "Enter the admin secret to use the Attendance QR Panel."
  );

  if (!enteredSecret || !enteredSecret.trim()) {
    adminSecret = "";
    setPanelMessage(
      "Admin secret required",
      "Refresh the page and enter the admin secret to use the panel."
    );
    renderSession();
    return false;
  }

  adminSecret = enteredSecret.trim();
  window.__ADMIN_SECRET = adminSecret;
  clearPanelMessage();
  return true;
}

function handleUnauthorized() {
  adminSecret = "";
  delete window.__ADMIN_SECRET;
  currentSession = null;
  setPanelMessage(
    "Unauthorized",
    "The admin secret is missing or incorrect. Refresh the page and enter the correct secret."
  );
  renderSession();
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return dateFormatter.format(new Date(value));
}

function setStatus(status) {
  const label = status ? status[0].toUpperCase() + status.slice(1) : "Not started";
  statusBadge.textContent = label;
  statusBadge.className = `status-badge ${
    status ? `status-${status}` : "status-idle"
  }`;
}

function renderSession() {
  currentSession = normalizeClientSession(currentSession);

  if (panelMessage) {
    sessionIdValue.textContent = "-";
    startTimeValue.textContent = "-";
    expirationTimeValue.textContent = "-";
    setStatus(null);
    qrImage.hidden = true;
    qrImage.removeAttribute("src");
    qrPlaceholder.hidden = false;
    placeholderTitle.textContent = panelMessage.title;
    placeholderCopy.textContent = panelMessage.copy;
    startButton.disabled = true;
    endButton.disabled = true;
    return;
  }

  const hasSession = Boolean(currentSession);
  const isActive = Boolean(currentSession?.active);

  sessionIdValue.textContent = hasSession ? currentSession.session_id : "-";
  startTimeValue.textContent = hasSession ? formatDate(currentSession.start_time) : "-";
  expirationTimeValue.textContent = hasSession ? formatDate(currentSession.expires_at) : "-";
  setStatus(hasSession ? currentSession.status : null);

  if (isActive && currentSession.qr_data_url) {
    qrImage.src = currentSession.qr_data_url;
    qrImage.hidden = false;
    qrPlaceholder.hidden = true;
  } else {
    qrImage.hidden = true;
    qrImage.removeAttribute("src");
    qrPlaceholder.hidden = false;

    if (!hasSession) {
      placeholderTitle.textContent = "No active session";
      placeholderCopy.textContent = "Start a session to generate a QR code.";
    } else if (currentSession.status === "expired") {
      placeholderTitle.textContent = "Session expired";
      placeholderCopy.textContent =
        "This QR code is no longer valid. Start a new session to generate another code.";
    } else {
      placeholderTitle.textContent = "Session inactive";
      placeholderCopy.textContent =
        "The current session is not active. Start a new session when you are ready.";
    }
  }

  startButton.disabled = !adminSecret;
  endButton.disabled = !adminSecret || !isActive;
}

async function requestJson(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (adminSecret) {
    headers["x-admin-secret"] = adminSecret;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  let data = null;

  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  return { response, data };
}

function getErrorMessage(response, data, fallbackMessage) {
  if (response.status === 403) {
    handleUnauthorized();
    return "The admin secret is missing or incorrect.";
  }

  if (typeof data?.error === "string") {
    return data.error;
  }

  return fallbackMessage;
}

async function loadSession() {
  const { response, data } = await requestJson("/api/session");

  if (response.status === 403) {
    handleUnauthorized();
    return;
  }

  if (!response.ok) {
    throw new Error(getErrorMessage(response, data, "Failed to load session."));
  }

  clearPanelMessage();
  currentSession = data;
  renderSession();
}

async function startSession(replaceActive = false) {
  const { response, data } = await requestJson("/api/session/start", {
    method: "POST",
    body: JSON.stringify({ replaceActive }),
  });

  if (response.status === 403) {
    handleUnauthorized();
    return;
  }

  if (response.status === 409) {
    clearPanelMessage();
    currentSession = data;
    renderSession();

    const confirmed = window.confirm(
      "A session is already active. Replace it with a new session?"
    );

    if (confirmed) {
      return startSession(true);
    }

    return;
  }

  if (!response.ok) {
    throw new Error(getErrorMessage(response, data, "Failed to start session."));
  }

  clearPanelMessage();
  currentSession = data;
  renderSession();
}

async function endSession() {
  const { response, data } = await requestJson("/api/session/end", {
    method: "POST",
  });

  if (response.status === 403) {
    handleUnauthorized();
    return;
  }

  if (!response.ok) {
    throw new Error(getErrorMessage(response, data, "Failed to end session."));
  }

  clearPanelMessage();
  currentSession = data;
  renderSession();
}

startButton.addEventListener("click", async () => {
  if (!adminSecret) {
    setPanelMessage(
      "Admin secret required",
      "Refresh the page and enter the admin secret to use the panel."
    );
    renderSession();
    return;
  }

  startButton.disabled = true;

  try {
    if (currentSession?.active) {
      const confirmed = window.confirm(
        "A session is already active. Replace it with a new session?"
      );

      if (!confirmed) {
        return;
      }

      await startSession(true);
      return;
    }

    await startSession(false);
  } catch (error) {
    if (adminSecret) {
      window.alert(error.message);
    }
  } finally {
    renderSession();
  }
});

endButton.addEventListener("click", async () => {
  if (!adminSecret) {
    setPanelMessage(
      "Admin secret required",
      "Refresh the page and enter the admin secret to use the panel."
    );
    renderSession();
    return;
  }

  endButton.disabled = true;

  try {
    await endSession();
  } catch (error) {
    if (adminSecret) {
      window.alert(error.message);
    }
  } finally {
    renderSession();
  }
});

window.setInterval(() => {
  if (!currentSession?.active) {
    return;
  }

  const normalized = normalizeClientSession(currentSession);

  if (normalized !== currentSession) {
    currentSession = normalized;
    renderSession();
  }
}, 1000);

async function initializePanel() {
  if (!ensureAdminSecret()) {
    return;
  }

  await loadSession();
}

initializePanel().catch((error) => {
  if (!panelMessage) {
    setPanelMessage("Panel unavailable", error.message);
    renderSession();
  }
});
