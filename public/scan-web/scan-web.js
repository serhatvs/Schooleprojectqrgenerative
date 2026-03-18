const STORAGE_KEYS = {
  userId: "attendanceScanner.userId",
  deviceInstallId: "attendanceScanner.deviceInstallId",
  deviceInstallPassword: "attendanceScanner.deviceInstallPassword",
};

const RESULT_MESSAGES = {
  success: { text: "Yoklama başarıyla alındı", tone: "success" },
  expired: { text: "Yoklama süresi dolmuş", tone: "warning" },
  duplicate_student: { text: "Zaten yoklama verdiniz", tone: "warning" },
  duplicate_device: { text: "Bu cihaz zaten kullanıldı", tone: "warning" },
  invalid_qr: { text: "Geçersiz bağlantı", tone: "danger" },
  invalid_gallery_qr: { text: "Geçersiz QR", tone: "danger" },
  unreadable_qr: { text: "QR okunamadı", tone: "danger" },
  missing_user_id: { text: "Öğrenci numarası giriniz", tone: "warning" },
  location_required: { text: "Konum izni gerekli", tone: "warning" },
  sending: { text: "Yoklama gönderiliyor...", tone: "idle" },
  getting_location: { text: "Konum alınıyor...", tone: "idle" },
  reading_qr: { text: "QR okunuyor...", tone: "idle" },
  ready: { text: "Yoklama bağlantısı hazır", tone: "idle" },
  gallery_ready: { text: "Devam etmek için galeriden QR seçin", tone: "idle" },
  server_error: { text: "Sunucuya ulaşılamadı", tone: "danger" },
};

const LOCATION_REQUIRED_ERROR = "Konum izni gerekli";
const userIdInput = document.getElementById("user-id-input");
const submitButton = document.getElementById("submit-button");
const resultBanner = document.getElementById("result-banner");
const pageNote = document.getElementById("page-note");
const attendanceForm = document.getElementById("attendance-form");
const galleryButton = document.getElementById("gallery-button");
const galleryInput = document.getElementById("gallery-input");
const galleryHint = document.getElementById("gallery-hint");

let sessionId = "";
let isSubmitting = false;
let isDecoding = false;
let qrDecoder = null;

function createFallbackUuid() {
  const bytes = getRandomBytes(16);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;

  const hex = bytesToHex(bytes);

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function getRandomBytes(length) {
  const bytes = new Uint8Array(length);

  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
    return bytes;
  }

  for (let index = 0; index < length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }

  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getStorageItem(key) {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch (error) {
    return "";
  }
}

function setStorageItem(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.warn("Failed to persist local storage item:", key, error);
  }
}

function ensureDeviceCredentials() {
  let deviceInstallId = getStorageItem(STORAGE_KEYS.deviceInstallId);
  let deviceInstallPassword = getStorageItem(STORAGE_KEYS.deviceInstallPassword);

  if (!deviceInstallId) {
    deviceInstallId =
      typeof window.crypto?.randomUUID === "function"
        ? window.crypto.randomUUID()
        : createFallbackUuid();
    setStorageItem(STORAGE_KEYS.deviceInstallId, deviceInstallId);
  }

  if (!deviceInstallPassword) {
    deviceInstallPassword = bytesToHex(getRandomBytes(16));
    setStorageItem(STORAGE_KEYS.deviceInstallPassword, deviceInstallPassword);
  }

  return {
    deviceInstallId,
    deviceInstallPassword,
  };
}

function loadStoredUserId() {
  const storedUserId = getStorageItem(STORAGE_KEYS.userId);

  if (storedUserId) {
    userIdInput.value = storedUserId;
  }
}

function persistUserId() {
  setStorageItem(STORAGE_KEYS.userId, userIdInput.value.trim());
}

function setResult(message, tone) {
  resultBanner.textContent = message;
  resultBanner.className = `result-banner result-${tone}`;
}

function syncUi() {
  const hasSessionId = Boolean(sessionId);
  const isBusy = isSubmitting || isDecoding;

  userIdInput.disabled = isBusy;
  submitButton.disabled = isBusy || !hasSessionId;
  galleryButton.hidden = hasSessionId;
  galleryHint.hidden = hasSessionId;
  galleryButton.disabled = isBusy || hasSessionId;
}

function getCurrentUserId() {
  return userIdInput.value.trim();
}

function getStatusMessage(status) {
  return RESULT_MESSAGES[status] ?? RESULT_MESSAGES.server_error;
}

