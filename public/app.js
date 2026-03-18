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
const dashboardStatus = document.getElementById("dashboard-status");
const todayAttendanceValue = document.getElementById("today-attendance-value");
const todaySessionValue = document.getElementById("today-session-value");
const totalAttendanceValue = document.getElementById("total-attendance-value");
const flaggedAttendanceValue = document.getElementById("flagged-attendance-value");
const dailyDateInput = document.getElementById("daily-date-input");
const monthlyMonthInput = document.getElementById("monthly-month-input");
const dailyViewButton = document.getElementById("daily-view-button");
const dailyExportButton = document.getElementById("daily-export-button");
const monthlyViewButton = document.getElementById("monthly-view-button");
const monthlyExportButton = document.getElementById("monthly-export-button");
const totalExportButton = document.getElementById("total-export-button");
const dailySummaryBody = document.getElementById("daily-summary-body");
const monthlySummaryBody = document.getElementById("monthly-summary-body");
const dailyDetailBody = document.getElementById("daily-detail-body");
const monthlyDetailBody = document.getElementById("monthly-detail-body");
const dailyDetailTitle = document.getElementById("daily-detail-title");
const monthlyDetailTitle = document.getElementById("monthly-detail-title");
const dailyDetailCopy = document.getElementById("daily-detail-copy");
const monthlyDetailCopy = document.getElementById("monthly-detail-copy");

let currentSession = null;
let adminSecret =
  typeof window.__ADMIN_SECRET === "string" ? window.__ADMIN_SECRET.trim() : "";
let panelMessage = null;

const dashboardState = {
  dailySummary: [],
  monthlySummary: [],
  dailyDetails: [],
  monthlyDetails: [],
  selectedDate: getTurkeyDateString(),
  selectedMonth: getTurkeyMonthString(),
};

const SESSION_STATUS_LABELS = {
  active: "Açık",
  expired: "Süresi Doldu",
  ended: "Kapatıldı",
};

const ERROR_MESSAGE_MAP = {
  invalid_date: "Geçerli bir tarih seçin.",
  invalid_month: "Geçerli bir ay seçin.",
  unauthorized: "Yönetici şifresi eksik veya hatalı.",
  forbidden: "Yönetici şifresi eksik veya hatalı.",
  server_error: "İşlem şu anda tamamlanamadı.",
};

const dateFormatter = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "medium",
  timeStyle: "medium",
});

function getTurkeyDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  return values;
}

