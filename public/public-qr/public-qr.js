const REFRESH_INTERVAL_MS = 5000;
const statusMessage = document.getElementById("status-message");
const statusValue = document.getElementById("status-value");
const sessionIdValue = document.getElementById("session-id-value");
const expiresAtValue = document.getElementById("expires-at-value");
const qrImage = document.getElementById("qr-image");
const emptyState = document.getElementById("empty-state");

const STATUS_LABELS = {
  active: "Aktif",
  expired: "Süresi Doldu",
  idle: "Beklemede",
};

const STATUS_MESSAGES = {
  active: "Aktif yoklama QR kodu gösteriliyor.",
  expired: "Yoklamanın süresi doldu.",
  idle: "Şu anda aktif yoklama yok.",
  error: "QR bilgisi alınamadı.",
};

const dateFormatter = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return dateFormatter.format(parsed);
}

function setStatus(status) {
  const toneClass =
    status === "active" ? "status-active" : status === "expired" ? "status-expired" : "";
  statusMessage.className = `status-message ${toneClass}`.trim();
  statusMessage.textContent = STATUS_MESSAGES[status] ?? STATUS_MESSAGES.error;
  statusValue.textContent = STATUS_LABELS[status] ?? "-";
}

function renderIdleLikeState(status, data) {
  setStatus(status);
  sessionIdValue.textContent = data?.session_id ?? "-";
  expiresAtValue.textContent = formatDate(data?.expires_at);
  qrImage.hidden = true;
  qrImage.removeAttribute("src");
  emptyState.hidden = false;
}

function renderActiveState(data) {
  setStatus("active");
  sessionIdValue.textContent = data.session_id ?? "-";
  expiresAtValue.textContent = formatDate(data.expires_at);
  qrImage.src = data.qr_data_url;
  qrImage.hidden = false;
  emptyState.hidden = true;
}

async function loadCurrentQr() {
  try {
    const response = await fetch("/api/session/current-qr", {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("request_failed");
    }

    const data = await response.json();

    if (data?.status === "active" && data.qr_data_url) {
      renderActiveState(data);
      return;
    }

    if (data?.status === "expired") {
      renderIdleLikeState("expired", data);
      return;
    }

    renderIdleLikeState("idle", data);
  } catch (error) {
    setStatus("error");
    sessionIdValue.textContent = "-";
    expiresAtValue.textContent = "-";
    qrImage.hidden = true;
    qrImage.removeAttribute("src");
    emptyState.hidden = false;
  }
}

function init() {
  void loadCurrentQr();
  window.setInterval(() => {
    void loadCurrentQr();
  }, REFRESH_INTERVAL_MS);
}

init();