function getSessionIdFromQuery() {
  const value = new URLSearchParams(window.location.search).get("session_id");

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function setSessionId(nextSessionId, source) {
  sessionId = nextSessionId;

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("session_id", nextSessionId);
  window.history.replaceState({}, "", nextUrl);

  pageNote.textContent =
    source === "gallery"
      ? "QR çözüldü. Öğrenci numaranızı girip yoklamayı gönderebilirsiniz."
      : "Bağlantı açıldıktan sonra konum izni vererek yoklamanızı gönderebilirsiniz.";

  setResult(RESULT_MESSAGES.ready.text, RESULT_MESSAGES.ready.tone);
  syncUi();
  userIdInput.focus();
}

function extractSessionIdFromUrl(decodedText) {
  try {
    const parsedUrl = new URL(decodedText);
    const parsedSessionId = parsedUrl.searchParams.get("session_id");

    return typeof parsedSessionId === "string" ? parsedSessionId.trim() : "";
  } catch (error) {
    return "";
  }
}

function extractSessionIdFromJson(decodedText) {
  try {
    const parsedJson = JSON.parse(decodedText);

    return typeof parsedJson?.session_id === "string"
      ? parsedJson.session_id.trim()
      : "";
  } catch (error) {
    return "";
  }
}

function extractSessionIdFromDecodedText(decodedText) {
  const normalizedText = typeof decodedText === "string" ? decodedText.trim() : "";

  if (!normalizedText) {
    return { error: RESULT_MESSAGES.unreadable_qr };
  }

  const sessionIdFromUrl = extractSessionIdFromUrl(normalizedText);

  if (sessionIdFromUrl) {
    return { sessionId: sessionIdFromUrl };
  }

  const sessionIdFromJson = extractSessionIdFromJson(normalizedText);

  if (sessionIdFromJson) {
    return { sessionId: sessionIdFromJson };
  }

  return { error: RESULT_MESSAGES.invalid_gallery_qr };
}

async function getQrDecoder() {
  if (!qrDecoder) {
    qrDecoder = new Html5Qrcode("gallery-decoder");
  }

  return qrDecoder;
}

async function decodeQrFromImage(file) {
  const decoder = await getQrDecoder();

  try {
    const decodedText = await decoder.scanFile(file, false);
    return extractSessionIdFromDecodedText(decodedText);
  } catch (error) {
    return { error: RESULT_MESSAGES.unreadable_qr };
  } finally {
    try {
      await decoder.clear();
    } catch (error) {
      // Ignore cleanup errors from scanFile decoding.
    }
  }
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation unavailable"));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  });
}

async function getKonum() {
  try {
    const position = await getCurrentPosition();
    const { latitude, longitude } = position.coords ?? {};

    if (typeof latitude !== "number" || typeof longitude !== "number") {
      throw new Error("Missing coordinates");
    }

    return `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  } catch (error) {
    throw new Error(LOCATION_REQUIRED_ERROR);
  }
}

async function submitAttendanceWithKonum(konum) {
  const { deviceInstallId, deviceInstallPassword } = ensureDeviceCredentials();
  let response;

  try {
    response = await fetch(`${window.location.origin}/api/attendance/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: getCurrentUserId(),
        device_install_id: deviceInstallId,
        device_install_password: deviceInstallPassword,
        scan_time: new Date().toISOString(),
        konum,
        session_id: sessionId,
      }),
    });
  } catch (error) {
    return RESULT_MESSAGES.server_error;
  }

  const data = await response.json().catch(() => ({ status: "server_error" }));

  if (!response.ok) {
    return RESULT_MESSAGES.server_error;
  }

  return getStatusMessage(data?.status);
}

async function handleSubmit(event) {
  event.preventDefault();

  if (isSubmitting || isDecoding || !sessionId) {
    return;
  }

  const userId = getCurrentUserId();

  if (!userId) {
    setResult(
      RESULT_MESSAGES.missing_user_id.text,
      RESULT_MESSAGES.missing_user_id.tone
    );
    userIdInput.focus();
    return;
  }

  persistUserId();
  isSubmitting = true;
  syncUi();
  setResult(
    RESULT_MESSAGES.getting_location.text,
    RESULT_MESSAGES.getting_location.tone
  );

  try {
    const konum = await getKonum();
    setResult(RESULT_MESSAGES.sending.text, RESULT_MESSAGES.sending.tone);
    const outcome = await submitAttendanceWithKonum(konum);
    setResult(outcome.text, outcome.tone);
  } catch (error) {
    if (error instanceof Error && error.message === LOCATION_REQUIRED_ERROR) {
      setResult(
        RESULT_MESSAGES.location_required.text,
        RESULT_MESSAGES.location_required.tone
      );
    } else {
      console.error("Failed to submit attendance:", error);
      setResult(
        RESULT_MESSAGES.server_error.text,
        RESULT_MESSAGES.server_error.tone
      );
    }
  } finally {
    isSubmitting = false;
    syncUi();
  }
}

async function handleGalleryInputChange() {
  const file = galleryInput.files?.[0];

  if (!file || isDecoding || sessionId) {
    return;
  }

  isDecoding = true;
  syncUi();
  setResult(RESULT_MESSAGES.reading_qr.text, RESULT_MESSAGES.reading_qr.tone);

  try {
    const qrResult = await decodeQrFromImage(file);

    if (qrResult.error) {
      setResult(qrResult.error.text, qrResult.error.tone);
      return;
    }

    setSessionId(qrResult.sessionId, "gallery");
  } finally {
    isDecoding = false;
    galleryInput.value = "";
    syncUi();
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/scan-web" })
      .catch((error) => console.warn("Service worker registration failed:", error));
  });
}

function initPage() {
  sessionId = getSessionIdFromQuery();
  loadStoredUserId();
  ensureDeviceCredentials();

  if (!sessionId) {
    pageNote.textContent = "QR kodu ekran görüntüsü alıp galeriden seçebilirsiniz.";
    setResult(
      RESULT_MESSAGES.gallery_ready.text,
      RESULT_MESSAGES.gallery_ready.tone
    );
    syncUi();
    userIdInput.focus();
    return;
  }

  setSessionId(sessionId, "query");
}

function init() {
  userIdInput.addEventListener("input", persistUserId);
  attendanceForm.addEventListener("submit", (event) => {
    void handleSubmit(event);
  });
  galleryButton.addEventListener("click", () => {
    galleryInput.click();
  });
  galleryInput.addEventListener("change", () => {
    void handleGalleryInputChange();
  });

  initPage();
  registerServiceWorker();
}

init();