function getTurkeyDateString(date = new Date()) {
  const parts = getTurkeyDateParts(date);

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getTurkeyMonthString(date = new Date()) {
  return getTurkeyDateString(date).slice(0, 7);
}

function getUserMessage(message, fallbackMessage) {
  if (typeof message !== "string" || !message.trim()) {
    return fallbackMessage;
  }

  return ERROR_MESSAGE_MAP[message] ?? fallbackMessage;
}

function formatFlagReason(value) {
  if (!value) {
    return "-";
  }

  if (value === "out_of_school") {
    return "Kampüs Dışı";
  }

  return "Şüpheli";
}

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

function resetDashboardState() {
  dashboardState.dailySummary = [];
  dashboardState.monthlySummary = [];
  dashboardState.dailyDetails = [];
  dashboardState.monthlyDetails = [];
}

function ensureAdminSecret() {
  if (adminSecret) {
    return true;
  }

  const enteredSecret = window.prompt(
    "Yoklama ekranını açmak için yönetici şifresini girin."
  );

  if (!enteredSecret || !enteredSecret.trim()) {
    adminSecret = "";
    setPanelMessage(
      "Yönetici şifresi gerekli",
      "Sayfayı yenileyip yönetici şifresini girin."
    );
    renderSession();
    renderDashboard();
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
  resetDashboardState();
  setPanelMessage(
    "Yetkisiz erişim",
    "Yönetici şifresi eksik veya hatalı. Sayfayı yenileyip doğru şifreyi girin."
  );
  renderSession();
  renderDashboard();
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return dateFormatter.format(new Date(value));
}

function formatDistance(value) {
  if (value == null || value === "") {
    return "-";
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "-";
  }

  return `${numericValue.toFixed(1)} m`;
}

function formatCount(value) {
  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue.toLocaleString() : "0";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setStatus(status) {
  const label = status ? (SESSION_STATUS_LABELS[status] ?? status) : "Henüz Başlatılmadı";
  statusBadge.textContent = label;
  statusBadge.className = `status-badge ${
    status ? `status-${status}` : "status-idle"
  }`;
}

function setDashboardStatus(message, tone = "idle") {
  dashboardStatus.textContent = message;
  dashboardStatus.className = `dashboard-status dashboard-status-${tone}`;
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
      placeholderTitle.textContent = "Henüz aktif yoklama yok";
      placeholderCopy.textContent = "QR kod oluşturmak için yoklama başlatın.";
    } else if (currentSession.status === "expired") {
      placeholderTitle.textContent = "Yoklamanın süresi doldu";
      placeholderCopy.textContent =
        "Bu QR kod artık geçerli değil. Yeni bir yoklama başlatıp yeni kod oluşturun.";
    } else {
      placeholderTitle.textContent = "Yoklama kapalı";
      placeholderCopy.textContent =
        "Hazır olduğunuzda yeni bir yoklama başlatın.";
    }
  }

  startButton.disabled = !adminSecret;
  endButton.disabled = !adminSecret || !isActive;
}

function getTodaySummary() {
  return (
    dashboardState.dailySummary.find((row) => row.date === getTurkeyDateString()) ??
    null
  );
}

function updateOverviewCards() {
  const todaySummary = getTodaySummary();
  const totalAttendance = dashboardState.dailySummary.reduce(
    (total, row) => total + Number(row.attendance_count ?? 0),
    0
  );
  const totalFlagged = dashboardState.dailySummary.reduce(
    (total, row) => total + Number(row.flagged_count ?? 0),
    0
  );

  todayAttendanceValue.textContent = formatCount(todaySummary?.attendance_count);
  todaySessionValue.textContent = formatCount(todaySummary?.session_count);
  totalAttendanceValue.textContent = formatCount(totalAttendance);
  flaggedAttendanceValue.textContent = formatCount(totalFlagged);
}

function buildEmptyTableRow(columnCount, message) {
  return `
    <tr>
      <td colspan="${columnCount}" class="table-empty">${escapeHtml(message)}</td>
    </tr>
  `;
}

function renderDailySummaryTable() {
  if (dashboardState.dailySummary.length === 0) {
    dailySummaryBody.innerHTML = buildEmptyTableRow(
      5,
      "Günlük özet kaydı bulunamadı."
    );
    return;
  }

  dailySummaryBody.innerHTML = dashboardState.dailySummary
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.date)}</td>
          <td>${formatCount(row.session_count)}</td>
          <td>${formatCount(row.attendance_count)}</td>
          <td>${formatCount(row.flagged_count)}</td>
          <td>
            <div class="table-actions">
              <button
                class="button button-secondary button-small"
                type="button"
                data-action="view-day"
                data-date="${escapeHtml(row.date)}"
              >
                Görüntüle
              </button>
              <button
                class="button button-secondary button-small"
                type="button"
                data-action="export-day"
                data-date="${escapeHtml(row.date)}"
              >
                Excel'e Aktar
              </button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");
}

function renderMonthlySummaryTable() {
  if (dashboardState.monthlySummary.length === 0) {
    monthlySummaryBody.innerHTML = buildEmptyTableRow(
      5,
      "Aylık özet kaydı bulunamadı."
    );
    return;
  }

  monthlySummaryBody.innerHTML = dashboardState.monthlySummary
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.month)}</td>
          <td>${formatCount(row.session_count)}</td>
          <td>${formatCount(row.attendance_count)}</td>
          <td>${formatCount(row.flagged_count)}</td>
          <td>
            <div class="table-actions">
              <button
                class="button button-secondary button-small"
                type="button"
                data-action="view-month"
                data-month="${escapeHtml(row.month)}"
              >
                Görüntüle
              </button>
              <button
                class="button button-secondary button-small"
                type="button"
                data-action="export-month"
                data-month="${escapeHtml(row.month)}"
              >
                Excel'e Aktar
              </button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");
}

