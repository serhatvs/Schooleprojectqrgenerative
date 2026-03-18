const STORAGE_KEYS = {
  userId: "attendanceScanner.userId",
  deviceInstallId: "attendanceScanner.deviceInstallId",
  deviceInstallPassword: "attendanceScanner.deviceInstallPassword",
};

const RESULT_MESSAGES = {
  success: { text: "Yoklama basariyla alindi", tone: "success" },
  expired: { text: "Yoklama suresi dolmus", tone: "warning" },
  duplicate_student: { text: "Zaten yoklama verdiniz", tone: "warning" },
  duplicate_device: { text: "Bu cihaz zaten kullanildi", tone: "warning" },
  invalid_qr: { text: "Gecersiz QR", tone: "danger" },
  unreadable_qr: { text: "QR okunamadi", tone: "danger" },
  missing_user_id: { text: "Ogrenci numarasi giriniz", tone: "warning" },
  location_required: { text: "Konum izni gerekli", tone: "warning" },
  camera_error: { text: "Kamera acilamadi", tone: "danger" },
  server_error: { text: "Sunucuya ulasilamadi", tone: "danger" },
  ready: { text: "Tarayici hazir.", tone: "idle" },
  starting: { text: "Kamera baslatiliyor...", tone: "idle" },
  getting_location: { text: "Konum aliniyor...", tone: "idle" },
};

const RESUME_DELAY_MS = 3000;
const scannerReader = document.getElementById("scanner-reader");
const scannerPlaceholder = document.getElementById("scanner-placeholder");
const startButton = document.getElementById("start-button");
const userIdInput = document.getElementById("user-id-input");
const resultBanner = document.getElementById("result-banner");

let scanner = null;
let isScannerRunning = false;
let isProcessing = false;
let resumeTimer = null;
let shouldAutoResume = false;

function syncStartButton() {
  startButton.disabled = isScannerRunning;
}

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

function setScannerVisible(isVisible) {
  scannerReader.hidden = !isVisible;
  scannerPlaceholder.hidden = isVisible;
}

function setResult(message, tone) {
  resultBanner.textContent = message;
  resultBanner.className = `result-banner result-${tone}`;
}

function clearResumeTimer() {
  if (resumeTimer) {
    window.clearTimeout(resumeTimer);
    resumeTimer = null;
  }
}

function getCurrentUserId() {
  return userIdInput.value.trim();
}

function getStatusMessage(status) {
  return RESULT_MESSAGES[status] ?? RESULT_MESSAGES.server_error;
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
    throw new Error("Konum izni gerekli");
  }
}

function extractSessionIdFromQr(decodedText) {
  let parsedQr;

  try {
    parsedQr = JSON.parse(decodedText);
  } catch (error) {
    return { error: RESULT_MESSAGES.unreadable_qr };
  }

  if (typeof parsedQr?.session_id !== "string" || !parsedQr.session_id.trim()) {
    return { error: RESULT_MESSAGES.invalid_qr };
  }

  return { sessionId: parsedQr.session_id.trim() };
}

async function stopScanner() {
  clearResumeTimer();

  if (!scanner || !isScannerRunning) {
    setScannerVisible(false);
    syncStartButton();
    return;
  }

  try {
    await scanner.stop();
  } catch (error) {
    console.warn("Failed to stop scanner cleanly:", error);
  } finally {
    isScannerRunning = false;
    setScannerVisible(false);
    syncStartButton();
  }
}

function chooseCamera(cameras) {
  if (!Array.isArray(cameras) || cameras.length === 0) {
    return null;
  }

  const preferredCamera = cameras.find((camera) =>
    /back|rear|environment/i.test(camera.label)
  );

  return preferredCamera?.id ?? cameras[0].id;
}

