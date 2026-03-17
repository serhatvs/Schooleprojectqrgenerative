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

  endButton.disabled = !isActive;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  let data = null;

  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  return { response, data };
}

async function loadSession() {
  const { response, data } = await requestJson("/api/session");

  if (!response.ok) {
    throw new Error("Failed to load session.");
  }

  currentSession = data;
  renderSession();
}

async function startSession(replaceActive = false) {
  const { response, data } = await requestJson("/api/session/start", {
    method: "POST",
    body: JSON.stringify({ replaceActive }),
  });

  if (response.status === 409) {
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
    throw new Error("Failed to start session.");
  }

  currentSession = data;
  renderSession();
}

async function endSession() {
  const { response, data } = await requestJson("/api/session/end", {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Failed to end session.");
  }

  currentSession = data;
  renderSession();
}

startButton.addEventListener("click", async () => {
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
    window.alert(error.message);
  } finally {
    startButton.disabled = false;
    renderSession();
  }
});

endButton.addEventListener("click", async () => {
  endButton.disabled = true;

  try {
    await endSession();
  } catch (error) {
    window.alert(error.message);
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

loadSession().catch((error) => {
  window.alert(error.message);
});

