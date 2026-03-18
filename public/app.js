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

const dateFormatter = new Intl.DateTimeFormat(undefined, {
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
    "Enter the admin secret to use the Attendance QR Panel."
  );

  if (!enteredSecret || !enteredSecret.trim()) {
    adminSecret = "";
    setPanelMessage(
      "Admin secret required",
      "Refresh the page and enter the admin secret to use the panel."
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
    "Unauthorized",
    "The admin secret is missing or incorrect. Refresh the page and enter the correct secret."
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
  const label = status ? status[0].toUpperCase() + status.slice(1) : "Not started";
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
      "No attendance summary data found."
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
                View
              </button>
              <button
                class="button button-secondary button-small"
                type="button"
                data-action="export-day"
                data-date="${escapeHtml(row.date)}"
              >
                Export
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
      "No monthly summary data found."
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
                View
              </button>
              <button
                class="button button-secondary button-small"
                type="button"
                data-action="export-month"
                data-month="${escapeHtml(row.month)}"
              >
                Export
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
    return buildEmptyTableRow(8, "No attendance records found for this selection.");
  }

  return rows
    .map((row) => {
      const isFlagged = row.is_in_school === false || Boolean(row.flag_reason);
      const inSchoolLabel = row.is_in_school === false ? "No" : "Yes";
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
          <td>${escapeHtml(row.flag_reason ?? "-")}</td>
        </tr>
      `;
    })
    .join("");
}

function renderDetailTables() {
  dailyDetailTitle.textContent = `Daily Detail - ${dashboardState.selectedDate}`;
  monthlyDetailTitle.textContent = `Monthly Detail - ${dashboardState.selectedMonth}`;
  dailyDetailCopy.textContent = `Attendance rows for ${dashboardState.selectedDate}.`;
  monthlyDetailCopy.textContent = `Attendance rows for ${dashboardState.selectedMonth}.`;
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

function expectArrayResult(result, fallbackMessage) {
  const { response, data } = result;

  if (response.status === 403) {
    handleUnauthorized();
    throw new Error("The admin secret is missing or incorrect.");
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

async function loadDailyDetails() {
  const date = dailyDateInput.value || dashboardState.selectedDate;

  if (!date) {
    setDashboardStatus("Select a date first.", "warning");
    return;
  }

  dashboardState.selectedDate = date;
  dailyDateInput.value = date;
  setDashboardStatus(`Loading daily details for ${date}...`, "idle");

  try {
    const result = await requestJson(`/api/attendance/daily-view?date=${date}`);
    dashboardState.dailyDetails = expectArrayResult(
      result,
      "Failed to load daily attendance details."
    );
    renderDashboard();
    setDashboardStatus(`Daily details loaded for ${date}.`, "success");
  } catch (error) {
    dashboardState.dailyDetails = [];
    renderDashboard();
    setDashboardStatus(error.message, "error");
  }
}

async function loadMonthlyDetails() {
  const month = monthlyMonthInput.value || dashboardState.selectedMonth;

  if (!month) {
    setDashboardStatus("Select a month first.", "warning");
    return;
  }

  dashboardState.selectedMonth = month;
  monthlyMonthInput.value = month;
  setDashboardStatus(`Loading monthly details for ${month}...`, "idle");

  try {
    const result = await requestJson(`/api/attendance/monthly-view?month=${month}`);
    dashboardState.monthlyDetails = expectArrayResult(
      result,
      "Failed to load monthly attendance details."
    );
    renderDashboard();
    setDashboardStatus(`Monthly details loaded for ${month}.`, "success");
  } catch (error) {
    dashboardState.monthlyDetails = [];
    renderDashboard();
    setDashboardStatus(error.message, "error");
  }
}

async function loadDashboardSummary() {
  setDashboardStatus("Loading dashboard...", "idle");

  try {
    const [dailySummaryResult, monthlySummaryResult] = await Promise.all([
      requestJson("/api/attendance/daily-summary"),
      requestJson("/api/attendance/monthly-summary"),
    ]);

    dashboardState.dailySummary = expectArrayResult(
      dailySummaryResult,
      "Failed to load daily attendance summary."
    );
    dashboardState.monthlySummary = expectArrayResult(
      monthlySummaryResult,
      "Failed to load monthly attendance summary."
    );
    renderDashboard();
    setDashboardStatus("Dashboard updated.", "success");
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

  const response = await fetch(url, { headers });

  if (response.status === 403) {
    handleUnauthorized();
    throw new Error("The admin secret is missing or incorrect.");
  }

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
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
    setDashboardStatus("Select a date first.", "warning");
    return;
  }

  try {
    setDashboardStatus(`Exporting ${date}...`, "idle");
    await downloadProtectedFile(
      `/api/attendance/daily-export?date=${date}`,
      `attendance_${date}.csv`
    );
    setDashboardStatus(`Daily export ready for ${date}.`, "success");
  } catch (error) {
    setDashboardStatus(error.message, "error");
  }
}

async function exportSelectedMonth(month = dashboardState.selectedMonth) {
  if (!month) {
    setDashboardStatus("Select a month first.", "warning");
    return;
  }

  try {
    setDashboardStatus(`Exporting ${month}...`, "idle");
    await downloadProtectedFile(
      `/api/attendance/monthly-export?month=${month}`,
      `attendance_${month}.csv`
    );
    setDashboardStatus(`Monthly export ready for ${month}.`, "success");
  } catch (error) {
    setDashboardStatus(error.message, "error");
  }
}

async function exportAllAttendance() {
  try {
    setDashboardStatus("Exporting all attendance...", "idle");
    await downloadProtectedFile(
      "/api/attendance/total-export",
      "attendance_total.csv"
    );
    setDashboardStatus("Total attendance export ready.", "success");
  } catch (error) {
    setDashboardStatus(error.message, "error");
  }
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
    setPanelMessage("Panel unavailable", error.message);
    renderSession();
  }

  setDashboardStatus(error.message, "error");
});