async function startScanner() {
  if (isScannerRunning || isProcessing) {
    return;
  }

  const currentUserId = getCurrentUserId();

  if (!currentUserId) {
    setResult(
      RESULT_MESSAGES.missing_user_id.text,
      RESULT_MESSAGES.missing_user_id.tone
    );
    userIdInput.focus();
    return;
  }

  persistUserId();
  ensureDeviceCredentials();
  clearResumeTimer();
  shouldAutoResume = true;
  startButton.disabled = true;
  setResult(RESULT_MESSAGES.starting.text, RESULT_MESSAGES.starting.tone);

  if (!scanner) {
    scanner = new Html5Qrcode("scanner-reader");
  }

  try {
    setScannerVisible(true);

    try {
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 220, height: 220 },
          aspectRatio: 1,
        },
        handleScanSuccess,
        () => {}
      );
    } catch (primaryError) {
      const cameras = await Html5Qrcode.getCameras();
      const cameraId = chooseCamera(cameras);

      if (!cameraId) {
        throw primaryError;
      }

      await scanner.start(
        cameraId,
        {
          fps: 10,
          qrbox: { width: 220, height: 220 },
          aspectRatio: 1,
        },
        handleScanSuccess,
        () => {}
      );
    }

    isScannerRunning = true;
    syncStartButton();
    setResult(RESULT_MESSAGES.ready.text, RESULT_MESSAGES.ready.tone);
  } catch (error) {
    console.error("Failed to start scanner:", error);
    shouldAutoResume = false;
    isScannerRunning = false;
    setScannerVisible(false);
    syncStartButton();
    setResult(RESULT_MESSAGES.camera_error.text, RESULT_MESSAGES.camera_error.tone);
  } finally {
    syncStartButton();
  }
}

function resumeScanningSoon() {
  clearResumeTimer();

  if (!shouldAutoResume) {
    isProcessing = false;
    return;
  }

  resumeTimer = window.setTimeout(async () => {
    if (document.hidden) {
      isProcessing = false;
      return;
    }

    isProcessing = false;
    await startScanner();
  }, RESUME_DELAY_MS);
}

async function submitAttendance(sessionId) {
  const { deviceInstallId, deviceInstallPassword } = ensureDeviceCredentials();
  const konum = await getKonum();

  const response = await fetch(`${window.location.origin}/api/attendance/scan`, {
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

  const data = await response
    .json()
    .catch(() => ({ status: "server_error" }));

  if (!response.ok) {
    return RESULT_MESSAGES.server_error;
  }

  return getStatusMessage(data?.status);
}

async function processDecodedText(decodedText) {
  await stopScanner();

  const userId = getCurrentUserId();

  if (!userId) {
    setResult(
      RESULT_MESSAGES.missing_user_id.text,
      RESULT_MESSAGES.missing_user_id.tone
    );
    resumeScanningSoon();
    return;
  }

  const qrResult = extractSessionIdFromQr(decodedText);

  if (qrResult.error) {
    setResult(qrResult.error.text, qrResult.error.tone);
    resumeScanningSoon();
    return;
  }

  try {
    setResult(
      RESULT_MESSAGES.getting_location.text,
      RESULT_MESSAGES.getting_location.tone
    );
    const outcome = await submitAttendance(qrResult.sessionId);
    setResult(outcome.text, outcome.tone);
  } catch (error) {
    if (error instanceof Error && error.message === "Konum izni gerekli") {
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
  }

  resumeScanningSoon();
}

function handleScanSuccess(decodedText) {
  if (isProcessing) {
    return;
  }

  isProcessing = true;
  void processDecodedText(decodedText);
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

function handleVisibilityChange() {
  if (!document.hidden || !shouldAutoResume || isProcessing || isScannerRunning) {
    return;
  }

  void startScanner();
}

function handlePageHide() {
  shouldAutoResume = false;
  void stopScanner();
}

function init() {
  loadStoredUserId();
  ensureDeviceCredentials();
  setResult(RESULT_MESSAGES.ready.text, RESULT_MESSAGES.ready.tone);
  syncStartButton();

  userIdInput.addEventListener("input", persistUserId);
  startButton.addEventListener("click", () => {
    void startScanner();
  });
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("pagehide", handlePageHide);

  registerServiceWorker();
}

init();