function buildDetailRows(rows) {
  if (rows.length === 0) {
    return buildEmptyTableRow(8, "Bu seçim için yoklama kaydı bulunamadı.");
  }

  return rows
    .map((row) => {
      const isFlagged = row.is_in_school === false || Boolean(row.flag_reason);
      const inSchoolLabel = row.is_in_school === false ? "Hayır" : "Evet";
      const badgeClass = row.is_in_school === false ? "pill-flagged" : "pill-ok";

      return `
        <tr class="${isFlagged ? "data-row-flagged" : ""}">
          <td>${escapeHtml(row.user_id)}</td>
          <td>${escapeHtml(row.session_id)}</td>
          <td>${escapeHtml(row.scan_time)}</td>
          <td>${escapeHtml(row.created_at)}</td>
          <td>${escapeHtml(row.konum)}</td>
          <td><span class="pill ${badgeClass}">${inSchoolLabel}</span></td>
          <td>${escapeHtml(formatDistance(row.distance_meters))}</td>
          <td>${escapeHtml(formatFlagReason(row.flag_reason))}</td>
        </tr>
      `;
    })
    .join("");
}

function renderDetailTables() {
  dailyDetailTitle.textContent = `Günlük Kayıtlar - ${dashboardState.selectedDate}`;
  monthlyDetailTitle.textContent = `Aylık Kayıtlar - ${dashboardState.selectedMonth}`;
  dailyDetailCopy.textContent = `${dashboardState.selectedDate} günü için yoklama kayıtları.`;
  monthlyDetailCopy.textContent = `${dashboardState.selectedMonth} ayı için yoklama kayıtları.`;
  dailyDetailBody.innerHTML = buildDetailRows(dashboardState.dailyDetails);
  monthlyDetailBody.innerHTML = buildDetailRows(dashboardState.monthlyDetails);
}

function renderDashboard() {
  dailyDateInput.value = dashboardState.selectedDate;
  monthlyMonthInput.value = dashboardState.selectedMonth;
  updateOverviewCards();
  renderDailySummaryTable();
  renderMonthlySummaryTable();
  renderDetailTables();
}

async function requestJson(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (adminSecret) {
    headers["x-admin-secret"] = adminSecret;
  }

  let response;

  try {
    response = await fetch(url, {
      ...options,
      headers,
    });
  } catch (error) {
    throw new Error("Sunucuya ulaşılamadı.");
  }

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
    return "Yönetici şifresi eksik veya hatalı.";
  }

  if (typeof data?.error === "string") {
    return getUserMessage(data.error, fallbackMessage);
  }

  return fallbackMessage;
}

function expectArrayResult(result, fallbackMessage) {
  const { response, data } = result;

  if (response.status === 403) {
    handleUnauthorized();
    throw new Error("Yönetici şifresi eksik veya hatalı.");
  }

  if (!response.ok) {
    throw new Error(getErrorMessage(response, data, fallbackMessage));
  }

  return Array.isArray(data) ? data : [];
}

async function loadSession() {
  const { response, data } = await requestJson("/api/session");

  if (response.status === 403) {
    handleUnauthorized();
    return;
  }

  if (!response.ok) {
    throw new Error(getErrorMessage(response, data, "Yoklama bilgileri alınamadı."));
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
      "Açık bir yoklama var. Yeni yoklama ile değiştirmek ister misiniz?"
    );

    if (confirmed) {
      return startSession(true);
    }

    return;
  }

  if (!response.ok) {
    throw new Error(getErrorMessage(response, data, "Yoklama başlatılamadı."));
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
    throw new Error(getErrorMessage(response, data, "Yoklama bitirilemedi."));
  }

  clearPanelMessage();
  currentSession = data;
  renderSession();
}

async function loadDailyDetails() {
  const date = dailyDateInput.value || dashboardState.selectedDate;

  if (!date) {
    setDashboardStatus("Önce bir gün seçin.", "warning");
    return;
  }

  dashboardState.selectedDate = date;
  dailyDateInput.value = date;
  setDashboardStatus(`${date} günü için kayıtlar yükleniyor...`, "idle");

  try {
    const result = await requestJson(`/api/attendance/daily-view?date=${date}`);
    dashboardState.dailyDetails = expectArrayResult(
      result,
      "Günlük kayıtlar alınamadı."
    );
    renderDashboard();
    setDashboardStatus(`${date} günü için kayıtlar hazır.`, "success");
  } catch (error) {
    dashboardState.dailyDetails = [];
    renderDashboard();
    setDashboardStatus(error.message, "error");
  }
}

async function loadMonthlyDetails() {
  const month = monthlyMonthInput.value || dashboardState.selectedMonth;

  if (!month) {
    setDashboardStatus("Önce bir ay seçin.", "warning");
    return;
  }

  dashboardState.selectedMonth = month;
  monthlyMonthInput.value = month;
  setDashboardStatus(`${month} ayı için kayıtlar yükleniyor...`, "idle");

  try {
    const result = await requestJson(`/api/attendance/monthly-view?month=${month}`);
    dashboardState.monthlyDetails = expectArrayResult(
      result,
      "Aylık kayıtlar alınamadı."
    );
    renderDashboard();
    setDashboardStatus(`${month} ayı için kayıtlar hazır.`, "success");
  } catch (error) {
    dashboardState.monthlyDetails = [];
    renderDashboard();
    setDashboardStatus(error.message, "error");
  }
}

async function loadDashboardSummary() {
  setDashboardStatus("Yoklama kayıtları yükleniyor...", "idle");

  try {
    const [dailySummaryResult, monthlySummaryResult] = await Promise.all([
      requestJson("/api/attendance/daily-summary"),
      requestJson("/api/attendance/monthly-summary"),
    ]);

    dashboardState.dailySummary = expectArrayResult(
      dailySummaryResult,
      "Günlük özet alınamadı."
    );
    dashboardState.monthlySummary = expectArrayResult(
      monthlySummaryResult,
      "Aylık özet alınamadı."
    );
    renderDashboard();
    setDashboardStatus("Yoklama kayıtları güncellendi.", "success");
  } catch (error) {
    dashboardState.dailySummary = [];
    dashboardState.monthlySummary = [];
    renderDashboard();
    setDashboardStatus(error.message, "error");
  }
}

async function loadDashboard() {
  await loadDashboardSummary();
  await Promise.all([loadDailyDetails(), loadMonthlyDetails()]);
}

function getDownloadFilename(response, fallbackName) {
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="?([^"]+)"?/i);

  return match?.[1] ?? fallbackName;
}

async function downloadProtectedFile(url, fallbackName) {
  const headers = {};

  if (adminSecret) {
    headers["x-admin-secret"] = adminSecret;
  }

  let response;

  try {
    response = await fetch(url, { headers });
  } catch (error) {
    throw new Error("Sunucuya ulaşılamadı.");
  }

  if (response.status === 403) {
    handleUnauthorized();
    throw new Error("Yönetici şifresi eksik veya hatalı.");
  }

  if (!response.ok) {
    let errorMessage = "Dosya hazırlanamadı.";

    try {
      const data = await response.clone().json();
      if (typeof data?.error === "string") {
        errorMessage = getUserMessage(data.error, errorMessage);
      }
    } catch (error) {
      errorMessage = "Dosya hazırlanamadı.";
    }

    throw new Error(errorMessage);
  }

  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = getDownloadFilename(response, fallbackName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 1000);
}

async function exportSelectedDay(date = dashboardState.selectedDate) {
  if (!date) {
    setDashboardStatus("Önce bir gün seçin.", "warning");
    return;
  }

  try {
    setDashboardStatus(`${date} günü için Excel dosyası hazırlanıyor...`, "idle");
    await downloadProtectedFile(
      `/api/attendance/daily-export-xlsx?date=${date}`,
      `attendance_${date}.xlsx`
    );
    setDashboardStatus(`${date} günü için Excel dosyası hazır.`, "success");
  } catch (error) {
    setDashboardStatus(error.message, "error");
  }
}

async function exportSelectedMonth(month = dashboardState.selectedMonth) {
  if (!month) {
    setDashboardStatus("Önce bir ay seçin.", "warning");
    return;
  }

  try {
    setDashboardStatus(`${month} ayı için Excel dosyası hazırlanıyor...`, "idle");
    await downloadProtectedFile(
      `/api/attendance/monthly-export-xlsx?month=${month}`,
      `attendance_${month}.xlsx`
    );
    setDashboardStatus(`${month} ayı için Excel dosyası hazır.`, "success");
  } catch (error) {
    setDashboardStatus(error.message, "error");
  }
}

async function exportAllAttendance() {
  try {
    setDashboardStatus("Tüm kayıtlar için Excel dosyası hazırlanıyor...", "idle");
    await downloadProtectedFile(
      "/api/attendance/total-export-xlsx",
      "attendance_all.xlsx"
    );
    setDashboardStatus("Tüm kayıtlar için Excel dosyası hazır.", "success");
  } catch (error) {
    setDashboardStatus(error.message, "error");
  }
}

startButton.addEventListener("click", async () => {
  if (!adminSecret) {
    setPanelMessage(
      "Yönetici şifresi gerekli",
      "Sayfayı yenileyip yönetici şifresini girin."
    );
    renderSession();
    return;
  }

  startButton.disabled = true;

  try {
    if (currentSession?.active) {
      const confirmed = window.confirm(
        "Açık bir yoklama var. Yeni yoklama ile değiştirmek ister misiniz?"
      );

      if (!confirmed) {
        return;
      }

      await startSession(true);
    } else {
      await startSession(false);
    }
  } catch (error) {
    if (adminSecret) {
      window.alert(error.message);
    }
  } finally {
    renderSession();
    void loadDashboard();
  }
});

endButton.addEventListener("click", async () => {
  if (!adminSecret) {
    setPanelMessage(
      "Yönetici şifresi gerekli",
      "Sayfayı yenileyip yönetici şifresini girin."
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
    void loadDashboard();
  }
});

dailyViewButton.addEventListener("click", () => {
  void loadDailyDetails();
});

monthlyViewButton.addEventListener("click", () => {
  void loadMonthlyDetails();
});

dailyExportButton.addEventListener("click", () => {
  void exportSelectedDay(dailyDateInput.value || dashboardState.selectedDate);
});

monthlyExportButton.addEventListener("click", () => {
  void exportSelectedMonth(monthlyMonthInput.value || dashboardState.selectedMonth);
});

totalExportButton.addEventListener("click", () => {
  void exportAllAttendance();
});

dailySummaryBody.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action][data-date]");

  if (!button) {
    return;
  }

  const { action, date } = button.dataset;

  if (!date) {
    return;
  }

  dashboardState.selectedDate = date;
  dailyDateInput.value = date;

  if (action === "view-day") {
    void loadDailyDetails();
  } else if (action === "export-day") {
    void exportSelectedDay(date);
  }
});

monthlySummaryBody.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action][data-month]");

  if (!button) {
    return;
  }

  const { action, month } = button.dataset;

  if (!month) {
    return;
  }

  dashboardState.selectedMonth = month;
  monthlyMonthInput.value = month;

  if (action === "view-month") {
    void loadMonthlyDetails();
  } else if (action === "export-month") {
    void exportSelectedMonth(month);
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
  dashboardState.selectedDate = getTurkeyDateString();
  dashboardState.selectedMonth = getTurkeyMonthString();
  dailyDateInput.value = dashboardState.selectedDate;
  monthlyMonthInput.value = dashboardState.selectedMonth;
  renderDashboard();

  if (!ensureAdminSecret()) {
    return;
  }

  await Promise.all([loadSession(), loadDashboard()]);
}

initializePanel().catch((error) => {
  if (!panelMessage) {
    setPanelMessage(
      "Ekran açılamadı",
      "Yoklama ekranı şu anda açılamıyor. Lütfen tekrar deneyin."
    );
    renderSession();
  }

  setDashboardStatus("Yoklama ekranı şu anda açılamıyor.", "error");
});
