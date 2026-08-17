function readStoredObject(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const WORKSPACE_CONTEXT_KEY = "bugmega_workspace_context";
const AUTH_ACCESS_KEY = "bugmega_access";
const AUTH_REFRESH_KEY = "bugmega_refresh";
const AUTH_REMEMBER_KEY = "bugmega_remember_me";

function readStoredToken(key) {
  return localStorage.getItem(key) || sessionStorage.getItem(key) || "";
}

function authRememberPreference() {
  const saved = localStorage.getItem(AUTH_REMEMBER_KEY);
  if (saved === "1") return true;
  if (saved === "0") return false;
  if (localStorage.getItem(AUTH_ACCESS_KEY) || localStorage.getItem(AUTH_REFRESH_KEY)) return true;
  if (sessionStorage.getItem(AUTH_ACCESS_KEY) || sessionStorage.getItem(AUTH_REFRESH_KEY)) return false;
  return true;
}

function clearStoredTokens() {
  localStorage.removeItem(AUTH_ACCESS_KEY);
  localStorage.removeItem(AUTH_REFRESH_KEY);
  sessionStorage.removeItem(AUTH_ACCESS_KEY);
  sessionStorage.removeItem(AUTH_REFRESH_KEY);
}

const state = {
  access: readStoredToken(AUTH_ACCESS_KEY),
  refresh: readStoredToken(AUTH_REFRESH_KEY),
  me: null,
  team: null,
  personalTeam: null,
  companyAccess: null,
  companyAccesses: [],
  membership: null,
  workspaceContext: localStorage.getItem(WORKSPACE_CONTEXT_KEY) || "personal",
  platformSettings: null,
  unreadCommentCount: 0,
  unreadNotificationCount: 0,
  activeTimer: null,
  timerTick: null,
  notificationPoll: null,
  notificationPollBusy: false,
  livePoll: null,
  livePollBusy: false,
  liveSocket: null,
  liveReconnectTimer: null,
  liveRefreshTimer: null,
  liveReconnectDelay: 1500,
  sessionCookieSynced: false,
  adminUsersRefreshTimer: null,
  liveTaskSignature: "",
  liveWebsiteSignature: "",
  liveInboxSignature: "",
  chatSocket: null,
  supportSocket: null,
  chatReply: null,
  supportReply: null,
  mentionUsers: null,
  mentionTarget: null,
  mentionToken: null,
  mentionActiveIndex: 0,
  clientProjects: [],
  clientWebsites: [],
  projectSidebarOpen: readStoredObject("bugmega_project_sidebar_open"),
  sidebarCollapsed: localStorage.getItem("bugmega_sidebar_collapsed") === "1",
  dropdownDismissBound: false,
  commandSearchDismissBound: false,
  commandSearchTimer: null,
  commandSearchAbort: null,
  commandSearchResults: [],
  appNavigationBound: false,
  routeLoadingTimer: null,
  routeNavigationToken: 0,
  purchaseCart: null,
  clientTaskReply: null,
  clientTaskCommentEdit: null,
};

const app = document.getElementById("app");
const path = () => window.location.pathname;
const $ = (selector) => document.querySelector(selector);
const selectorEscape = (value) => (window.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/"/g, '\\"'));

function icon(name) {
  return `<i data-lucide="${name}"></i>`;
}

function icons() {
  if (window.lucide) lucide.createIcons();
}

window.addEventListener("load", icons);

function syncTaskPanelOffset() {
  const topbar = $(".topbar");
  const sidebar = $(".workspace-nav");
  const fallback = 68;
  const rect = topbar?.getBoundingClientRect?.();
  const topbarHeight = topbar ? Math.ceil(topbar.offsetHeight || rect?.height || fallback) : fallback;
  const topbarBottom = rect ? Math.ceil(rect.bottom) : topbarHeight;
  const offset = Math.max(fallback, topbarHeight, topbarBottom);
  const sidebarRect = sidebar?.getBoundingClientRect?.();
  const sidebarRight = sidebarRect && window.matchMedia("(min-width: 981px)").matches ? Math.max(0, Math.ceil(sidebarRect.right)) : 0;
  document.documentElement.style.setProperty("--task-panel-top-offset", `${offset}px`);
  document.documentElement.style.setProperty("--active-sidebar-width", `${sidebarRight}px`);
  document.body.style.setProperty("--active-sidebar-width", `${sidebarRight}px`);
}

window.addEventListener("resize", syncTaskPanelOffset);
window.addEventListener("load", syncTaskPanelOffset);

function routeLoadingHTML(label = "Loading page...") {
  return `
    <div class="route-loading-overlay" data-route-loading role="status" aria-live="polite">
      <div class="route-loading-card">
        <span class="route-loading-spinner" aria-hidden="true"></span>
        <span>${esc(label)}</span>
      </div>
    </div>`;
}

function showRouteLoading(label = "Loading page...", immediate = false) {
  clearTimeout(state.routeLoadingTimer);
  const draw = () => {
    if (document.querySelector("[data-route-loading]")) return;
    document.body.insertAdjacentHTML("beforeend", routeLoadingHTML(label));
  };
  if (immediate) draw();
  else state.routeLoadingTimer = setTimeout(draw, 120);
}

function hideRouteLoading() {
  clearTimeout(state.routeLoadingTimer);
  state.routeLoadingTimer = null;
  document.querySelectorAll("[data-route-loading]").forEach((node) => node.remove());
}

const loadingButtonStates = new WeakMap();

function setButtonLoading(button, loading = true, label = "Working...") {
  if (!button) return () => {};
  if (loading) {
    if (!loadingButtonStates.has(button)) {
      loadingButtonStates.set(button, {
        html: button.innerHTML,
        disabled: button.disabled,
        ariaBusy: button.getAttribute("aria-busy"),
      });
    }
    button.disabled = true;
    button.classList.add("is-loading");
    button.setAttribute("aria-busy", "true");
    button.innerHTML = `<span class="inline-spinner" aria-hidden="true"></span><span>${esc(label)}</span>`;
    return () => setButtonLoading(button, false);
  }
  const previous = loadingButtonStates.get(button);
  if (!previous) return () => {};
  button.innerHTML = previous.html;
  button.disabled = previous.disabled;
  if (previous.ariaBusy == null) button.removeAttribute("aria-busy");
  else button.setAttribute("aria-busy", previous.ariaBusy);
  button.classList.remove("is-loading");
  loadingButtonStates.delete(button);
  icons();
  return () => {};
}

function beginFormLoading(form, submitter, message = "Working...", buttonLabel = "Working...") {
  setFormStatus(form, message);
  form?.classList.add("is-loading");
  form?.setAttribute("aria-busy", "true");
  const button = submitter?.matches?.("button") ? submitter : form?.querySelector("button[type='submit']");
  const stopButton = setButtonLoading(button, true, buttonLabel);
  return () => {
    stopButton();
    form?.classList.remove("is-loading");
    form?.removeAttribute("aria-busy");
  };
}

function setTaskPanelActive(active) {
  document.documentElement.classList.toggle("task-panel-active", Boolean(active));
  document.body.classList.toggle("task-panel-active", Boolean(active));
  if (active) requestAnimationFrame(syncTaskPanelOffset);
}

function closeClientTaskPanel(panel = $("#clientTaskPanel")) {
  panel?.remove();
  setTaskPanelActive(false);
  document.body.classList.remove("annotation-viewer-open");
  state.clientTaskReply = null;
  state.clientTaskCommentEdit = null;
}

function showClientTaskPanelLoading(label = "Opening task...") {
  setTaskPanelActive(true);
  document.body.classList.remove("annotation-viewer-open");
  let panel = $("#clientTaskPanel");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "clientTaskPanel";
    document.body.appendChild(panel);
  }
  panel.className = "client-task-panel task-panel-loading";
  panel.innerHTML = `<div class="task-panel-loader" role="status" aria-live="polite">
    <span class="inline-spinner" aria-hidden="true"></span>
    <span>${esc(label)}</span>
  </div>`;
}

function showClientTaskPanelError(message = "Could not open task.") {
  setTaskPanelActive(true);
  let panel = $("#clientTaskPanel");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "clientTaskPanel";
    document.body.appendChild(panel);
  }
  panel.className = "client-task-panel task-panel-loading";
  panel.innerHTML = `<div class="task-panel-loader task-panel-error">
    <strong>Could not open task</strong>
    <span>${esc(message)}</span>
    <button class="btn compact" type="button" data-close-client-task>${icon("x")}Close</button>
  </div>`;
  panel.querySelector("[data-close-client-task]")?.addEventListener("click", () => closeClientTaskPanel(panel));
  icons();
}

async function openClientTaskWithProgress(taskID, focusCommentID = "", trigger = null) {
  if (!taskID) return;
  const stopButton = setButtonLoading(trigger, true, "Opening...");
  showClientTaskPanelLoading();
  try {
    await openClientTaskPanel(taskID, focusCommentID);
  } catch (error) {
    showClientTaskPanelError(error.message);
  } finally {
    stopButton();
  }
}

function beginRouteTransition(options = {}) {
  state.routeNavigationToken += 1;
  const token = state.routeNavigationToken;
  if (options.loader !== false) showRouteLoading(options.label || "Loading page...");
  return token;
}

function finishRouteTransition(token) {
  if (state.routeNavigationToken === token) hideRouteLoading();
}

const QR_VERSION = 10;
const QR_SIZE = QR_VERSION * 4 + 17;
const QR_QUIET_ZONE = 4;
const QR_DATA_BLOCKS = [68, 68, 69, 69];
const QR_ECC_CODEWORDS = 18;

function qrGFMultiply(x, y) {
  let product = 0;
  for (let i = 7; i >= 0; i--) {
    product = (product << 1) ^ ((product >>> 7) * 0x11d);
    if (((y >>> i) & 1) !== 0) product ^= x;
  }
  return product & 0xff;
}

function qrGFPower(value) {
  let result = 1;
  for (let i = 0; i < value; i++) result = qrGFMultiply(result, 2);
  return result;
}

function qrGeneratorPolynomial(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = Array(poly.length + 1).fill(0);
    poly.forEach((coefficient, index) => {
      next[index] ^= qrGFMultiply(coefficient, qrGFPower(i));
      next[index + 1] ^= coefficient;
    });
    poly = next;
  }
  return poly.slice(0, degree).reverse();
}

function qrReedSolomonRemainder(data, degree) {
  const divisor = qrGeneratorPolynomial(degree);
  const result = Array(degree).fill(0);
  data.forEach((byte) => {
    const factor = byte ^ result.shift();
    result.push(0);
    divisor.forEach((coefficient, index) => {
      result[index] ^= qrGFMultiply(coefficient, factor);
    });
  });
  return result;
}

function qrAppendBits(bits, value, length) {
  for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

function qrDataCodewords(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const capacity = QR_DATA_BLOCKS.reduce((sum, value) => sum + value, 0);
  if (bytes.length > capacity - 3) throw new Error("Authenticator URL is too long for the local QR renderer.");
  const bits = [];
  qrAppendBits(bits, 0x4, 4);
  qrAppendBits(bits, bytes.length, 16);
  bytes.forEach((byte) => qrAppendBits(bits, byte, 8));
  const maxBits = capacity * 8;
  qrAppendBits(bits, 0, Math.min(4, maxBits - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0));
  }
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);
  return data;
}

function qrCodewords(text) {
  const data = qrDataCodewords(text);
  const blocks = [];
  let offset = 0;
  QR_DATA_BLOCKS.forEach((length) => {
    const block = data.slice(offset, offset + length);
    blocks.push({ data: block, ecc: qrReedSolomonRemainder(block, QR_ECC_CODEWORDS) });
    offset += length;
  });
  const codewords = [];
  const maxDataLength = Math.max(...blocks.map((block) => block.data.length));
  for (let index = 0; index < maxDataLength; index++) {
    blocks.forEach((block) => {
      if (index < block.data.length) codewords.push(block.data[index]);
    });
  }
  for (let index = 0; index < QR_ECC_CODEWORDS; index++) {
    blocks.forEach((block) => codewords.push(block.ecc[index]));
  }
  return codewords;
}

function qrBlankMatrix() {
  return {
    modules: Array.from({ length: QR_SIZE }, () => Array(QR_SIZE).fill(false)),
    reserved: Array.from({ length: QR_SIZE }, () => Array(QR_SIZE).fill(false)),
  };
}

function qrSet(matrix, x, y, value, reserve = true) {
  if (x < 0 || y < 0 || x >= QR_SIZE || y >= QR_SIZE) return;
  matrix.modules[y][x] = Boolean(value);
  if (reserve) matrix.reserved[y][x] = true;
}

function qrDrawFinder(matrix, x, y) {
  for (let dy = -1; dy <= 7; dy++) {
    for (let dx = -1; dx <= 7; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      const inPattern = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
      const black = inPattern && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      qrSet(matrix, xx, yy, black);
    }
  }
}

function qrDrawAlignment(matrix, cx, cy) {
  if (matrix.reserved[cy]?.[cx]) return;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      qrSet(matrix, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

function qrDrawFunctionPatterns(matrix) {
  qrDrawFinder(matrix, 0, 0);
  qrDrawFinder(matrix, QR_SIZE - 7, 0);
  qrDrawFinder(matrix, 0, QR_SIZE - 7);
  for (let i = 8; i < QR_SIZE - 8; i++) {
    qrSet(matrix, i, 6, i % 2 === 0);
    qrSet(matrix, 6, i, i % 2 === 0);
  }
  [6, 28, 50].forEach((x) => [6, 28, 50].forEach((y) => qrDrawAlignment(matrix, x, y)));
  qrSet(matrix, 8, QR_VERSION * 4 + 9, true);
  qrReserveFormat(matrix);
  qrDrawVersion(matrix);
}

function qrReserveFormat(matrix) {
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      qrSet(matrix, 8, i, false);
      qrSet(matrix, i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) qrSet(matrix, QR_SIZE - 1 - i, 8, false);
  for (let i = 8; i < 15; i++) qrSet(matrix, 8, QR_SIZE - 15 + i, false);
}

function qrBCH(value, poly, degree) {
  let result = value;
  for (let i = 0; i < degree; i++) {
    result = (result << 1) ^ (((result >>> (degree - 1)) & 1) * poly);
  }
  return result;
}

function qrDrawVersion(matrix) {
  const bits = (QR_VERSION << 12) | qrBCH(QR_VERSION, 0x1f25, 12);
  for (let i = 0; i < 18; i++) {
    const bit = ((bits >>> i) & 1) !== 0;
    const a = QR_SIZE - 11 + (i % 3);
    const b = Math.floor(i / 3);
    qrSet(matrix, a, b, bit);
    qrSet(matrix, b, a, bit);
  }
}

function qrMaskBit(mask, x, y) {
  if (mask === 0) return (x + y) % 2 === 0;
  if (mask === 1) return y % 2 === 0;
  if (mask === 2) return x % 3 === 0;
  if (mask === 3) return (x + y) % 3 === 0;
  if (mask === 4) return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
  if (mask === 5) return ((x * y) % 2) + ((x * y) % 3) === 0;
  if (mask === 6) return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
  return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
}

function qrPlaceData(matrix, codewords, mask) {
  let bitIndex = 0;
  let upward = true;
  for (let right = QR_SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right--;
    for (let vert = 0; vert < QR_SIZE; vert++) {
      const y = upward ? QR_SIZE - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (matrix.reserved[y][x]) continue;
        const bit = ((codewords[Math.floor(bitIndex / 8)] >>> (7 - (bitIndex % 8))) & 1) !== 0;
        qrSet(matrix, x, y, bit !== qrMaskBit(mask, x, y), false);
        bitIndex++;
      }
    }
    upward = !upward;
  }
}

function qrDrawFormat(matrix, mask) {
  const data = (1 << 3) | mask;
  const bits = ((data << 10) | qrBCH(data, 0x537, 10)) ^ 0x5412;
  const get = (index) => ((bits >>> index) & 1) !== 0;
  for (let i = 0; i <= 5; i++) qrSet(matrix, 8, i, get(i));
  qrSet(matrix, 8, 7, get(6));
  qrSet(matrix, 8, 8, get(7));
  qrSet(matrix, 7, 8, get(8));
  for (let i = 9; i < 15; i++) qrSet(matrix, 14 - i, 8, get(i));
  for (let i = 0; i < 8; i++) qrSet(matrix, QR_SIZE - 1 - i, 8, get(i));
  for (let i = 8; i < 15; i++) qrSet(matrix, 8, QR_SIZE - 15 + i, get(i));
}

function qrPenalty(modules) {
  let penalty = 0;
  for (let y = 0; y < QR_SIZE; y++) {
    let runColor = modules[y][0];
    let runLength = 1;
    for (let x = 1; x < QR_SIZE; x++) {
      if (modules[y][x] === runColor) runLength++;
      else {
        if (runLength >= 5) penalty += 3 + runLength - 5;
        runColor = modules[y][x];
        runLength = 1;
      }
    }
    if (runLength >= 5) penalty += 3 + runLength - 5;
  }
  for (let x = 0; x < QR_SIZE; x++) {
    let runColor = modules[0][x];
    let runLength = 1;
    for (let y = 1; y < QR_SIZE; y++) {
      if (modules[y][x] === runColor) runLength++;
      else {
        if (runLength >= 5) penalty += 3 + runLength - 5;
        runColor = modules[y][x];
        runLength = 1;
      }
    }
    if (runLength >= 5) penalty += 3 + runLength - 5;
  }
  for (let y = 0; y < QR_SIZE - 1; y++) {
    for (let x = 0; x < QR_SIZE - 1; x++) {
      const color = modules[y][x];
      if (modules[y][x + 1] === color && modules[y + 1][x] === color && modules[y + 1][x + 1] === color) penalty += 3;
    }
  }
  const pattern = [true, false, true, true, true, false, true, false, false, false, false];
  const reverse = [...pattern].reverse();
  const matches = (line, start, source) => source.every((value, index) => line[start + index] === value);
  for (let y = 0; y < QR_SIZE; y++) {
    for (let x = 0; x <= QR_SIZE - 11; x++) {
      if (matches(modules[y], x, pattern) || matches(modules[y], x, reverse)) penalty += 40;
    }
  }
  for (let x = 0; x < QR_SIZE; x++) {
    const column = modules.map((row) => row[x]);
    for (let y = 0; y <= QR_SIZE - 11; y++) {
      if (matches(column, y, pattern) || matches(column, y, reverse)) penalty += 40;
    }
  }
  const dark = modules.flat().filter(Boolean).length;
  penalty += Math.floor(Math.abs((dark * 20) / (QR_SIZE * QR_SIZE) - 10)) * 10;
  return penalty;
}

function qrModules(text) {
  const codewords = qrCodewords(text);
  let best = null;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const matrix = qrBlankMatrix();
    qrDrawFunctionPatterns(matrix);
    qrPlaceData(matrix, codewords, mask);
    qrDrawFormat(matrix, mask);
    const penalty = qrPenalty(matrix.modules);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      best = matrix.modules;
    }
  }
  return best;
}

function drawLocalQRCode(canvas, text) {
  const modules = qrModules(text);
  const moduleCount = QR_SIZE + QR_QUIET_ZONE * 2;
  const size = Math.max(canvas.width || 180, canvas.height || 180);
  canvas.width = size;
  canvas.height = size;
  const scale = size / moduleCount;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#09231e";
  modules.forEach((row, y) => row.forEach((black, x) => {
    if (black) ctx.fillRect((x + QR_QUIET_ZONE) * scale, (y + QR_QUIET_ZONE) * scale, Math.ceil(scale), Math.ceil(scale));
  }));
}

function renderTwoFactorQRCode(otpauthURL, qrImageURL = "") {
  const image = $("#twoFactorQRCodeImage");
  const canvas = $("#twoFactorQRCode");
  const placeholder = $("#twoFactorQRPlaceholder");
  const status = $("#twoFactorQRStatus");
  if (!otpauthURL) return;
  if (image) {
    image.hidden = true;
    image.removeAttribute("src");
  }
  if (canvas) canvas.hidden = true;
  if (placeholder) {
    placeholder.hidden = false;
    placeholder.textContent = "QR";
  }
  if (status) status.textContent = "Generating scan code...";
  if (image && qrImageURL) {
    image.onload = () => {
      image.hidden = false;
      if (placeholder) placeholder.hidden = true;
      if (status) status.textContent = "Scan this QR code with Google Authenticator, then enter the 6 digit code below.";
    };
    image.onerror = () => {
      image.hidden = true;
      if (placeholder) {
        placeholder.hidden = false;
        placeholder.textContent = "Use setup key";
      }
      if (status) status.textContent = "Could not load the QR code. Add the setup key manually in your authenticator app.";
    };
    image.src = qrImageURL;
    return;
  }
  try {
    if (!canvas) throw new Error("QR canvas is not available");
    drawLocalQRCode(canvas, otpauthURL);
    canvas.hidden = false;
    if (placeholder) placeholder.hidden = true;
    if (status) status.textContent = "Scan this QR code with Google Authenticator, then enter the 6 digit code below.";
  } catch {
    if (canvas) canvas.hidden = true;
    if (placeholder) {
      placeholder.hidden = false;
      placeholder.textContent = "Use setup key";
    }
    if (status) status.textContent = "Could not draw the QR code. Add the setup key manually in your authenticator app.";
  }
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function mentionText(value) {
  return esc(value).replace(/(^|[\s(])@([a-zA-Z0-9_]{3,24})/g, '$1<span class="mention">@$2</span>');
}

function chatText(value) {
  return mentionText(value).replace(/(https?:\/\/[^\s<]+)/g, (url) => `<a class="text-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`);
}

function websiteOrigin(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return parsed.origin;
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

function annotationPageURL(baseURL, pagePath = "") {
  const pathValue = String(pagePath || "").trim();
  if (/^https?:\/\//i.test(pathValue)) return pathValue;
  const base = websiteOrigin(baseURL);
  if (!base) return "";
  if (!pathValue || pathValue === "/") return base;
  return `${base}${pathValue.startsWith("/") ? "" : "/"}${pathValue}`;
}

const ANNOTATION_VIEWPORT = { width: 1440, height: 6000, maxHeight: 50000 };
const ANNOTATION_TALL_FALLBACK_HEIGHT = 18000;
const ANNOTATION_DEVICE_VIEWPORTS = [
  { value: "desktop", label: "Desktop", icon: "monitor", width: 1440 },
  { value: "tablet", label: "Tablet", icon: "tablet", width: 768 },
  { value: "mobile", label: "Mobile", icon: "smartphone", width: 390 },
];
const ANNOTATION_DEFAULT_DEVICE = "desktop";
const COMMENT_REACTION_EMOJIS = ["\u{1F44D}", "\u{2705}", "\u{2764}\u{FE0F}", "\u{1F602}", "\u{1F440}"];
let annotationViewportResizeBound = false;

function clampAnnotationPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
}

function annotationPinHTML(pin = {}, index = 0) {
  const rawX = clampAnnotationPercent(pin.x ?? pin.pin_x);
  const rawY = clampAnnotationPercent(pin.y ?? pin.pin_y);
  const targetWidth = annotationViewportDimension(pin.target_page_width || pin.target_width || pin.page_width || ANNOTATION_VIEWPORT.width, ANNOTATION_VIEWPORT.width, 320, 8000);
  const targetHeight = annotationViewportDimension(pin.target_page_height || pin.target_height || pin.page_height || ANNOTATION_VIEWPORT.height, ANNOTATION_VIEWPORT.height, 900, ANNOTATION_VIEWPORT.maxHeight);
  const sourceWidth = annotationViewportDimension(pin.page_width || pin.viewport_width || targetWidth, targetWidth, 320, 8000);
  const sourceHeight = annotationViewportDimension(pin.page_height || pin.viewport_height || targetHeight, targetHeight, 900, ANNOTATION_VIEWPORT.maxHeight);
  const x = clampAnnotationPercent(((rawX / 100) * sourceWidth / targetWidth) * 100);
  const y = clampAnnotationPercent(((rawY / 100) * sourceHeight / targetHeight) * 100);
  const label = pin.label || String(index + 1);
  const title = pin.title || pin.description || "Annotation pin";
  const attrs = pin.id ? ` data-feedback-pin="${esc(pin.id)}"` : "";
  return `<button class="pin" type="button" style="left:${x}%;top:${y}%;" title="${esc(title)}"${attrs}>${esc(label)}</button>`;
}

function annotationViewportDimension(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function annotationViewportForDevice(device = ANNOTATION_DEFAULT_DEVICE) {
  return ANNOTATION_DEVICE_VIEWPORTS.find((item) => item.value === device) || ANNOTATION_DEVICE_VIEWPORTS[0];
}

function annotationDeviceForWidth(width = ANNOTATION_VIEWPORT.width) {
  const viewportWidth = annotationViewportDimension(width, ANNOTATION_VIEWPORT.width, 320, 8000);
  if (viewportWidth <= 480) return "mobile";
  if (viewportWidth <= 900) return "tablet";
  return "desktop";
}

function annotationDeviceControlsHTML(activeDevice = ANNOTATION_DEFAULT_DEVICE) {
  const active = annotationViewportForDevice(activeDevice).value;
  return `<div class="annotation-device-toolbar" data-annotation-device-toolbar aria-label="Annotation viewport">
    ${ANNOTATION_DEVICE_VIEWPORTS.map((device) => `<button class="annotation-device-button${device.value === active ? " active" : ""}" type="button" data-annotation-device="${esc(device.value)}" aria-pressed="${device.value === active ? "true" : "false"}" title="${esc(device.label)} view (${device.width}px)">${icon(device.icon)}</button>`).join("")}
  </div>`;
}

function setAnnotationDeviceToolbarState(root = document, activeDevice = ANNOTATION_DEFAULT_DEVICE) {
  const active = annotationViewportForDevice(activeDevice).value;
  root.querySelectorAll("[data-annotation-device]").forEach((button) => {
    const isActive = button.dataset.annotationDevice === active;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function setAnnotationViewportWidth(viewport, width) {
  if (!viewport) return ANNOTATION_VIEWPORT.width;
  const nextWidth = annotationViewportDimension(width, ANNOTATION_VIEWPORT.width, 320, 8000);
  viewport.dataset.annotationWidth = String(nextWidth);
  viewport.style.setProperty("--annotation-width", `${nextWidth}px`);
  const frame = viewport.querySelector("[data-annotation-frame]");
  if (frame) frame.width = String(nextWidth);
  syncAnnotationViewports(viewport.closest(".annotation-stage") || document);
  return nextWidth;
}

function refreshAnnotationViewportMeasurement(viewport, fallbackHeight) {
  if (!viewport) return { width: ANNOTATION_VIEWPORT.width, height: ANNOTATION_VIEWPORT.height, measured: false };
  const width = Number(viewport.dataset.annotationWidth || ANNOTATION_VIEWPORT.width);
  const fallback = annotationViewportDimension(fallbackHeight || viewport.dataset.annotationFallbackHeight || viewport.dataset.annotationHeight, ANNOTATION_VIEWPORT.height, 900, ANNOTATION_VIEWPORT.maxHeight);
  const frame = viewport.querySelector("[data-annotation-frame]");
  const measured = frame ? measureAnnotationFrameHeight(frame) : 0;
  const height = setAnnotationViewportHeight(viewport, measured || fallback);
  return { width, height, measured: Boolean(measured) };
}

function bindAnnotationDeviceControls(root = document, options = {}) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll("[data-annotation-device]").forEach((button) => {
    if (button.dataset.annotationDeviceBound === "1") return;
    button.dataset.annotationDeviceBound = "1";
    button.addEventListener("click", () => {
      const device = annotationViewportForDevice(button.dataset.annotationDevice);
      const stage = button.closest(".annotation-stage") || root.querySelector?.(".annotation-stage") || root;
      const viewport = stage.querySelector?.("[data-annotation-viewport]") || root.querySelector?.("[data-annotation-viewport]");
      if (!viewport) return;
      const width = setAnnotationViewportWidth(viewport, device.width);
      setAnnotationDeviceToolbarState(stage, device.value);
      const measurement = refreshAnnotationViewportMeasurement(viewport, options.fallbackHeight);
      options.onChange?.({ device: device.value, width, height: measurement.height, measured: measurement.measured, viewport });
    });
  });
}

function annotationFrameHTML(options = {}) {
  const title = options.title || "Annotation page";
  const width = annotationViewportDimension(options.width, ANNOTATION_VIEWPORT.width, 320, 8000);
  const height = annotationViewportDimension(options.height, ANNOTATION_VIEWPORT.height, 900, ANNOTATION_VIEWPORT.maxHeight);
  const fallbackHeight = annotationViewportDimension(options.fallbackHeight || height, height, 900, ANNOTATION_VIEWPORT.maxHeight);
  const device = options.device || annotationDeviceForWidth(width);
  const media = options.imageURL
    ? `<img src="${esc(options.imageURL)}" alt="${esc(title)} screenshot">`
    : `<iframe src="${esc(options.url || "")}" title="${esc(title)}" width="${width}" height="${height}" data-annotation-frame></iframe>`;
  const pins = (options.pins || []).map((pin, index) => annotationPinHTML({ ...pin, target_page_width: width, target_page_height: height }, index)).join("");
  return `${options.deviceControls === false ? "" : annotationDeviceControlsHTML(device)}<div class="annotation-viewport-shell" data-annotation-shell>
    <div class="annotation-viewport" data-annotation-viewport data-annotation-width="${width}" data-annotation-height="${height}" data-annotation-fallback-height="${fallbackHeight}" style="--annotation-width:${width}px;--annotation-height:${height}px;">
      ${media}
      <div class="click-catcher" id="${esc(options.catcherID || "clickCatcher")}"></div>
      <div class="pin-layer" id="${esc(options.pinLayerID || "pinLayer")}">${pins}</div>
    </div>
  </div>`;
}

function setAnnotationViewportHeight(viewport, height) {
  if (!viewport) return ANNOTATION_VIEWPORT.height;
  const nextHeight = annotationViewportDimension(height, ANNOTATION_VIEWPORT.height, 900, ANNOTATION_VIEWPORT.maxHeight);
  viewport.dataset.annotationHeight = String(nextHeight);
  viewport.style.setProperty("--annotation-height", `${nextHeight}px`);
  const frame = viewport.querySelector("[data-annotation-frame]");
  if (frame) frame.height = String(nextHeight);
  syncAnnotationViewports(viewport.closest(".annotation-stage") || document);
  return nextHeight;
}

function measureAnnotationFrameHeight(frame) {
  try {
    const doc = frame.contentDocument || frame.contentWindow?.document;
    if (!doc) return 0;
    const body = doc.body;
    const html = doc.documentElement;
    return Math.max(
      body?.scrollHeight || 0,
      body?.offsetHeight || 0,
      html?.clientHeight || 0,
      html?.scrollHeight || 0,
      html?.offsetHeight || 0,
    );
  } catch {
    return 0;
  }
}

function bindAnnotationFrameAutoHeight(root = document, options = {}) {
  root.querySelectorAll("[data-annotation-frame]").forEach((frame) => {
    if (frame.dataset.autoHeightBound === "1") return;
    frame.dataset.autoHeightBound = "1";
    const viewport = frame.closest("[data-annotation-viewport]");
    const fallbackHeight = annotationViewportDimension(options.fallbackHeight || viewport?.dataset.annotationFallbackHeight || viewport?.dataset.annotationHeight, ANNOTATION_VIEWPORT.height, 900, ANNOTATION_VIEWPORT.maxHeight);
    const applyHeight = () => {
      const measured = measureAnnotationFrameHeight(frame);
      const height = setAnnotationViewportHeight(viewport, measured || fallbackHeight);
      options.onHeight?.(height, Number(viewport?.dataset.annotationWidth || ANNOTATION_VIEWPORT.width), Boolean(measured));
    };
    setAnnotationViewportHeight(viewport, fallbackHeight);
    frame.addEventListener("load", applyHeight);
    window.setTimeout(applyHeight, 400);
    window.setTimeout(applyHeight, 1400);
  });
}

function bindAnnotationSidebarToggles(root = document) {
  root.querySelectorAll("[data-toggle-annotation-sidebar]").forEach((btn) => {
    if (btn.dataset.annotationSidebarBound === "1") return;
    btn.dataset.annotationSidebarBound = "1";
    btn.addEventListener("click", () => {
      const panel = btn.closest(".annotation-task-viewer") || btn.closest(".annotation-task-body") || btn.closest(".annotation-task-form")?.querySelector(".annotation-task-body");
      const body = panel?.classList.contains("annotation-task-body") ? panel : panel?.querySelector?.(".annotation-task-body") || panel;
      if (!body) return;
      const collapsed = !body.classList.contains("annotation-sidebar-collapsed");
      body.classList.toggle("annotation-sidebar-collapsed", collapsed);
      body.querySelectorAll(".annotation-sidebar-expand").forEach((expand) => {
        expand.hidden = !collapsed;
      });
    });
  });
}

function syncAnnotationViewports(root = document) {
  root.querySelectorAll("[data-annotation-viewport]").forEach((viewport) => {
    const shell = viewport.closest("[data-annotation-shell]");
    const stage = viewport.closest(".annotation-stage");
    if (!shell || !stage) return;
    const width = Number(viewport.dataset.annotationWidth || ANNOTATION_VIEWPORT.width);
    const height = Number(viewport.dataset.annotationHeight || ANNOTATION_VIEWPORT.height);
    const availableWidth = Math.max(320, stage.clientWidth - 16);
    const scale = Math.min(1, availableWidth / width);
    viewport.style.setProperty("--annotation-scale", scale.toFixed(4));
    shell.style.width = `${Math.round(width * scale)}px`;
    shell.style.height = `${Math.round(height * scale)}px`;
  });
}

function bindAnnotationViewportResize(root = document) {
  syncAnnotationViewports(root);
  requestAnimationFrame(() => syncAnnotationViewports(root));
  if (annotationViewportResizeBound) return;
  annotationViewportResizeBound = true;
  window.addEventListener("resize", () => syncAnnotationViewports());
}

function annotationPointFromEvent(event, viewport) {
  if (!viewport) return { x: 0, y: 0 };
  const rect = viewport.getBoundingClientRect();
  if (!rect.width || !rect.height) return { x: 0, y: 0 };
  return {
    x: clampAnnotationPercent(((event.clientX - rect.left) / rect.width) * 100),
    y: clampAnnotationPercent(((event.clientY - rect.top) / rect.height) * 100),
  };
}

const NIL_OBJECT_ID = "000000000000000000000000";

function fileNameFromURL(url) {
  const clean = String(url || "").split("?")[0].split("#")[0];
  try {
    return decodeURIComponent(clean.split("/").pop() || "Attachment");
  } catch {
    return clean.split("/").pop() || "Attachment";
  }
}

function attachmentKind(url, name = "") {
  const extFrom = (value) => (String(value || "").toLowerCase().split("?")[0].split("#")[0].match(/\.([a-z0-9]+)$/)?.[1] || "").toLowerCase();
  const ext = extFrom(name) || extFrom(url);
  const images = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif"]);
  if (images.has(ext)) return { ext, isImage: true, icon: "file-image", label: "Image" };
  if (ext === "pdf") return { ext, isImage: false, icon: "file-text", label: "PDF" };
  if (["doc", "docx", "odt", "rtf"].includes(ext)) return { ext, isImage: false, icon: "file-type", label: "Document" };
  if (["xls", "xlsx", "csv", "ods"].includes(ext)) return { ext, isImage: false, icon: "file-spreadsheet", label: "Spreadsheet" };
  if (["zip", "rar", "7z"].includes(ext)) return { ext, isImage: false, icon: "file-archive", label: "Archive" };
  return { ext, isImage: false, icon: "file", label: "File" };
}

function attachmentPreviewHTML(url, name = "", options = {}) {
  const href = String(url || "").trim();
  if (!href) return "";
  const label = name || fileNameFromURL(href);
  const kind = attachmentKind(href, label);
  const classes = ["attachment-tile", kind.isImage ? "is-image" : "is-file", options.compact ? "compact" : ""].filter(Boolean).join(" ");
  return `<button class="${classes}" type="button" data-open-attachment data-attachment-url="${esc(href)}" data-attachment-name="${esc(label)}" title="${esc(label)}">
    ${kind.isImage ? `<img src="${esc(href)}" alt="${esc(label)} preview" loading="lazy">` : `<span class="attachment-file-icon">${icon(kind.icon)}</span>`}
    <span>${esc(label)}</span>
    ${options.source ? `<small>${esc(options.source)}</small>` : ""}
  </button>`;
}

function taskAttachmentGalleryHTML(task = {}, comments = []) {
  const items = [];
  const seen = new Set();
  (task.attachments || []).forEach((url) => {
    const href = String(url || "").trim();
    if (!href || seen.has(href)) return;
    seen.add(href);
    items.push({ url: href, name: fileNameFromURL(href), source: "Task" });
  });
  (comments || []).forEach((comment) => {
    const href = String(comment.attachment_url || "").trim();
    if (!href || seen.has(href)) return;
    seen.add(href);
    items.push({ url: href, name: comment.attachment_name || fileNameFromURL(href), source: "Comment" });
  });
  if (!items.length) return "";
  return `<section class="task-attachment-gallery">
    <h3>Attachments</h3>
    <div class="attachment-grid">${items.map((item) => attachmentPreviewHTML(item.url, item.name, { source: item.source })).join("")}</div>
  </section>`;
}

function openAttachmentLightbox(url, name = "") {
  const href = String(url || "").trim();
  if (!href) return;
  const label = name || fileNameFromURL(href);
  const kind = attachmentKind(href, label);
  let dialog = document.getElementById("attachmentLightboxDialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "attachmentLightboxDialog";
    dialog.className = "modal attachment-lightbox-modal";
    document.body.appendChild(dialog);
  }
  dialog.innerHTML = `
    <div class="modal-head">
      <div><h2>${esc(label)}</h2><p class="muted">${esc(kind.label)}</p></div>
      <button class="btn icon quiet" type="button" data-close-attachment-lightbox title="Close">${icon("x")}</button>
    </div>
    <div class="attachment-lightbox-body">
      ${kind.isImage ? `<img src="${esc(href)}" alt="${esc(label)}" data-lightbox-image>` : kind.ext === "pdf" ? `<iframe src="${esc(href)}" title="${esc(label)}"></iframe>` : `<div class="attachment-document-preview"><span>${icon(kind.icon)}</span><strong>${esc(label)}</strong><small>${esc(kind.label)}</small></div>`}
    </div>
    <div class="toolbar">
      <a class="btn primary" href="${esc(href)}" download target="_blank" rel="noopener noreferrer">${icon("download")}Download</a>
      <a class="btn" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${icon("external-link")}Open</a>
    </div>`;
  dialog.querySelector("[data-close-attachment-lightbox]")?.addEventListener("click", () => dialog.close());
  dialog.querySelector("[data-lightbox-image]")?.addEventListener("click", (event) => event.currentTarget.classList.toggle("is-zoomed"));
  dialog.showModal();
  icons();
}

function bindAttachmentOpeners(root = document) {
  root.querySelectorAll("[data-open-attachment]").forEach((btn) => {
    if (btn.dataset.attachmentBound === "1") return;
    btn.dataset.attachmentBound = "1";
    btn.addEventListener("click", () => openAttachmentLightbox(btn.dataset.attachmentUrl, btn.dataset.attachmentName));
  });
}

function annotationSnapshotHTML(item = {}) {
  const url = String(item.screenshot_url || "").trim();
  if (!url) return `<section class="annotation-snapshot empty"><h3>Section snapshot</h3><p class="muted">No section screenshot saved for this annotation yet.</p></section>`;
  return `<section class="annotation-snapshot">
    <div class="panel-head compact-panel-head"><h3>Section snapshot</h3><span class="pill">${icon("image")}Saved</span></div>
    <div class="annotation-snapshot-frame">${attachmentPreviewHTML(url, "Annotation section screenshot", { source: "Snapshot" })}</div>
  </section>`;
}

function setAnnotationScreenshotPreview(form, url = "", label = "Section screenshot") {
  const preview = form?.querySelector("[data-annotation-screenshot-preview]");
  const input = form?.elements?.screenshot_url;
  if (input) input.value = String(url || "").trim();
  if (!preview) return;
  if (!url) {
    preview.hidden = true;
    preview.innerHTML = "";
    return;
  }
  preview.hidden = false;
  preview.innerHTML = `${attachmentPreviewHTML(url, label, { source: "Snapshot" })}
    <button class="btn icon quiet" type="button" data-clear-annotation-screenshot title="Remove snapshot">${icon("x")}</button>`;
  preview.querySelector("[data-clear-annotation-screenshot]")?.addEventListener("click", () => setAnnotationScreenshotPreview(form, ""));
  bindAttachmentOpeners(preview);
  icons();
}

function annotationVisibleCropRect(viewport, options = {}) {
  const rect = viewport.getBoundingClientRect();
  const visibleLeft = Math.max(0, rect.left);
  const visibleTop = Math.max(0, rect.top);
  const visibleRight = Math.min(window.innerWidth, rect.right);
  const visibleBottom = Math.min(window.innerHeight, rect.bottom);
  const visibleWidth = Math.max(1, visibleRight - visibleLeft);
  const visibleHeight = Math.max(1, visibleBottom - visibleTop);
  const pinX = Number(options.pinX);
  const pinY = Number(options.pinY);
  const focusX = Number.isFinite(pinX) ? rect.left + (rect.width * clampAnnotationPercent(pinX)) / 100 : rect.left + rect.width / 2;
  const focusY = Number.isFinite(pinY) ? rect.top + (rect.height * clampAnnotationPercent(pinY)) / 100 : rect.top + rect.height / 2;
  const desiredWidth = Math.min(visibleWidth, Math.max(320, Number(options.width) || 620));
  const desiredHeight = Math.min(visibleHeight, Math.max(240, Number(options.height) || 460));
  const left = Math.min(Math.max(focusX - desiredWidth / 2, visibleLeft), visibleRight - desiredWidth);
  const top = Math.min(Math.max(focusY - desiredHeight / 2, visibleTop), visibleBottom - desiredHeight);
  return {
    left: Math.max(0, left),
    top: Math.max(0, top),
    width: desiredWidth,
    height: desiredHeight,
  };
}

async function captureAnnotationSectionFile(stage = document, options = {}) {
  const viewport = stage?.querySelector?.("[data-annotation-viewport]");
  if (!viewport) throw new Error("Open the annotation page before capturing a screenshot.");
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Your browser does not support tab screenshot capture. Upload a screenshot instead.");
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((resolve) => setTimeout(resolve, 180));
    const rect = annotationVisibleCropRect(viewport, options);
    const scaleX = video.videoWidth / Math.max(1, window.innerWidth);
    const scaleY = video.videoHeight / Math.max(1, window.innerHeight);
    const sx = Math.max(0, Math.round(rect.left * scaleX));
    const sy = Math.max(0, Math.round(rect.top * scaleY));
    const sw = Math.max(1, Math.min(video.videoWidth - sx, Math.round(rect.width * scaleX)));
    const sh = Math.max(1, Math.min(video.videoHeight - sy, Math.round(rect.height * scaleY)));
    const maxWidth = 1600;
    const ratio = Math.min(1, maxWidth / sw);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw * ratio));
    canvas.height = Math.max(1, Math.round(sh * ratio));
    canvas.getContext("2d").drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.92));
    if (!blob) throw new Error("Could not create screenshot image.");
    return new File([blob], `annotation-pin-section-${Date.now()}.png`, { type: "image/png" });
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}

const STAFF_ROLES = [
  { value: "owner", label: "Owner" },
  { value: "client_admin", label: "Client Admin" },
  { value: "web developer", label: "Web developer" },
  { value: "internal", label: "Internal" },
  { value: "copy writer", label: "Copy writer" },
  { value: "marketing", label: "Marketing" },
  { value: "it", label: "IT" },
  { value: "manager", label: "Manager" },
];

function staffRoleOptions(selected = "") {
  const selectedRole = normalizedStaffRole(selected);
  return STAFF_ROLES
    .map((role) => `<option value="${esc(role.value)}" ${selectedRole === role.value ? "selected" : ""}>${esc(role.label)}</option>`)
    .join("");
}

function normalizedStaffRole(value) {
  if (value === "marketing it") return "marketing";
  if (value === "client admin" || value === "client-admin") return "client_admin";
  return STAFF_ROLES.find((role) => role.value === value)?.value || "";
}

function staffRoleLabel(value) {
  if (value === "marketing it") return "Marketing / IT";
  if (value === "client admin") return "Client Admin";
  return STAFF_ROLES.find((role) => role.value === normalizedStaffRole(value))?.label || value || "";
}

function accountRoleLabel(user = state.me) {
  if (user?.role === "owner_adm") return "Owner admin";
  if (user?.role === "client_admin") return "Client Admin";
  return "User admin";
}

function roleLabel(value) {
  if (value === "owner_adm") return "Owner admin";
  if (value === "users_admin") return "User admin";
  if (value === "users_member") return "Staff member";
  if (value === "client_admin") return "Client Admin";
  return String(value || "").replaceAll("_", " ");
}

function companyRoleLabel(value) {
  if (value === "owner_adm") return "Owner admin";
  if (value === "users_admin") return "Company admin";
  if (value === "users_member") return "Company member";
  if (value === "client_admin") return "Client Admin";
  return String(value || "").replaceAll("_", " ");
}

function membershipStatusLabel(value) {
  if (value === "suspended") return "blocked";
  if (value === "left") return "left company";
  return value || "active";
}

function userInitial(user = state.me) {
  return esc((user?.name || user?.username || user?.email || "U").trim().slice(0, 1).toUpperCase() || "U");
}

function userChip(user = state.me) {
  return `<span class="user-chip">${user?.avatar_url ? `<img src="${esc(user.avatar_url)}" alt="">` : `<span>${userInitial(user)}</span>`}</span>`;
}

function workspaceInitial(name = "W") {
  return esc(String(name || "W").trim().slice(0, 1).toUpperCase() || "W");
}

function workspaceAvatar(option = {}) {
  if (option.kind === "personal" || option.kind === "owner") return userChip();
  return `<span class="user-chip">${option.logo_url ? `<img src="${esc(option.logo_url)}" alt="">` : `<span>${workspaceInitial(option.name)}</span>`}</span>`;
}

function normalizeCompanyAccess(access = {}) {
  const teamID = String(access.team_id || access.id || "");
  if (!teamID) return null;
  return {
    team_id: teamID,
    name: access.company_name || access.name || "Company workspace",
    logo_url: access.company_logo_url || access.logo_url || "",
    staff_role: access.staff_role || "",
    company_role: access.company_role || "",
    status: access.status || "active",
    joined_at: access.joined_at || "",
    current: Boolean(access.current),
    membership: access.membership || null,
  };
}

function joinedCompanyAccesses() {
  const seen = new Set();
  return (state.companyAccesses || [])
    .map(normalizeCompanyAccess)
    .filter((access) => {
      if (!access || seen.has(access.team_id) || access.status === "suspended" || access.status === "left") return false;
      seen.add(access.team_id);
      return true;
    });
}

function personalWorkspaceTeam() {
  if (state.me?.role === "owner_adm") return state.team || state.personalTeam || null;
  return state.personalTeam || null;
}

function workspaceOptions() {
  const userDisplayName = state.me?.name || state.me?.username || state.me?.email || "User";
  const personalTeam = personalWorkspaceTeam();
  const options = [{
    value: "personal",
    kind: state.me?.role === "owner_adm" ? "owner" : "personal",
    team_id: personalTeam?.id || "",
    name: state.me?.role === "owner_adm" ? "Owner Admin" : (personalTeam?.name || `${userDisplayName}'s Company`),
    subtitle: state.me?.role === "owner_adm" ? "Platform Owner" : userDisplayName,
    logo_url: personalTeam?.logo_url || "",
  }];
  joinedCompanyAccesses().forEach((access) => {
    options.push({
      value: `company:${access.team_id}`,
      kind: "company",
      team_id: access.team_id,
      name: access.name,
      subtitle: staffRoleLabel(access.staff_role) || companyRoleLabel(access.company_role) || "Member",
      logo_url: access.logo_url,
    });
  });
  return options;
}

function ensureWorkspaceContext() {
  const options = workspaceOptions();
  if (!options.some((option) => option.value === state.workspaceContext)) {
    state.workspaceContext = "personal";
    localStorage.setItem(WORKSPACE_CONTEXT_KEY, state.workspaceContext);
  }
}

function activeWorkspaceOption() {
  const options = workspaceOptions();
  return options.find((option) => option.value === state.workspaceContext) || options[0];
}

function activeWorkspaceTeamID() {
  return activeWorkspaceOption()?.team_id || "";
}

function isPersonalWorkspaceContext() {
  return activeWorkspaceOption()?.kind !== "company";
}

function workspaceContextPickerHTML(options = workspaceOptions()) {
  if (options.length < 2) return "";
  return `<label class="workspace-context-picker">
    <span>View workspace</span>
    <select id="workspaceContextSelect" aria-label="Switch workspace view">
      ${options.map((option) => `<option value="${esc(option.value)}" ${option.value === state.workspaceContext ? "selected" : ""}>${esc(option.name)}</option>`).join("")}
    </select>
  </label>`;
}

function bindWorkspaceContextSwitcher() {
  const select = $("#workspaceContextSelect");
  select?.addEventListener("change", () => {
    state.workspaceContext = select.value;
    localStorage.setItem(WORKSPACE_CONTEXT_KEY, state.workspaceContext);
    state.mentionUsers = null;
    route();
  });
}

async function loadMentionUsers() {
  if (state.mentionUsers) return state.mentionUsers;
  const teamID = activeWorkspaceTeamID();
  const url = teamID ? `/api/users/mentions?team_id=${encodeURIComponent(teamID)}` : "/api/users/mentions";
  const data = await api(url).catch(() => ({ users: [] }));
  state.mentionUsers = (data.users || []).filter((user) => user.username);
  return state.mentionUsers;
}

function mentionToken(input) {
  const cursor = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, cursor);
  const match = before.match(/(^|[\s(])@([A-Za-z0-9_]{0,24})$/);
  if (!match) return null;
  return {
    start: cursor - match[2].length - 1,
    end: cursor,
    query: match[2].toLowerCase(),
  };
}

function mentionBox() {
  let box = document.getElementById("mentionSuggestions");
  if (!box) {
    box = document.createElement("div");
    box.id = "mentionSuggestions";
    box.className = "mention-suggestions";
    box.hidden = true;
    document.body.appendChild(box);
  }
  return box;
}

function hideMentionSuggestions() {
  const box = document.getElementById("mentionSuggestions");
  if (box) box.hidden = true;
  state.mentionTarget = null;
  state.mentionToken = null;
  state.mentionActiveIndex = 0;
}

async function updateMentionSuggestions(input) {
  const token = mentionToken(input);
  if (!token) {
    hideMentionSuggestions();
    return;
  }
  const users = await loadMentionUsers();
  const matches = users
    .filter((user) => {
      const username = (user.username || "").toLowerCase();
      const name = (user.name || "").toLowerCase();
      return username.startsWith(token.query) || name.includes(token.query);
    })
    .slice(0, 8);
  if (!matches.length) {
    hideMentionSuggestions();
    return;
  }
  state.mentionTarget = input;
  state.mentionToken = token;
  state.mentionActiveIndex = Math.min(state.mentionActiveIndex, matches.length - 1);
  const rect = input.getBoundingClientRect();
  const box = mentionBox();
  box.style.left = `${Math.max(8, rect.left)}px`;
  box.style.top = `${rect.bottom + 6}px`;
  box.style.width = `${Math.min(360, Math.max(240, rect.width))}px`;
  box.innerHTML = matches.map((user, index) => `
    <button class="mention-suggestion ${index === state.mentionActiveIndex ? "active" : ""}" type="button" data-mention-username="${esc(user.username)}">
      <strong>@${esc(user.username)}</strong>
      <span>${esc(user.name || user.email || "")}${user.staff_role ? " · " + esc(staffRoleLabel(user.staff_role)) : ""}</span>
    </button>`).join("");
  box.hidden = false;
  box.querySelectorAll("[data-mention-username]").forEach((btn) => btn.addEventListener("mousedown", (event) => {
    event.preventDefault();
    insertMention(btn.dataset.mentionUsername);
  }));
}

function insertMention(username) {
  const input = state.mentionTarget;
  const token = state.mentionToken;
  if (!input || !token || !username) return;
  const before = input.value.slice(0, token.start);
  const after = input.value.slice(token.end);
  const inserted = `@${username} `;
  input.value = before + inserted + after;
  const cursor = before.length + inserted.length;
  input.focus();
  input.setSelectionRange(cursor, cursor);
  hideMentionSuggestions();
}

function bindMentionSuggestions(root = document) {
  root.querySelectorAll("[data-mentionable]").forEach((input) => {
    if (input.dataset.mentionBound) return;
    input.dataset.mentionBound = "true";
    input.addEventListener("input", () => {
      state.mentionActiveIndex = 0;
      updateMentionSuggestions(input);
    });
    input.addEventListener("click", () => updateMentionSuggestions(input));
    input.addEventListener("blur", () => setTimeout(hideMentionSuggestions, 120));
    input.addEventListener("keydown", (event) => {
      const box = document.getElementById("mentionSuggestions");
      if (!box || box.hidden) return;
      const items = Array.from(box.querySelectorAll("[data-mention-username]"));
      if (!items.length) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        state.mentionActiveIndex = event.key === "ArrowDown"
          ? (state.mentionActiveIndex + 1) % items.length
          : (state.mentionActiveIndex - 1 + items.length) % items.length;
        updateMentionSuggestions(input);
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        insertMention(items[state.mentionActiveIndex]?.dataset.mentionUsername);
      }
      if (event.key === "Escape") hideMentionSuggestions();
    });
  });
}

function money(cents) {
  return "$" + ((cents || 0) / 100).toFixed(0);
}

function dollars(cents) {
  return ((cents || 0) / 100).toFixed(2);
}

function cents(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

function billingPeriodLabel(value = "monthly") {
  return value === "yearly" ? "Yearly" : "Monthly";
}

function billingUnitLabel(value = "monthly") {
  return value === "yearly" ? "year" : "month";
}

function planUnitAmount(plan = {}, period = "monthly") {
  const yearly = period === "yearly";
  if (plan.pricing_model === "per_seat") {
    if (yearly) return plan.price_per_seat_yearly || ((plan.price_per_seat || 0) * 12);
    return plan.price_per_seat || 0;
  }
  if (yearly) return plan.price_yearly || ((plan.price || 0) * 12);
  return plan.price || 0;
}

function planPriceSummary(plan = {}) {
  const suffix = plan.pricing_model === "per_seat" ? "/seat" : "";
  return `${money(planUnitAmount(plan, "monthly"))}${suffix}/month · ${money(planUnitAmount(plan, "yearly"))}${suffix}/year`;
}

function planOptionsHTML(plans = [], selected = "") {
  return plans.map((plan) => `<option value="${esc(plan.id)}" ${selected === plan.id ? "selected" : ""}>${esc(plan.name)} - ${esc(planPriceSummary(plan))}</option>`).join("");
}

async function purchasePlans() {
  const membership = activeWorkspaceMembership();
  if (membership.plans?.length) return membership.plans;
  const data = await api("/api/subscriptions/plans").catch(() => ({ plans: [] }));
  return data.plans || [];
}

function purchaseCartTotal(plan = {}, period = "monthly", quantity = 1) {
  return planUnitAmount(plan, period) * Math.max(1, Number(quantity || 1));
}

function ensurePurchaseCartDialog() {
  let dialog = $("#purchaseCartDialog");
  if (dialog) return dialog;
  document.body.insertAdjacentHTML("beforeend", `<dialog id="purchaseCartDialog" class="modal checkout-cart-modal">
    <div class="modal-head">
      <div><h2>Checkout cart</h2><p class="muted">Review your package before PayPal checkout.</p></div>
      <button class="btn icon quiet" type="button" data-close-dialog="purchaseCartDialog" title="Close">${icon("x")}</button>
    </div>
    <div class="form-grid">
      <div class="field"><label>Package</label><select id="purchaseCartPlan"></select></div>
      <div class="grid-2">
        <label class="field"><span>Period</span><select id="purchaseCartPeriod"><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
        <label class="field"><span>Amount</span><input id="purchaseCartQuantity" type="number" min="1" max="120" step="1" value="1"></label>
      </div>
      <section class="panel soft-panel" id="purchaseCartSummary"></section>
      <div class="toolbar">
        <button class="btn primary" id="purchaseCartCheckout" type="button">Checkout with PayPal</button>
        <button class="btn" type="button" data-close-dialog="purchaseCartDialog">Continue browsing</button>
      </div>
      <p class="status-line" id="purchaseCartStatus"></p>
    </div>
  </dialog>`);
  dialog = $("#purchaseCartDialog");
  bindDialogCloseButtons(document);
  ["purchaseCartPlan", "purchaseCartPeriod", "purchaseCartQuantity"].forEach((id) => {
    $(`#${id}`)?.addEventListener("input", updatePurchaseCartSummary);
    $(`#${id}`)?.addEventListener("change", updatePurchaseCartSummary);
  });
  $("#purchaseCartCheckout")?.addEventListener("click", checkoutPurchaseCart);
  icons();
  return dialog;
}

function setPurchaseCartStatus(text, error = false) {
  const line = $("#purchaseCartStatus");
  if (!line) return;
  line.textContent = text || "";
  line.style.color = error ? "var(--danger)" : "var(--text-secondary)";
}

function updatePurchaseCartSummary() {
  const cart = state.purchaseCart;
  if (!cart) return;
  const plans = cart.plans || [];
  const planID = $("#purchaseCartPlan")?.value || cart.plan_id;
  const period = $("#purchaseCartPeriod")?.value || cart.billing_period || "monthly";
  const quantity = Math.max(1, Number($("#purchaseCartQuantity")?.value || cart.quantity || 1));
  const plan = plans.find((item) => item.id === planID) || plans[0] || {};
  state.purchaseCart = { ...cart, plan_id: plan.id, billing_period: period, quantity };
  const total = purchaseCartTotal(plan, period, quantity);
  const unit = planUnitAmount(plan, period);
  const summary = $("#purchaseCartSummary");
  if (summary) {
    summary.innerHTML = `
      <div class="panel-head"><h2>${esc(plan.name || "Package")}</h2><span class="pill">${esc(billingPeriodLabel(period))}</span></div>
      <p class="muted">${esc(plan.description || "Website feedback, tasks, team access, reports, and project management.")}</p>
      <div class="admin-detail-stats">
        ${adminStatHTML("Unit price", `${money(unit)} / ${billingUnitLabel(period)}`)}
        ${adminStatHTML("Amount", String(quantity))}
        ${adminStatHTML("Total", money(total))}
      </div>`;
    icons();
  }
}

async function openPurchaseCart(planID = "", options = {}) {
  const plans = options.plans?.length ? options.plans : await purchasePlans();
  if (!plans.length) {
    alert("No pricing package is available yet.");
    return;
  }
  const plan = plans.find((item) => item.id === planID) || plans[0];
  const dialog = ensurePurchaseCartDialog();
  state.purchaseCart = {
    plans,
    plan_id: plan.id,
    billing_period: options.period || "monthly",
    quantity: Math.max(1, Number(options.quantity || 1)),
    onDone: options.onDone || null,
  };
  const planSelect = $("#purchaseCartPlan");
  if (planSelect) {
    planSelect.innerHTML = plans.map((item) => `<option value="${esc(item.id)}">${esc(item.name)} - ${esc(planPriceSummary(item))}</option>`).join("");
    planSelect.value = plan.id;
  }
  const periodSelect = $("#purchaseCartPeriod");
  if (periodSelect) periodSelect.value = state.purchaseCart.billing_period;
  const quantityInput = $("#purchaseCartQuantity");
  if (quantityInput) quantityInput.value = String(state.purchaseCart.quantity);
  setPurchaseCartStatus("");
  updatePurchaseCartSummary();
  dialog?.showModal();
}

async function checkoutPurchaseCart() {
  const cart = state.purchaseCart;
  if (!cart?.plan_id) return;
  const button = $("#purchaseCartCheckout");
  const previous = button?.textContent || "Checkout with PayPal";
  if (button) {
    button.disabled = true;
    button.textContent = "Checking out...";
  }
  setPurchaseCartStatus("Creating PayPal checkout...");
  try {
    const data = await api("/api/subscriptions/purchase", {
      method: "POST",
      body: JSON.stringify({
        plan_id: cart.plan_id,
        provider: "paypal",
        billing_period: cart.billing_period || "monthly",
        quantity: Math.max(1, Number(cart.quantity || 1)),
      }),
    });
    if (data.checkout?.url) {
      setPurchaseCartStatus("Redirecting to PayPal...");
      window.location.href = data.checkout.url;
      return;
    }
    setPurchaseCartStatus("PayPal checkout was created, but the approval URL was missing.", true);
  } catch (error) {
    setPurchaseCartStatus(error.message, true);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previous;
    }
  }
}

function activeWorkspaceMembership() {
  if (state.me?.role === "owner_adm") return { status: "active", allowed: true, trial: false, plans: [] };
  if (isPersonalWorkspaceContext()) return state.membership || { status: "no_membership", allowed: false, plans: [] };
  const teamID = activeWorkspaceTeamID();
  return joinedCompanyAccesses().find((access) => access.team_id === teamID)?.membership || { status: "no_membership", allowed: false, plans: [] };
}

function paidFeatureAllowed() {
  const membership = activeWorkspaceMembership();
  return membership.allowed === true || ["active", "trialing"].includes(membership.status);
}

function trialActiveForWorkspace() {
  const membership = activeWorkspaceMembership();
  return membership.status === "trialing" || membership.trial === true;
}

function trialNoticeKey() {
  return `bugmega_trial_notice:${activeWorkspaceTeamID() || "personal"}`;
}

function showTrialNoticeOnce() {
  if (!trialActiveForWorkspace()) return;
  const key = trialNoticeKey();
  if (sessionStorage.getItem(key) === "1") return;
  sessionStorage.setItem(key, "1");
  const membership = activeWorkspaceMembership();
  const trialEnds = membership.trial_ends_at ? ` Trial ends ${fmtDate(membership.trial_ends_at)}.` : "";
  document.body.insertAdjacentHTML("beforeend", `<dialog id="trialNoticeDialog" class="modal compact-modal">
    <div class="modal-head"><h2>Enjoy your trial</h2><button class="btn icon quiet" type="button" data-close-dialog="trialNoticeDialog" title="Close">${icon("x")}</button></div>
    <p class="muted">Your workspace has full access during the 14-day trial.${esc(trialEnds)}</p>
    <div class="toolbar"><button class="btn primary" type="button" id="trialUpgradeBtn">Upgrade</button><button class="btn" type="button" data-close-dialog="trialNoticeDialog">Continue</button></div>
  </dialog>`);
  bindDialogCloseButtons(document);
  $("#trialUpgradeBtn")?.addEventListener("click", async () => {
    $("#trialNoticeDialog")?.close();
    await openPurchaseCart("", { plans: membership.plans || [], onDone: async () => { await loadMe(); } });
  });
  icons();
  $("#trialNoticeDialog")?.showModal();
}

function membershipLabel(value) {
  const labels = {
    active: "Active",
    trialing: "Trial",
    pending_approval: "Pending owner approval",
    pending_payment: "Pending payment",
    checkout_failed: "Checkout failed",
    capture_failed: "Payment failed",
    capture_incomplete: "Payment incomplete",
    cancelled: "Cancelled",
    expired: "Expired",
    no_membership: "Free",
    unknown: "Unknown",
  };
  return labels[value] || value || "Free";
}

function pricingCardsHTML(plans = [], options = {}) {
  const canPurchase = options.canPurchase !== false;
  if (!plans.length) return `<section class="panel"><p class="muted">No pricing plans are available yet. Please contact the platform owner.</p></section>`;
  return `<div class="pricing-grid app-pricing-grid">${plans.map((plan) => `<article class="${plan.featured ? "featured" : ""}" data-plan-card="${esc(plan.id)}">
    <h3>${esc(plan.name)}</h3>
    <p>${esc(planPriceSummary(plan))}</p>
    <span>${Number(plan.seat_limit || 0)} seats · ${Number(plan.project_limit || 0)} projects · ${Number(plan.trial_days || 0) || 14} trial days</span>
    ${plan.description ? `<small>${esc(plan.description)}</small>` : ""}
    <div class="grid-2" style="margin-top:12px">
      <label class="field"><span>Period</span><select data-buy-period ${canPurchase ? "" : "disabled"}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
      <label class="field"><span>Amount</span><input data-buy-quantity type="number" min="1" max="120" step="1" value="1" ${canPurchase ? "" : "disabled"}></label>
    </div>
    <p class="pricing-actions">
      <button class="btn primary" data-add-cart="${esc(plan.id)}" ${canPurchase ? "" : "disabled"}>${icon("shopping-cart")}Add to cart</button>
    </p>
  </article>`).join("")}</div>`;
}

function bindPurchaseButtons(onDone = null) {
  document.querySelectorAll("[data-add-cart]").forEach((btn) => btn.addEventListener("click", async () => {
    const card = btn.closest("[data-plan-card]");
    await openPurchaseCart(btn.dataset.addCart, {
      period: card?.querySelector("[data-buy-period]")?.value || "monthly",
      quantity: Number(card?.querySelector("[data-buy-quantity]")?.value || 1),
      onDone,
    });
  }));
}

async function renderMembershipPaywall(feature = "workspace features") {
  const membership = activeWorkspaceMembership();
  const plans = membership.plans?.length ? membership.plans : ((await api("/api/subscriptions/plans").catch(() => ({ plans: [] }))).plans || []);
  const personal = isPersonalWorkspaceContext();
  shell("Membership required", `
    <div class="page-title"><div><h1>Membership required</h1><p class="muted">Upgrade to use ${esc(feature)}. New workspaces can use these tools during the 14-day trial.</p></div><span class="pill warn">${esc(membershipLabel(membership.status))}</span></div>
    <section class="panel paywall-panel">
      <h2>Choose a package</h2>
      <p class="muted">${personal ? "Pay with PayPal to activate your package." : "This company workspace needs an active membership. Ask the company admin to purchase or activate a plan."}</p>
      ${pricingCardsHTML(plans, { canPurchase: personal })}
    </section>`);
  bindPurchaseButtons(async () => {
    await loadMe();
    await renderMembershipPaywall(feature);
  });
  icons();
}

async function guardPaidFeaturePage(feature) {
  if (paidFeatureAllowed()) {
    setTimeout(showTrialNoticeOnce, 0);
    return true;
  }
  await renderMembershipPaywall(feature);
  return false;
}

function subscriptionDurationText(subscription = {}) {
  const quantity = Number(subscription.billing_quantity || 1);
  const unit = billingUnitLabel(subscription.billing_period || "monthly");
  return `${quantity} ${unit}${quantity === 1 ? "" : "s"}`;
}

function usefulBillingDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getFullYear() <= 1) return "";
  return date.toLocaleDateString();
}

function currentMembershipIsPaid(membership = activeWorkspaceMembership()) {
  return membership.status === "active" && Boolean(membership.subscription_id) && !membership.trial;
}

function billingMembershipDetailsHTML(membership = activeWorkspaceMembership(), plans = []) {
  const plan = membership.plan || plans.find((item) => item.id === membership.plan_id) || {};
  const registeredAt = usefulBillingDate(state.me?.created_at) || "Unknown";
  const startedAt = usefulBillingDate(membership.started_at || membership.created_at) || "Not started";
  const expiresAt = usefulBillingDate(membership.expires_at) || "No expiry date";
  const period = membership.billing_period || "monthly";
  const quantity = Number(membership.billing_quantity || 1);
  const provider = membership.payment_provider ? String(membership.payment_provider).replace(/^./, (ch) => ch.toUpperCase()) : "No payment method";
  const amount = plan.id ? purchaseCartTotal(plan, period, quantity) : 0;
  const term = `${quantity} ${billingUnitLabel(period)}${quantity === 1 ? "" : "s"}`;
  return `<section class="panel billing-membership-panel">
    <div class="panel-head">
      <div>
        <h2>Membership details</h2>
        <p class="muted">${esc(plan.name || "Current package")} for ${esc(activeWorkspaceOption()?.name || "your workspace")}</p>
      </div>
      <span class="pill ${membership.status === "active" ? "" : membership.status === "trialing" ? "warn" : "danger"}">${esc(membershipLabel(membership.status))}</span>
    </div>
    <div class="admin-detail-stats billing-detail-stats">
      ${adminStatHTML("Account registered", registeredAt)}
      ${adminStatHTML("Membership started", startedAt)}
      ${adminStatHTML("Expires", expiresAt)}
      ${adminStatHTML("Billing term", term)}
      ${adminStatHTML("Payment method", provider)}
      ${adminStatHTML("Package price", amount ? money(amount) : "Set in plan")}
    </div>
    ${membership.external_transaction_id ? `<p class="muted">PayPal reference: ${esc(membership.external_transaction_id)}</p>` : ""}
  </section>`;
}

function billingInvoicesPanelHTML(invoices = [], options = {}) {
  const className = options.className || "";
  return `<section class="panel billing-invoices-panel ${esc(className)}">
    <h2>Invoices</h2>
    <div class="task-list">${invoices.map((invoice) => `<article class="task-row" id="invoice-${esc(invoice.id || invoice.subscription_id || "")}">
      <div><h3>${money(invoice.amount)} ${esc(invoice.currency || "").toUpperCase()}</h3><span class="muted">${fmtDate(invoice.issued_at)}</span></div>
      <span class="pill">${esc(invoice.status || "invoice")}</span>
      ${invoice.external_invoice_url ? `<a class="btn" href="${esc(invoice.external_invoice_url)}">Receipt</a>` : `<span class="muted">No receipt</span>`}
    </article>`).join("") || `<p class="muted">No invoices yet.</p>`}</div>
  </section>`;
}

function fmtDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString();
}

function appTimeZone() {
  const configured = String(state.platformSettings?.time_zone || "").trim();
  if (configured) return configured;
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function fmtDateTimeInTimeZone(value, timeZone = appTimeZone()) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  }
}

function fmtDateTime(value) {
  return fmtDateTimeInTimeZone(value, appTimeZone());
}

function fmtDayMonthYear(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function minutesLabel(minutes = 0) {
  const total = Math.max(0, Number(minutes) || 0);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function dateInputValue(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function activeDurationLabel(startTime) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startTime).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function taskTimeTrackerHTML(taskID, entries = [], activeEntry = null) {
  const taskEntries = (entries || []).filter((entry) => String(entry.task_id) === String(taskID));
  const activeForTask = activeEntry && String(activeEntry.task_id) === String(taskID) ? activeEntry : null;
  const totalMinutes = taskEntries.reduce((sum, entry) => sum + (Number(entry.duration_minutes) || 0), 0);
  return `<section class="task-time-tracker" data-time-tracker="${esc(taskID)}">
    <div class="task-time-head">
      <div><h3>Time tracker</h3><span class="muted">${esc(minutesLabel(totalMinutes))} logged${activeForTask ? " plus active timer" : ""}</span></div>
      <div class="toolbar compact-toolbar">
        ${activeForTask ? `<button class="btn danger compact" type="button" data-stop-task-timer="${esc(activeForTask.id)}">${icon("square")}Stop</button>` : `<button class="btn primary compact" type="button" data-start-task-timer="${esc(taskID)}">${icon("play")}Start</button>`}
      </div>
    </div>
    ${activeForTask ? `<p class="pill active-time-pill">${icon("timer")}<span data-active-task-time="${esc(activeForTask.start_time)}">${esc(activeDurationLabel(activeForTask.start_time))}</span></p>` : ""}
    <details class="manual-time-box">
      <summary>${icon("chevron-right")}Manual Time</summary>
      <form class="manual-time-form" data-manual-time-form="${esc(taskID)}">
        <div class="grid-3">
          <div class="field"><label>Date</label><input type="date" name="date" value="${esc(dateInputValue(new Date()))}"></div>
          <div class="field"><label>Minutes</label><input type="number" name="duration_minutes" min="1" step="1" value="30"></div>
          <div class="field"><label>Billable</label><select name="billable"><option value="true">Billable</option><option value="false">Non-billable</option></select></div>
        </div>
        <div class="field"><label>Note</label><input name="note" placeholder="What was worked on?"></div>
        <button class="btn compact" type="submit">${icon("plus")}Insert manual time</button>
        <p class="status-line"></p>
      </form>
    </details>
    <details class="time-history-box">
      <summary>${icon("history")}Time history (${taskEntries.length})</summary>
      <div class="time-history-list">
        ${taskEntries.map((entry) => timeEntryRowHTML(entry)).join("") || `<p class="muted">No time entries yet.</p>`}
      </div>
    </details>
  </section>`;
}

function timeEntryRowHTML(entry = {}) {
  const isRunning = !entry.end_time;
  return `<form class="time-entry-row" data-time-entry-form="${esc(entry.id)}">
    <div>
      <strong>${esc(isRunning ? "Running" : minutesLabel(entry.duration_minutes))}</strong>
      <span class="muted">${esc(fmtDate(entry.start_time))} ${entry.is_manual ? "manual" : "timer"}</span>
    </div>
    <input type="number" name="duration_minutes" min="1" step="1" value="${esc(entry.duration_minutes || 1)}" ${isRunning ? "disabled" : ""} title="Minutes">
    <input name="note" value="${esc(entry.note || "")}" placeholder="Note">
    <select name="billable"><option value="true" ${entry.billable ? "selected" : ""}>Billable</option><option value="false" ${!entry.billable ? "selected" : ""}>Non-billable</option></select>
    <button class="btn compact" type="submit" ${isRunning ? "disabled" : ""}>${icon("save")}Save</button>
    <button class="btn icon quiet danger-text" type="button" data-delete-time-entry="${esc(entry.id)}" title="Delete entry">${icon("trash-2")}</button>
    <p class="status-line"></p>
  </form>`;
}

function bindTaskTimeTracker(root, taskID, refresh = async () => {}) {
  const tracker = root.querySelector(`[data-time-tracker="${selectorEscape(taskID)}"]`);
  if (!tracker || tracker.dataset.timeTrackerBound === "1") return;
  tracker.dataset.timeTrackerBound = "1";
  let tick = null;
  const drawActiveTimes = () => {
    tracker.querySelectorAll("[data-active-task-time]").forEach((node) => {
      node.textContent = activeDurationLabel(node.dataset.activeTaskTime);
    });
  };
  if (tracker.querySelector("[data-active-task-time]")) {
    drawActiveTimes();
    tick = setInterval(drawActiveTimes, 1000);
    tracker.dataset.timerInterval = String(tick);
  }
  tracker.querySelector("[data-start-task-timer]")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    try {
      await api("/api/time-entries/start", { method: "POST", body: JSON.stringify({ task_id: taskID }) });
      await refreshTimerWidget();
      await refresh();
    } catch (error) {
      setStatus(error.message, true);
      event.currentTarget.disabled = false;
    }
  });
  tracker.querySelector("[data-stop-task-timer]")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    try {
      await api(`/api/time-entries/${event.currentTarget.dataset.stopTaskTimer}/stop`, { method: "POST" });
      await refreshTimerWidget();
      await refresh();
    } catch (error) {
      setStatus(error.message, true);
      event.currentTarget.disabled = false;
    }
  });
  tracker.querySelector("[data-manual-time-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    body.task_id = taskID;
    body.duration_minutes = Number(body.duration_minutes || 0);
    body.billable = body.billable !== "false";
    try {
      await api("/api/time-entries", { method: "POST", body: JSON.stringify(body) });
      await refresh();
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  tracker.querySelectorAll("[data-time-entry-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(form).entries());
      body.duration_minutes = Number(body.duration_minutes || 0);
      body.billable = body.billable !== "false";
      try {
        await api(`/api/time-entries/${form.dataset.timeEntryForm}`, { method: "PATCH", body: JSON.stringify(body) });
        await refresh();
      } catch (error) {
        setFormStatus(form, error.message, true);
      }
    });
  });
  tracker.querySelectorAll("[data-delete-time-entry]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!typedConfirm("Delete this time entry?")) return;
    await api(`/api/time-entries/${btn.dataset.deleteTimeEntry}`, { method: "DELETE" });
    await refresh();
  }));
}

function badgeCount(value) {
  const count = Number(value) || 0;
  return count > 99 ? "99+" : String(count);
}

function inboxUnreadTotal() {
  return (Number(state.unreadCommentCount) || 0) + (Number(state.unreadNotificationCount) || 0);
}

function unreadNotificationCount(notifications = []) {
  return (notifications || []).filter((note) => !note.read && note.type !== "team_invitation").length;
}

function resizeProfilePhotoFile(file, maxSize = 500) {
  const supportedSmallTypes = ["image/jpeg", "image/png", "image/gif"];
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith("image/")) {
      reject(new Error("Image file is required"));
      return;
    }
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) {
        URL.revokeObjectURL(url);
        reject(new Error("Image has invalid dimensions"));
        return;
      }
      if (width <= maxSize && height <= maxSize && supportedSmallTypes.includes(file.type)) {
        URL.revokeObjectURL(url);
        resolve(file);
        return;
      }
      const scale = Math.min(maxSize / width, maxSize / height);
      const targetWidth = Math.max(1, Math.round(width * scale));
      const targetHeight = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      canvas.getContext("2d").drawImage(image, 0, 0, targetWidth, targetHeight);
      URL.revokeObjectURL(url);
      const type = file.type === "image/png" ? "image/png" : "image/jpeg";
      const ext = type === "image/png" ? "png" : "jpg";
      const base = (file.name || "profile").replace(/\.[^.]+$/, "") || "profile";
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Could not resize image"));
          return;
        }
        resolve(new File([blob], `${base}-500.${ext}`, { type, lastModified: Date.now() }));
      }, type, 0.86);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image must be a valid JPG, PNG, GIF, or WebP file"));
    };
    image.src = url;
  });
}

function setStatus(text, error = false) {
  const line = $(".status-line");
  if (line) {
    line.textContent = text || "";
    line.style.color = error ? "var(--danger)" : "var(--text-secondary)";
  }
}

function setFormStatus(form, text, error = false) {
  const line = form?.querySelector(".status-line");
  if (line) {
    line.textContent = text || "";
    line.style.color = error ? "var(--danger)" : "var(--text-secondary)";
  }
}

async function api(url, options = {}, retry = true) {
  const headers = options.headers || {};
  const isForm = options.body instanceof FormData;
  if (!isForm) headers["Content-Type"] = "application/json";
  if (state.access) headers.Authorization = "Bearer " + state.access;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401 && retry && state.refresh) {
    const refreshed = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: state.refresh }),
    });
    if (refreshed.ok) {
      const data = await refreshed.json();
      storeTokens(data.access_token, data.refresh_token);
      return api(url, options, false);
    }
  }
  const type = res.headers.get("Content-Type") || "";
  const body = type.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const message = typeof body === "object" ? (body.error || "Request failed") : (body || "Request failed");
    const error = new Error(message);
    error.status = res.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function apiBlob(url, options = {}, retry = true) {
  const headers = options.headers || {};
  if (state.access) headers.Authorization = "Bearer " + state.access;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401 && retry && state.refresh) {
    const refreshed = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: state.refresh }),
    });
    if (refreshed.ok) {
      const data = await refreshed.json();
      storeTokens(data.access_token, data.refresh_token);
      return apiBlob(url, options, false);
    }
  }
  if (!res.ok) {
    const type = res.headers.get("Content-Type") || "";
    const body = type.includes("application/json") ? await res.json() : await res.text();
    const message = typeof body === "object" ? (body.error || "Download failed") : (body || "Download failed");
    const error = new Error(message);
    error.status = res.status;
    error.body = body;
    throw error;
  }
  return {
    blob: await res.blob(),
    filename: filenameFromDisposition(res.headers.get("Content-Disposition") || "", "download.pdf"),
  };
}

function filenameFromDisposition(disposition, fallback = "download") {
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1].replace(/^"|"$/g, ""));
    } catch {
      return utfMatch[1].replace(/^"|"$/g, "");
    }
  }
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1]?.trim() || fallback;
}

async function downloadAuthenticatedFile(url, fallbackFilename = "download.pdf") {
  const data = await apiBlob(url);
  const objectURL = URL.createObjectURL(data.blob);
  const link = document.createElement("a");
  link.href = objectURL;
  link.download = data.filename || fallbackFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectURL), 1500);
}

function storeTokens(access, refresh, remember = authRememberPreference()) {
  state.access = access;
  state.refresh = refresh;
  clearStoredTokens();
  localStorage.setItem(AUTH_REMEMBER_KEY, remember ? "1" : "0");
  const storage = remember ? localStorage : sessionStorage;
  storage.setItem(AUTH_ACCESS_KEY, access);
  storage.setItem(AUTH_REFRESH_KEY, refresh);
}

function logout() {
  stopNotificationPolling();
  stopLivePolling();
  fetch("/api/auth/logout", { method: "POST", keepalive: true }).catch(() => {});
  clearStoredTokens();
  state.access = "";
  state.refresh = "";
  window.location.href = "/login";
}

async function syncSessionCookie() {
  if (!state.access || state.sessionCookieSynced) return;
  state.sessionCookieSynced = true;
  try {
    const res = await fetch("/api/auth/session-cookie", {
      method: "POST",
      headers: { Authorization: "Bearer " + state.access },
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.access_token && data.refresh_token) storeTokens(data.access_token, data.refresh_token);
  } catch {
    // The app can still work with the Authorization header; the widget just waits for a valid cookie.
  }
}

async function loadMe() {
  const previousTeamID = state.team?.id || "";
  const data = await api("/api/users/me");
  state.me = data.user;
  state.team = data.team;
  state.personalTeam = data.personal_team || null;
  state.companyAccess = data.company_access || null;
  state.companyAccesses = Array.isArray(data.company_accesses)
    ? data.company_accesses
    : (data.company_access ? [data.company_access] : []);
  state.membership = data.membership || null;
  state.platformSettings = data.platform_settings || null;
  state.unreadCommentCount = Number(data.unread_comment_count || 0);
  syncSessionCookie();
  const clientData = await api("/api/client-projects").catch(() => ({ clients: [], websites: [] }));
  state.clientProjects = clientData.clients || [];
  state.clientWebsites = clientData.websites || [];
  ensureWorkspaceContext();
  if ((state.team?.id || "") !== previousTeamID) state.mentionUsers = null;
  const preference = state.me.theme_preference || "system";
  localStorage.setItem("bugmega_theme", preference);
  applyTheme(preference);
  applyPlatformTheme(state.platformSettings || {});
  applyPlatformFavicon(state.platformSettings || {});
}

function applyTheme(preference) {
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = preference === "system" ? (prefersDark ? "dark" : "light") : preference;
  if (state.platformSettings) applyPlatformTheme(state.platformSettings);
}

function applyPlatformTheme(settings = {}) {
  const root = document.documentElement;
  const sharedVars = {
    theme_primary_color: "--accent",
    theme_primary_strong_color: "--accent-strong",
    theme_button_color: "--button-primary-color",
    theme_button_text_color: "--button-primary-text-color",
  };
  const lightOnlyVars = {
    theme_font_color: "--text-primary",
    theme_heading_color: "--heading-color",
    theme_background_color: "--bg-primary",
  };
  Object.entries(sharedVars).forEach(([key, variable]) => {
    const value = String(settings?.[key] || "").trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) root.style.setProperty(variable, value);
    else root.style.removeProperty(variable);
  });
  const isDark = root.dataset.theme === "dark";
  Object.entries(lightOnlyVars).forEach(([key, variable]) => {
    const value = String(settings?.[key] || "").trim();
    if (!isDark && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) root.style.setProperty(variable, value);
    else root.style.removeProperty(variable);
  });
}

async function uploadResizedImage(file, purpose = "profile", maxSize = 500) {
  const uploadFile = await resizeProfilePhotoFile(file, maxSize);
  const body = new FormData();
  body.append("purpose", purpose);
  body.append("file", uploadFile);
  return api("/api/uploads", { method: "POST", body });
}

function applyPlatformFavicon(settings = {}) {
  const url = String(settings?.favicon_url || "").trim();
  let link = document.querySelector("link[rel='icon']");
  if (!url) {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = url;
}

function googleAuthStartURL(mode, inviteToken = "") {
  const params = new URLSearchParams({ mode });
  if (inviteToken) params.set("invite", inviteToken);
  return `/api/auth/google/start?${params.toString()}`;
}

async function renderAuth(mode) {
  if (!state.platformSettings) {
    const platform = await api("/api/platform-settings").catch(() => ({ settings: {} }));
    state.platformSettings = platform.settings || {};
    applyPlatformTheme(state.platformSettings);
    applyPlatformFavicon(state.platformSettings);
  }
  const isRegister = mode === "register";
  const inviteToken = new URLSearchParams(location.search).get("invite") || "";
  const platformName = state.platformSettings?.site_name || "bugmega";
  const googleEnabled = state.platformSettings?.google_signin_enabled === true;
  const rememberDefault = authRememberPreference();
  app.innerHTML = `
    <div class="auth-wrap">
      <section class="auth-box">
        <a class="brand" href="/"><span class="brand-mark">${esc(platformName.slice(0, 1) || "P")}</span>${esc(platformName)}</a>
        <h1>${isRegister ? (inviteToken ? "Create invited account" : "Create workspace") : "Welcome back"}</h1>
        ${googleEnabled ? `<a class="btn google-auth-btn" href="${esc(googleAuthStartURL(isRegister ? "register" : "login", inviteToken))}"><span class="google-mark">G</span>${isRegister ? "Sign up with Google" : "Continue with Google"}</a>
        <div class="auth-divider"><span>or</span></div>` : ""}
        <form id="authForm" class="form-grid">
          ${isRegister ? `<div class="field"><label>Name</label><input name="name" required></div>` : ""}
          ${isRegister ? `<div class="field"><label>Username</label><input name="username" required pattern="[a-zA-Z0-9_]{3,24}" placeholder="jane_writer"></div>` : ""}
          ${isRegister && !inviteToken ? `<div class="field"><label>Company name</label><input name="company_name" required placeholder="Acme Inc"></div>` : ""}
          ${isRegister && inviteToken ? `<input type="hidden" name="invite_token" value="${esc(inviteToken)}"><p class="muted">Create your account first, then review the company invitation from Inbox to accept or decline.</p>` : ""}
          <div class="field"><label>Email</label><input type="email" name="email" required></div>
          <div class="field"><label>Password</label><input type="password" name="password" required minlength="8"></div>
          ${!isRegister ? `<div class="field two-factor-field" hidden><label>Authenticator code</label><input id="twoFactorCode" name="two_factor_code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></div>` : ""}
          ${!isRegister ? `<label class="check-row auth-remember-row"><input type="checkbox" name="remember_me" value="1" ${rememberDefault ? "checked" : ""}> Remember me</label>` : ""}
          <button class="btn primary" type="submit" id="authSubmitBtn">${icon(isRegister ? "user-plus" : "log-in")}${isRegister ? "Create account" : "Login"}</button>
          <p class="status-line"></p>
        </form>
        <p class="muted">${isRegister ? `Already have an account? <a class="text-link" href="/login">Login</a>` : `New team? <a class="text-link" href="/register">Create a workspace</a>`}</p>
      </section>
    </div>`;
  icons();
  $("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const authForm = event.currentTarget;
    const form = Object.fromEntries(new FormData(authForm).entries());
    const rememberMe = isRegister ? true : Boolean(form.remember_me);
    delete form.remember_me;
    if (isRegister && form.company_name) form.workspace_name = form.company_name;
    try {
      const data = await api(isRegister ? "/api/auth/register" : "/api/auth/login", { method: "POST", body: JSON.stringify(form) });
      if (data.two_factor_required) {
        authForm.dataset.twoFactorPending = "1";
        $(".two-factor-field")?.removeAttribute("hidden");
        const codeInput = $("#twoFactorCode");
        if (codeInput) {
          codeInput.required = true;
          codeInput.focus();
        }
        $("#authSubmitBtn").innerHTML = `${icon("shield-check")}Verify code`;
        icons();
        setStatus("Enter your authenticator code");
        return;
      }
      storeTokens(data.access_token, data.refresh_token, rememberMe);
      window.location.href = "/dashboard";
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

function navLink(href, label, iconName) {
  const active = isActiveRoute(href);
  return `<a class="${active ? "active" : ""}" href="${href}">${icon(iconName)}${label}</a>`;
}

function isActiveRoute(href) {
  return path() === href || (href !== "/dashboard" && path().startsWith(href));
}

function railLink(href, label, iconName) {
  return `<a class="rail-link ${isActiveRoute(href) ? "active" : ""}" href="${href}" title="${esc(label)}">${icon(iconName)}<span>${esc(label)}</span></a>`;
}

function workspaceLink(href, label, iconName, badge = "") {
  return `<a class="nav-item ${isActiveRoute(href) ? "active" : ""}" href="${href}">${icon(iconName)}<span>${esc(label)}</span>${badge ? `<strong class="unread-badge">${esc(badge)}</strong>` : ""}</a>`;
}

function workspaceChild(href, label, iconName, badge = "") {
  return `<a class="nav-child ${isActiveRoute(href) ? "active" : ""}" href="${href}">${icon(iconName)}<span>${esc(label)}</span>${badge ? `<strong class="mini-count">${esc(badge)}</strong>` : ""}</a>`;
}

function isRoutableAppURL(url) {
  if (url.origin !== window.location.origin) return false;
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (pathname === "/login" || pathname === "/register") return true;
  return [
    "/dashboard",
    "/chat",
    "/team",
    "/tasks",
    "/projects",
    "/websites",
    "/settings",
    "/reports",
    "/admin",
    "/spaces",
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function navigateApp(href, options = {}) {
  const url = new URL(href, window.location.href);
  if (!isRoutableAppURL(url)) {
    window.location.href = url.href;
    return;
  }
  const target = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (target === current) return;
  if (options.replace) history.replaceState(null, "", target);
  else history.pushState(null, "", target);
  window.scrollTo(0, 0);
  route().catch(renderRouteError);
}

function bindAppNavigation() {
  if (state.appNavigationBound) return;
  state.appNavigationBound = true;
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest("a[href]");
    if (!link) return;
    if (link.target && link.target !== "_self") return;
    if (link.hasAttribute("download")) return;
    const href = link.getAttribute("href") || "";
    if (!href || href === "#" || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    const url = new URL(href, window.location.href);
    if (!isRoutableAppURL(url)) return;
    event.preventDefault();
    navigateApp(url.href);
  });
  window.addEventListener("popstate", () => route().catch(renderRouteError));
}

function saveProjectSidebarState() {
  localStorage.setItem("bugmega_project_sidebar_open", JSON.stringify(state.projectSidebarOpen || {}));
}

function setProjectSidebarOpen(clientID, isOpen) {
  state.projectSidebarOpen = state.projectSidebarOpen || {};
  state.projectSidebarOpen[clientID] = Boolean(isOpen);
  saveProjectSidebarState();
}

function isProjectSidebarOpen(client) {
  const stored = state.projectSidebarOpen?.[client.id];
  if (typeof stored === "boolean") return stored;
  return isActiveRoute(`/projects/${client.id}`);
}

function canManageSidebarClient(client) {
  const userID = state.me?.id || "";
  if (!userID) return false;
  if (state.me?.role === "owner_adm") return true;
  if ((client.client_admin_ids || []).includes(userID)) return true;
  if (client.created_by === userID) return true;
  return isPersonalWorkspaceContext() && state.me?.role === "users_admin" && [state.me?.team_id, state.personalTeam?.id].filter(Boolean).includes(client.team_id);
}

function sidebarProjectsHTML() {
  const workspaceTeamID = activeWorkspaceTeamID();
  const sitesByClient = (state.clientWebsites || []).reduce((acc, site) => {
    (acc[site.client_id] ||= []).push(site);
    return acc;
  }, {});
  const visibleClients = (state.clientProjects || []).filter((client) => !workspaceTeamID || client.team_id === workspaceTeamID);
  const rows = visibleClients.map((client) => {
    const sites = sitesByClient[client.id] || [];
    const isOpen = isProjectSidebarOpen(client);
    const canManage = canManageSidebarClient(client);
    return `
      <div class="nav-group project-nav-group ${isOpen ? "expanded" : ""}" data-sidebar-project="${esc(client.id)}">
        <div class="nav-item project-folder-row ${isActiveRoute(`/projects/${client.id}`) ? "active" : ""}">
          <button class="project-folder-toggle" type="button" data-project-toggle="${esc(client.id)}" aria-expanded="${isOpen ? "true" : "false"}" title="${isOpen ? "Collapse folder" : "Expand folder"}">${icon(isOpen ? "chevron-down" : "chevron-right")}</button>
          <a class="project-folder-link" href="/projects/${esc(client.id)}">${icon("folder")}<span>${esc(client.name)}</span></a>
          ${sites.length ? `<strong class="mini-count">${esc(sites.length)}</strong>` : ""}
          ${canManage ? `<button class="project-add-website" type="button" data-sidebar-add-website="${esc(client.id)}" title="Add website">${icon("plus")}</button>` : ""}
        </div>
        <div class="project-site-list" ${isOpen ? "" : "hidden"}>
          ${sites.map((site) => workspaceChild(`/projects/${client.id}/sites/${site.id}`, site.name, "globe-2")).join("") || `<span class="project-site-empty">No websites yet</span>`}
        </div>
      </div>`;
  }).join("");
  return rows || workspaceChild("/projects", isPersonalWorkspaceContext() ? "Add client folder" : "No shared projects", isPersonalWorkspaceContext() ? "folder-plus" : "folder-lock");
}

function sidebarWebsiteDialogHTML() {
  return `<dialog id="sidebarWebsiteDialog" class="modal client-dialog">
    <form id="sidebarWebsiteForm" class="form-grid" method="dialog">
      <input type="hidden" name="client_id">
      <div class="modal-head">
        <div>
          <h2>Add website</h2>
          <p class="muted" id="sidebarWebsiteClientName"></p>
        </div>
        <button class="btn icon quiet" type="button" data-close-dialog="sidebarWebsiteDialog" title="Close">${icon("x")}</button>
      </div>
      <div class="field"><label>Website name</label><input name="name" required></div>
      <div class="field"><label>Website URL</label><input name="url" placeholder="https://example.com"></div>
      <div class="field"><label>Website details</label><textarea name="details" data-mentionable></textarea></div>
      <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Create</button><button class="btn" type="button" data-close-dialog="sidebarWebsiteDialog">Cancel</button></div>
      <p class="status-line"></p>
    </form>
  </dialog>`;
}

function bindDialogCloseButtons(root = document) {
  root.querySelectorAll("[data-close-dialog]").forEach((btn) => {
    if (btn.dataset.closeBound === "1") return;
    btn.dataset.closeBound = "1";
    btn.addEventListener("click", () => {
      const targetID = btn.dataset.closeDialog || "";
      const dialog = targetID ? document.getElementById(targetID) : btn.closest("dialog");
      dialog?.close();
    });
  });
}

function bindSidebarProjectControls() {
  document.querySelectorAll("[data-project-toggle]").forEach((btn) => btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const clientID = btn.dataset.projectToggle;
    const nextOpen = btn.getAttribute("aria-expanded") !== "true";
    setProjectSidebarOpen(clientID, nextOpen);
    const group = btn.closest("[data-sidebar-project]");
    const list = group?.querySelector(".project-site-list");
    group?.classList.toggle("expanded", nextOpen);
    if (nextOpen) list?.removeAttribute("hidden");
    else list?.setAttribute("hidden", "");
    btn.setAttribute("aria-expanded", nextOpen ? "true" : "false");
    btn.setAttribute("title", nextOpen ? "Collapse folder" : "Expand folder");
    btn.innerHTML = icon(nextOpen ? "chevron-down" : "chevron-right");
    icons();
  }));

  const dialog = $("#sidebarWebsiteDialog");
  const form = $("#sidebarWebsiteForm");
  document.querySelectorAll("[data-sidebar-add-website]").forEach((btn) => btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const clientID = btn.dataset.sidebarAddWebsite;
    const client = (state.clientProjects || []).find((item) => item.id === clientID);
    if (!dialog || !form || !client) return;
    form.reset();
    form.elements.client_id.value = clientID;
    $("#sidebarWebsiteClientName").textContent = client.name || "Client folder";
    dialog.showModal();
  }));

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const clientID = form.elements.client_id.value;
    const values = Object.fromEntries(new FormData(form).entries());
    delete values.client_id;
    try {
      const created = await api(`/api/client-projects/${clientID}/websites`, { method: "POST", body: JSON.stringify(values) });
      setProjectSidebarOpen(clientID, true);
      await refreshClientSidebarCache();
      window.location.href = `/projects/${clientID}/sites/${created.website.id}`;
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });

  bindDialogCloseButtons(dialog || document);
}

function commandSearchResultIcon(result = {}) {
  const type = String(result.type || "").toLowerCase();
  if (type.includes("mention")) return "at-sign";
  if (type.includes("comment")) return "message-square";
  if (type.includes("annotation")) return "map-pin";
  return "circle-check-big";
}

function commandSearchResultHTML(result, index) {
  const type = result.type || "Result";
  const title = result.title || "Untitled";
  const snippet = result.snippet || result.context || "";
  const context = result.context || "";
  const author = result.author_name ? ` by ${result.author_name}` : "";
  return `<button class="command-search-result" type="button" data-command-result="${esc(index)}">
    <span class="command-search-icon">${icon(commandSearchResultIcon(result))}</span>
    <span class="command-search-copy">
      <strong><small>${esc(type)}</small>${esc(title)}</strong>
      ${snippet ? `<span>${esc(snippet)}</span>` : ""}
      ${context || author ? `<em>${esc([context, author.trim()].filter(Boolean).join(" - "))}</em>` : ""}
    </span>
  </button>`;
}

function renderCommandSearchResults(results = [], query = "") {
  const panel = $("#commandSearchResults");
  if (!panel) return;
  state.commandSearchResults = results;
  if (!query.trim()) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }
  panel.hidden = false;
  if (!results.length) {
    panel.innerHTML = `<div class="command-search-empty">No results for "${esc(query)}"</div>`;
    return;
  }
  panel.innerHTML = results.map((result, index) => commandSearchResultHTML(result, index)).join("");
  panel.querySelectorAll("[data-command-result]").forEach((btn) => btn.addEventListener("click", async () => {
    const result = state.commandSearchResults[Number(btn.dataset.commandResult)];
    await openCommandSearchResult(result);
  }));
  icons();
}

async function openCommandSearchResult(result = {}) {
  const panel = $("#commandSearchResults");
  if (panel) panel.hidden = true;
  const taskID = result.task_id;
  const commentID = result.comment_id || "";
  if (!taskID) return;
  if (result.source_type === "client_task") {
    const target = result.url || `/tasks?task_id=${encodeURIComponent(taskID)}${commentID ? `&comment_id=${encodeURIComponent(commentID)}` : ""}`;
    if (path() !== "/tasks") {
      window.location.href = target;
      return;
    }
    history.replaceState(null, "", target);
    if (commentID) {
      await api(`/api/client-task-comments/${commentID}/read`, { method: "POST", body: JSON.stringify({}) }).catch(() => null);
    }
    await openClientTaskWithProgress(taskID, commentID);
    return;
  }
  const target = result.url || `/dashboard?task_id=${encodeURIComponent(taskID)}${commentID ? `&comment_id=${encodeURIComponent(commentID)}` : ""}&source_type=task`;
  if (path() !== "/dashboard") {
    window.location.href = target;
    return;
  }
  history.replaceState(null, "", target);
  if (commentID) {
    await api(`/api/tasks/${taskID}/comments/${commentID}/read`, { method: "POST", body: JSON.stringify({}) }).catch(() => null);
  }
  const data = await api(`/api/tasks/${taskID}`);
  showTaskDetailDialog(data, commentID);
}

function bindCommandSearch() {
  const input = $("#commandSearch");
  const panel = $("#commandSearchResults");
  if (!input || !panel) return;
  input.addEventListener("input", () => {
    const query = input.value.trim();
    clearTimeout(state.commandSearchTimer);
    state.commandSearchAbort?.abort();
    if (query.length < 2) {
      renderCommandSearchResults([], "");
      return;
    }
    panel.hidden = false;
    panel.innerHTML = `<div class="command-search-empty">Searching...</div>`;
    state.commandSearchTimer = setTimeout(async () => {
      try {
        state.commandSearchAbort = new AbortController();
        const data = await api(`/api/search?q=${encodeURIComponent(query)}`, { signal: state.commandSearchAbort.signal });
        renderCommandSearchResults(data.results || [], query);
      } catch (error) {
        if (error.name === "AbortError") return;
        panel.innerHTML = `<div class="command-search-empty danger-text">${esc(error.message)}</div>`;
      }
    }, 180);
  });
  input.addEventListener("focus", () => {
    if (state.commandSearchResults.length) panel.hidden = false;
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      panel.hidden = true;
      return;
    }
    if (event.key !== "Enter") return;
    const first = state.commandSearchResults[0];
    if (first) {
      event.preventDefault();
      openCommandSearchResult(first);
      return;
    }
    const query = input.value.trim();
    if (query) window.location.href = `/tasks?search=${encodeURIComponent(query)}`;
  });
  if (!state.commandSearchDismissBound) {
    state.commandSearchDismissBound = true;
    document.addEventListener("click", (event) => {
      if (event.target.closest(".command-search-wrap")) return;
      document.querySelectorAll(".command-search-results").forEach((node) => {
        node.hidden = true;
      });
    });
  }
}

function shell(title, html) {
  const workspaceOptionList = workspaceOptions();
  const activeWorkspace = activeWorkspaceOption();
  const workspaceName = activeWorkspace?.name || "Workspace";
  const workspaceSubtitle = activeWorkspace?.subtitle || (state.me?.name || state.me?.username || state.me?.email || "User");
  const workspaceLogo = workspaceAvatar(activeWorkspace);
  const personalWorkspace = isPersonalWorkspaceContext();
  document.body.classList.toggle("sidebar-collapsed", Boolean(state.sidebarCollapsed));
  app.innerHTML = `
    <div class="workspace-shell clickup-shell ${state.sidebarCollapsed ? "sidebar-collapsed" : ""}">
      <aside class="workspace-nav" aria-label="Workspace">
        <div class="workspace-switcher">
          ${workspaceLogo}
          <div>
            <strong>${esc(workspaceName)}</strong>
            <span>${esc(workspaceSubtitle)}</span>
          </div>
        </div>
        ${workspaceContextPickerHTML(workspaceOptionList)}
        <nav class="workspace-menu">
          <p class="nav-kicker">Home</p>
          ${workspaceLink("/dashboard", "Inbox", "inbox", badgeCount(inboxUnreadTotal()))}
          ${workspaceLink("/chat", "Chat", "messages-square")}
          ${workspaceLink("/team", "Team", "users")}
          <div class="nav-group">
            ${workspaceLink("/tasks", "Tasks", "circle-check-big")}
            ${workspaceChild("/tasks?view=assigned", "Assigned to me", "user-check")}
            ${workspaceChild("/tasks?view=calendar", "Today & Upcoming", "calendar-days", "4")}
          </div>
          <p class="nav-kicker">Projects</p>
          ${sidebarProjectsHTML()}
          <p class="nav-kicker">Tools</p>
          ${workspaceChild("/projects", "All projects", "folder-open")}
          ${workspaceChild("/team/performance", "Team Performance", "bar-chart-3")}
          ${workspaceChild("/reports/time", "Time reports", "timer")}
          ${personalWorkspace && state.me?.role === "users_admin" ? workspaceChild("/team/integrations", "Integrations", "plug") : ""}
          ${state.me?.role === "owner_adm" ? `
            <p class="nav-kicker">Owner</p>
            ${workspaceLink("/admin/users", "Manage users", "users")}
            ${workspaceChild("/admin/plans", "Pricing plans", "badge-dollar-sign")}
            ${workspaceChild("/admin/pages", "Pages", "file-pen")}
            ${workspaceChild("/admin/settings", "Settings", "settings")}
          ` : ""}
        </nav>
        <a class="mention-pill" href="/settings/company">${icon("settings")}Settings</a>
      </aside>
      <button class="sidebar-toggle" id="sidebarToggle" type="button" title="${state.sidebarCollapsed ? "Expand menu" : "Collapse menu"}">${icon(state.sidebarCollapsed ? "panel-left-open" : "panel-left-close")}</button>
      <main class="main-area">
        <header class="topbar command-topbar">
          <div class="command-search-wrap">
            <label class="command-bar" for="commandSearch">
              ${icon("search")}
              <input id="commandSearch" autocomplete="off" placeholder="Search tasks, comments, mentions">
            </label>
            <div class="command-search-results" id="commandSearchResults" hidden></div>
          </div>
          <div class="topbar-actions">
            <div class="profile-menu">
              <button class="profile-menu-button" id="profileMenuBtn" type="button" aria-haspopup="true" aria-expanded="false" title="More options">
                ${userChip()}
                ${icon("chevron-down")}
              </button>
              <div class="profile-dropdown" id="profileDropdown" hidden>
                <div class="profile-summary">
                  ${userChip()}
                  <div>
                    <strong>${esc(state.me?.name || "User")}</strong>
                    <span>${esc(state.me?.email || "")}</span>
                  </div>
                </div>
                <a class="dropdown-item" href="/tasks">${icon("circle-check-big")}Create task</a>
                <a class="dropdown-item" href="/chat">${icon("messages-square")}Chat</a>
                <button class="dropdown-item" id="helpChatBtn" type="button">${icon("circle-help")}Help</button>
                <a class="dropdown-item" href="/settings/company">${icon("settings")}Settings</a>
                <a class="dropdown-item" href="/settings/billing">${icon("credit-card")}Billing</a>
                <label class="dropdown-field">
                  <span>${icon("palette")}Theme</span>
                  <select id="themeSelect" aria-label="Theme">
                    <option value="system">System</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </label>
                <button class="dropdown-item danger-text" id="logoutBtn" type="button">${icon("log-out")}Sign out</button>
              </div>
            </div>
          </div>
        </header>
        <section class="page-content">${html}</section>
      </main>
    </div>
    <div id="timerWidget" class="timer-widget"></div>
    ${sidebarWebsiteDialogHTML()}`;
  syncTaskPanelOffset();
  $("#logoutBtn").addEventListener("click", logout);
  $("#helpChatBtn")?.addEventListener("click", () => {
    closeProfileMenu();
    openHelpChatWidget();
  });
  $("#themeSelect").value = state.me?.theme_preference || "system";
  $("#themeSelect").addEventListener("change", async (event) => {
    const theme = event.target.value;
    localStorage.setItem("bugmega_theme", theme);
    applyTheme(theme);
    await api("/api/users/me/preferences", { method: "PATCH", body: JSON.stringify({ theme }) });
  });
  bindMentionSuggestions(app);
  bindDialogCloseButtons(app);
  bindWorkspaceContextSwitcher();
  bindSidebarProjectControls();
  $("#sidebarToggle")?.addEventListener("click", () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    localStorage.setItem("bugmega_sidebar_collapsed", state.sidebarCollapsed ? "1" : "0");
    document.body.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
    const shellEl = app.querySelector(".workspace-shell");
    shellEl?.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
    requestAnimationFrame(syncTaskPanelOffset);
    const btn = $("#sidebarToggle");
    if (btn) {
      btn.title = state.sidebarCollapsed ? "Expand menu" : "Collapse menu";
      btn.innerHTML = icon(state.sidebarCollapsed ? "panel-left-open" : "panel-left-close");
      icons();
    }
  });
  bindCommandSearch();
  const profileMenuBtn = $("#profileMenuBtn");
  const profileDropdown = $("#profileDropdown");
  const closeProfileMenu = () => {
    profileDropdown?.setAttribute("hidden", "");
    profileMenuBtn?.setAttribute("aria-expanded", "false");
  };
  profileMenuBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = !profileDropdown?.hasAttribute("hidden");
    if (isOpen) closeProfileMenu();
    else {
      profileDropdown?.removeAttribute("hidden");
      profileMenuBtn.setAttribute("aria-expanded", "true");
    }
  });
  profileDropdown?.addEventListener("click", (event) => event.stopPropagation());
  document.onclick = () => closeProfileMenu();
  document.onkeydown = (event) => {
    if (event.key === "Escape") closeProfileMenu();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      $("#commandSearch")?.focus();
    }
  };
  icons();
  refreshTimerWidget();
}

async function getFirstList() {
  if (!state.team) return null;
  const spaces = await api(`/api/spaces/${state.team.id}`);
  const space = (spaces.spaces || [])[0];
  if (!space?.project_ids?.length) return null;
  const projectID = space.project_ids[0];
  const lists = await api(`/api/projects/${projectID}/lists`);
  return (lists.lists || [])[0] || null;
}

async function renderDashboard() {
  const params = new URLSearchParams(location.search);
  const mentionFilter = params.get("mention") || "all";
  const projectFilter = params.get("project_id") || "";
  const inboxParams = new URLSearchParams({ mention: mentionFilter });
  if (projectFilter) inboxParams.set("project_id", projectFilter);
  const inboxData = await api(`/api/inbox/comments?${inboxParams.toString()}`).catch(() => ({ comments: [], projects: [], unread_count: 0 }));
  const inboxComments = inboxData.comments || [];
  const projects = inboxData.projects || [];
  state.unreadCommentCount = Number(inboxData.unread_count || 0);
  const invitationData = await api("/api/users/me/invitations").catch(() => ({ invitations: [] }));
  const invitations = invitationData.invitations || [];
  const notificationData = await api("/api/users/me/notifications").catch(() => ({ notifications: [] }));
  const notifications = (notificationData.notifications || []).filter((note) => note.type !== "team_invitation");
  const notificationBinData = await api("/api/users/me/notifications?bin=1").catch(() => ({ notifications: [] }));
  const deletedNotifications = (notificationBinData.notifications || []).filter((note) => note.type !== "team_invitation");
  state.unreadNotificationCount = unreadNotificationCount(notifications) + invitations.length;
  shell("Inbox", `
    <div class="inbox-page">
      <div class="inbox-head">
        <div>
          <h1>Inbox</h1>
          <p class="muted">${esc(state.team?.name || "bugmega")} task comments</p>
        </div>
        <span id="inboxUnreadSummary" class="pill ${inboxUnreadTotal() ? "warn" : ""}">${esc(badgeCount(inboxUnreadTotal()))} unread</span>
      </div>
      <div id="invitationCenterMount">${invitationCards(invitations)}</div>
      <div id="notificationCenterMount">${notificationCards(notifications, deletedNotifications)}</div>
      <section class="panel inbox-filter-panel">
        <div class="inbox-filter-row">
          <div class="tabs">
            <button class="${mentionFilter === "all" ? "active" : ""}" type="button" data-inbox-mention-filter="all">${icon("messages-square")}All comments</button>
            <button class="${mentionFilter === "mention_me" ? "active" : ""}" type="button" data-inbox-mention-filter="mention_me">${icon("at-sign")}Mention me</button>
            <button class="${mentionFilter === "mention_others" ? "active" : ""}" type="button" data-inbox-mention-filter="mention_others">${icon("users")}Mention teammates</button>
          </div>
          <div class="field inbox-project-filter">
            <label>Project</label>
            <select id="inboxProjectFilter">
              <option value="">All projects</option>
              ${projects.map((project) => `<option value="${esc(project.id)}" ${projectFilter === project.id ? "selected" : ""}>${esc(project.name)}</option>`).join("")}
            </select>
          </div>
        </div>
      </section>
      <div id="inboxCommentsMount">${inboxSection("Comments", inboxCommentRows(inboxComments))}</div>
    </div>`);
  state.liveInboxSignature = inboxCommentsLiveSignature(inboxData);
  bindInvitationActions();
  document.querySelectorAll("[data-inbox-mention-filter]").forEach((btn) => btn.addEventListener("click", () => {
    setInboxFilters(btn.dataset.inboxMentionFilter, $("#inboxProjectFilter")?.value || "");
  }));
  $("#inboxProjectFilter")?.addEventListener("change", (event) => {
    setInboxFilters(mentionFilter, event.currentTarget.value);
  });
  bindInboxCommentRows();
  bindNotificationActions();
  const focusTaskID = params.get("task_id") || "";
  const focusCommentID = params.get("comment_id") || "";
  if (focusTaskID && (params.get("source_type") || "task") === "task") {
    setTimeout(async () => {
      try {
        if (focusCommentID) {
          const readData = await api(`/api/tasks/${focusTaskID}/comments/${focusCommentID}/read`, { method: "POST", body: JSON.stringify({}) }).catch(() => ({}));
          if (readData.unread_count !== undefined) updateInboxBadge(readData.unread_count);
        }
        const data = await api(`/api/tasks/${focusTaskID}`);
        showTaskDetailDialog(data, focusCommentID);
      } catch (error) {
        setStatus(error.message, true);
      }
    }, 0);
  }
}

function bindInvitationActions() {
  document.querySelectorAll("[data-invite-action]").forEach((btn) => btn.addEventListener("click", async () => {
    try {
      await api(`/api/invitations/${btn.dataset.inviteId}/${btn.dataset.inviteAction}`, { method: "POST", body: JSON.stringify({}) });
      await loadMe();
      await renderDashboard();
    } catch (error) {
      setStatus(error.message, true);
    }
  }));
}

function invitationCards(invitations) {
  if (!invitations.length) return "";
  return `<section class="invite-strip">${invitations.map((invite) => `
    <article class="invite-card">
      <div>
        <strong>${icon("mail-check")} Team invitation</strong>
        <span class="muted">Join ${esc(invite.company_name || "the company")} with @${esc(invite.username || "username")}</span>
      </div>
      <div class="toolbar">
        <button class="btn primary" data-invite-id="${invite.id}" data-invite-action="accept">${icon("check")}Accept</button>
        <button class="btn" data-invite-id="${invite.id}" data-invite-action="decline">${icon("x")}Decline</button>
      </div>
    </article>`).join("")}</section>`;
}

function invitationStatusRows(invitations) {
  if (!invitations.length) return `<p class="muted">No staff invitations yet.</p>`;
  return invitations.map((invite) => `
    <article class="task-row">
      <div><h3>${esc(invite.email)}</h3><span class="muted">@${esc(invite.username || "pending")}</span></div>
      <span class="pill ${invite.status === "pending" ? "warn" : invite.status === "canceled" || invite.status === "declined" || invite.status === "left" ? "danger" : ""}">${esc(membershipStatusLabel(invite.status))}</span>
      <div class="invite-actions">
        ${invite.status === "pending" ? `<button class="btn compact" data-cancel-invite="${invite.id}">${icon("x")}Cancel</button>` : `<span class="muted">${fmtDate(invite.responded_at || invite.created_at)}</span>`}
        <button class="btn compact danger" data-remove-invite="${invite.id}">${icon("trash-2")}Remove</button>
      </div>
    </article>`).join("");
}

function bindInvitationCancels(refresh, teamID = state.team?.id) {
  document.querySelectorAll("[data-cancel-invite]").forEach((btn) => btn.addEventListener("click", async () => {
    try {
      await api(`/api/teams/${teamID}/invitations/${btn.dataset.cancelInvite}`, { method: "DELETE" });
      await refresh();
    } catch (error) {
      setStatus(error.message, true);
    }
  }));
  document.querySelectorAll("[data-remove-invite]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!confirm("Remove this invitation from the status list?")) return;
    try {
      await api(`/api/teams/${teamID}/invitations/${btn.dataset.removeInvite}/remove`, { method: "DELETE" });
      await refresh();
    } catch (error) {
      setStatus(error.message, true);
    }
  }));
}

function notificationRow(note, deleted = false) {
  const id = esc(note.id || "");
  const label = notificationTypeLabel(note.type);
  const title = note.content ? mentionText(note.content) : esc(label);
  const isRead = Boolean(note.read);
  const statusText = deleted ? "bin" : isRead ? "read" : "new";
  const statusTitle = deleted ? "Notification in bin" : isRead ? "Read notification" : "Unread notification";
  const openAttrs = deleted ? "" : ` type="button" data-open-notification="${id}"`;
  const openTag = deleted ? "div" : "button";
  return `
    <article class="inbox-row notification-row ${deleted ? "is-deleted" : isRead ? "is-read" : "is-unread"}" data-notification-row="${id}">
      <${openTag} class="notification-open"${openAttrs}>
        <span class="inbox-row-icon">${icon(deleted ? "trash-2" : "bell")}</span>
        <div class="inbox-row-title notification-title"><strong>${title}</strong></div>
        <span class="priority-flag">${icon(deleted ? "archive-restore" : "bell")} ${esc(label)}</span>
        <span class="mention-filter-pill">Notification</span>
        <span class="mini-count ${deleted || isRead ? "is-read" : "is-new"}" title="${esc(statusTitle)}" aria-label="${esc(statusTitle)}">${esc(statusText)}</span>
        <time>${deleted ? "Moved to bin" : inboxTime(note.created_at)}</time>
      </${openTag}>
      <div class="toolbar notification-actions">
        ${deleted ? `
          <button class="btn compact" type="button" data-notification-restore="${id}">${icon("rotate-ccw")}Restore</button>
          <button class="btn compact danger" type="button" data-notification-permanent="${id}">${icon("trash")}Remove forever</button>
        ` : `<button class="btn icon quiet danger notification-remove-btn" type="button" data-notification-delete="${id}" title="Remove notification" aria-label="Remove notification">${icon("trash-2")}</button>`}
      </div>
    </article>`;
}

function notificationTypeLabel(type) {
  return String(type || "notification").replaceAll("_", " ");
}

function notificationCards(notifications, deletedNotifications = []) {
  if (!notifications.length && !deletedNotifications.length) return "";
  return `<section class="panel notification-center">
    <div class="panel-head">
      <div>
        <h2>Notifications</h2>
        <p class="muted">${esc(notifications.length)} active, ${esc(deletedNotifications.length)} in bin</p>
      </div>
      <div class="toolbar">
        ${notifications.length ? `<button class="btn compact danger" type="button" data-notification-delete-all>${icon("trash-2")}Remove all</button>` : ""}
        ${deletedNotifications.length ? `<button class="btn compact" type="button" data-notification-restore-all>${icon("rotate-ccw")}Restore all</button><button class="btn compact danger" type="button" data-notification-empty-bin>${icon("trash")}Empty bin</button>` : ""}
      </div>
    </div>
    ${notifications.length ? `<div class="notification-list">${notifications.map((note) => notificationRow(note)).join("")}</div>` : `<p class="muted">No active notifications.</p>`}
    <details class="notification-bin" ${deletedNotifications.length ? "open" : ""}>
      <summary>${icon("archive-restore")} Notification bin (${esc(deletedNotifications.length)})</summary>
      ${deletedNotifications.length ? `<div class="notification-list">${deletedNotifications.map((note) => notificationRow(note, true)).join("")}</div>` : `<p class="muted">The bin is empty.</p>`}
    </details>
  </section>`;
}

function markNotificationRowRead(row) {
  if (!row) return;
  row.classList.remove("is-unread");
  row.classList.add("is-read");
  const marker = row.querySelector(".mini-count");
  if (marker) {
    marker.textContent = "read";
    marker.classList.remove("is-new");
    marker.classList.add("is-read");
    marker.title = "Read notification";
    marker.setAttribute("aria-label", "Read notification");
  }
}

async function openNotificationTarget(data = {}) {
  const target = normalizeNotificationTarget(data);
  if (target.source_type === "task" && target.task_id) {
    try {
      const taskData = await api(`/api/tasks/${target.task_id}`);
      showTaskDetailDialog(taskData, target.comment_id || "");
      return;
    } catch (error) {
      openNotificationDetailDialog(target, `Could not open the related task: ${error.message}`);
      return;
    }
  }
  if (target.source_type === "client_task" && target.task_id) {
    await openClientTaskWithProgress(target.task_id, target.comment_id || "");
    return;
  }
  if (target.source_type === "chat" && target.chat_id) {
    try {
      await openNotificationChatDialog(target.chat_id);
    } catch (error) {
      openNotificationDetailDialog(target, `Could not open the related chat: ${error.message}`);
    }
    return;
  }
  openNotificationDetailDialog(target);
}

function normalizeNotificationTarget(data = {}) {
  const taskTarget = notificationTaskTargetFromURL(data.url);
  return taskTarget ? { ...data, ...taskTarget } : data;
}

function notificationTaskTargetFromURL(url) {
  if (!url) return null;
  try {
    const parsed = new URL(String(url), window.location.origin);
    const taskID = parsed.searchParams.get("task_id") || "";
    if (!taskID) return null;
    const commentID = parsed.searchParams.get("comment_id") || "";
    if (parsed.pathname === "/tasks") {
      return { source_type: "client_task", task_id: taskID, comment_id: commentID, url: parsed.pathname + parsed.search };
    }
    if (parsed.pathname === "/dashboard") {
      return { source_type: "task", task_id: taskID, comment_id: commentID, url: parsed.pathname + parsed.search };
    }
  } catch {
    return null;
  }
  return null;
}

function notificationTargetTitle(sourceType) {
  switch (sourceType) {
  case "client_project":
    return "Project access";
  case "feedback":
    return "Website feedback";
  case "billing":
    return "Billing";
  case "team":
    return "Team";
  default:
    return "Notification";
  }
}

function openNotificationFrame(url, title = "Notification") {
  let dialog = $("#notificationTargetDialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "notificationTargetDialog";
    dialog.className = "modal notification-target-dialog";
    document.body.appendChild(dialog);
  }
  dialog.innerHTML = `
    <div class="modal-head">
      <h2>${esc(title)}</h2>
      <button class="btn icon quiet" type="button" data-close-dialog="notificationTargetDialog" title="Close">${icon("x")}</button>
    </div>
    <iframe class="notification-target-frame" src="${esc(url)}" title="${esc(title)}"></iframe>`;
  bindDialogCloseButtons(dialog);
  icons();
  if (!dialog.open) dialog.showModal();
}

function openNotificationDetailDialog(data = {}, message = "") {
  const note = data.notification || {};
  const label = notificationTypeLabel(note.type || data.source_type || "notification");
  const isTaskURL = Boolean(notificationTaskTargetFromURL(data.url));
  let dialog = $("#notificationDetailDialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "notificationDetailDialog";
    dialog.className = "modal notification-detail-dialog";
    document.body.appendChild(dialog);
  }
  dialog.innerHTML = `
    <div class="modal-head">
      <div>
        <h2>Notification detail</h2>
        <p class="muted">${esc(label)}${note.created_at ? " - " + esc(inboxTime(note.created_at)) : ""}</p>
      </div>
      <button class="btn icon quiet" type="button" data-close-dialog="notificationDetailDialog" title="Close">${icon("x")}</button>
    </div>
    <div class="notification-detail-body">
      <p>${mentionText(note.content || "This notification has no extra message.")}</p>
      ${message ? `<p class="status-line danger-text">${esc(message)}</p>` : ""}
      ${data.url && !isTaskURL ? `<button class="btn compact" type="button" data-notification-frame-open="${esc(data.url)}">${icon("external-link")}Open related page</button>` : ""}
    </div>`;
  dialog.querySelector("[data-notification-frame-open]")?.addEventListener("click", (event) => {
    openNotificationFrame(event.currentTarget.dataset.notificationFrameOpen, notificationTargetTitle(data.source_type));
  });
  bindDialogCloseButtons(dialog);
  icons();
  if (!dialog.open) dialog.showModal();
}

async function openNotificationChatDialog(chatID) {
  const chats = (await api("/api/chats")).chats || [];
  const chat = chats.find((item) => item.id === chatID);
  if (!chat) {
    openNotificationFrame(`/chat?id=${encodeURIComponent(chatID)}`, "Chat");
    return;
  }
  const messages = ((await api(`/api/chats/${chatID}/messages`)).messages || []);
  const mentionUsers = await loadMentionUsers().catch(() => []);
  const usersByID = Object.fromEntries([...mentionUsers, state.me].filter(Boolean).map((user) => [user.id, user]));
  const canWrite = chat.status !== "ended" && !chat.deleted_at;
  let dialog = $("#notificationChatDialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "notificationChatDialog";
    dialog.className = "modal chat-room-dialog notification-chat-dialog";
    document.body.appendChild(dialog);
  }
  dialog.innerHTML = `
    <section class="chat-window chat-room-window">
      <div class="chat-window-head">
        <div><h2>${esc(chatTitle(chat, usersByID))}</h2><span class="muted">${esc(chat.status === "ended" ? "Conversation ended" : "Conversation open")}</span></div>
        <div class="chat-window-actions">
          ${chatActionsHTML(chat)}
          <button class="btn icon quiet" type="button" data-close-dialog="notificationChatDialog" title="Close">${icon("x")}</button>
        </div>
      </div>
      <div id="notificationMessages" class="messages">${messages.map((m) => chatMessageHTML(m, usersByID, "notification")).join("")}</div>
      ${chatComposerHTML("notificationChatForm", "notification", canWrite, "Message @username")}
    </section>`;
  bindDialogCloseButtons(dialog);
  bindChatManagementActions(() => openNotificationChatDialog(chatID));
  if (canWrite) openChatSocket(chatID, usersByID, "notification");
  bindRichChatComposer("notificationChatForm", "notification");
  bindChatReplyButtons("notification");
  dialog.addEventListener("close", () => {
    if (state.chatSocket) {
      state.chatSocket.close();
      state.chatSocket = null;
    }
    setChatReply("notification", null);
  }, { once: true });
  icons();
  if (!dialog.open) dialog.showModal();
  $("#notificationMessages").scrollTop = $("#notificationMessages").scrollHeight;
}

function bindNotificationActions() {
  document.querySelectorAll("[data-open-notification]").forEach((btn) => btn.addEventListener("click", async () => {
    try {
      btn.disabled = true;
      const data = await api(`/api/users/me/notifications/${btn.dataset.openNotification}/open`, { method: "POST", body: JSON.stringify({}) });
      const row = btn.closest("[data-notification-row]");
      const wasUnread = row?.classList.contains("is-unread");
      markNotificationRowRead(row);
      if (wasUnread) {
        state.unreadNotificationCount = Math.max(0, Number(state.unreadNotificationCount || 0) - 1);
        updateInboxUnreadUI();
      }
      await openNotificationTarget(data);
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      btn.disabled = false;
    }
  }));
  document.querySelectorAll("[data-notification-delete-all]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!confirm("Move all notifications to the bin?")) return;
    try {
      await api("/api/users/me/notifications", { method: "DELETE" });
      await refreshNotificationsLive();
    } catch (error) {
      setStatus(error.message, true);
    }
  }));
  document.querySelectorAll("[data-notification-delete]").forEach((btn) => btn.addEventListener("click", async () => {
    try {
      await api(`/api/users/me/notifications/${btn.dataset.notificationDelete}`, { method: "DELETE" });
      await refreshNotificationsLive();
    } catch (error) {
      setStatus(error.message, true);
    }
  }));
  document.querySelectorAll("[data-notification-restore]").forEach((btn) => btn.addEventListener("click", async () => {
    try {
      await api(`/api/users/me/notifications/${btn.dataset.notificationRestore}/restore`, { method: "POST", body: JSON.stringify({}) });
      await refreshNotificationsLive();
    } catch (error) {
      setStatus(error.message, true);
    }
  }));
  document.querySelectorAll("[data-notification-restore-all]").forEach((btn) => btn.addEventListener("click", async () => {
    try {
      await api("/api/users/me/notifications/bin/restore", { method: "POST", body: JSON.stringify({}) });
      await refreshNotificationsLive();
    } catch (error) {
      setStatus(error.message, true);
    }
  }));
  document.querySelectorAll("[data-notification-permanent]").forEach((btn) => btn.addEventListener("click", async () => {
    try {
      await api(`/api/users/me/notifications/${btn.dataset.notificationPermanent}/permanent`, { method: "DELETE" });
      await refreshNotificationsLive();
    } catch (error) {
      setStatus(error.message, true);
    }
  }));
  document.querySelectorAll("[data-notification-empty-bin]").forEach((btn) => btn.addEventListener("click", async () => {
    try {
      await api("/api/users/me/notifications/bin/permanent", { method: "DELETE" });
      await refreshNotificationsLive();
    } catch (error) {
      setStatus(error.message, true);
    }
  }));
}

function inboxSection(title, rows) {
  return `<section class="inbox-group"><h2>${esc(title)}</h2><div class="inbox-list">${rows}</div></section>`;
}

function setInboxFilters(mention, projectID) {
  const params = new URLSearchParams();
  if (mention && mention !== "all") params.set("mention", mention);
  if (projectID) params.set("project_id", projectID);
  window.location.href = `/dashboard${params.toString() ? "?" + params.toString() : ""}`;
}

function updateInboxBadge(count) {
  state.unreadCommentCount = Number(count) || 0;
  updateInboxUnreadUI();
}

function updateInboxUnreadUI() {
  const total = inboxUnreadTotal();
  const link = document.querySelector('.workspace-menu a[href="/dashboard"]');
  let badge = link?.querySelector(".unread-badge");
  if (total > 0 && !badge && link) {
    badge = document.createElement("strong");
    badge.className = "unread-badge";
    link.appendChild(badge);
  }
  if (badge) {
    if (total > 0) badge.textContent = badgeCount(total);
    else badge.remove();
  }
  const summary = $("#inboxUnreadSummary");
  if (summary) {
    summary.textContent = `${badgeCount(total)} unread`;
    summary.classList.toggle("warn", total > 0);
  }
}

async function loadNotificationSets() {
  const [activeData, binData, invitationData] = await Promise.all([
    api("/api/users/me/notifications").catch(() => ({ notifications: [] })),
    api("/api/users/me/notifications?bin=1").catch(() => ({ notifications: [] })),
    api("/api/users/me/invitations").catch(() => ({ invitations: [] })),
  ]);
  return {
    notifications: (activeData.notifications || []).filter((note) => note.type !== "team_invitation"),
    deletedNotifications: (binData.notifications || []).filter((note) => note.type !== "team_invitation"),
    invitations: invitationData.invitations || [],
  };
}

async function refreshNotificationsLive() {
  if (!state.access || state.notificationPollBusy) return;
  state.notificationPollBusy = true;
  try {
    const { notifications, deletedNotifications, invitations } = await loadNotificationSets();
    state.unreadNotificationCount = unreadNotificationCount(notifications) + invitations.length;
    updateInboxUnreadUI();
    const mount = $("#notificationCenterMount");
    const invitationMount = $("#invitationCenterMount");
    if (path() === "/dashboard" && invitationMount) {
      invitationMount.innerHTML = invitationCards(invitations);
      bindInvitationActions();
    }
    if (path() === "/dashboard" && mount) {
      mount.innerHTML = notificationCards(notifications, deletedNotifications);
      bindNotificationActions();
      icons();
    }
  } catch {
    // Keep polling quiet; route-level auth handling will surface real session issues.
  } finally {
    state.notificationPollBusy = false;
  }
}

function startNotificationPolling() {
  if (!state.access || state.notificationPollBusy) return;
  refreshNotificationsLive();
}

function stopNotificationPolling() {
  if (state.notificationPoll) clearInterval(state.notificationPoll);
  state.notificationPoll = null;
  state.notificationPollBusy = false;
}

function liveStableString(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function liveTaskShape(task = {}) {
  return {
    id: task.id,
    client_id: task.client_id,
    website_id: task.website_id,
    tab_id: task.tab_id,
    type: task.type,
    title: task.title,
    content: task.content,
    comment: task.comment,
    url: task.url,
    status: task.status,
    completion_count: Number(task.completion_count || 0),
    last_completed_at: task.last_completed_at || "",
    assignee_ids: task.assignee_ids || [],
    due_date: task.due_date || "",
    recurrence: task.recurrence || {},
    attachments: task.attachments || [],
    checklist: task.checklist || [],
    blocks: task.blocks || [],
    annotations: task.annotations || [],
    updated_at: task.updated_at || "",
  };
}

function liveCommentShape(comment = {}) {
  return {
    id: comment.id,
    task_id: comment.task_id,
    author_id: comment.author_id,
    content: comment.content,
    reply_to_id: comment.reply_to_id || "",
    reply_text: comment.reply_text || "",
    attachment_url: comment.attachment_url || "",
    attachment_name: comment.attachment_name || "",
    reactions: comment.reactions || [],
    read_by: comment.read_by || [],
    created_at: comment.created_at || "",
  };
}

function taskListLiveSignature(data = {}) {
  return liveStableString({
    scope: data.scope || "",
    tasks: (data.tasks || []).map(liveTaskShape),
    clients: (data.clients || []).map((client) => ({ id: client.id, name: client.name, updated_at: client.updated_at || "" })),
    websites: (data.websites || []).map((site) => ({ id: site.id, client_id: site.client_id, name: site.name, url: site.url || "", updated_at: site.updated_at || "" })),
    tabs: (data.tabs || []).map((tab) => ({ id: tab.id, website_id: tab.website_id, title: tab.title, type: tab.type, statuses: tab.statuses || [], status_styles: tab.status_styles || {}, updated_at: tab.updated_at || "" })),
  });
}

function clientWebsiteLiveSignature(data = {}) {
  return liveStableString({
    website: data.website ? { id: data.website.id, name: data.website.name, url: data.website.url || "", details: data.website.details || "", updated_at: data.website.updated_at || "" } : null,
    tabs: (data.tabs || []).map((tab) => ({ id: tab.id, title: tab.title, type: tab.type, content: tab.content || "", statuses: tab.statuses || [], status_styles: tab.status_styles || {}, updated_at: tab.updated_at || "" })),
    documents: (data.documents || []).map((doc) => ({ id: doc.id, title: doc.title, kind: doc.kind, url: doc.url || "", file_url: doc.file_url || "", updated_at: doc.updated_at || "" })),
    tasks: (data.tasks || []).map(liveTaskShape),
    members: (data.members || []).map((entry) => ({ role: entry.role || "", user_id: entry.user?.id || "", name: entry.user?.name || "", username: entry.user?.username || "", avatar_url: entry.user?.avatar_url || "" })),
  });
}

function clientTaskDetailLiveSignature(data = {}) {
  return liveStableString({
    task: liveTaskShape(data.task || {}),
    comments: (data.comments || []).map(liveCommentShape),
    logs: (data.logs || []).map((log) => ({ id: log.id, action: log.action, detail: log.detail, actor_id: log.actor_id, created_at: log.created_at })),
    tab: data.tab ? { id: data.tab.id, statuses: data.tab.statuses || [], status_styles: data.tab.status_styles || {}, updated_at: data.tab.updated_at || "" } : null,
    members: (data.members || []).map((entry) => ({ role: entry.role || "", user_id: entry.user?.id || "", name: entry.user?.name || "", username: entry.user?.username || "", avatar_url: entry.user?.avatar_url || "" })),
  });
}

function inboxCommentsLiveSignature(data = {}) {
  return liveStableString({
    unread_count: Number(data.unread_count || 0),
    comments: (data.comments || []).map((item) => ({
      id: item.id,
      task_id: item.task_id,
      read: Boolean(item.read),
      comment: item.comment || "",
      author_name: item.author_name || "",
      author_username: item.author_username || "",
      task_title: item.task_title || "",
      project_name: item.project_name || "",
      list_name: item.list_name || "",
      source_type: item.source_type || "",
      created_at: item.created_at || "",
    })),
  });
}

function activeElementIsEditable(root = document) {
  const active = document.activeElement;
  if (!active || active === document.body || !root.contains(active)) return false;
  const tag = active.tagName;
  return active.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(tag);
}

function liveDraftIn(root = document) {
  return Array.from(root.querySelectorAll("textarea, input[type='text'], input[type='search'], input[type='file'], [contenteditable='true']")).some((field) => {
    if (field.closest("[hidden]")) return false;
    if (field.closest("dialog:not([open])")) return false;
    if (field.type === "file") return Boolean(field.files?.length);
    return String(field.value ?? field.textContent ?? "").trim().length > 0;
  });
}

function liveDropdownOpen(root = document) {
  return Boolean(root.querySelector(".assignee-menu:not([hidden]), .status-menu:not([hidden]), .context-menu:not([hidden]), .client-tab-menu:not([hidden]), #commandSearchResults:not([hidden])"));
}

function livePageRefreshBlocked() {
  if ($("#clientTaskPanel")) return true;
  if (document.querySelector(".assigned-inline-task-form:not([hidden])")) return true;
  if (Array.from(document.querySelectorAll("dialog[open]")).some((dialog) => dialog.id !== "taskDetailDialog")) return true;
  return activeElementIsEditable(document) || liveDropdownOpen(document);
}

function livePanelRefreshBlocked(panel) {
  if (!panel) return false;
  if (state.clientTaskReply || state.clientTaskCommentEdit) return true;
  if (Array.from(panel.querySelectorAll("dialog[open]")).length) return true;
  return activeElementIsEditable(panel) || liveDraftIn(panel) || liveDropdownOpen(panel);
}

async function refreshInboxCommentsLive() {
  const params = new URLSearchParams(location.search);
  const mentionFilter = path() === "/dashboard" ? (params.get("mention") || "all") : "all";
  const projectFilter = path() === "/dashboard" ? (params.get("project_id") || "") : "";
  const inboxParams = new URLSearchParams({ mention: mentionFilter });
  if (projectFilter) inboxParams.set("project_id", projectFilter);
  const data = await api(`/api/inbox/comments?${inboxParams.toString()}`).catch(() => null);
  if (!data) return;
  state.unreadCommentCount = Number(data.unread_count || 0);
  updateInboxUnreadUI();
  const signature = inboxCommentsLiveSignature(data);
  if (path() === "/dashboard") {
    const mount = $("#inboxCommentsMount");
    if (mount && signature !== state.liveInboxSignature) {
      mount.innerHTML = inboxSection("Comments", inboxCommentRows(data.comments || []));
      bindInboxCommentRows();
      icons();
    }
  }
  state.liveInboxSignature = signature;
}

async function refreshOpenClientTaskPanelLive() {
  const panel = $("#clientTaskPanel");
  const taskID = panel?.dataset.liveTaskId || "";
  if (!panel || !taskID || livePanelRefreshBlocked(panel)) return;
  try {
    const data = await api(`/api/client-tasks/${taskID}`);
    const signature = clientTaskDetailLiveSignature(data);
    if (signature && signature !== panel.dataset.liveSignature) {
      const annotationID = panel.dataset.liveAnnotationId || "";
      if ((data.task || {}).type === "annotation" || panel.classList.contains("annotation-task-viewer")) {
        await openClientAnnotationTaskViewer(taskID, data, annotationID);
      } else {
        await openClientTaskPanel(taskID);
      }
      const nextPanel = $("#clientTaskPanel");
      if (nextPanel) nextPanel.dataset.liveSignature = signature;
    }
  } catch {
    closeClientTaskPanel(panel);
    if (!livePageRefreshBlocked()) route();
  }
}

async function refreshLegacyTaskDialogLive() {
  const dialog = $("#taskDetailDialog");
  const taskID = dialog?.dataset.liveTaskId || "";
  if (!dialog?.open || !taskID || activeElementIsEditable(dialog) || liveDraftIn(dialog)) return;
  try {
    const data = await api(`/api/tasks/${taskID}`);
    const signature = liveStableString({ task: data.task || {} });
    if (signature && signature !== dialog.dataset.liveSignature) {
      showTaskDetailDialog(data, dialog.dataset.liveCommentId || "");
      const nextDialog = $("#taskDetailDialog");
      if (nextDialog) nextDialog.dataset.liveSignature = signature;
    }
  } catch {
    dialog.close();
  }
}

async function refreshTaskPageLive() {
  if (path() !== "/tasks" || livePageRefreshBlocked()) return;
  const params = new URLSearchParams(location.search);
  const assignedOnly = (params.get("view") || "all") === "assigned";
  const data = await api(`/api/client-tasks/assigned${assignedOnly ? "?scope=assigned" : ""}`).catch(() => null);
  if (!data) return;
  const signature = taskListLiveSignature(data);
  if (signature && signature !== state.liveTaskSignature) {
    const scroll = { x: window.scrollX, y: window.scrollY };
    const filters = Object.fromEntries(Array.from(document.querySelectorAll("[data-assigned-filter]")).map((field) => [field.dataset.assignedFilter, field.value]));
    const searchValue = document.querySelector("[data-assigned-search]")?.value || "";
    await renderTasks();
    Object.entries(filters).forEach(([key, value]) => {
      const field = document.querySelector(`[data-assigned-filter="${selectorEscape(key)}"]`);
      if (field) field.value = value;
    });
    const search = document.querySelector("[data-assigned-search]");
    if (search) search.value = searchValue;
    document.querySelector("[data-assigned-filter]")?.dispatchEvent(new Event("change"));
    search?.dispatchEvent(new Event("input"));
    window.scrollTo(scroll.x, scroll.y);
  }
}

async function refreshClientWebsiteLive() {
  const match = path().match(/^\/projects\/([^/]+)\/sites\/([^/]+)/);
  if (!match || livePageRefreshBlocked()) return;
  const data = await api(`/api/client-websites/${match[2]}`).catch(() => null);
  if (!data) return;
  const signature = clientWebsiteLiveSignature(data);
  if (signature && signature !== state.liveWebsiteSignature) {
    const scroll = { x: window.scrollX, y: window.scrollY };
    await renderClientWebsite(match[1], match[2]);
    window.scrollTo(scroll.x, scroll.y);
  }
}

async function refreshWorkspaceLive() {
  if (!state.access || state.livePollBusy) return;
  state.livePollBusy = true;
  try {
    await refreshNotificationsLive();
    await refreshInboxCommentsLive();
    await refreshOpenClientTaskPanelLive();
    await refreshLegacyTaskDialogLive();
    await refreshTaskPageLive();
    await refreshClientWebsiteLive();
    await refreshAdminUsersLive();
  } catch {
    // Keep live updates quiet; normal route/api handling will report actionable errors.
  } finally {
    state.livePollBusy = false;
  }
}

function adminUsersPageActive() {
  return path() === "/admin" || path() === "/admin/users";
}

function adminUsersDialogOpen() {
  return ["userCreateDialog", "userEditDialog", "userMessageDialog", "userMembershipDialog"].some((id) => Boolean($(`#${id}`)?.open));
}

async function refreshAdminUsersLive() {
  if (!adminUsersPageActive()) return;
  if (adminUsersDialogOpen()) {
    if (state.adminUsersRefreshTimer) clearTimeout(state.adminUsersRefreshTimer);
    state.adminUsersRefreshTimer = setTimeout(() => {
      state.adminUsersRefreshTimer = null;
      refreshAdminUsersLive();
    }, 1200);
    return;
  }
  await renderAdmin();
}

function scheduleWorkspaceLiveRefresh(delay = 180) {
  if (!state.access) return;
  if (state.liveRefreshTimer) clearTimeout(state.liveRefreshTimer);
  state.liveRefreshTimer = setTimeout(() => {
    state.liveRefreshTimer = null;
    refreshWorkspaceLive();
  }, delay);
}

function startLivePolling() {
  if (!state.access || state.liveSocket || state.liveReconnectTimer) return;
  if (!window.WebSocket) {
    if (!state.livePoll) state.livePoll = setInterval(refreshWorkspaceLive, 60000);
    return;
  }
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${location.host}/ws/live?token=${encodeURIComponent(state.access)}`);
  state.liveSocket = socket;
  socket.onopen = () => {
    state.liveReconnectDelay = 1500;
    scheduleWorkspaceLiveRefresh(0);
  };
  socket.onmessage = (event) => {
    let payload = {};
    try {
      payload = JSON.parse(event.data || "{}");
    } catch {
      payload = {};
    }
    if (payload.type === "live_connected") return;
    scheduleWorkspaceLiveRefresh();
  };
  socket.onclose = () => {
    if (state.liveSocket === socket) state.liveSocket = null;
    if (!state.access) return;
    const delay = Math.min(state.liveReconnectDelay || 1500, 30000);
    state.liveReconnectDelay = Math.min(delay * 1.6, 30000);
    state.liveReconnectTimer = setTimeout(() => {
      state.liveReconnectTimer = null;
      startLivePolling();
    }, delay);
  };
  socket.onerror = () => {
    socket.close();
  };
}

function stopLivePolling() {
  if (state.livePoll) clearInterval(state.livePoll);
  state.livePoll = null;
  state.livePollBusy = false;
  if (state.liveRefreshTimer) clearTimeout(state.liveRefreshTimer);
  state.liveRefreshTimer = null;
  if (state.adminUsersRefreshTimer) clearTimeout(state.adminUsersRefreshTimer);
  state.adminUsersRefreshTimer = null;
  if (state.liveReconnectTimer) clearTimeout(state.liveReconnectTimer);
  state.liveReconnectTimer = null;
  if (state.liveSocket) {
    state.liveSocket.onclose = null;
    state.liveSocket.close();
  }
  state.liveSocket = null;
}

function inboxCommentRows(comments) {
  if (!comments.length) {
    return `
      <article class="inbox-row empty-row">
        <span class="inbox-row-icon">${icon("message-square")}</span>
        <div class="inbox-row-title"><strong>No comments found</strong><span>Try a different mention or project filter.</span></div>
        <span></span>
        <div class="inbox-row-message"><strong>Clear</strong><span>No matching task comments.</span></div>
        <span></span><span></span><span class="mini-count is-read" title="No unread comments" aria-label="No unread comments">0</span><time>Now</time>
      </article>`;
  }
  return comments.map((item) => `
    <button class="inbox-row comment-inbox-row ${item.read ? "is-quiet" : "is-unread"}" type="button" data-open-task-comment="${esc(item.task_id)}" data-comment-id="${esc(item.id)}" data-source-type="${esc(item.source_type || "task")}">
      <span class="inbox-row-icon">${icon(item.read ? "message-square" : "message-square-dot")}</span>
      <div class="inbox-row-title">
        <strong>${esc(item.task_title || "Untitled task")}</strong>
        <span>${esc(item.project_name || "Project")}${item.list_name ? " / " + esc(item.list_name) : ""}</span>
      </div>
      <span class="avatar-dot">${esc((item.author_name || item.author_username || "U").slice(0, 1).toUpperCase())}</span>
      <div class="inbox-row-message">
        <strong>${esc(item.author_name || item.author_username || "Someone")}</strong>
        <span>${mentionText(item.comment || "")}</span>
      </div>
      <span class="priority-flag ${String(item.task_priority || "normal").toLowerCase()}">${icon("flag")}${esc(item.task_priority || "Normal")}</span>
      <span class="mention-filter-pill">${item.mention_me ? "Mention me" : item.mention_others ? "Mention team" : "Comment"}</span>
      <span class="mini-count ${item.read ? "is-read" : "is-new"}" title="${item.read ? "Read comment" : "Unread comment"}" aria-label="${item.read ? "Read comment" : "Unread comment"}">${item.read ? "read" : "new"}</span>
      <time>${inboxTime(item.created_at)}</time>
    </button>`).join("");
}

function bindInboxCommentRows() {
  document.querySelectorAll("[data-open-task-comment]").forEach((row) => row.addEventListener("click", async () => {
    const taskID = row.dataset.openTaskComment;
    const commentID = row.dataset.commentId;
    const sourceType = row.dataset.sourceType || "task";
    try {
      const readURL = sourceType === "client_task" ? `/api/client-task-comments/${commentID}/read` : `/api/tasks/${taskID}/comments/${commentID}/read`;
      const readData = await api(readURL, { method: "POST", body: JSON.stringify({}) });
      if (readData.unread_count !== undefined) updateInboxBadge(readData.unread_count);
      row.classList.remove("is-unread");
      row.classList.add("is-quiet");
      const marker = row.querySelector(".mini-count");
      if (marker) {
        marker.textContent = "read";
        marker.classList.remove("is-new");
        marker.classList.add("is-read");
        marker.title = "Read comment";
        marker.setAttribute("aria-label", "Read comment");
      }
      if (sourceType === "client_task") {
        await openClientTaskWithProgress(taskID, commentID, row);
      } else {
        const data = await api(`/api/tasks/${taskID}`);
        showTaskDetailDialog(data, commentID);
      }
    } catch (error) {
      setStatus(error.message, true);
    }
  }));
}

function bindInboxTabs() {
  document.querySelectorAll("[data-inbox-tab]").forEach((tab) => tab.addEventListener("click", () => {
    const target = tab.dataset.inboxTab;
    document.querySelectorAll("[data-inbox-tab]").forEach((item) => item.classList.toggle("active", item === tab));
    document.querySelectorAll("[data-inbox-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.inboxPanel === target));
  }));
}

function inboxTime(value) {
  if (!value) return "Now";
  return fmtDateTime(value) || "Now";
}

function inboxRows(tasks, websites = [], quiet = false) {
  const taskRowsHTML = tasks.map((task, index) => {
    const priority = task.priority || "Normal";
    const status = task.status || "To Do";
    const description = task.description || (status === "Done" ? "Marked this task as complete" : `Priority is ${priority}`);
    const count = task.comment_count || task.assignee_ids?.length || index + 1;
    return `
      <article class="inbox-row ${quiet ? "is-quiet" : ""}">
        <span class="inbox-row-icon">${icon(status === "Done" ? "message-square-check" : "message-square")}</span>
        <div class="inbox-row-title">
          <strong>${esc(task.title)}</strong>
          <span>${mentionText(description)}</span>
        </div>
        <span class="avatar-dot">${esc((state.me?.name || "P").slice(0, 1).toUpperCase())}</span>
        <div class="inbox-row-message">
          <strong>${status === "Done" ? "Completed" : "Task updated"}</strong>
          <span>${esc(status)} -> ${esc(priority)}</span>
        </div>
        <span class="priority-flag ${priority.toLowerCase()}">${icon("flag")}${esc(priority)}</span>
        <button class="btn icon quiet row-action" data-start-timer="${task.id}" title="Start timer">${icon("play")}</button>
        <span class="mini-count">${count}</span>
        <time>${inboxTime(task.updated_at || task.created_at || task.due_date)}</time>
      </article>`;
  }).join("");
  const websiteRowsHTML = websites.slice(0, 2).map((site) => `
    <article class="inbox-row">
      <span class="inbox-row-icon feedback">${icon("map-pin")}</span>
      <div class="inbox-row-title">
        <strong>${esc(site.name || site.url)}</strong>
        <span>Website feedback workspace is ready</span>
      </div>
      <span class="avatar-dot">P</span>
      <div class="inbox-row-message"><strong>Visual review</strong><span>${esc(site.url || "")}</span></div>
      <span class="priority-flag normal">${icon("flag")}Normal</span>
      <a class="btn icon quiet row-action" href="/websites" title="Open website">${icon("external-link")}</a>
      <span class="mini-count">1</span>
      <time>${inboxTime(site.created_at)}</time>
    </article>`).join("");
  const rows = taskRowsHTML + websiteRowsHTML;
  if (rows) return rows;
  return `
    <article class="inbox-row empty-row">
      <span class="inbox-row-icon">${icon("sparkles")}</span>
      <div class="inbox-row-title">
        <strong>Your workspace is ready</strong>
        <span>Create a task or add a website to start receiving activity here.</span>
      </div>
      <span></span>
      <div class="inbox-row-message"><strong>No unread items</strong><span>Everything is clear.</span></div>
      <span class="priority-flag normal">${icon("flag")}Normal</span>
      <a class="btn icon quiet row-action" href="/tasks" title="Create task">${icon("plus")}</a>
      <span class="mini-count">0</span>
      <time>Now</time>
    </article>`;
}

function taskRows(tasks) {
  if (!tasks.length) return `<p class="muted">No tasks yet.</p>`;
  return tasks.map((task) => `
    <article class="task-row task-row-with-comments">
      <div>
        <h3>${esc(task.title)}</h3>
        <span class="muted">${mentionText(task.description || "")}</span>
        <div class="comment-list">${(task.comments || []).slice(-2).map((comment) => `<p>${mentionText(comment.content)}</p>`).join("")}</div>
        <form class="inline-comment" data-task-comment="${task.id}">
          <input name="content" data-mentionable placeholder="Comment @username">
          <button class="btn icon quiet" title="Add comment">${icon("send")}</button>
        </form>
      </div>
      <span class="pill">${esc(task.status)}</span>
      <button class="btn" data-start-timer="${task.id}">${icon("play")}Start</button>
    </article>`).join("");
}

function teamMemberRows(members, canManageTeam) {
  if (!members.length) return `<p class="muted">No listed members yet.</p>`;
  return members.map((member) => {
    const hasLeft = member.status === "left";
    const canManageMember = canManageTeam && member.id !== state.me?.id && ["users_member", "client_admin"].includes(member.role) && !hasLeft;
    const isSuspended = member.status === "suspended";
    const statusText = hasLeft ? "left company" : (isSuspended ? "blocked" : (member.status || "active"));
    return `<article class="task-row">
      <div><h3>${esc(member.name)}</h3><span class="muted">@${esc(member.username || "pending")} · ${esc(member.email)}</span></div>
      <span class="pill ${isSuspended || hasLeft ? "danger" : ""}">${esc(statusText)}</span>
      ${canManageMember ? `
        <details class="row-menu">
          <summary class="btn icon quiet" title="Manage staff">${icon("more-horizontal")}</summary>
          <div class="row-menu-list">
            <button type="button" data-edit-member="${member.id}">${icon("pencil")}Edit</button>
            <button type="button" class="${isSuspended ? "" : "danger-text"}" data-member-status="${member.id}" data-next-status="${isSuspended ? "active" : "suspended"}">${icon(isSuspended ? "rotate-ccw" : "ban")}${isSuspended ? "Reactivate" : "Block"}</button>
            <button type="button" class="danger-text" data-delete-member="${member.id}">${icon("trash-2")}Delete</button>
          </div>
        </details>` : ""}
    </article>`;
  }).join("");
}

async function renderTeam() {
  const teamID = activeWorkspaceTeamID() || state.personalTeam?.id || state.team?.id;
  if (!teamID) return renderDashboard();
  const data = await api(`/api/teams/${teamID}`);
  const members = data.members || [];
  const canManageTeam = state.me?.role === "owner_adm" || data.team?.owner_admin_id === state.me?.id || (isPersonalWorkspaceContext() && state.me?.role === "users_admin" && [state.me?.team_id, state.personalTeam?.id].filter(Boolean).includes(teamID));
  const invitationData = canManageTeam ? await api(`/api/teams/${teamID}/invitations`).catch(() => ({ invitations: [] })) : { invitations: [] };
  const invitations = invitationData.invitations || [];
  shell("Team", `
    <div class="page-title"><div><h1>Team</h1><p class="muted">${esc(data.team.name)}</p></div></div>
    <div class="grid-2">
      <section class="panel"><h2>Listed Members</h2><div class="task-list">${teamMemberRows(members, canManageTeam)}</div></section>
      ${canManageTeam ? `<section class="panel">
        <h2>Invite Staff</h2>
        <form id="inviteForm" class="form-grid">
          <div class="field"><label>Email or @username</label><input name="recipient" required placeholder="staff@company.com or @alex_dev" autocomplete="off"></div>
          <button class="btn primary" type="submit">${icon("mail-plus")}Send invitation</button>
          <p class="status-line"></p>
        </form>
        ${canManageTeam ? `<div class="inline-section"><h3>Invitation Status</h3><div class="task-list invite-history">${invitationStatusRows(invitations)}</div></div>` : ""}
      </section>` : `<section class="panel"><h2>Company view</h2><p class="muted">You are viewing the members shared by this company. Management controls are available only to the company admin.</p></section>`}
    </div>
    <dialog id="memberEditDialog" class="modal">
      <form id="memberEditForm" class="form-grid" method="dialog">
        <div class="modal-head"><h2>Edit Staff</h2><button class="btn icon quiet" type="button" data-close-dialog="memberEditDialog" title="Close">${icon("x")}</button></div>
        <input type="hidden" name="id">
        <div class="grid-2">
          <div class="field"><label>Name</label><input name="name" required></div>
          <div class="field"><label>Email</label><input type="email" name="email" required></div>
        </div>
        <div class="field"><label>Username</label><input name="username" required pattern="[a-zA-Z0-9_]{3,24}"></div>
        <div class="field"><label>Status</label><select name="status"><option value="active">active</option><option value="suspended">suspended</option></select></div>
        <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Save</button><button class="btn" type="button" data-close-dialog="memberEditDialog">Cancel</button></div>
        <p class="status-line"></p>
      </form>
    </dialog>`);
  const membersByID = Object.fromEntries(members.map((member) => [member.id, member]));
  $("#inviteForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api(`/api/teams/${teamID}/invitations`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      renderTeam();
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  document.querySelectorAll("[data-edit-member]").forEach((btn) => btn.addEventListener("click", () => {
    const member = membersByID[btn.dataset.editMember];
    const form = $("#memberEditForm");
    form.elements.id.value = member.id;
    form.elements.name.value = member.name || "";
    form.elements.email.value = member.email || "";
    form.elements.username.value = member.username || "";
    form.elements.status.value = member.status || "active";
    $("#memberEditDialog").showModal();
  }));
  document.querySelectorAll("[data-delete-member]").forEach((btn) => btn.addEventListener("click", async () => {
    const member = membersByID[btn.dataset.deleteMember];
    if (!confirm(`Delete ${member?.email || "this staff member"} from the team?`)) return;
    await api(`/api/teams/${teamID}/members/${btn.dataset.deleteMember}`, { method: "DELETE" });
    renderTeam();
  }));
  document.querySelectorAll("[data-member-status]").forEach((btn) => btn.addEventListener("click", async () => {
    const member = membersByID[btn.dataset.memberStatus];
    const nextStatus = btn.dataset.nextStatus;
    if (nextStatus === "suspended" && !confirm(`Suspend / block ${member?.email || "this staff member"}?`)) return;
    await api(`/api/teams/${teamID}/members/${btn.dataset.memberStatus}`, {
      method: "PATCH",
      body: JSON.stringify({ status: nextStatus }),
    });
    renderTeam();
  }));
  $("#memberEditForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api(`/api/teams/${teamID}/members/${form.elements.id.value}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.elements.name.value,
          email: form.elements.email.value,
          username: form.elements.username.value,
          status: form.elements.status.value,
        }),
      });
      $("#memberEditDialog").close();
      renderTeam();
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  bindDialogCloseButtons();
  bindInvitationCancels(renderTeam, teamID);
}

function clientRoleLabel(value) {
  if (value === "client_admin") return "Client Admin";
  if (normalizedStaffRole(value)) return staffRoleLabel(value);
  if (value === "domain_admin") return "Client Admin";
  if (value === "domain_member") return "Member";
  return "Member";
}

function clientWebsiteAccessRows(site = {}, members = []) {
  const memberIDs = site.member_ids || [];
  const adminIDs = site.client_admin_ids || [];
  const memberRoles = site.member_roles || {};
  const accessIDs = [...new Set([...memberIDs, ...adminIDs])];
  if (!accessIDs.length) return `<p class="muted">No domain-only access yet.</p>`;
  const membersByID = Object.fromEntries((members || []).map((member) => [member.id, member]));
  return accessIDs.map((id) => {
    const member = membersByID[id] || {};
    const accessRole = memberRoles[id] || member.staff_role || "internal";
    const role = adminIDs.includes(id) ? "Client Admin" : (staffRoleLabel(accessRole) || "Member");
    return `<article class="task-row">
      <div><h3>${esc(member.name || member.username || member.email || "Member")}</h3><span class="muted">@${esc(member.username || "member")} - ${esc(member.email || "")}</span></div>
      <span class="pill">${esc(role)}</span>
      <button class="btn compact danger" type="button" data-remove-domain-member="${esc(id)}">${icon("user-minus")}Remove</button>
    </article>`;
  }).join("");
}

function clientWebsiteRows(websites, canManage = false, canManageMembers = false) {
  if (!websites.length) return `<p class="muted">No websites yet.</p>`;
  return websites.map((site) => {
    const accessCount = new Set([...(site.member_ids || []), ...(site.client_admin_ids || [])]).size;
    return `<article class="task-row website-row">
    <div><h3>${esc(site.name)}</h3><span class="muted">${esc(site.url || "No URL yet")}</span></div>
    <span class="pill">${icon("globe-2")}website</span>
    ${accessCount ? `<span class="pill">${esc(accessCount)} domain access</span>` : ""}
    <div class="invite-actions">
      <a class="btn compact" href="/projects/${esc(site.client_id)}/sites/${esc(site.id)}">${icon("external-link")}Open</a>
      ${canManageMembers ? `<button class="btn compact" type="button" data-share-client-website="${esc(site.id)}">${icon("users")}Add team</button>` : ""}
      ${canManage ? `<div class="context-actions" data-action-menu-wrap>
        <button class="context-menu-trigger" type="button" data-action-menu-trigger aria-label="Website options"></button>
        <div class="context-menu" data-action-menu hidden>
          <button type="button" data-edit-client-website="${esc(site.id)}">${icon("pencil")}Edit website</button>
          <button class="danger-text" type="button" data-delete-client-website="${esc(site.id)}" data-website-name="${esc(site.name)}">${icon("trash-2")}Delete website</button>
        </div>
      </div>` : ""}
    </div>
  </article>`;
  }).join("");
}

function clientWebsiteWidgetInstallHTML(website = {}, canManage = false) {
  if (!canManage) {
    return `<section class="panel widget-install-panel">
      <div class="panel-head compact-panel-head"><h2>Website capture widget</h2><span class="pill">Protected</span></div>
      <p class="muted">Only admins can manage this website widget configuration.</p>
    </section>`;
  }
  const key = String(website.widget_key || "").trim();
  if (!key) return `<section class="panel widget-install-panel"><div class="panel-head compact-panel-head"><h2>Website capture widget</h2><span class="pill">Preparing key</span></div></section>`;
  const snippet = `<script src="${location.origin}/widget.js" data-project="${key}" async></script>`;
  return `<section class="panel widget-install-panel">
    <div class="panel-head compact-panel-head">
      <div><h2>Website capture widget</h2><p class="muted">Paste this code inside the &lt;head&gt;...&lt;/head&gt; section on ${esc(website.url || website.name || "the client website")}. The button appears only for signed-in BugMega users with domain access.</p></div>
      <button class="btn compact" type="button" id="copyClientWidgetCode">${icon("copy")}Copy code</button>
    </div>
    <textarea class="code-textarea" id="clientWidgetInstallCode" readonly>${esc(snippet)}</textarea>
    <p class="status-line" id="clientWidgetInstallStatus"></p>
  </section>`;
}

function clientDocumentRows(documents, canManage) {
  if (!documents.length) return `<p class="muted">No documents yet.</p>`;
  return documents.map((doc) => {
    const link = doc.file_url || doc.url || "";
    return `<article class="task-row client-doc-row">
      <div>
        <h3>${esc(doc.title)}</h3>
        <span class="muted">${esc(doc.kind || "note")}${link ? " - " + esc(link) : ""}</span>
        ${doc.content ? `<p>${chatText(doc.content)}</p>` : ""}
      </div>
      <span class="pill">${esc(doc.kind || "note")}</span>
      <div class="invite-actions">
        ${link ? `<a class="btn compact" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${icon("external-link")}Open</a>` : ""}
        ${canManage ? `<button class="btn compact danger" type="button" data-delete-client-doc="${esc(doc.id)}">${icon("trash-2")}Delete</button>` : ""}
      </div>
    </article>`;
  }).join("");
}

function deleteClientWebsiteDialogHTML() {
  return `<dialog id="deleteClientWebsiteDialog" class="modal client-dialog">
    <form id="deleteClientWebsiteForm" class="form-grid" method="dialog">
      <div class="modal-head"><h2>Delete website</h2><button class="btn icon quiet" type="button" data-close-dialog="deleteClientWebsiteDialog" title="Close">${icon("x")}</button></div>
      <input type="hidden" name="website_id">
      <p class="muted" id="deleteClientWebsiteText">This will delete the website and its tabs, task boards, documents, comments, and logs.</p>
      <div class="field"><label>Type Confirm to delete</label><input name="confirm_text" autocomplete="off" required></div>
      <div class="toolbar"><button class="btn danger" type="submit">${icon("trash-2")}Delete website</button><button class="btn" type="button" data-close-dialog="deleteClientWebsiteDialog">Cancel</button></div>
      <p class="status-line"></p>
    </form>
  </dialog>`;
}

function editClientWebsiteDialogHTML() {
  return `<dialog id="editClientWebsiteDialog" class="modal client-dialog">
    <form id="editClientWebsiteForm" class="form-grid" method="dialog">
      <div class="modal-head"><h2>Edit website</h2><button class="btn icon quiet" type="button" data-close-dialog="editClientWebsiteDialog" title="Close">${icon("x")}</button></div>
      <input type="hidden" name="website_id">
      <div class="field"><label>Website name</label><input name="name" required></div>
      <div class="field"><label>Website URL</label><input name="url" placeholder="https://example.com"></div>
      <div class="field"><label>Website details</label><textarea name="details" data-mentionable></textarea></div>
      <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Save</button><button class="btn" type="button" data-close-dialog="editClientWebsiteDialog">Cancel</button></div>
      <p class="status-line"></p>
    </form>
  </dialog>`;
}

function bindContextActionMenus(root = document) {
  bindFloatingDropdownDismissal();
  root.querySelectorAll("[data-action-menu], [data-client-tab-menu]").forEach((menu) => {
    if (menu.dataset.actionMenuBound === "1") return;
    menu.dataset.actionMenuBound = "1";
    menu.addEventListener("click", (event) => event.stopPropagation());
  });
  root.querySelectorAll("[data-action-menu-trigger], [data-client-tab-menu-trigger]").forEach((trigger) => {
    if (trigger.dataset.actionTriggerBound === "1") return;
    trigger.dataset.actionTriggerBound = "1";
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const wrap = trigger.closest("[data-action-menu-wrap], [data-client-tab-item]");
      const menu = wrap?.querySelector("[data-action-menu], [data-client-tab-menu]");
      if (!menu) return;
      document.querySelectorAll("[data-action-menu], [data-client-tab-menu]").forEach((other) => {
        if (other !== menu) other.hidden = true;
      });
      menu.hidden = !menu.hidden;
    });
  });
}

function bindClientWebsiteEdit(websites = [], onSaved) {
  const sitesByID = Object.fromEntries(websites.map((site) => [site.id, site]));
  document.querySelectorAll("[data-edit-client-website]").forEach((btn) => {
    if (btn.dataset.editBound === "1") return;
    btn.dataset.editBound = "1";
    btn.addEventListener("click", () => {
      const site = sitesByID[btn.dataset.editClientWebsite];
      const form = $("#editClientWebsiteForm");
      if (!site || !form) return;
      form.reset();
      form.elements.website_id.value = site.id || "";
      form.elements.name.value = site.name || "";
      form.elements.url.value = site.url || "";
      form.elements.details.value = site.details || "";
      $("#editClientWebsiteDialog")?.showModal();
    });
  });
  $("#editClientWebsiteForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const websiteID = form.elements.website_id.value;
    try {
      await api(`/api/client-websites/${websiteID}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.elements.name.value,
          url: form.elements.url.value,
          details: form.elements.details.value,
        }),
      });
      $("#editClientWebsiteDialog")?.close();
      await refreshClientSidebarCache();
      await onSaved?.(websiteID);
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
}

function bindClientWebsiteDelete(onDeleted) {
  document.querySelectorAll("[data-delete-client-website]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const form = $("#deleteClientWebsiteForm");
      if (!form) return;
      form.reset();
      form.elements.website_id.value = btn.dataset.deleteClientWebsite || "";
      $("#deleteClientWebsiteText").textContent = `This will delete ${btn.dataset.websiteName || "this website"} and its tabs, task boards, documents, comments, and logs.`;
      $("#deleteClientWebsiteDialog")?.showModal();
    });
  });
  $("#deleteClientWebsiteForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const websiteID = form.elements.website_id.value;
    if (String(form.elements.confirm_text.value || "").trim() !== "Confirm") {
      setFormStatus(form, "Type Confirm exactly to delete this website.", true);
      return;
    }
    try {
      await api(`/api/client-websites/${websiteID}`, { method: "DELETE" });
      $("#deleteClientWebsiteDialog")?.close();
      await refreshClientSidebarCache();
      await onDeleted?.(websiteID);
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
}

function clientMemberRows(members, canManageMembers) {
  if (!members.length) return `<p class="muted">No members listed yet.</p>`;
  return members.map((entry) => {
    const user = entry.user || {};
    const role = staffRoleLabel(entry.client_role) || clientRoleLabel(entry.client_role);
    return `<article class="task-row">
      <div><h3>${esc(user.name || user.username || user.email)}</h3><span class="muted">@${esc(user.username || "member")} - ${esc(user.email || "")}</span></div>
      <span class="pill">${esc(role)}</span>
      ${canManageMembers && user.id !== state.me?.id ? `<button class="btn compact danger" type="button" data-remove-client-member="${esc(user.id)}">${icon("user-minus")}Remove</button>` : ""}
    </article>`;
  }).join("");
}

function teamMemberOptionHTML(members = []) {
  const candidates = (members || []).filter((member) => member.status === "active" || member.status === "pending");
  if (!candidates.length) return `<option value="" disabled>No active or pending invited members available</option>`;
  return candidates.map((member) => {
    const status = member.status === "pending" ? " - pending invite" : "";
    return `<option value="${esc(member.id)}">${esc(member.name || member.email)} - @${esc(member.username || "member")}${esc(status)}</option>`;
  }).join("");
}

function memberStaffRole(member) {
  return normalizedStaffRole(member?.staff_role) || "internal";
}

function bindAccessRoleSelect(form, members = []) {
  if (!form || !form.elements?.user_id || !form.elements?.role) return;
  const membersByID = Object.fromEntries((members || []).map((member) => [member.id, member]));
  const sync = () => {
    form.elements.role.value = memberStaffRole(membersByID[form.elements.user_id.value]);
  };
  form.elements.user_id.addEventListener("change", sync);
  sync();
}

function compactClientTaskTitle(value) {
  return Array.from(String(value || "").trim()).slice(0, 80).join("").trim();
}

function compactClientTaskContent(value) {
  return Array.from(String(value || "").trim()).slice(0, 100).join("").trim();
}

const DEFAULT_CLIENT_TASK_STATUSES = ["todo", "in_progress", "done"];
const DEFAULT_CLIENT_TASK_STATUS_STYLES = {
  todo: { icon_color: "#9ca3af", text_color: "#d1d5db" },
  in_progress: { icon_color: "#f59e0b", text_color: "#fbbf24" },
  done: { icon_color: "#10b981", text_color: "#6ee7b7" },
};

function normalizeClientTaskStatusValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function clientTaskStatusLabel(value) {
  const labels = { todo: "To do", in_progress: "In progress", revision: "Revision", completed: "Completed", ready_for_review: "Ready for review", done: "Done" };
  return labels[value] || String(value || "").replaceAll("_", " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function normalizeStatusColor(value, fallback) {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback;
}

function hexRGB(color) {
  const normalized = normalizeStatusColor(color, "#000000").slice(1);
  return [0, 2, 4].map((index) => parseInt(normalized.slice(index, index + 2), 16) / 255);
}

function relativeLuminance(color) {
  const channels = hexRGB(color).map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrastRatio(foreground, background) {
  const light = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (light + 0.05) / (dark + 0.05);
}

function isDarkThemeActive() {
  return document.documentElement.dataset.theme === "dark";
}

function readableStatusTextColor(value, fallback = "#e5e7eb") {
  const color = normalizeStatusColor(value, fallback);
  if (!isDarkThemeActive()) return color;
  return contrastRatio(color, "#101613") < 4.5 ? "#78dccb" : color;
}

function clientTaskStatuses(tab, tasks = []) {
  const seen = new Set();
  const savedStyles = tab?.status_styles || {};
  const savedStatuses = Array.isArray(tab?.statuses) && tab.statuses.length ? tab.statuses : DEFAULT_CLIENT_TASK_STATUSES;
  const values = [...savedStatuses, ...(tasks || []).map((task) => task.status || "todo")];
  return values.map(normalizeClientTaskStatusValue).filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  }).map((value) => {
    const fallback = DEFAULT_CLIENT_TASK_STATUS_STYLES[value] || { icon_color: "#8b5cf6", text_color: "#e5e7eb" };
    const style = savedStyles[value] || {};
    return {
      value,
      label: clientTaskStatusLabel(value),
      icon_color: normalizeStatusColor(style.icon_color, fallback.icon_color),
      text_color: normalizeStatusColor(style.text_color, fallback.text_color),
    };
  });
}

function statusStyleVars(status) {
  return `style="--status-icon-color:${esc(normalizeStatusColor(status?.icon_color, "#8b5cf6"))}; --status-text-color:${esc(readableStatusTextColor(status?.text_color, "#e5e7eb"))}"`;
}

function statusBadgeHTML(status, className = "status-badge") {
  return `<span class="${esc(className)}" ${statusStyleVars(status)}><span class="status-dot"></span><span>${esc(status?.label || clientTaskStatusLabel(status?.value || "todo"))}</span></span>`;
}

function statusStylesPayload(tab, tasks, statusValue, iconColor, textColor) {
  const status = normalizeClientTaskStatusValue(statusValue);
  const statuses = clientTaskStatuses(tab, tasks);
  const values = statuses.map((item) => item.value);
  if (status && !values.includes(status)) values.push(status);
  const styles = {};
  statuses.forEach((item) => {
    styles[item.value] = { icon_color: item.icon_color, text_color: item.text_color };
  });
  if (status) {
    styles[status] = {
      icon_color: normalizeStatusColor(iconColor, "#f97316"),
      text_color: normalizeStatusColor(textColor, "#fed7aa"),
    };
  }
  return { statuses: values, status_styles: styles };
}

function statusOrderPayload(tab, tasks, orderedValues = []) {
  const knownStatuses = clientTaskStatuses(tab, tasks);
  const knownByValue = Object.fromEntries(knownStatuses.map((item) => [item.value, item]));
  const values = [];
  orderedValues.map(normalizeClientTaskStatusValue).forEach((value) => {
    if (value && !values.includes(value)) values.push(value);
  });
  knownStatuses.forEach((item) => {
    if (item.value && !values.includes(item.value)) values.push(item.value);
  });
  const styles = {};
  values.forEach((value) => {
    const fallback = DEFAULT_CLIENT_TASK_STATUS_STYLES[value] || { icon_color: "#8b5cf6", text_color: "#e5e7eb" };
    const item = knownByValue[value] || fallback;
    styles[value] = {
      icon_color: normalizeStatusColor(item.icon_color, fallback.icon_color),
      text_color: normalizeStatusColor(item.text_color, fallback.text_color),
    };
  });
  return { statuses: values, status_styles: styles };
}

async function saveClientStatusOrder(tab, tasks = [], orderedValues = [], onSaved = () => {}) {
  if (!tab?.id) return;
  await api(`/api/client-tabs/${tab.id}`, {
    method: "PATCH",
    body: JSON.stringify(statusOrderPayload(tab, tasks, orderedValues)),
  });
  await onSaved();
}

function dueDateDeltaLabel(value) {
  return dueDateDeltaLabelFromDate(parseLocalDate(value));
}

function parseLocalDate(value) {
  if (!value) return null;
  const match = String(value).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function localISODate(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayLocalDate() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function dueDateDeltaLabelFromDate(due) {
  if (!due) return "";
  const today = todayLocalDate();
  const days = Math.ceil((due.getTime() - today.getTime()) / 86400000);
  if (Number.isNaN(days)) return "";
  if (days === 0) return "Today";
  return `${Math.abs(days)}D${days < 0 ? " late" : ""}`;
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDINAL_LABELS = { 1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth", "-1": "last" };

function monthlyOrdinalFromDate(date) {
  if (!date) return 1;
  return Math.floor((date.getDate() - 1) / 7) + 1;
}

function monthlyNthWeekdayDate(year, monthIndex, ordinal, weekday) {
  const lastDay = daysInMonth(year, monthIndex);
  if (ordinal === -1) {
    for (let day = lastDay; day >= 1; day -= 1) {
      const candidate = new Date(year, monthIndex, day);
      if (candidate.getDay() === weekday) return candidate;
    }
    return null;
  }
  const first = new Date(year, monthIndex, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  const day = 1 + offset + ((ordinal || 1) - 1) * 7;
  return day <= lastDay ? new Date(year, monthIndex, day) : null;
}

function nextRecurringDueDate(dueValue, recurrence = {}) {
  const start = parseLocalDate(dueValue);
  if (!start) return null;
  const today = todayLocalDate();
  const minDate = today > start ? today : start;
  const frequency = recurrence?.frequency || "";
  if (!frequency || frequency === "none") return start;
  if (frequency === "daily") return minDate;
  if (frequency === "weekly") {
    const delta = (start.getDay() - minDate.getDay() + 7) % 7;
    const candidate = addDays(minDate, delta);
    return candidate < start ? addDays(candidate, 7) : candidate;
  }
  if (frequency !== "monthly") return start;
  const monthlyMode = recurrence.monthly_mode || "dates";
  for (let offset = 0; offset < 36; offset += 1) {
    const cursor = new Date(minDate.getFullYear(), minDate.getMonth() + offset, 1);
    const candidates = [];
    if (monthlyMode === "nth_weekday") {
      const ordinal = Number(recurrence.week_ordinal || monthlyOrdinalFromDate(start));
      const weekday = Number.isInteger(recurrence.weekday) ? recurrence.weekday : start.getDay();
      const candidate = monthlyNthWeekdayDate(cursor.getFullYear(), cursor.getMonth(), ordinal, weekday);
      if (candidate) candidates.push(candidate);
    } else {
      const dates = Array.isArray(recurrence.month_dates) && recurrence.month_dates.length ? recurrence.month_dates : [start.getDate()];
      dates.forEach((day) => {
        const numericDay = Number(day);
        if (numericDay >= 1 && numericDay <= daysInMonth(cursor.getFullYear(), cursor.getMonth())) {
          candidates.push(new Date(cursor.getFullYear(), cursor.getMonth(), numericDay));
        }
      });
    }
    const next = candidates.sort((a, b) => a - b).find((candidate) => candidate >= minDate && candidate >= start);
    if (next) return next;
  }
  return start;
}

function recurrenceLabel(recurrence = {}, dueValue = "") {
  const frequency = recurrence?.frequency || "";
  const start = parseLocalDate(dueValue);
  if (!frequency || frequency === "none") return "";
  if (frequency === "daily") return "Daily";
  if (frequency === "weekly") return `Weekly${start ? ` on ${WEEKDAY_LABELS[start.getDay()]}` : ""}`;
  if (frequency !== "monthly") return "";
  if ((recurrence.monthly_mode || "dates") === "nth_weekday") {
    const ordinal = recurrence.week_ordinal || monthlyOrdinalFromDate(start);
    const weekday = Number.isInteger(recurrence.weekday) ? recurrence.weekday : (start ? start.getDay() : 1);
    return `Monthly ${ORDINAL_LABELS[ordinal] || "first"} ${WEEKDAY_LABELS[weekday] || "Monday"}`;
  }
  const dates = Array.isArray(recurrence.month_dates) && recurrence.month_dates.length ? recurrence.month_dates : (start ? [start.getDate()] : []);
  return dates.length ? `Monthly on ${dates.join(", ")}` : "Monthly";
}

function taskCompletionCount(task = {}) {
  return Math.max(0, Number(task.completion_count || 0));
}

function taskCompletionBadgeHTML(task = {}) {
  const count = taskCompletionCount(task);
  return count ? `<span class="pill completion-pill">${icon("check-check")}Completed ${esc(count)}x</span>` : "";
}

function taskDueInfo(task = {}) {
  const nextDue = nextRecurringDueDate(task.due_date, task.recurrence || {});
  const label = dueDateDeltaLabelFromDate(nextDue);
  const repeat = recurrenceLabel(task.recurrence || {}, task.due_date);
  return {
    date: nextDue ? localISODate(nextDue) : "",
    label,
    repeat,
    text: [repeat, label].filter(Boolean).join(" · "),
  };
}

function showDueDateCalendar(value) {
  if (!value) return;
  const input = document.createElement("input");
  input.type = "date";
  input.value = String(value).slice(0, 10);
  input.style.position = "fixed";
  input.style.left = "-1000px";
  input.style.top = "0";
  document.body.appendChild(input);
  const cleanup = () => setTimeout(() => input.remove(), 120);
  input.addEventListener("blur", cleanup, { once: true });
  input.addEventListener("change", cleanup, { once: true });
  input.focus();
  if (input.showPicker) input.showPicker();
}

function assigneeAvatarsHTML(ids = [], usersByID = {}) {
  const users = (ids || []).map((id) => usersByID[id]).filter(Boolean);
  if (!users.length) return "";
  return `<div class="assignee-avatars">${users.slice(0, 5).map((user) => userChip(user)).join("")}${users.length > 5 ? `<span class="avatar-more">+${users.length - 5}</span>` : ""}</div>`;
}

function assigneePickerHTML(members = [], selected = []) {
  const selectedSet = new Set(selected || []);
  const selectedUsers = (members || []).map((entry) => entry.user || {}).filter((user) => selectedSet.has(user.id));
  const rows = (members || []).map((entry) => {
    const user = entry.user || {};
    const name = user.name || user.username || user.email || "Member";
    const roleText = staffRoleLabel(entry.client_role || entry.staff_role || user.staff_role) || roleLabel(entry.role || user.role || "");
    const searchable = [name, user.username, user.email, entry.client_role, entry.staff_role, user.staff_role, entry.role, user.role, roleText].filter(Boolean).join(" ");
    return `<label class="assignee-choice ${selectedSet.has(user.id) ? "selected" : ""}" data-assignee-search="${esc(searchable)}">
      <input type="checkbox" name="assignee_ids" value="${esc(user.id || "")}" ${selectedSet.has(user.id) ? "checked" : ""}>
      ${userChip(user)}
      <strong>${esc(name)}</strong>
      <span class="assignee-remove-hint" aria-hidden="true">${icon("x")}</span>
    </label>`;
  }).join("");
  return `<div class="assignee-picker">
    <button class="assignee-trigger" type="button" data-assignee-trigger>
      <span class="assignee-trigger-icons">${selectedUsers.length ? selectedUsers.slice(0, 3).map((user) => userChip(user)).join("") : icon("user-plus")}</span>
      <span data-assignee-trigger-label>${selectedUsers.length ? `${selectedUsers.length} assigned` : "Assign"}</span>
    </button>
    <div class="assignee-menu" data-assignee-menu hidden>
      <input class="assignee-search" type="search" placeholder="Search or enter email...">
      <span class="muted">Assignees</span>
      <div class="assignee-list">${rows || `<p class="muted">No listed members yet.</p>`}</div>
    </div>
  </div>`;
}

function statusAddControlsHTML(tabID = "") {
  if (!tabID) return "";
  return `<div class="status-add-form" data-status-add-form data-status-tab-id="${esc(tabID)}">
    <span class="muted">Add status</span>
    <input data-status-add-name placeholder="Needs revisions">
    <div class="status-color-row">
      <label><span>Icon</span><input type="color" data-status-add-icon-color value="#f97316"></label>
      <label><span>Text</span><input type="color" data-status-add-text-color value="#fed7aa"></label>
      <button class="btn icon quiet status-add-submit" type="button" data-status-add-submit title="Add status">${icon("plus")}</button>
    </div>
    <small data-status-add-message></small>
  </div>`;
}

function statusEditControlsHTML(tabID = "") {
  if (!tabID) return "";
  return `<div class="status-edit-form" data-status-edit-form data-status-tab-id="${esc(tabID)}" hidden>
    <span class="muted">Edit status</span>
    <input data-status-edit-name placeholder="Status name">
    <div class="status-color-row">
      <label><span>Icon</span><input type="color" data-status-edit-icon-color value="#f97316"></label>
      <label><span>Text</span><input type="color" data-status-edit-text-color value="#fed7aa"></label>
      <button class="btn icon quiet status-edit-submit" type="button" data-status-edit-submit title="Save status">${icon("check")}</button>
      <button class="btn icon quiet" type="button" data-status-edit-cancel title="Cancel">${icon("x")}</button>
    </div>
    <small data-status-edit-message></small>
  </div>`;
}

function statusPickerHTML(statuses = [], selected = "todo", name = "status", autoTaskID = "", options = {}) {
  const selectedValue = normalizeClientTaskStatusValue(selected || "todo") || "todo";
  const selectedStatus = statuses.find((item) => item.value === selectedValue) || { value: selectedValue, label: clientTaskStatusLabel(selectedValue), icon_color: "#8b5cf6", text_color: "#e5e7eb" };
  const triggerLabel = options.triggerLabel || selectedStatus.label;
  const canManageStatuses = Boolean(options.canManageStatuses && options.tabID);
  const canAdd = Boolean((options.canAdd || canManageStatuses) && options.tabID);
  return `<div class="status-picker" data-status-picker ${autoTaskID ? `data-auto-task-id="${esc(autoTaskID)}"` : ""}>
    <button class="status-trigger" type="button" data-status-trigger ${statusStyleVars(selectedStatus)}>
      <span class="status-dot"></span><span data-status-trigger-label>${esc(triggerLabel)}</span>${icon("chevron-down")}
    </button>
    <input type="hidden" name="${esc(name)}" value="${esc(selectedValue)}">
    <div class="status-menu" data-status-menu hidden>
      ${statuses.map((item) => `<div class="status-option-row">
        <button type="button" data-status-option="${esc(item.value)}" ${autoTaskID ? `data-auto-client-task-status="${esc(autoTaskID)}"` : ""} ${statusStyleVars(item)}><span class="status-dot"></span><span data-status-option-label>${esc(item.label)}</span></button>
        ${canManageStatuses ? `<span class="status-option-actions">
          <button class="btn icon quiet" type="button" data-status-edit="${esc(item.value)}" data-status-label="${esc(item.label)}" data-status-icon-color="${esc(item.icon_color)}" data-status-text-color="${esc(item.text_color)}" title="Edit status">${icon("pencil")}</button>
          <button class="btn icon quiet danger-text" type="button" data-status-delete="${esc(item.value)}" data-status-label="${esc(item.label)}" title="Delete status">${icon("trash-2")}</button>
        </span>` : ""}
      </div>`).join("")}
      ${canAdd ? statusAddControlsHTML(options.tabID) : ""}
      ${canManageStatuses ? statusEditControlsHTML(options.tabID) : ""}
    </div>
  </div>`;
}

function selectedAssigneeIDs(form) {
  return Array.from(form.querySelectorAll("input[name='assignee_ids']:checked")).map((input) => input.value).filter(Boolean);
}

function bindAssigneePickers(root = document) {
  bindFloatingDropdownDismissal();
  root.querySelectorAll(".assignee-picker").forEach((picker) => {
    const trigger = picker.querySelector("[data-assignee-trigger]");
    const menu = picker.querySelector("[data-assignee-menu]");
    const search = picker.querySelector(".assignee-search");
    menu?.addEventListener("click", (event) => event.stopPropagation());
    const resetSearch = () => {
      if (search) search.value = "";
      picker.querySelectorAll(".assignee-choice").forEach((row) => {
        row.hidden = false;
      });
    };
    const updateTrigger = () => {
      const checkedRows = Array.from(picker.querySelectorAll(".assignee-choice input:checked")).map((input) => input.closest(".assignee-choice")).filter(Boolean);
      picker.querySelectorAll(".assignee-choice").forEach((row) => row.classList.toggle("selected", Boolean(row.querySelector("input:checked"))));
      const icons = checkedRows.slice(0, 3).map((row) => row.querySelector(".user-chip")?.outerHTML || "").join("");
      picker.querySelector(".assignee-trigger-icons").innerHTML = checkedRows.length ? icons : icon("user-plus");
      picker.querySelector("[data-assignee-trigger-label]").textContent = checkedRows.length ? `${checkedRows.length} assigned` : "Assign";
      window.lucide?.createIcons();
    };
    trigger?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      document.querySelectorAll(".assignee-menu").forEach((other) => {
        if (other !== menu) other.hidden = true;
      });
      const shouldOpen = Boolean(menu?.hidden);
      if (menu) menu.hidden = !menu.hidden;
      if (shouldOpen) {
        resetSearch();
        search?.focus();
      }
    });
    search?.addEventListener("click", (event) => event.stopPropagation());
    search?.addEventListener("keydown", (event) => event.stopPropagation());
    search?.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      picker.querySelectorAll(".assignee-choice").forEach((row) => {
        const searchable = row.dataset.assigneeSearch || row.textContent || "";
        row.hidden = Boolean(q) && !searchable.toLowerCase().includes(q);
      });
    });
    picker.querySelectorAll(".assignee-choice input").forEach((input) => input.addEventListener("change", () => {
      updateTrigger();
      picker.dispatchEvent(new CustomEvent("assigneeschange", { bubbles: true }));
    }));
  });
}

function bindStatusPickers(root = document) {
  bindFloatingDropdownDismissal();
  root.querySelectorAll("[data-status-picker]").forEach((picker) => {
    const trigger = picker.querySelector("[data-status-trigger]");
    const menu = picker.querySelector("[data-status-menu]");
    const input = picker.querySelector("input[type='hidden']");
    menu?.addEventListener("click", (event) => event.stopPropagation());
    trigger?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      document.querySelectorAll(".status-menu").forEach((other) => {
        if (other !== menu) other.hidden = true;
      });
      if (menu) menu.hidden = !menu.hidden;
    });
    picker.querySelectorAll("[data-status-option]").forEach((option) => option.addEventListener("click", () => {
      const value = option.dataset.statusOption;
      if (input) input.value = value;
      const trigger = picker.querySelector("[data-status-trigger]");
      const label = option.querySelector("[data-status-option-label]")?.textContent || clientTaskStatusLabel(value);
      picker.querySelector("[data-status-trigger-label]").textContent = label;
      trigger?.style.setProperty("--status-icon-color", option.style.getPropertyValue("--status-icon-color"));
      trigger?.style.setProperty("--status-text-color", option.style.getPropertyValue("--status-text-color"));
      if (menu) menu.hidden = true;
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      picker.dispatchEvent(new CustomEvent("statuschange", { bubbles: true, detail: { value } }));
    }));
  });
}

function bindStatusAddControls(root, tab, tasks = [], onSaved = () => {}) {
  root.querySelectorAll("[data-status-add-form]").forEach((box) => {
    const submit = box.querySelector("[data-status-add-submit]");
    const nameInput = box.querySelector("[data-status-add-name]");
    const message = box.querySelector("[data-status-add-message]");
    const save = async () => {
      const status = normalizeClientTaskStatusValue(nameInput?.value || "");
      if (!status || !tab?.id) {
        if (message) message.textContent = "Status name is required.";
        return;
      }
      if (submit) submit.disabled = true;
      if (message) message.textContent = "Saving...";
      try {
        const payload = statusStylesPayload(
          tab,
          tasks,
          status,
          box.querySelector("[data-status-add-icon-color]")?.value,
          box.querySelector("[data-status-add-text-color]")?.value,
        );
        await api(`/api/client-tabs/${tab.id}`, { method: "PATCH", body: JSON.stringify(payload) });
        if (message) message.textContent = "Saved";
        await onSaved(status);
      } catch (error) {
        if (message) message.textContent = error.message;
      } finally {
        if (submit) submit.disabled = false;
      }
    };
    submit?.addEventListener("click", save);
    nameInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      save();
    });
  });
  root.querySelectorAll("[data-status-edit]").forEach((btn) => btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const menu = btn.closest("[data-status-menu]");
    const form = menu?.querySelector("[data-status-edit-form]");
    if (!form) return;
    form.hidden = false;
    form.dataset.editingStatus = btn.dataset.statusEdit || "";
    form.querySelector("[data-status-edit-name]").value = btn.dataset.statusLabel || clientTaskStatusLabel(btn.dataset.statusEdit);
    form.querySelector("[data-status-edit-icon-color]").value = normalizeStatusColor(btn.dataset.statusIconColor, "#f97316");
    form.querySelector("[data-status-edit-text-color]").value = normalizeStatusColor(btn.dataset.statusTextColor, "#fed7aa");
    const message = form.querySelector("[data-status-edit-message]");
    if (message) message.textContent = "";
    form.querySelector("[data-status-edit-name]")?.focus();
  }));
  root.querySelectorAll("[data-status-edit-cancel]").forEach((btn) => btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const form = btn.closest("[data-status-edit-form]");
    if (form) form.hidden = true;
  }));
  root.querySelectorAll("[data-status-edit-submit]").forEach((btn) => btn.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const form = btn.closest("[data-status-edit-form]");
    const oldStatus = form?.dataset.editingStatus;
    const message = form?.querySelector("[data-status-edit-message]");
    const nextName = form?.querySelector("[data-status-edit-name]")?.value || "";
    if (!oldStatus || !tab?.id) return;
    if (!normalizeClientTaskStatusValue(nextName)) {
      if (message) message.textContent = "Status name is required.";
      return;
    }
    btn.disabled = true;
    if (message) message.textContent = "Saving...";
    try {
      await api(`/api/client-tabs/${tab.id}/statuses/${oldStatus}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: nextName,
          icon_color: form.querySelector("[data-status-edit-icon-color]")?.value,
          text_color: form.querySelector("[data-status-edit-text-color]")?.value,
        }),
      });
      if (message) message.textContent = "Saved";
      await onSaved(normalizeClientTaskStatusValue(nextName));
    } catch (error) {
      if (message) message.textContent = error.message;
    } finally {
      btn.disabled = false;
    }
  }));
  root.querySelectorAll("[data-status-delete]").forEach((btn) => btn.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const status = btn.dataset.statusDelete;
    const label = btn.dataset.statusLabel || clientTaskStatusLabel(status);
    if (!status || !tab?.id) return;
    if (!typedConfirm(`Delete status "${label}"? Tasks in this status will move to the first remaining status.`)) return;
    btn.disabled = true;
    try {
      await api(`/api/client-tabs/${tab.id}/statuses/${status}`, { method: "DELETE" });
      await onSaved();
    } catch (error) {
      const menu = btn.closest("[data-status-menu]");
      const message = menu?.querySelector("[data-status-add-message]") || menu?.querySelector("[data-status-edit-message]");
      if (message) message.textContent = error.message;
    } finally {
      btn.disabled = false;
    }
  }));
}

function bindClientTaskQuickAutosave(root, taskID, afterSave = () => {}, task = {}) {
  const form = root.querySelector("#clientTaskQuickEditForm");
  if (!form || !taskID) return;
  const dueInput = form.querySelector("input[name='due_date']");
  let saveVersion = 0;
  const save = async (body) => {
    const currentVersion = ++saveVersion;
    setFormStatus(form, "Saving...");
    try {
      await api(`/api/client-tasks/${taskID}`, { method: "PATCH", body: JSON.stringify(body) });
      if (currentVersion === saveVersion) {
        setFormStatus(form, "Saved");
      }
      await afterSave();
    } catch (error) {
      if (currentVersion === saveVersion) {
        setFormStatus(form, error.message, true);
      }
    }
  };
  form.querySelector("input[name='status']")?.addEventListener("change", (event) => {
    save({ status: event.currentTarget.value });
  });
  form.querySelectorAll("[data-due-edit-open]").forEach((btn) => btn.addEventListener("click", () => {
    dueInput?.focus();
    if (dueInput?.showPicker) {
      try {
        dueInput.showPicker();
      } catch {
        dueInput.click();
      }
    } else {
      dueInput?.click();
    }
  }));
  dueInput?.addEventListener("change", (event) => {
    const label = form.querySelector("[data-due-edit-label]");
    if (label) label.textContent = taskDueInfo({ due_date: event.currentTarget.value, recurrence: task.recurrence || {} }).text || "No due date";
    save({ due_date: event.currentTarget.value });
  });
  form.querySelector(".assignee-picker")?.addEventListener("assigneeschange", () => {
    save({ assignee_ids: selectedAssigneeIDs(form) });
  });
}

function bindClientBoardDrag(root, onMoved = () => {}) {
  const setup = () => {
    if (!window.Sortable) {
      setTimeout(setup, 120);
      return;
    }
    root.querySelectorAll(".client-board .kanban-column").forEach((column) => {
      Sortable.create(column, {
        group: "client-tasks",
        animation: 150,
        draggable: ".client-task-card[data-can-drag='true']",
        filter: "button, input, textarea, a, .status-picker, .assignee-picker",
        preventOnFilter: false,
        ghostClass: "task-card-ghost",
        dragClass: "task-card-dragging",
        onAdd: async (event) => {
          const taskID = event.item?.dataset.clientTaskId;
          const status = event.to?.dataset.clientStatus;
          if (!taskID || !status) return;
          try {
            await api(`/api/client-tasks/${taskID}`, { method: "PATCH", body: JSON.stringify({ status }) });
            await onMoved();
          } catch (error) {
            setStatus(error.message, true);
            await onMoved();
          }
        },
      });
    });
  };
  setup();
}

function statusValuesFromBoard(board) {
  return Array.from(board?.querySelectorAll(".kanban-column[data-client-status]") || [])
    .map((column) => column.dataset.clientStatus || "")
    .filter(Boolean);
}

function bindClientStatusColumnSort(root, tab, tasks = [], canManageStatuses = false, onSaved = () => {}) {
  if (!canManageStatuses || !tab?.id) return;
  const boards = Array.from(root.querySelectorAll(`[data-status-board-sort="${selectorEscape(tab.id)}"]`));
  const saveBoard = async (board) => {
    board.classList.add("status-order-saving");
    try {
      await saveClientStatusOrder(tab, tasks, statusValuesFromBoard(board), onSaved);
    } catch (error) {
      setStatus(error.message, true);
      board.classList.remove("status-order-saving");
    }
  };
  boards.forEach((board) => {
    board.querySelectorAll("[data-status-column-move]").forEach((btn) => btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const column = btn.closest(".kanban-column");
      if (!column) return;
      const direction = Number(btn.dataset.statusColumnDir || 0);
      if (direction < 0 && column.previousElementSibling) {
        board.insertBefore(column, column.previousElementSibling);
      } else if (direction > 0 && column.nextElementSibling) {
        board.insertBefore(column.nextElementSibling, column);
      } else {
        return;
      }
      await saveBoard(board);
    }));
  });
  const setupSortable = () => {
    if (!window.Sortable) {
      setTimeout(setupSortable, 120);
      return;
    }
    boards.forEach((board) => {
      Sortable.create(board, {
        animation: 150,
        draggable: ".kanban-column",
        handle: "[data-status-column-handle]",
        filter: "button:not([data-status-column-handle]), input, textarea, a, .client-task-card",
        preventOnFilter: false,
        ghostClass: "task-card-ghost",
        dragClass: "task-card-dragging",
        onEnd: async (event) => {
          if (event.oldIndex === event.newIndex) return;
          await saveBoard(board);
        },
      });
    });
  };
  setupSortable();
}

function bindFloatingDropdownDismissal() {
  if (state.dropdownDismissBound) return;
  state.dropdownDismissBound = true;
  document.addEventListener("click", () => {
    document.querySelectorAll(".assignee-menu, .status-menu, .context-menu, .client-tab-menu").forEach((menu) => {
      menu.hidden = true;
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".assignee-menu, .status-menu, .context-menu, .client-tab-menu").forEach((menu) => {
      menu.hidden = true;
    });
  });
}

function richEditorHTML(name, value = "", placeholder = "") {
  return `<div class="rich-editor" contenteditable="true" data-rich-editor="${esc(name)}" data-placeholder="${esc(placeholder)}">${esc(value)}</div><input type="hidden" name="${esc(name)}" value="${esc(value)}">`;
}

function pageRichEditorHTML(name, value = "", placeholder = "") {
  const id = `pageRichEditor_${name}_${Math.random().toString(36).slice(2)}`;
  return `<div class="page-rich-editor-wrap" data-page-rich-wrap>
    <div class="page-rich-toolbar" role="toolbar" aria-label="Rich text formatting">
      <select data-rich-format title="Heading style">
        <option value="p">Paragraph</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="h4">Heading 4</option>
      </select>
      <button class="btn icon quiet" type="button" data-rich-command="bold" title="Bold"><strong>B</strong></button>
      <button class="btn icon quiet" type="button" data-rich-command="italic" title="Italic"><em>I</em></button>
      <button class="btn icon quiet" type="button" data-rich-command="insertUnorderedList" title="Bullet list">${icon("list")}</button>
      <button class="btn icon quiet" type="button" data-rich-command="insertOrderedList" title="Numbered list">${icon("list-ordered")}</button>
      <label class="page-rich-color" title="Font color">
        ${icon("palette")}
        <input type="color" data-rich-color value="#0b8f7a" aria-label="Font color">
      </label>
      <button class="btn icon quiet" type="button" data-rich-table title="Insert table">${icon("table-2")}</button>
    </div>
    <div id="${esc(id)}" class="rich-editor page-rich-editor" contenteditable="true" data-page-rich-editor="${esc(name)}" data-placeholder="${esc(placeholder)}">${pageRichSafeHTML(value || "")}</div>
    <input type="hidden" name="${esc(name)}" value="${esc(pageRichSafeHTML(value || ""))}">
  </div>`;
}

function bindRichEditors(root = document) {
  root.querySelectorAll("[data-rich-editor]").forEach((editor) => {
    const input = root.querySelector(`input[name="${editor.dataset.richEditor}"]`);
    const sync = () => {
      if (input) input.value = editor.innerText.trim();
    };
    editor.addEventListener("input", sync);
    sync();
  });
}

function syncRichEditors(root = document) {
  root.querySelectorAll("[data-rich-editor]").forEach((editor) => {
    const input = root.querySelector(`input[name="${editor.dataset.richEditor}"]`);
    if (input) input.value = editor.innerText.trim();
  });
}

function bindPageRichEditors(root = document) {
  root.querySelectorAll("[data-page-rich-wrap]").forEach((wrap) => {
    if (wrap.dataset.pageRichBound === "1") return;
    wrap.dataset.pageRichBound = "1";
    const editor = wrap.querySelector("[data-page-rich-editor]");
    if (!editor) return;
    const input = wrap.querySelector(`input[name="${selectorEscape(editor.dataset.pageRichEditor)}"]`);
    const sync = () => {
      if (input) input.value = editor.innerHTML.trim();
    };
    const focusEditor = () => {
      editor.focus();
      sync();
    };
    wrap.querySelectorAll("[data-rich-command]").forEach((btn) => btn.addEventListener("click", () => {
      focusEditor();
      document.execCommand(btn.dataset.richCommand, false, null);
      sync();
    }));
    wrap.querySelector("[data-rich-format]")?.addEventListener("change", (event) => {
      focusEditor();
      document.execCommand("formatBlock", false, event.currentTarget.value || "p");
      sync();
    });
    wrap.querySelector("[data-rich-color]")?.addEventListener("input", (event) => {
      focusEditor();
      document.execCommand("foreColor", false, event.currentTarget.value || "#0b8f7a");
      sync();
    });
    wrap.querySelector("[data-rich-table]")?.addEventListener("click", () => {
      focusEditor();
      document.execCommand("insertHTML", false, `<table><tbody><tr><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td></tr></tbody></table><p><br></p>`);
      sync();
    });
    editor.addEventListener("input", sync);
    editor.addEventListener("blur", sync);
    sync();
  });
}

function syncPageRichEditors(root = document) {
  root.querySelectorAll("[data-page-rich-editor]").forEach((editor) => {
    const wrap = editor.closest("[data-page-rich-wrap]") || root;
    const input = wrap.querySelector(`input[name="${selectorEscape(editor.dataset.pageRichEditor)}"]`);
    if (input) input.value = editor.innerHTML.trim();
  });
}

function pageRichSafeHTML(value = "") {
  const allowedTags = new Set(["DIV", "P", "BR", "STRONG", "B", "EM", "I", "U", "UL", "OL", "LI", "H1", "H2", "H3", "H4", "BLOCKQUOTE", "CODE", "PRE", "A", "SPAN", "FONT", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD"]);
  const template = document.createElement("template");
  template.innerHTML = String(value || "");
  const clean = (node) => {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) return;
      if (child.nodeType !== Node.ELEMENT_NODE || !allowedTags.has(child.tagName)) {
        child.replaceWith(document.createTextNode(child.textContent || ""));
        return;
      }
      const href = child.getAttribute("href") || "";
      const colorStyle = child.getAttribute("style") || "";
      const fontColor = child.getAttribute("color") || "";
      Array.from(child.attributes).forEach((attr) => child.removeAttribute(attr.name));
      if (child.tagName === "A") {
        if (/^(https?:|mailto:|tel:|\/|#)/i.test(href)) {
          child.setAttribute("href", href);
          child.setAttribute("rel", "noopener");
          if (/^https?:/i.test(href)) child.setAttribute("target", "_blank");
        }
      }
      if (child.tagName === "SPAN" || child.tagName === "FONT") {
        const color = colorStyle.match(/color:\s*(#[0-9a-f]{3,6}|rgb\([^)]+\))/i)?.[1] || fontColor;
        if (color && (/^#[0-9a-f]{3,6}$/i.test(color) || /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i.test(color))) {
          if (child.tagName === "FONT") child.setAttribute("color", color);
          else child.setAttribute("style", `color:${color}`);
        }
      }
      clean(child);
    });
  };
  clean(template.content);
  return template.innerHTML;
}

function recurrenceControlsHTML(recurrence = {}, dueValue = "") {
  const frequency = recurrence?.frequency || "none";
  const monthlyMode = recurrence?.monthly_mode || "dates";
  const dueDate = parseLocalDate(dueValue);
  const dates = Array.isArray(recurrence?.month_dates) && recurrence.month_dates.length ? recurrence.month_dates : (dueDate ? [dueDate.getDate()] : []);
  const ordinal = recurrence?.week_ordinal || monthlyOrdinalFromDate(dueDate);
  const weekday = Number.isInteger(recurrence?.weekday) ? recurrence.weekday : (dueDate ? dueDate.getDay() : 1);
  return `<div class="recurrence-controls" data-recurrence-controls>
    <div class="field"><label>Repeat</label><select name="recurrence_frequency" data-recurrence-frequency>
      <option value="none" ${frequency === "none" || !frequency ? "selected" : ""}>Does not repeat</option>
      <option value="daily" ${frequency === "daily" ? "selected" : ""}>Daily</option>
      <option value="weekly" ${frequency === "weekly" ? "selected" : ""}>Weekly</option>
      <option value="monthly" ${frequency === "monthly" ? "selected" : ""}>Monthly</option>
    </select></div>
    <div class="recurrence-monthly" data-recurrence-monthly ${frequency === "monthly" ? "" : "hidden"}>
      <div class="field"><label>Monthly repeat</label><select name="recurrence_monthly_mode" data-recurrence-monthly-mode>
        <option value="dates" ${monthlyMode !== "nth_weekday" ? "selected" : ""}>Specific dates</option>
        <option value="nth_weekday" ${monthlyMode === "nth_weekday" ? "selected" : ""}>First/second weekday</option>
      </select></div>
      <div class="field" data-recurrence-month-dates ${monthlyMode === "nth_weekday" ? "hidden" : ""}><label>Dates in month</label><input name="recurrence_month_dates" value="${esc(dates.join(", "))}" placeholder="1, 15, 28"></div>
      <div class="grid-2 recurrence-nth-fields" data-recurrence-nth ${monthlyMode === "nth_weekday" ? "" : "hidden"}>
        <div class="field"><label>Week</label><select name="recurrence_week_ordinal">
          ${[1, 2, 3, 4, 5].map((value) => `<option value="${value}" ${Number(ordinal) === value ? "selected" : ""}>${esc(ORDINAL_LABELS[value])}</option>`).join("")}
          <option value="-1" ${Number(ordinal) === -1 ? "selected" : ""}>last</option>
        </select></div>
        <div class="field"><label>Day</label><select name="recurrence_weekday">
          ${WEEKDAY_LABELS.map((label, index) => `<option value="${index}" ${Number(weekday) === index ? "selected" : ""}>${esc(label)}</option>`).join("")}
        </select></div>
      </div>
    </div>
  </div>`;
}

function bindRecurrenceControls(root = document) {
  root.querySelectorAll("[data-recurrence-controls]").forEach((box) => {
    if (box.dataset.recurrenceBound === "1") return;
    box.dataset.recurrenceBound = "1";
    const frequency = box.querySelector("[data-recurrence-frequency]");
    const mode = box.querySelector("[data-recurrence-monthly-mode]");
    const monthly = box.querySelector("[data-recurrence-monthly]");
    const dates = box.querySelector("[data-recurrence-month-dates]");
    const nth = box.querySelector("[data-recurrence-nth]");
    const update = () => {
      if (monthly) monthly.hidden = frequency?.value !== "monthly";
      if (dates) dates.hidden = mode?.value === "nth_weekday";
      if (nth) nth.hidden = mode?.value !== "nth_weekday";
    };
    frequency?.addEventListener("change", update);
    mode?.addEventListener("change", update);
    update();
  });
}

function recurrencePayloadFromForm(form) {
  const frequency = form.elements.recurrence_frequency?.value || "none";
  if (!frequency || frequency === "none") return { frequency: "none" };
  const recurrence = { frequency };
  if (frequency === "monthly") {
    const mode = form.elements.recurrence_monthly_mode?.value || "dates";
    recurrence.monthly_mode = mode;
    if (mode === "nth_weekday") {
      recurrence.week_ordinal = Number(form.elements.recurrence_week_ordinal?.value || 1);
      recurrence.weekday = Number(form.elements.recurrence_weekday?.value || 1);
    } else {
      recurrence.month_dates = String(form.elements.recurrence_month_dates?.value || "")
        .split(",")
        .map((item) => Number(item.trim()))
        .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31);
    }
  }
  return recurrence;
}

function checklistBuilderRowHTML(item = {}) {
  return `<div class="checklist-builder-row" data-checklist-row>
    <input type="checkbox" data-checklist-done ${item.done ? "checked" : ""} title="Done">
    <input type="text" data-checklist-text value="${esc(item.text || "")}" placeholder="Checklist item">
    <button class="btn icon quiet" type="button" data-remove-checklist-row title="Remove item">${icon("x")}</button>
  </div>`;
}

function checklistBuilderHTML(items = []) {
  const rows = Array.isArray(items) && items.length ? items : [{ text: "", done: false }];
  return `<div class="checklist-builder" data-checklist-builder>
    <div class="checklist-builder-head">
      <label>Checklist</label>
      <button class="btn compact" type="button" data-add-checklist-row>${icon("list-checks")}Add item</button>
    </div>
    <div class="checklist-builder-rows" data-checklist-rows>${rows.map(checklistBuilderRowHTML).join("")}</div>
  </div>`;
}

function bindChecklistBuilders(root = document) {
  root.querySelectorAll("[data-checklist-builder]").forEach((builder) => {
    if (builder.dataset.checklistBound === "1") return;
    builder.dataset.checklistBound = "1";
    const rows = builder.querySelector("[data-checklist-rows]");
    const bindRow = (row) => {
      row.querySelector("[data-remove-checklist-row]")?.addEventListener("click", () => {
        row.remove();
        if (!rows.querySelector("[data-checklist-row]")) {
          rows.insertAdjacentHTML("beforeend", checklistBuilderRowHTML());
          bindRow(rows.lastElementChild);
          icons();
        }
      });
    };
    rows.querySelectorAll("[data-checklist-row]").forEach(bindRow);
    builder.querySelector("[data-add-checklist-row]")?.addEventListener("click", () => {
      rows.insertAdjacentHTML("beforeend", checklistBuilderRowHTML());
      const row = rows.lastElementChild;
      bindRow(row);
      row.querySelector("[data-checklist-text]")?.focus();
      icons();
    });
  });
}

function readChecklistItems(root = document) {
  return Array.from(root.querySelectorAll("[data-checklist-row]")).map((row) => ({
    text: row.querySelector("[data-checklist-text]")?.value.trim() || "",
    done: Boolean(row.querySelector("[data-checklist-done]")?.checked),
  })).filter((item) => item.text);
}

function normalizeTaskBlocks(blocks = []) {
  return (Array.isArray(blocks) ? blocks : []).map((block) => {
    const type = block.type === "checklist" ? "checklist" : "content";
    if (type === "checklist") {
      return { type, checklist: (block.checklist || []).filter((item) => String(item.text || "").trim()) };
    }
    return { type, content: String(block.content || "").trim() };
  }).filter((block) => block.type === "checklist" ? block.checklist.length : block.content);
}

function taskContentBlocks(task = {}) {
  const saved = normalizeTaskBlocks(task.blocks || []);
  if (saved.length) return saved;
  const content = task.type === "annotation" ? task.comment || task.content : task.content;
  const blocks = [];
  if (String(content || "").trim()) blocks.push({ type: "content", content: String(content).trim() });
  const checklist = Array.isArray(task.checklist) ? task.checklist.filter((item) => String(item.text || "").trim()) : [];
  if (task.type !== "annotation" && checklist.length) blocks.push({ type: "checklist", checklist });
  return blocks;
}

function taskPreviewText(task = {}) {
  if (task.type === "annotation") return compactClientTaskContent(task.comment || task.content || "");
  const firstContent = taskContentBlocks(task).find((block) => block.type === "content")?.content || "";
  return compactClientTaskContent(firstContent || task.content || "");
}

const FEEDBACK_TASK_STATUS_VALUES = ["todo", "in_progress", "revision", "completed", "ready_for_review"];
const FEEDBACK_TASK_STATUS_STYLES = {
  todo: { icon_color: "#9ca3af", text_color: "#d1d5db" },
  in_progress: { icon_color: "#f59e0b", text_color: "#fbbf24" },
  revision: { icon_color: "#ef4444", text_color: "#fca5a5" },
  completed: { icon_color: "#10b981", text_color: "#6ee7b7" },
  ready_for_review: { icon_color: "#38bdf8", text_color: "#bae6fd" },
};

function feedbackStatusValue(value) {
  const normalized = normalizeClientTaskStatusValue(value);
  if (!normalized || ["open", "normal", "low", "high", "urgent"].includes(normalized)) return "todo";
  if (normalized === "to_do") return "todo";
  if (normalized === "inprogress" || normalized === "progress") return "in_progress";
  if (["needs_revision", "needs_revisions", "revisions"].includes(normalized)) return "revision";
  if (["review", "ready_review"].includes(normalized)) return "ready_for_review";
  if (["done", "complete", "completed", "closed"].includes(normalized)) return "completed";
  return normalized;
}

function feedbackBugTitle(bug = {}) {
  return String(bug.title || bug.description || "Pinned feedback").trim();
}

function feedbackBugAssigneeIDs(bug = {}) {
  return [...new Set([...(bug.assignee_ids || []), bug.assignee_id].filter(Boolean))];
}

function feedbackStatusObject(statuses = [], value = "todo") {
  const statusValue = feedbackStatusValue(value);
  return statuses.find((item) => item.value === statusValue) || {
    value: statusValue,
    label: clientTaskStatusLabel(statusValue),
    icon_color: FEEDBACK_TASK_STATUS_STYLES[statusValue]?.icon_color || DEFAULT_CLIENT_TASK_STATUS_STYLES[statusValue]?.icon_color || "#8b5cf6",
    text_color: FEEDBACK_TASK_STATUS_STYLES[statusValue]?.text_color || DEFAULT_CLIENT_TASK_STATUS_STYLES[statusValue]?.text_color || "#e5e7eb",
  };
}

function feedbackTaskStatuses(bugs = []) {
  return clientTaskStatuses(
    { statuses: FEEDBACK_TASK_STATUS_VALUES, status_styles: FEEDBACK_TASK_STATUS_STYLES },
    bugs.map((bug) => ({ status: feedbackStatusValue(bug.status || bug.severity) })),
  );
}

function feedbackMemberEntries(users = []) {
  return (users || []).filter((user) => user?.id).map((user) => ({ user, staff_role: user.staff_role, role: user.role }));
}

function feedbackBugRowsHTML(bugs = [], statuses = [], usersByID = {}) {
  if (!bugs.length) return `<p class="muted">No annotation feedback yet.</p>`;
  return bugs.map((bug, index) => {
    const statusValue = feedbackStatusValue(bug.status || bug.severity);
    return `<article class="feedback-row" data-feedback-row="${esc(bug.id)}">
      <div class="feedback-row-main">
        <strong>${esc(feedbackBugTitle(bug))}</strong>
        <span>${icon("map-pin")}Position ${Number(bug.pin_x || 0).toFixed(1)}%, ${Number(bug.pin_y || 0).toFixed(1)}%</span>
      </div>
      <div class="feedback-row-meta">
        ${assigneeAvatarsHTML(feedbackBugAssigneeIDs(bug), usersByID)}
        <form class="feedback-status-form" data-feedback-status-form="${esc(bug.id)}">${statusPickerHTML(statuses, statusValue, "status")}</form>
        <button class="btn compact" type="button" data-open-feedback-bug="${esc(bug.id)}">${icon("panel-top-open")}Task</button>
      </div>
    </article>`;
  }).join("");
}

function feedbackBugDetailHTML(bug = {}, statuses = [], usersByID = {}) {
  const statusValue = feedbackStatusValue(bug.status || bug.severity);
  const assignees = feedbackBugAssigneeIDs(bug).map((id) => usersByID[id]).filter(Boolean);
  return `<div class="feedback-detail">
    <div class="feedback-detail-head">
      <span class="muted">Annotation detail</span>
      <h2>${esc(feedbackBugTitle(bug))}</h2>
      <form class="feedback-status-form" data-feedback-status-form="${esc(bug.id)}">${statusPickerHTML(statuses, statusValue, "status")}</form>
    </div>
    <label class="feedback-url-field"><span>Page URL</span><input value="${esc(bug.page_url || "No page URL")}" readonly></label>
    <div class="feedback-detail-grid">
      <div><span class="muted">Assignee</span>${assignees.length ? `<div class="assignee-avatars">${assignees.map((user) => userChip(user)).join("")}</div>` : `<strong>Unassigned</strong>`}</div>
      <div><span class="muted">Created</span><strong>${esc(fmtDateTime(bug.created_at))}</strong></div>
    </div>
    ${bug.description ? `<h3>Details</h3><p>${chatText(bug.description)}</p>` : ""}
    ${bug.attachments?.length ? `<h3>Attachments</h3><div class="task-attachment-gallery">${bug.attachments.map((url) => attachmentPreviewHTML(url, "", { source: "Feedback" })).join("")}</div>` : ""}
    <section class="feedback-comments">
      <h3>Comments</h3>
      <div class="feedback-comment-list" data-feedback-comment-list>${feedbackCommentsHTML(bug.comments || [], usersByID)}</div>
      <form class="feedback-comment-form" data-feedback-comment-form="${esc(bug.id)}">
        <div class="attachment-preview" data-feedback-attachment-preview hidden></div>
        <textarea name="comment" data-mentionable placeholder="Leave a comment"></textarea>
        <input type="file" name="attachment" hidden>
        <div class="toolbar compact-toolbar">
          <button class="btn icon quiet" type="button" data-feedback-comment-emoji title="Add emoji">${icon("smile")}</button>
          <button class="btn icon quiet" type="button" data-feedback-comment-attach title="Attach file">${icon("paperclip")}</button>
          <button class="btn primary compact" type="submit">${icon("send")}Send</button>
        </div>
        <p class="status-line"></p>
      </form>
    </section>
  </div>`;
}

function feedbackCommentHTML(comment = {}, usersByID = {}) {
  const author = usersByID[comment.author_id] || {};
  const authorName = author.name || author.username || "Someone";
  return `<article class="feedback-comment">
    <div class="message-head"><strong>${esc(authorName)}</strong><time>${inboxTime(comment.created_at)}</time></div>
    ${comment.content ? `<p>${chatText(comment.content)}</p>` : ""}
    ${comment.attachment_url ? `<div class="comment-attachment">${attachmentPreviewHTML(comment.attachment_url, comment.attachment_name || "Attachment", { compact: true })}</div>` : ""}
  </article>`;
}

function feedbackCommentsHTML(comments = [], usersByID = {}) {
  if (!comments.length) return `<p class="muted">No comments yet.</p>`;
  return comments.map((comment) => feedbackCommentHTML(comment, usersByID)).join("");
}

function clientAnnotationTaskRowsHTML(tasks = [], statuses = [], usersByID = {}) {
  if (!tasks.length) return `<p class="muted">No annotation tasks on this page yet.</p>`;
  return tasks.map((task) => {
    const statusValue = task.status || "todo";
    return `<article class="feedback-row" data-client-annotation-row="${esc(task.id)}">
      <div class="feedback-row-main">
        <strong>${esc(task.title || "Annotation")}</strong>
        <span>${icon("map-pin")}Position ${Number(task.pin_x || 0).toFixed(1)}%, ${Number(task.pin_y || 0).toFixed(1)}%</span>
      </div>
      <div class="feedback-row-meta">
        ${assigneeAvatarsHTML(task.assignee_ids || [], usersByID)}
        <div class="feedback-status-form" data-client-annotation-status-form="${esc(task.id)}">${statusPickerHTML(statuses, statusValue, "status")}</div>
        <button class="btn compact" type="button" data-open-client-annotation="${esc(task.id)}">${icon("panel-top-open")}Task</button>
      </div>
    </article>`;
  }).join("");
}

function clientAnnotationItemStatusPickerHTML(taskID = "", annotationID = "", statusValue = "todo", statuses = []) {
  if (!taskID || !annotationID) return statusBadgeHTML(feedbackStatusObject(statuses, statusValue || "todo"), "status-badge status-pill");
  return `<div class="feedback-status-form" data-client-annotation-item-status-form="${esc(taskID)}" data-annotation-id="${esc(annotationID)}">${statusPickerHTML(statuses, statusValue || "todo", "status")}</div>`;
}

function syncClientAnnotationItemStatusControls(root = document, annotationID = "", statuses = [], value = "todo") {
  const status = feedbackStatusObject(statuses, value || "todo");
  root.querySelectorAll(`[data-client-annotation-item-status-form][data-annotation-id="${selectorEscape(annotationID)}"]`).forEach((box) => {
    const input = box.querySelector("input[name='status']");
    const trigger = box.querySelector("[data-status-trigger]");
    const label = box.querySelector("[data-status-trigger-label]");
    if (input) input.value = status.value;
    if (label) label.textContent = status.label;
    trigger?.style.setProperty("--status-icon-color", status.icon_color);
    trigger?.style.setProperty("--status-text-color", status.text_color);
  });
}

function bindClientAnnotationItemStatusForms(root = document, statuses = [], onSaved = async () => {}) {
  root.querySelectorAll("[data-client-annotation-item-status-form]").forEach((box) => {
    if (box.dataset.clientAnnotationItemStatusBound === "1") return;
    box.dataset.clientAnnotationItemStatusBound = "1";
    box.addEventListener("change", async (event) => {
      if (!event.target.matches("input[name='status']")) return;
      const taskID = box.dataset.clientAnnotationItemStatusForm;
      const annotationID = box.dataset.annotationId;
      const status = event.target.value || "todo";
      if (!taskID || !annotationID) return;
      try {
        const result = await api(`/api/client-tasks/${taskID}/annotations/${annotationID}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
        syncClientAnnotationItemStatusControls(root, annotationID, statuses, result.status || status);
        await onSaved(result, annotationID, result.status || status);
      } catch (error) {
        console.error(error);
      }
    });
  });
}

function clientAnnotationTaskDetailHTML(task = {}, statuses = [], usersByID = {}, comments = [], canManageFolder = false, options = {}) {
  const assignees = (task.assignee_ids || []).map((id) => usersByID[id]).filter(Boolean);
  const showStatus = options.showStatus !== false;
  const commentTaskID = options.commentTaskID || task.id;
  const annotationStatusTaskID = options.annotationStatusTaskID || "";
  return `<div class="feedback-detail">
    <div class="feedback-detail-head">
      <span class="muted">Annotation detail</span>
      <h2>${esc(task.title || "Annotation")}</h2>
      ${showStatus ? `<div class="feedback-status-form" data-client-annotation-status-form="${esc(task.id)}">${statusPickerHTML(statuses, task.status || "todo", "status")}</div>` : clientAnnotationItemStatusPickerHTML(annotationStatusTaskID, task.id, task.status || "todo", statuses)}
    </div>
    <label class="feedback-url-field"><span>Page URL</span><input value="${esc(task.url || "No page URL")}" readonly></label>
    <div class="feedback-detail-grid">
      <div><span class="muted">Assignee</span>${assignees.length ? `<div class="assignee-avatars">${assignees.map((user) => userChip(user)).join("")}</div>` : `<strong>Unassigned</strong>`}</div>
      <div><span class="muted">Created</span><strong>${esc(fmtDateTime(task.created_at))}</strong></div>
    </div>
    ${task.comment ? `<h3>Details</h3><p>${chatText(task.comment)}</p>` : ""}
    ${annotationSnapshotHTML(task)}
    ${taskAttachmentGalleryHTML(task, comments)}
    <section class="feedback-comments">
      <h3>Comments</h3>
      <div class="client-task-comment-list feedback-comment-list">${clientTaskCommentsHTML(comments || [], usersByID, canManageFolder)}</div>
      <div class="client-comment-composer-slot" data-client-comment-composer-default>
        <form id="clientTaskCommentForm" class="feedback-comment-form client-comment-form" data-client-annotation-comment-form="${esc(commentTaskID)}">
          <div class="reply-preview" data-client-task-reply-preview hidden></div>
          <div class="attachment-preview" data-client-task-attachment-preview hidden></div>
          <textarea name="content" data-mentionable placeholder="Comment @username"></textarea>
          <input type="file" name="attachment" hidden>
          <div class="toolbar compact-toolbar">
            <button class="btn icon quiet" type="button" data-client-comment-emoji title="Add emoji">${icon("smile")}</button>
            <button class="btn icon quiet" type="button" data-client-comment-attach title="Attach file">${icon("paperclip")}</button>
            <button class="btn primary compact" type="submit">${icon("send")}Send</button>
          </div>
          <p class="status-line"></p>
        </form>
      </div>
    </section>
  </div>`;
}

function clientTaskAnnotationItems(task = {}) {
  const nested = Array.isArray(task.annotations) ? task.annotations : [];
  const source = nested.length ? nested : ((task.pin_x !== undefined && task.pin_x !== null && task.pin_y !== undefined && task.pin_y !== null) ? [{
    id: task.id,
    title: task.title,
    url: task.url,
    comment: task.comment || task.content,
    screenshot_url: task.screenshot_url || "",
    pin_x: task.pin_x,
    pin_y: task.pin_y,
    page_width: task.page_width,
    page_height: task.page_height,
    attachments: task.attachments || [],
    assignee_ids: task.assignee_ids || [],
    status: task.status,
    created_at: task.created_at,
    created_by: task.created_by,
  }] : []);
  return source.map((item, index) => ({
    ...item,
    id: item.id || `annotation-${index}`,
    title: item.title || task.title || `Annotation ${index + 1}`,
    url: item.url || task.url || "",
    comment: item.comment || "",
    screenshot_url: item.screenshot_url || task.screenshot_url || "",
    attachments: item.attachments || [],
    assignee_ids: item.assignee_ids || task.assignee_ids || [],
    status: item.status || task.status || "todo",
    created_at: item.created_at || task.created_at,
    created_by: item.created_by || task.created_by,
  })).filter((item) => item.pin_x !== undefined && item.pin_x !== null && item.pin_y !== undefined && item.pin_y !== null);
}

function clientAnnotationItemRowsHTML(items = [], statuses = [], usersByID = {}, options = {}) {
  if (!items.length) return `<p class="muted">No annotations in this task yet.</p>`;
  const taskID = options.taskID || "";
  return items.map((item, index) => {
    const status = feedbackStatusObject(statuses, item.status || "todo");
    return `<article class="feedback-row" data-client-annotation-item-row="${esc(item.id)}">
      <div class="feedback-row-main">
        <strong>${esc(item.title || `Annotation ${index + 1}`)}</strong>
        <span>${icon("map-pin")}Position ${Number(item.pin_x || 0).toFixed(1)}%, ${Number(item.pin_y || 0).toFixed(1)}%</span>
      </div>
      <div class="feedback-row-meta">
        ${assigneeAvatarsHTML(item.assignee_ids || [], usersByID)}
        ${taskID ? clientAnnotationItemStatusPickerHTML(taskID, item.id, status.value, statuses) : statusBadgeHTML(status, "status-badge status-pill")}
        <button class="btn compact" type="button" data-open-client-annotation-item="${esc(item.id)}">${icon("panel-top-open")}Details</button>
      </div>
    </article>`;
  }).join("");
}

function clientAnnotationItemPinHTML(item = {}, index = 0, targetWidth = ANNOTATION_VIEWPORT.width, targetHeight = ANNOTATION_VIEWPORT.height) {
  return annotationPinHTML({
    id: item.id,
    x: item.pin_x,
    y: item.pin_y,
    page_width: item.page_width,
    page_height: item.page_height,
    target_page_width: targetWidth,
    target_page_height: targetHeight,
    label: String(index + 1),
    title: item.title || "Annotation",
  });
}

function contentBlockEditorHTML(blocks = []) {
  const initial = normalizeTaskBlocks(blocks).length ? normalizeTaskBlocks(blocks) : [{ type: "content", content: "" }];
  return `<div class="content-block-editor" data-content-block-editor>
    <div class="content-block-list" data-content-block-list>${initial.map(contentBlockEditorBlockHTML).join("")}</div>
    <div class="toolbar compact-toolbar">
      <button class="btn compact" type="button" data-add-content-block>${icon("file-text")}Content</button>
      <button class="btn compact" type="button" data-add-checklist-block>${icon("list-checks")}Checklist</button>
    </div>
  </div>`;
}

function contentBlockEditorBlockHTML(block = {}) {
  const type = block.type === "checklist" ? "checklist" : "content";
  return `<section class="content-block-editor-row" data-content-block data-block-type="${type}">
    <div class="content-block-head">
      <strong>${type === "checklist" ? "Checklist" : "Content"}</strong>
      <button class="btn icon quiet" type="button" data-remove-content-block title="Remove block">${icon("x")}</button>
    </div>
    ${type === "checklist" ? `<div class="checklist-builder-rows" data-checklist-rows>${(block.checklist?.length ? block.checklist : [{ text: "", done: false }]).map(checklistBuilderRowHTML).join("")}</div>
      <button class="btn compact" type="button" data-add-checklist-row>${icon("plus")}Item</button>` : `<div class="rich-editor block-rich-editor" contenteditable="true" data-block-content data-placeholder="Write task details">${esc(block.content || "")}</div>`}
  </section>`;
}

function bindContentBlockEditors(root = document) {
  root.querySelectorAll("[data-content-block-editor]").forEach((editor) => {
    if (editor.dataset.blocksBound === "1") return;
    editor.dataset.blocksBound = "1";
    const list = editor.querySelector("[data-content-block-list]");
    const bindBlock = (block) => {
      block.querySelector("[data-remove-content-block]")?.addEventListener("click", () => {
        block.remove();
        if (!list.querySelector("[data-content-block]")) {
          list.insertAdjacentHTML("beforeend", contentBlockEditorBlockHTML({ type: "content", content: "" }));
          bindBlock(list.lastElementChild);
        }
        icons();
      });
      const bindChecklistRow = (row) => {
        row.querySelector("[data-remove-checklist-row]")?.addEventListener("click", () => {
          const rows = block.querySelector("[data-checklist-rows]");
          row.remove();
          if (!rows.querySelector("[data-checklist-row]")) {
            rows.insertAdjacentHTML("beforeend", checklistBuilderRowHTML());
            bindChecklistRow(rows.lastElementChild);
          }
          icons();
        });
      };
      block.querySelectorAll("[data-checklist-row]").forEach(bindChecklistRow);
      block.querySelector("[data-add-checklist-row]")?.addEventListener("click", () => {
        const rows = block.querySelector("[data-checklist-rows]");
        rows.insertAdjacentHTML("beforeend", checklistBuilderRowHTML());
        bindChecklistRow(rows.lastElementChild);
        rows.lastElementChild.querySelector("[data-checklist-text]")?.focus();
        icons();
      });
    };
    list.querySelectorAll("[data-content-block]").forEach(bindBlock);
    editor.querySelector("[data-add-content-block]")?.addEventListener("click", () => {
      list.insertAdjacentHTML("beforeend", contentBlockEditorBlockHTML({ type: "content", content: "" }));
      bindBlock(list.lastElementChild);
      list.lastElementChild.querySelector("[data-block-content]")?.focus();
      icons();
    });
    editor.querySelector("[data-add-checklist-block]")?.addEventListener("click", () => {
      list.insertAdjacentHTML("beforeend", contentBlockEditorBlockHTML({ type: "checklist", checklist: [{ text: "", done: false }] }));
      bindBlock(list.lastElementChild);
      list.lastElementChild.querySelector("[data-checklist-text]")?.focus();
      icons();
    });
  });
}

function readContentBlocks(root = document) {
  return Array.from(root.querySelectorAll("[data-content-block]")).map((block) => {
    const type = block.dataset.blockType === "checklist" ? "checklist" : "content";
    if (type === "checklist") return { type, checklist: readChecklistItems(block) };
    return { type, content: block.querySelector("[data-block-content]")?.innerText.trim() || "" };
  }).filter((block) => block.type === "checklist" ? block.checklist.length : block.content);
}

function contentFromBlocks(blocks = []) {
  return blocks.find((block) => block.type === "content" && block.content)?.content || "";
}

function checklistFromBlocks(blocks = []) {
  return blocks.filter((block) => block.type === "checklist").flatMap((block) => block.checklist || []);
}

function taskContentBlocksHTML(blocks = [], canUpdate = false) {
  const visible = normalizeTaskBlocks(blocks);
  if (!visible.length) return `<h3>Content</h3><div class="task-rich-content">No content yet.</div>`;
  return `<section class="task-content-blocks" data-task-blocks>
    ${visible.map((block, blockIndex) => block.type === "checklist" ? taskChecklistBlockHTML(block, blockIndex, canUpdate) : `<div class="task-content-block" data-task-render-block data-block-type="content"><h3>Content</h3><div class="task-rich-content">${chatText(block.content)}</div></div>`).join("")}
  </section>`;
}

function taskChecklistBlockHTML(block, blockIndex, canUpdate = false) {
  const checklist = block.checklist || [];
  const doneCount = checklist.filter((item) => item.done).length;
  return `<section class="task-checklist task-content-block" data-task-render-block data-block-type="checklist">
    <div class="task-checklist-head"><h3>Checklist</h3><span class="task-checklist-meta"><span class="muted" data-checklist-count>${doneCount}/${checklist.length} done</span><span class="checklist-save-indicator" data-checklist-save-status aria-live="polite"></span></span></div>
    <div class="task-checklist-items">
      ${checklist.map((item, itemIndex) => `<label class="task-checklist-item ${item.done ? "done" : ""}">
        <input type="checkbox" data-task-checklist-done data-block-index="${blockIndex}" data-item-index="${itemIndex}" ${item.done ? "checked" : ""} ${canUpdate ? "" : "disabled"}>
        <span>${chatText(item.text)}</span>
      </label>`).join("")}
    </div>
  </section>`;
}

function taskChecklistHTML(items = [], canUpdate = false) {
  const checklist = Array.isArray(items) ? items.filter((item) => String(item.text || "").trim()) : [];
  if (!checklist.length) return "";
  const doneCount = checklist.filter((item) => item.done).length;
  return `<section class="task-checklist" data-task-checklist>
    <div class="task-checklist-head"><h3>Checklist</h3><span class="muted">${doneCount}/${checklist.length} done</span><span class="status-line" data-checklist-save-status></span></div>
    <div class="task-checklist-items">
      ${checklist.map((item, index) => `<label class="task-checklist-item ${item.done ? "done" : ""}">
        <input type="checkbox" data-task-checklist-done data-index="${index}" ${item.done ? "checked" : ""} ${canUpdate ? "" : "disabled"}>
        <span>${chatText(item.text)}</span>
      </label>`).join("")}
    </div>
  </section>`;
}

function readVisibleTaskChecklist(root = document) {
  return Array.from(root.querySelectorAll(".task-checklist-item")).map((row) => ({
    text: row.querySelector("span")?.innerText.trim() || "",
    done: Boolean(row.querySelector("[data-task-checklist-done]")?.checked),
  })).filter((item) => item.text);
}

function readVisibleTaskBlocks(root = document) {
  return Array.from(root.querySelectorAll("[data-task-render-block]")).map((block) => {
    const type = block.dataset.blockType === "checklist" ? "checklist" : "content";
    if (type === "checklist") return { type, checklist: readVisibleTaskChecklist(block) };
    return { type, content: block.querySelector(".task-rich-content")?.innerText.trim() || "" };
  }).filter((block) => block.type === "checklist" ? block.checklist.length : block.content);
}

function bindTaskChecklistAutosave(root, taskID, afterSave = () => {}) {
  const box = root.querySelector("[data-task-blocks]");
  if (!box || !taskID) return;
  box.querySelectorAll("[data-task-checklist-done]").forEach((input) => input.addEventListener("change", async () => {
    const block = input.closest("[data-task-render-block][data-block-type='checklist']");
    const status = block?.querySelector("[data-checklist-save-status]");
    input.closest(".task-checklist-item")?.classList.toggle("done", input.checked);
    if (status) {
      status.classList.add("saving");
      status.innerHTML = `<span class="inline-spinner tiny-spinner" aria-hidden="true"></span><span>Saving</span>`;
    }
    try {
      const blocks = readVisibleTaskBlocks(box);
      await api(`/api/client-tasks/${taskID}`, { method: "PATCH", body: JSON.stringify({ blocks }) });
      box.querySelectorAll("[data-task-render-block][data-block-type='checklist']").forEach((block) => {
        const items = readVisibleTaskChecklist(block);
        const count = block.querySelector("[data-checklist-count]");
        if (count) count.textContent = `${items.filter((item) => item.done).length}/${items.length} done`;
      });
      if (status) {
        status.classList.remove("saving");
        status.textContent = "Saved";
        setTimeout(() => {
          if (status.textContent === "Saved") status.textContent = "";
        }, 1200);
      }
      await afterSave();
    } catch (error) {
      if (status) {
        status.classList.remove("saving");
        status.textContent = error.message;
      }
    }
  }));
}

function bindClientTaskTypeToggle(form) {
  const select = form?.querySelector("[data-client-task-type]");
  const descriptionFields = form?.querySelector("[data-task-description-fields]");
  const annotationFields = form?.querySelector("[data-task-annotation-fields]");
  const urlInput = form?.elements.url;
  if (!select) return;
  const update = () => {
    const isAnnotation = select.value === "annotation";
    if (descriptionFields) descriptionFields.hidden = isAnnotation;
    if (annotationFields) annotationFields.hidden = !isAnnotation;
    if (urlInput) urlInput.required = isAnnotation;
  };
  select.addEventListener("change", update);
  update();
}

function canManageClientTaskUI(task, canManageFolder = false) {
  return Boolean(canManageFolder || task?.created_by === state.me?.id);
}

function clientTaskBoardHTML(tasks, tab, members, canManage, canManageStatuses = false, canUpdateProgress = false) {
  const statuses = clientTaskStatuses(tab, tasks);
  const usersByID = clientTaskUsersByID(members);
  return `<div class="client-board" ${canManageStatuses ? `data-status-board-sort="${esc(tab.id)}"` : ""}>
    ${statuses.map((status) => `<section class="kanban-column" data-client-status="${esc(status.value)}">
      <div class="kanban-status-head">
        <h3>${statusBadgeHTML(status, "status-badge status-heading")}</h3>
        ${canManageStatuses ? `<span class="status-column-controls">
          <button class="btn icon quiet" type="button" data-status-column-move="${esc(status.value)}" data-status-column-dir="-1" title="Move status up">${icon("chevron-up")}</button>
          <button class="btn icon quiet" type="button" data-status-column-move="${esc(status.value)}" data-status-column-dir="1" title="Move status down">${icon("chevron-down")}</button>
          <button class="btn icon quiet status-column-handle" type="button" data-status-column-handle title="Drag status">${icon("grip-vertical")}</button>
        </span>` : ""}
      </div>
      ${(tasks || []).filter((task) => (task.status || "todo") === status.value && task.tab_id === tab.id).map((task) => {
        const canManageTask = canManageClientTaskUI(task, canManage);
        const canUpdateTaskProgress = Boolean(canUpdateProgress || canManageTask);
        const dueInfo = taskDueInfo(task);
        return `<article class="task-card client-task-card" data-client-task-id="${esc(task.id)}" data-can-drag="${canUpdateTaskProgress ? "true" : "false"}">
          <button class="client-task-open" type="button" data-open-client-task="${esc(task.id)}">${esc(compactClientTaskTitle(task.title))}</button>
          <p>${chatText(taskPreviewText(task) || "No content yet.")}</p>
          <div class="client-task-card-meta">
            ${statusBadgeHTML(status, "status-badge status-pill")}
            ${taskCompletionBadgeHTML(task)}
            <span class="pill">${esc(fmtDateTime(task.created_at))}</span>
            ${dueInfo.text ? `<button class="pill warn due-count" type="button" data-due-calendar="${esc(dueInfo.date || task.due_date)}">${icon("calendar-days")}${esc(dueInfo.text)}</button>` : ""}
            ${assigneeAvatarsHTML(task.assignee_ids || [], usersByID)}
          </div>
          ${(canUpdateTaskProgress || canManageTask) ? `<div class="toolbar compact-toolbar">
            ${canUpdateTaskProgress ? statusPickerHTML(statuses, task.status || "todo", "status", task.id, { canManageStatuses, tabID: tab.id }) : ""}
            ${canManageTask ? `<button class="btn compact danger" type="button" data-delete-client-task="${esc(task.id)}">${icon("trash-2")}Delete</button>` : ""}
          </div>` : ""}
        </article>`;
      }).join("") || `<p class="muted">No tasks.</p>`}
    </section>`).join("")}
  </div>`;
}

function clientTaskUsersByID(members = []) {
  return Object.fromEntries(members.map((entry) => [entry.user?.id, entry.user]).filter(([id]) => id));
}

function clientCommentReactionUsers(reaction = {}) {
  return Array.isArray(reaction.user_ids) ? reaction.user_ids.map(String) : [];
}

function clientReactionUserLabel(userID, usersByID = {}) {
  const user = usersByID[String(userID)] || (String(userID) === String(state.me?.id) ? state.me : null) || {};
  const username = String(user.username || "").trim();
  if (username) return `@${username}`;
  return user.name || user.email || "Unknown user";
}

function clientCommentReactionsHTML(comment = {}, usersByID = {}) {
  const reactions = Array.isArray(comment.reactions) ? comment.reactions : [];
  const byEmoji = new Map();
  reactions.forEach((reaction) => {
    if (reaction?.emoji) byEmoji.set(reaction.emoji, clientCommentReactionUsers(reaction));
  });
  const emojis = Array.from(new Set([...COMMENT_REACTION_EMOJIS, ...reactions.map((reaction) => reaction?.emoji).filter(Boolean)]));
  if (!emojis.length) return "";
  return `<div class="comment-reactions">
    ${emojis.map((emoji) => {
      const userIDs = byEmoji.get(emoji) || [];
      const active = Boolean(state.me?.id && userIDs.includes(String(state.me.id)));
      const count = userIDs.length;
      const reactors = userIDs.map((id) => clientReactionUserLabel(id, usersByID)).join(", ");
      const title = reactors ? `${emoji} by ${reactors}` : `React ${emoji}`;
      return `<button class="comment-reaction ${active ? "active" : ""} ${count ? "" : "empty"}" type="button" data-client-comment-reaction="${esc(comment.id)}" data-emoji="${esc(emoji)}" data-reactors="${esc(reactors)}" title="${esc(title)}">${esc(emoji)}${count ? `<span>${count}</span>` : ""}</button>`;
    }).join("")}
  </div>`;
}

function bindClientCommentReactions(root = document, refresh = async () => {}, usersByID = {}) {
  root.querySelectorAll("[data-client-comment-reaction]").forEach((btn) => {
    if (btn.dataset.reactionBound === "1") return;
    btn.dataset.reactionBound = "1";
    btn.addEventListener("click", async () => {
      const commentID = btn.dataset.clientCommentReaction;
      const emoji = btn.dataset.emoji || btn.textContent.trim();
      if (!commentID || !emoji) return;
      btn.disabled = true;
      try {
        const result = await api(`/api/client-task-comments/${commentID}/reactions`, { method: "POST", body: JSON.stringify({ emoji }) });
        const article = btn.closest("[data-client-comment-id]");
        const reactionsHTML = clientCommentReactionsHTML({ id: commentID, reactions: result.reactions || [] }, usersByID);
        const current = article?.querySelector(".comment-reactions");
        if (current) {
          current.outerHTML = reactionsHTML;
          bindClientCommentReactions(article, refresh, usersByID);
          icons();
        } else {
          await refresh();
        }
      } catch (error) {
        console.error(error);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function resetClientCommentForm(form, root = document) {
  if (!form) return;
  const textarea = form.elements?.content;
  if (textarea) textarea.value = "";
  const attachment = form.elements?.attachment;
  if (attachment) attachment.value = "";
  const attachmentPreview = form.querySelector("[data-client-task-attachment-preview]");
  if (attachmentPreview) {
    attachmentPreview.hidden = true;
    attachmentPreview.innerHTML = "";
  }
  state.clientTaskReply = null;
  state.clientTaskCommentEdit = null;
  moveClientCommentComposer(root, "");
  const replyPreview = form.querySelector("[data-client-task-reply-preview]");
  if (replyPreview) {
    replyPreview.hidden = true;
    replyPreview.innerHTML = "";
  }
  const submit = form.querySelector("[type='submit']");
  if (submit) submit.innerHTML = `${icon("send")}Send`;
  setFormStatus(form, "");
  icons();
}

async function refreshClientTaskCommentList(root = document, taskID = "", usersByID = {}, canManageFolder = false, afterRender = () => {}) {
  if (!taskID) return null;
  const form = root.querySelector("#clientTaskCommentForm");
  if (form) moveClientCommentComposer(root, "");
  const latest = await api(`/api/client-tasks/${taskID}`);
  const latestUsersByID = { ...usersByID };
  (latest.members || []).forEach((entry) => {
    if (entry?.user?.id) latestUsersByID[entry.user.id] = entry.user;
  });
  (latest.log_users || []).forEach((user) => {
    if (user?.id) latestUsersByID[user.id] = user;
  });
  const list = root.querySelector(".client-task-comment-list");
  if (list) list.innerHTML = clientTaskCommentsHTML(latest.comments || [], latestUsersByID, canManageFolder);
  const livePanel = root?.id === "clientTaskPanel" ? root : root?.closest?.("#clientTaskPanel") || root?.querySelector?.("#clientTaskPanel");
  if (livePanel) livePanel.dataset.liveSignature = clientTaskDetailLiveSignature(latest);
  afterRender(root, latest, latestUsersByID);
  icons();
  return latest;
}

function focusClientTaskComment(root = document, commentID = "") {
  if (!commentID) return;
  const comment = root.querySelector(`[data-client-comment-id="${selectorEscape(commentID)}"]`);
  if (!comment) return;
  comment.classList.add("active");
  comment.scrollIntoView({ block: "center", behavior: "smooth" });
}

function clientTaskCommentArticleHTML(comment, usersByID = {}, canManageFolder = false, nested = false, replyCount = 0) {
  const author = usersByID[comment.author_id] || {};
  const authorName = author.name || author.username || "Someone";
  const replyText = comment.content || comment.attachment_name || "Attachment";
  const canManageComment = canManageFolder || comment.author_id === state.me?.id;
  const replyLabel = replyCount ? `${replyCount} ${replyCount === 1 ? "reply" : "replies"}` : "Reply";
  const replyIcon = replyCount ? "messages-square" : "reply";
  return `<article class="client-task-comment ${nested ? "is-reply" : ""}" data-client-comment-id="${esc(comment.id)}">
    <div class="message-head"><strong>${esc(authorName)}</strong><time>${inboxTime(comment.created_at)}</time></div>
    ${comment.reply_text && !nested ? `<blockquote>${chatText(comment.reply_text)}</blockquote>` : ""}
    ${comment.content ? `<p>${chatText(comment.content)}</p>` : ""}
    ${comment.attachment_url ? `<div class="comment-attachment">${attachmentPreviewHTML(comment.attachment_url, comment.attachment_name || "Attachment", { compact: true })}</div>` : ""}
    ${clientCommentReactionsHTML(comment, usersByID)}
    <div class="client-comment-actions">
      <button class="message-reply-btn" type="button" ${replyCount ? `data-toggle-comment-replies="${esc(comment.id)}" aria-expanded="false"` : ""} data-client-comment-reply="${esc(comment.id)}" data-reply-text="${esc(replyText.slice(0, 160))}">${icon(replyIcon)}${replyLabel}</button>
      ${canManageComment ? `<button class="message-reply-btn" type="button" data-edit-client-comment="${esc(comment.id)}" data-comment-content="${esc(comment.content || "")}">${icon("pencil")}Edit</button><button class="message-reply-btn danger-text" type="button" data-delete-client-comment="${esc(comment.id)}">${icon("trash-2")}Delete</button>` : ""}
    </div>
    <div class="client-inline-reply-slot" data-client-comment-reply-slot="${esc(comment.id)}"></div>
  </article>`;
}

function clientTaskCommentThreadHTML(node, usersByID = {}, canManageFolder = false, nested = false) {
  const replies = node.replies || [];
  return `<div class="client-comment-thread ${nested ? "is-nested" : ""}">
    ${clientTaskCommentArticleHTML(node, usersByID, canManageFolder, nested, nested ? 0 : replies.length)}
    ${replies.length ? `<div class="comment-thread-replies" data-comment-replies="${esc(node.id)}" hidden>
      <div class="comment-thread-reply-list">${replies.map((reply) => clientTaskCommentArticleHTML(reply, usersByID, canManageFolder, true)).join("")}</div>
      <button class="message-reply-btn thread-reply-action" type="button" data-client-comment-reply="${esc(node.id)}" data-reply-text="${esc((node.content || node.attachment_name || "Comment").slice(0, 160))}">${icon("reply")}Reply to thread</button>
    </div>` : ""}
  </div>`;
}

function clientTaskCommentsHTML(comments = [], usersByID = {}, canManageFolder = false) {
  if (!comments.length) return `<p class="muted">No comments yet.</p>`;
  const nodes = new Map();
  comments.forEach((comment) => nodes.set(String(comment.id), { ...comment, replies: [] }));
  const roots = [];
  comments.forEach((comment) => {
    const id = String(comment.id || "");
    const replyToID = String(comment.reply_to_id || "");
    const node = nodes.get(id);
    if (!node) return;
    if (replyToID && replyToID !== NIL_OBJECT_ID && replyToID !== id && nodes.has(replyToID)) {
      let rootID = replyToID;
      const seen = new Set([id]);
      while (nodes.has(rootID)) {
        const parent = nodes.get(rootID);
        const nextID = String(parent.reply_to_id || "");
        if (!nextID || nextID === NIL_OBJECT_ID || !nodes.has(nextID) || seen.has(nextID)) break;
        seen.add(rootID);
        rootID = nextID;
      }
      nodes.get(rootID).replies.push(node);
      return;
    }
    roots.push(node);
  });
  return roots.map((comment) => clientTaskCommentThreadHTML(comment, usersByID, canManageFolder)).join("");
}

function taskLogActionLabel(action = "") {
  const labels = {
    created_task: "Created task",
    completed_recurrence: "Completed recurring task",
    updated_status: "Updated status",
    updated_assignment: "Updated assignment",
    created_comment: "Created comment",
    edited_comment: "Edited comment",
    deleted_comment: "Deleted comment",
  };
  return labels[action] || String(action || "Update").replaceAll("_", " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function taskUpdateLogHTML(logs = [], usersByID = {}) {
  if (!logs.length) return `<p class="muted">No update log yet.</p>`;
  return `<div class="task-update-log-list">
    ${logs.map((entry) => {
      const actor = usersByID[entry.actor_id] || {};
      const actorName = actor.name || actor.username || actor.email || "Someone";
      return `<article class="task-update-log-row">
        ${userChip(actor.id ? actor : { name: actorName })}
        <div>
          <h3>${esc(taskLogActionLabel(entry.action))}</h3>
          <p><strong>${esc(actorName)}</strong> ${esc(entry.detail || "updated this task")}</p>
          <time>${inboxTime(entry.created_at)}</time>
        </div>
      </article>`;
    }).join("")}
  </div>`;
}

function moveClientCommentComposer(root = document, commentID = "") {
  const scope = root || document;
  const form = scope.querySelector("#clientTaskCommentForm");
  if (!form) return;
  const defaultSlot = scope.querySelector("[data-client-comment-composer-default]");
  const targetSlot = commentID ? scope.querySelector(`[data-client-comment-reply-slot="${selectorEscape(commentID)}"]`) : defaultSlot;
  const slot = targetSlot || defaultSlot;
  if (!slot) return;
  if (form.parentElement !== slot) slot.appendChild(form);
  form.classList.toggle("is-inline-reply", Boolean(commentID && targetSlot));
}

function setClientTaskReply(reply, root = $("#clientTaskPanel") || document) {
  state.clientTaskReply = reply;
  if (reply) state.clientTaskCommentEdit = null;
  const scope = root || $("#clientTaskPanel") || document;
  moveClientCommentComposer(scope, reply?.id || "");
  const preview = scope?.querySelector("[data-client-task-reply-preview]");
  if (!preview) return;
  if (!reply) {
    preview.hidden = true;
    preview.innerHTML = "";
    return;
  }
  preview.hidden = false;
  preview.innerHTML = `<span>${icon("reply")}Replying to: ${chatText(reply.text)}</span><button class="btn icon quiet" type="button" data-clear-client-task-reply title="Cancel reply">${icon("x")}</button>`;
  preview.querySelector("[data-clear-client-task-reply]")?.addEventListener("click", () => setClientTaskReply(null, scope));
  icons();
}

function setClientTaskCommentEdit(comment, root = $("#clientTaskPanel") || document) {
  state.clientTaskCommentEdit = comment;
  if (comment) state.clientTaskReply = null;
  const scope = root || $("#clientTaskPanel") || document;
  if (comment || !state.clientTaskReply) moveClientCommentComposer(scope, "");
  const form = scope?.querySelector("#clientTaskCommentForm");
  const textarea = form?.elements.content;
  const preview = scope?.querySelector("[data-client-task-reply-preview]");
  if (!form || !textarea || !preview) return;
  if (!comment) {
    form.querySelector("button[type='submit']").innerHTML = `${icon("send")}Send`;
    if (!state.clientTaskReply) {
      preview.hidden = true;
      preview.innerHTML = "";
    }
    icons();
    return;
  }
  textarea.value = comment.content || "";
  preview.hidden = false;
  preview.innerHTML = `<span>${icon("pencil")}Editing comment</span><button class="btn icon quiet" type="button" data-cancel-client-comment-edit title="Cancel edit">${icon("x")}</button>`;
  form.querySelector("button[type='submit']").innerHTML = `${icon("save")}Save`;
  preview.querySelector("[data-cancel-client-comment-edit]")?.addEventListener("click", () => {
    textarea.value = "";
    setClientTaskCommentEdit(null, scope);
  });
  textarea.focus();
  icons();
}

async function openClientAnnotationTaskViewer(taskID, initialData = null, openAnnotationID = "", focusCommentID = "") {
  setTaskPanelActive(true);
  document.body.classList.add("annotation-viewer-open");
  const data = initialData || await api(`/api/client-tasks/${taskID}`);
  const task = data.task || {};
  const [timeEntriesData, activeTimerData] = await Promise.all([
    api(`/api/time-entries?task_id=${encodeURIComponent(taskID)}`).catch(() => ({ entries: [] })),
    api("/api/time-entries/active").catch(() => ({ entry: null })),
  ]);
  const taskTimeEntries = timeEntriesData.entries || [];
  const activeTimeEntry = activeTimerData.entry || null;
  const usersByID = clientTaskUsersByID(data.members || []);
  (data.log_users || []).forEach((user) => {
    if (user?.id) usersByID[user.id] = user;
  });
  const canManageFolder = Boolean(data.can_manage);
  const canManageTask = Boolean(data.can_manage_task || canManageClientTaskUI(task, canManageFolder));
  const canUpdateProgress = Boolean(data.can_update_progress || canManageTask);
  const canManageStatuses = Boolean(data.can_manage_statuses);
  const statuses = clientTaskStatuses(data.tab, [task]);
  const selectorForID = (value) => (window.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/"/g, '\\"'));
  const pageWidth = annotationViewportDimension(task.page_width, ANNOTATION_VIEWPORT.width, 320, 8000);
  const pageHeight = annotationViewportDimension(task.page_height, ANNOTATION_VIEWPORT.height, 900, ANNOTATION_VIEWPORT.maxHeight);
  const pageURL = task.url || data.website?.url || "";
  const annotationItems = clientTaskAnnotationItems(task);
  let activeAnnotationID = String(openAnnotationID || "");
  if (!activeAnnotationID && focusCommentID && annotationItems[0]?.id) activeAnnotationID = String(annotationItems[0].id);
  let panel = $("#clientTaskPanel");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "clientTaskPanel";
    document.body.appendChild(panel);
  }
  panel.className = "client-task-panel annotation-task-viewer";
  panel.dataset.liveTaskId = taskID;
  panel.dataset.liveTaskMode = "annotation";
  panel.dataset.liveAnnotationId = activeAnnotationID;
  panel.dataset.liveSignature = clientTaskDetailLiveSignature(data);
  panel.innerHTML = `
    <header class="client-task-panel-head annotation-viewer-head">
      <div><span class="muted">${esc(data.client?.name || "Client")} / ${esc(data.website?.name || "Website")}</span><h2>${esc(compactClientTaskTitle(task.title || "Annotation"))}</h2></div>
      <div class="toolbar">
        ${canManageTask ? `<button class="btn icon quiet" type="button" id="editClientAnnotationTaskBtn" title="Edit" aria-label="Edit annotation">${icon("pencil")}</button><button class="btn icon danger" type="button" id="deleteClientAnnotationTaskBtn" title="Delete" aria-label="Delete annotation">${icon("trash-2")}</button>` : ""}
        <button class="btn icon quiet" type="button" data-close-client-task title="Close">${icon("x")}</button>
      </div>
    </header>
    <div class="client-task-panel-body annotation-viewer-body">
      <section class="annotation-stage annotation-viewer-stage" id="clientAnnotationViewerStage">
        ${annotationFrameHTML({
          url: pageURL,
          title: task.title || "Annotation task",
          width: pageWidth,
          height: pageHeight,
          fallbackHeight: pageHeight,
          catcherID: "clientAnnotationViewerClickCatcher",
          pinLayerID: "clientAnnotationViewerPinLayer",
          pins: annotationItems.map((item, index) => ({ id: item.id, x: item.pin_x, y: item.pin_y, page_width: item.page_width || pageWidth, page_height: item.page_height || pageHeight, label: String(index + 1), title: item.title || "Annotation" })),
        })}
      </section>
      <aside class="bug-side annotation-task-side feedback-side annotation-viewer-side">
        <div class="feedback-detail-toolbar annotation-sidebar-toolbar">
          <h2>Annotations</h2>
          <button class="btn icon quiet" type="button" data-toggle-annotation-sidebar title="Collapse annotations">${icon("panel-right-close")}</button>
        </div>
        ${canUpdateProgress ? `<form id="clientTaskQuickEditForm" class="task-detail-meta task-detail-meta-form annotation-viewer-progress">
          ${statusPickerHTML(statuses, task.status || "todo", "status", "", { canManageStatuses, tabID: data.tab?.id })}
          ${taskCompletionBadgeHTML(task)}
          <span class="pill warn due-edit-pill"><button class="due-icon-btn" type="button" data-due-edit-open title="Change due date">${icon("calendar-days")}</button><button class="due-date-text-btn" type="button" data-due-edit-open><span data-due-edit-label>${esc(taskDueInfo(task).text || "No due date")}</span></button><input class="due-edit-input" type="date" name="due_date" value="${esc(String(task.due_date || "").slice(0, 10))}" title="Due date"></span>
          ${assigneePickerHTML(data.members || [], task.assignee_ids || [])}
          <span class="status-line"></span>
        </form>` : ""}
        <section class="feedback-sidebar-view" id="annotationViewerListView">
          <div class="feedback-list" id="annotationViewerList">${clientAnnotationItemRowsHTML(annotationItems, statuses, usersByID, { taskID })}</div>
          <div class="task-log-actions"><button class="btn compact" type="button" id="taskUpdateLogBtn">${icon("history")}Activity Log</button></div>
        </section>
        <section class="feedback-sidebar-view feedback-detail-view annotation-viewer-detail-view" id="annotationViewerDetailView" hidden>
          <div class="feedback-detail-toolbar">
            <button class="btn compact" type="button" id="annotationViewerBackBtn">${icon("arrow-left")}Back</button>
          </div>
          <div id="annotationViewerDetailBody"></div>
        </section>
      </aside>
      <button class="btn icon annotation-sidebar-expand" type="button" data-toggle-annotation-sidebar title="Show annotations" hidden>${icon("panel-right-open")}</button>
    </div>
    <dialog id="editClientAnnotationTaskDialog" class="modal client-dialog">
      <form id="editClientAnnotationTaskForm" class="form-grid" method="dialog">
        <div class="modal-head"><h2>Edit annotation</h2><button class="btn icon quiet" type="button" data-close-dialog="editClientAnnotationTaskDialog" title="Close">${icon("x")}</button></div>
        <input type="hidden" name="page_width" value="${esc(pageWidth)}">
        <input type="hidden" name="page_height" value="${esc(pageHeight)}">
        <div class="field"><label>Title</label><input name="title" maxlength="80" value="${esc(task.title || "")}" required></div>
        <div class="field"><label>Annotation URL</label><input name="url" value="${esc(pageURL)}" placeholder="https://example.com/page"></div>
        <div class="field"><label>Details</label>${richEditorHTML("comment", task.comment || task.content || "", "Write annotation details")}</div>
        <div class="field"><label>Assignment</label>${assigneePickerHTML(data.members || [], task.assignee_ids || [])}</div>
        <div class="grid-2"><div class="field"><label>Due date</label><input type="date" name="due_date" value="${esc(String(task.due_date || "").slice(0, 10))}"></div></div>
        ${recurrenceControlsHTML(task.recurrence || {}, task.due_date)}
        <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Save</button><button class="btn" type="button" data-close-dialog="editClientAnnotationTaskDialog">Cancel</button></div>
        <p class="status-line"></p>
      </form>
    </dialog>
    <dialog id="taskUpdateLogDialog" class="modal client-dialog update-log-dialog">
      <div class="modal-head"><h2>Update Log</h2><button class="btn icon quiet" type="button" data-close-dialog="taskUpdateLogDialog" title="Close">${icon("x")}</button></div>
      <div data-task-update-log-body>${taskUpdateLogHTML(data.logs || [], usersByID)}</div>
    </dialog>`;

  const close = () => {
    closeClientTaskPanel(panel);
  };
  panel.querySelector("[data-close-client-task]")?.addEventListener("click", close);
  const openViewerAnnotationDetail = (annotationID) => {
    const annotation = annotationItems.find((item) => String(item.id) === String(annotationID)) || annotationItems[0];
    const body = panel.querySelector("#annotationViewerDetailBody");
    if (!annotation || !body) return;
    activeAnnotationID = String(annotation.id);
    panel.dataset.liveAnnotationId = activeAnnotationID;
    panel.querySelector("#annotationViewerListView")?.setAttribute("hidden", "");
    panel.querySelector("#annotationViewerDetailView")?.removeAttribute("hidden");
    body.innerHTML = `${clientAnnotationTaskDetailHTML(annotation, statuses, usersByID, data.comments || [], canManageFolder, { showStatus: false, commentTaskID: taskID, annotationStatusTaskID: taskID })}
      ${taskTimeTrackerHTML(taskID, taskTimeEntries, activeTimeEntry)}`;
    panel.querySelectorAll("[data-client-annotation-item-row]").forEach((row) => row.classList.toggle("active", row.dataset.clientAnnotationItemRow === String(annotation.id)));
    panel.querySelectorAll("[data-feedback-pin]").forEach((pin) => {
      const active = pin.dataset.feedbackPin === String(annotation.id);
      pin.classList.toggle("highlighted", active);
      pin.classList.toggle("expanded", active);
    });
    panel.querySelector(`[data-feedback-pin="${selectorForID(annotation.id)}"]`)?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    bindAttachmentOpeners(body);
    bindMentionSuggestions(body);
    bindStatusPickers(body);
    bindClientAnnotationItemStatusForms(body, statuses, async (result, annotationID, status) => {
      const item = annotationItems.find((entry) => String(entry.id) === String(annotationID));
      if (item) item.status = status;
      syncClientAnnotationItemStatusControls(panel, annotationID, statuses, status);
    });
    bindAnnotationViewerCommentForm(body);
    bindTaskTimeTracker(body, taskID, async () => openClientAnnotationTaskViewer(taskID, null, activeAnnotationID));
    if (focusCommentID) setTimeout(() => focusClientTaskComment(body, focusCommentID), 60);
    icons();
  };
  const renderViewerPins = () => {
    const viewport = panel.querySelector("[data-annotation-viewport]");
    const targetHeight = Number(viewport?.dataset.annotationHeight || pageHeight);
    const targetWidth = Number(viewport?.dataset.annotationWidth || pageWidth);
    const layer = panel.querySelector("#clientAnnotationViewerPinLayer");
    if (layer) layer.innerHTML = annotationItems.map((item, index) => clientAnnotationItemPinHTML({ ...item, page_width: item.page_width || pageWidth, page_height: item.page_height || pageHeight }, index, targetWidth, targetHeight)).join("");
    icons();
  };
  bindAnnotationViewportResize(panel.querySelector("#clientAnnotationViewerStage"));
  bindAnnotationFrameAutoHeight(panel.querySelector("#clientAnnotationViewerStage"), {
    fallbackHeight: pageHeight,
    onHeight: renderViewerPins,
  });
  bindAnnotationDeviceControls(panel.querySelector("#clientAnnotationViewerStage"), {
    fallbackHeight: pageHeight,
    onChange: renderViewerPins,
  });
  renderViewerPins();
  panel.querySelector("#annotationViewerList")?.querySelectorAll("[data-open-client-annotation-item]").forEach((btn) => btn.addEventListener("click", () => openViewerAnnotationDetail(btn.dataset.openClientAnnotationItem)));
  panel.querySelector("#clientAnnotationViewerStage")?.addEventListener("click", (event) => {
    const pin = event.target.closest("[data-feedback-pin]");
    if (pin) openViewerAnnotationDetail(pin.dataset.feedbackPin);
  });
  panel.querySelector("#annotationViewerBackBtn")?.addEventListener("click", () => {
    activeAnnotationID = "";
    panel.dataset.liveAnnotationId = "";
    state.clientTaskReply = null;
    state.clientTaskCommentEdit = null;
    panel.querySelector("#annotationViewerDetailView")?.setAttribute("hidden", "");
    panel.querySelector("#annotationViewerListView")?.removeAttribute("hidden");
    const body = panel.querySelector("#annotationViewerDetailBody");
    if (body) body.innerHTML = "";
    panel.querySelectorAll("[data-feedback-pin]").forEach((pin) => pin.classList.remove("highlighted", "expanded"));
    panel.querySelectorAll("[data-client-annotation-item-row]").forEach((row) => row.classList.remove("active"));
  });

  panel.querySelector("#editClientAnnotationTaskBtn")?.addEventListener("click", () => panel.querySelector("#editClientAnnotationTaskDialog")?.showModal());
  panel.querySelector("#deleteClientAnnotationTaskBtn")?.addEventListener("click", async () => {
    if (!typedConfirm("Delete this annotation task? Comments, logs, and attachments linked to this task will be removed.")) return;
    await api(`/api/client-tasks/${taskID}`, { method: "DELETE" });
    close();
    route();
  });
  panel.querySelector("#taskUpdateLogBtn")?.addEventListener("click", async () => {
    const dialog = panel.querySelector("#taskUpdateLogDialog");
    const body = dialog?.querySelector("[data-task-update-log-body]");
    try {
      const latest = await api(`/api/client-tasks/${taskID}`);
      const logUsersByID = clientTaskUsersByID(latest.members || data.members || []);
      (latest.log_users || []).forEach((user) => {
        if (user?.id) logUsersByID[user.id] = user;
      });
      if (body) body.innerHTML = taskUpdateLogHTML(latest.logs || [], logUsersByID);
    } catch {
      if (body) body.innerHTML = taskUpdateLogHTML(data.logs || [], usersByID);
    }
    dialog?.showModal();
    icons();
  });
  panel.querySelector("#editClientAnnotationTaskForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    syncRichEditors(form);
    const body = Object.fromEntries(new FormData(form).entries());
    body.title = compactClientTaskTitle(body.title);
    body.comment = String(body.comment || "").trim();
    body.content = body.comment;
    body.checklist = [];
    body.blocks = [];
    body.assignee_ids = selectedAssigneeIDs(form);
    body.recurrence = recurrencePayloadFromForm(form);
    body.page_width = Number(body.page_width || pageWidth);
    body.page_height = Number(body.page_height || pageHeight);
    try {
      await api(`/api/client-tasks/${taskID}`, { method: "PATCH", body: JSON.stringify(body) });
      panel.querySelector("#editClientAnnotationTaskDialog")?.close();
      await openClientAnnotationTaskViewer(taskID, null, activeAnnotationID);
      route();
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });

  bindAssigneePickers(panel);
  bindStatusPickers(panel);
  bindClientAnnotationItemStatusForms(panel, statuses, async (result, annotationID, status) => {
    const item = annotationItems.find((entry) => String(entry.id) === String(annotationID));
    if (item) item.status = status;
    syncClientAnnotationItemStatusControls(panel, annotationID, statuses, status);
  });
  bindStatusAddControls(panel, data.tab, [task], async () => {
    await openClientAnnotationTaskViewer(taskID, null, activeAnnotationID);
    route();
  });
  bindClientTaskQuickAutosave(panel, taskID, async () => {
    route();
  }, task);
  bindRichEditors(panel);
  bindRecurrenceControls(panel);
  bindAttachmentOpeners(panel);
  bindMentionSuggestions(panel);
  bindDialogCloseButtons(panel);
  bindAnnotationSidebarToggles(panel);

  async function refreshAnnotationViewerComments(root = panel) {
    return refreshClientTaskCommentList(root, taskID, usersByID, canManageFolder, (scope) => {
      bindAttachmentOpeners(scope);
      bindMentionSuggestions(scope);
      bindAnnotationViewerCommentForm(scope);
    });
  }

  function bindAnnotationViewerCommentForm(root = panel) {
    root.querySelectorAll("[data-toggle-comment-replies]").forEach((btn) => {
      if (btn.dataset.annotationRepliesBound === "1") return;
      btn.dataset.annotationRepliesBound = "1";
      btn.addEventListener("click", () => {
        const box = Array.from(root.querySelectorAll("[data-comment-replies]")).find((item) => item.dataset.commentReplies === btn.dataset.toggleCommentReplies);
        if (!box) return;
        const nextOpen = box.hidden;
        box.hidden = !nextOpen;
        btn.setAttribute("aria-expanded", nextOpen ? "true" : "false");
        btn.classList.toggle("active", nextOpen);
      });
    });
    root.querySelectorAll("[data-client-comment-reply]").forEach((btn) => {
      if (btn.dataset.annotationReplyBound === "1") return;
      btn.dataset.annotationReplyBound = "1";
      btn.addEventListener("click", () => {
        setClientTaskReply({ id: btn.dataset.clientCommentReply, text: btn.dataset.replyText || "Comment" }, root);
        root.querySelector("textarea[name='content']")?.focus();
      });
    });
    root.querySelectorAll("[data-edit-client-comment]").forEach((btn) => {
      if (btn.dataset.annotationEditBound === "1") return;
      btn.dataset.annotationEditBound = "1";
      btn.addEventListener("click", () => {
        setClientTaskCommentEdit({ id: btn.dataset.editClientComment, content: btn.dataset.commentContent || "" }, root);
      });
    });
    root.querySelectorAll("[data-delete-client-comment]").forEach((btn) => {
      if (btn.dataset.annotationDeleteBound === "1") return;
      btn.dataset.annotationDeleteBound = "1";
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this comment?")) return;
        await api(`/api/client-task-comments/${btn.dataset.deleteClientComment}`, { method: "DELETE" });
        await refreshAnnotationViewerComments(root);
      });
    });
    bindClientCommentReactions(root, async () => refreshAnnotationViewerComments(root), usersByID);
    const commentForm = root.querySelector(`[data-client-annotation-comment-form="${taskID}"]`);
    if (!commentForm || commentForm.dataset.annotationViewerCommentBound === "1") return;
    commentForm.dataset.annotationViewerCommentBound = "1";
    const textarea = commentForm.elements.content;
    const attachmentInput = commentForm.elements.attachment;
    const preview = commentForm.querySelector("[data-client-task-attachment-preview]");
    commentForm.querySelector("[data-client-comment-emoji]")?.addEventListener("click", (event) => openEmojiPicker(event.currentTarget, textarea));
    commentForm.querySelector("[data-client-comment-attach]")?.addEventListener("click", () => attachmentInput?.click());
    attachmentInput?.addEventListener("change", () => {
      const file = attachmentInput.files?.[0];
      if (!file || !preview) return;
      const localURL = file.type.startsWith("image/") ? URL.createObjectURL(file) : "";
      preview.hidden = false;
      preview.innerHTML = `<span>${localURL ? `<img class="attachment-preview-mini" src="${esc(localURL)}" alt="${esc(file.name)} preview">` : icon("paperclip")}${esc(file.name)}</span><button class="btn icon quiet" type="button" data-clear-client-comment-attachment>${icon("x")}</button>`;
      preview.querySelector("[data-clear-client-comment-attachment]")?.addEventListener("click", () => {
        if (localURL) URL.revokeObjectURL(localURL);
        attachmentInput.value = "";
        preview.hidden = true;
        preview.innerHTML = "";
      });
      icons();
    });
    commentForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const content = String(textarea?.value || "").trim();
      const file = attachmentInput?.files?.[0];
      if (!content && !file) {
        setFormStatus(commentForm, "Comment or attachment is required.", true);
        return;
      }
      const submit = commentForm.querySelector("[type='submit']");
      if (submit) submit.disabled = true;
      try {
        if (state.clientTaskCommentEdit) {
          const body = { content };
          if (file) {
            body.attachment_url = await upload(file);
            body.attachment_name = file.name;
          }
          await api(`/api/client-task-comments/${state.clientTaskCommentEdit.id}`, { method: "PATCH", body: JSON.stringify(body) });
          resetClientCommentForm(commentForm, root);
          await refreshAnnotationViewerComments(root);
          return;
        }
        const body = {
          content,
          reply_to_id: state.clientTaskReply?.id || "",
          reply_text: state.clientTaskReply?.text || "",
          attachment_url: "",
          attachment_name: "",
        };
        if (file) {
          body.attachment_url = await upload(file);
          body.attachment_name = file.name;
        }
        await api(`/api/client-tasks/${taskID}/comments`, { method: "POST", body: JSON.stringify(body) });
        resetClientCommentForm(commentForm, root);
        await refreshAnnotationViewerComments(root);
      } catch (error) {
        setFormStatus(commentForm, error.message, true);
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  if (activeAnnotationID) openViewerAnnotationDetail(activeAnnotationID);
  else {
    state.clientTaskReply = null;
    state.clientTaskCommentEdit = null;
  }
  icons();
}

async function openClientTaskPanel(taskID, focusCommentID = "") {
  const data = await api(`/api/client-tasks/${taskID}`);
  const task = data.task || {};
  if (task.type === "annotation") {
    await openClientAnnotationTaskViewer(taskID, data, "", focusCommentID);
    return;
  }
  setTaskPanelActive(true);
  document.body.classList.remove("annotation-viewer-open");
  const usersByID = clientTaskUsersByID(data.members || []);
  (data.log_users || []).forEach((user) => {
    if (user?.id) usersByID[user.id] = user;
  });
  let panel = $("#clientTaskPanel");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "clientTaskPanel";
    document.body.appendChild(panel);
  }
  panel.className = "client-task-panel";
  const canManageFolder = Boolean(data.can_manage);
  const canManageTask = Boolean(data.can_manage_task || canManageClientTaskUI(task, canManageFolder));
  const canUpdateProgress = Boolean(data.can_update_progress || canManageTask);
  const canManageStatuses = Boolean(data.can_manage_statuses);
  const statuses = clientTaskStatuses(data.tab, [task]);
  const taskContent = task.type === "annotation" ? task.comment || task.content : task.content;
  const dueInfo = taskDueInfo(task);
  panel.dataset.liveTaskId = taskID;
  panel.dataset.liveTaskMode = "task";
  panel.dataset.liveAnnotationId = "";
  panel.dataset.liveSignature = clientTaskDetailLiveSignature(data);
  panel.innerHTML = `
    <header class="client-task-panel-head">
      <div><span class="muted">${esc(data.client?.name || "Client")} / ${esc(data.website?.name || "Website")}</span><h2>${esc(compactClientTaskTitle(task.title))}</h2></div>
      <div class="toolbar">
        ${canManageTask ? `<button class="btn icon quiet" type="button" id="editClientTaskBtn" title="Edit" aria-label="Edit task">${icon("pencil")}</button><button class="btn icon danger" type="button" id="deleteClientTaskPanelBtn" title="Delete" aria-label="Delete task">${icon("trash-2")}</button>` : ""}
        <button class="btn icon quiet" type="button" data-close-client-task title="Close">${icon("x")}</button>
      </div>
    </header>
    <div class="client-task-panel-body">
      <section class="client-task-detail-main">
        ${canUpdateProgress ? `<form id="clientTaskQuickEditForm" class="task-detail-meta task-detail-meta-form">
          ${statusPickerHTML(statuses, task.status || "todo", "status", "", { canManageStatuses, tabID: data.tab?.id })}
          <span class="pill">${esc(task.type || "description")}</span>
          ${taskCompletionBadgeHTML(task)}
          <span class="pill">${icon("calendar-days")}${esc(fmtDateTime(task.created_at))}</span>
          <span class="pill warn due-edit-pill"><button class="due-icon-btn" type="button" data-due-edit-open title="Change due date">${icon("calendar-days")}</button><button class="due-date-text-btn" type="button" data-due-edit-open><span data-due-edit-label>${esc(dueInfo.text || "No due date")}</span></button><input class="due-edit-input" type="date" name="due_date" value="${esc(String(task.due_date || "").slice(0, 10))}" title="Due date"></span>
          ${assigneePickerHTML(data.members || [], task.assignee_ids || [])}
          <span class="status-line"></span>
        </form>` : `<div class="task-detail-meta">
          ${statusBadgeHTML(statuses.find((item) => item.value === (task.status || "todo")) || statuses[0], "status-badge status-pill")}
          <span class="pill">${esc(task.type || "description")}</span>
          ${taskCompletionBadgeHTML(task)}
          <span class="pill">${icon("calendar-days")}${esc(fmtDateTime(task.created_at))}</span>
          ${dueInfo.text ? `<button class="pill warn due-count" type="button" data-due-calendar="${esc(dueInfo.date || task.due_date)}">${icon("calendar-days")}${esc(dueInfo.text)}</button>` : ""}
          ${assigneeAvatarsHTML(task.assignee_ids || [], usersByID)}
        </div>`}
        ${taskContentBlocksHTML(taskContentBlocks(task), canUpdateProgress)}
        ${task.url ? `<h3>Annotation URL</h3><p><a class="text-link" href="${esc(task.url)}" target="_blank" rel="noopener noreferrer">${esc(task.url)}</a></p>` : ""}
        ${task.pin_x !== undefined && task.pin_y !== undefined && task.pin_x !== null && task.pin_y !== null ? `<h3>Annotation Pin</h3><p class="muted">${Number(task.pin_x).toFixed(1)}%, ${Number(task.pin_y).toFixed(1)}%</p>` : ""}
        ${taskAttachmentGalleryHTML(task, data.comments || [])}
        <div class="task-log-actions"><button class="btn compact" type="button" id="taskUpdateLogBtn">${icon("history")}Activity Log</button></div>
      </section>
      <aside class="client-task-comments">
        <h3>Comments</h3>
        <div class="client-task-comment-list">${clientTaskCommentsHTML(data.comments || [], usersByID, canManageFolder)}</div>
        <div class="client-comment-composer-slot" data-client-comment-composer-default>
          <form id="clientTaskCommentForm" class="client-comment-form">
            <div class="reply-preview" data-client-task-reply-preview hidden></div>
            <div class="attachment-preview" data-client-task-attachment-preview hidden></div>
            <textarea name="content" data-mentionable placeholder="Comment @username"></textarea>
            <input type="file" name="attachment" hidden>
            <div class="toolbar compact-toolbar">
              <button class="btn icon quiet" type="button" data-client-comment-emoji title="Add emoji">${icon("smile")}</button>
              <button class="btn icon quiet" type="button" data-client-comment-attach title="Attach file">${icon("paperclip")}</button>
              <button class="btn primary" type="submit">${icon("send")}Send</button>
            </div>
            <p class="status-line"></p>
          </form>
        </div>
      </aside>
    </div>
    <dialog id="editClientTaskDialog" class="modal client-dialog">
      <form id="editClientTaskForm" class="form-grid" method="dialog">
        <div class="modal-head"><h2>Edit task</h2><button class="btn icon quiet" type="button" data-close-dialog="editClientTaskDialog" title="Close">${icon("x")}</button></div>
        <div class="quick-task-controls"><label class="compact-field"><span>Status</span>${statusPickerHTML(statuses, task.status || "todo", "status", "", { canManageStatuses, tabID: data.tab?.id })}</label><label class="compact-field"><span>Due</span><input type="date" name="due_date" value="${esc(String(task.due_date || "").slice(0, 10))}"></label></div>
        ${recurrenceControlsHTML(task.recurrence || {}, task.due_date)}
        <div class="field"><label>Title</label><input name="title" maxlength="80" value="${esc(task.title || "")}" required></div>
        ${task.type === "annotation" ? `<div class="field"><label>Comment</label>${richEditorHTML("comment", taskContent || "", "Write task details")}</div>` : `<div class="field"><label>Task body</label>${contentBlockEditorHTML(taskContentBlocks(task))}</div>`}
        <div class="field" ${task.type === "annotation" ? "" : "hidden"}><label>Annotation URL</label><input name="url" value="${esc(task.url || "")}" placeholder="https://example.com/page"></div>
        <div class="field"><label>Assignment</label>${assigneePickerHTML(data.members || [], task.assignee_ids || [])}</div>
        <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Save</button><button class="btn" type="button" data-close-dialog="editClientTaskDialog">Cancel</button></div>
        <p class="status-line"></p>
      </form>
    </dialog>
    <dialog id="taskUpdateLogDialog" class="modal client-dialog update-log-dialog">
      <div class="modal-head"><h2>Update Log</h2><button class="btn icon quiet" type="button" data-close-dialog="taskUpdateLogDialog" title="Close">${icon("x")}</button></div>
      <div data-task-update-log-body>${taskUpdateLogHTML(data.logs || [], usersByID)}</div>
    </dialog>`;
  panel.querySelector("[data-close-client-task]")?.addEventListener("click", () => {
    closeClientTaskPanel(panel);
  });
  panel.querySelector("#editClientTaskBtn")?.addEventListener("click", () => panel.querySelector("#editClientTaskDialog")?.showModal());
  panel.querySelector("#taskUpdateLogBtn")?.addEventListener("click", async () => {
    const dialog = panel.querySelector("#taskUpdateLogDialog");
    const body = dialog?.querySelector("[data-task-update-log-body]");
    try {
      const latest = await api(`/api/client-tasks/${taskID}`);
      const logUsersByID = clientTaskUsersByID(latest.members || data.members || []);
      (latest.log_users || []).forEach((user) => {
        if (user?.id) logUsersByID[user.id] = user;
      });
      if (body) body.innerHTML = taskUpdateLogHTML(latest.logs || [], logUsersByID);
    } catch {
      if (body) body.innerHTML = taskUpdateLogHTML(data.logs || [], usersByID);
    }
    dialog?.showModal();
    icons();
  });
  panel.querySelector("#deleteClientTaskPanelBtn")?.addEventListener("click", async () => {
    if (!confirm("Delete this task?")) return;
    await api(`/api/client-tasks/${taskID}`, { method: "DELETE" });
    closeClientTaskPanel(panel);
    route();
  });
  panel.querySelector("#editClientTaskForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    syncRichEditors(form);
    const body = Object.fromEntries(new FormData(form).entries());
    body.title = compactClientTaskTitle(body.title);
    if (task.type === "annotation") {
      body.comment = String(body.comment || "").trim();
      body.content = body.comment;
      body.checklist = [];
      body.blocks = [];
    } else {
      body.blocks = readContentBlocks(form);
      body.content = contentFromBlocks(body.blocks);
      body.comment = "";
      body.checklist = checklistFromBlocks(body.blocks);
    }
    body.assignee_ids = selectedAssigneeIDs(form);
    body.recurrence = recurrencePayloadFromForm(form);
    try {
      await api(`/api/client-tasks/${taskID}`, { method: "PATCH", body: JSON.stringify(body) });
      panel.querySelector("#editClientTaskDialog")?.close();
      await openClientTaskPanel(taskID);
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  panel.querySelectorAll("[data-due-calendar]").forEach((btn) => btn.addEventListener("click", () => showDueDateCalendar(btn.dataset.dueCalendar)));
  bindAssigneePickers(panel);
  bindStatusPickers(panel);
  bindStatusAddControls(panel, data.tab, [task], async () => {
    await openClientTaskPanel(taskID);
    route();
  });
  bindClientTaskQuickAutosave(panel, taskID, async () => {
    route();
  }, task);
  bindRichEditors(panel);
  bindChecklistBuilders(panel);
  bindContentBlockEditors(panel);
  bindRecurrenceControls(panel);
  bindTaskChecklistAutosave(panel, taskID);
  bindAttachmentOpeners(panel);
  const refreshTaskPanelComments = async () => refreshClientTaskCommentList(panel, taskID, usersByID, canManageFolder, (scope) => {
    bindAttachmentOpeners(scope);
    bindMentionSuggestions(scope);
    bindTaskPanelCommentActions();
  });
  function bindTaskPanelCommentActions() {
    panel.querySelectorAll("[data-toggle-comment-replies]").forEach((btn) => {
      if (btn.dataset.taskPanelRepliesBound === "1") return;
      btn.dataset.taskPanelRepliesBound = "1";
      btn.addEventListener("click", () => {
        const box = Array.from(panel.querySelectorAll("[data-comment-replies]")).find((item) => item.dataset.commentReplies === btn.dataset.toggleCommentReplies);
        if (!box) return;
        const nextOpen = box.hidden;
        box.hidden = !nextOpen;
        btn.setAttribute("aria-expanded", nextOpen ? "true" : "false");
        btn.classList.toggle("active", nextOpen);
      });
    });
    panel.querySelectorAll("[data-client-comment-reply]").forEach((btn) => {
      if (btn.dataset.taskPanelReplyBound === "1") return;
      btn.dataset.taskPanelReplyBound = "1";
      btn.addEventListener("click", () => {
        setClientTaskReply({ id: btn.dataset.clientCommentReply, text: btn.dataset.replyText || "Comment" }, panel);
        panel.querySelector("textarea[name='content']")?.focus();
      });
    });
    panel.querySelectorAll("[data-edit-client-comment]").forEach((btn) => {
      if (btn.dataset.taskPanelEditBound === "1") return;
      btn.dataset.taskPanelEditBound = "1";
      btn.addEventListener("click", () => {
        setClientTaskCommentEdit({ id: btn.dataset.editClientComment, content: btn.dataset.commentContent || "" }, panel);
      });
    });
    panel.querySelectorAll("[data-delete-client-comment]").forEach((btn) => {
      if (btn.dataset.taskPanelDeleteBound === "1") return;
      btn.dataset.taskPanelDeleteBound = "1";
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this comment?")) return;
        await api(`/api/client-task-comments/${btn.dataset.deleteClientComment}`, { method: "DELETE" });
        await refreshTaskPanelComments();
      });
    });
    bindClientCommentReactions(panel, refreshTaskPanelComments, usersByID);
  }
  bindTaskPanelCommentActions();
  const form = panel.querySelector("#clientTaskCommentForm");
  const textarea = form?.elements.content;
  form?.querySelector("[data-client-comment-emoji]")?.addEventListener("click", (event) => openEmojiPicker(event.currentTarget, textarea));
  form?.querySelector("[data-client-comment-attach]")?.addEventListener("click", () => form.elements.attachment.click());
  form?.elements.attachment?.addEventListener("change", () => {
    const file = form.elements.attachment.files?.[0];
    const preview = form.querySelector("[data-client-task-attachment-preview]");
    if (!file || !preview) return;
    const localURL = file.type.startsWith("image/") ? URL.createObjectURL(file) : "";
    preview.hidden = false;
    preview.innerHTML = `<span>${localURL ? `<img class="attachment-preview-mini" src="${esc(localURL)}" alt="${esc(file.name)} preview">` : icon("paperclip")}${esc(file.name)}</span><button class="btn icon quiet" type="button" data-clear-client-comment-attachment>${icon("x")}</button>`;
    preview.querySelector("[data-clear-client-comment-attachment]")?.addEventListener("click", () => {
      if (localURL) URL.revokeObjectURL(localURL);
      form.elements.attachment.value = "";
      preview.hidden = true;
      preview.innerHTML = "";
    });
    icons();
  });
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const content = textarea.value.trim();
    const file = form.elements.attachment.files?.[0];
    if (!content && !file) return;
    try {
      if (state.clientTaskCommentEdit) {
        const body = { content };
        if (file) {
          body.attachment_url = await upload(file);
          body.attachment_name = file.name;
        }
        await api(`/api/client-task-comments/${state.clientTaskCommentEdit.id}`, { method: "PATCH", body: JSON.stringify(body) });
        resetClientCommentForm(form, panel);
        await refreshTaskPanelComments();
        return;
      }
      const body = {
        content,
        reply_to_id: state.clientTaskReply?.id || "",
        reply_text: state.clientTaskReply?.text || "",
        attachment_url: "",
        attachment_name: "",
      };
      if (file) {
        body.attachment_url = await upload(file);
        body.attachment_name = file.name;
      }
      await api(`/api/client-tasks/${taskID}/comments`, { method: "POST", body: JSON.stringify(body) });
      resetClientCommentForm(form, panel);
      await refreshTaskPanelComments();
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  setClientTaskReply(null);
  bindDialogCloseButtons(panel);
  bindMentionSuggestions(panel);
  if (focusCommentID) setTimeout(() => focusClientTaskComment(panel, focusCommentID), 60);
  icons();
}

function clientTabNavHTML(tabs, selectedTab, canManage) {
  return (tabs || []).map((tab) => {
    const active = selectedTab?.id === tab.id;
    const protectedTab = tab.type === "config";
    return `<span class="client-tab-item ${active ? "active" : ""} ${canManage ? "has-actions" : ""}" data-client-tab-item>
      <button class="client-tab-link ${active ? "active" : ""}" type="button" data-client-tab-link="${esc(tab.id)}">${esc(tab.title)}</button>
      ${canManage ? `<button class="client-tab-menu-trigger" type="button" data-client-tab-menu-trigger aria-label="Tab options"></button>
        <div class="client-tab-menu" data-client-tab-menu hidden>
          <button type="button" data-edit-client-tab="${esc(tab.id)}">${icon("pencil")}Edit tab</button>
          ${protectedTab ? `<span class="client-tab-menu-note">${icon("lock")}Protected tab</span>` : `<button class="danger-text" type="button" data-delete-client-tab="${esc(tab.id)}">${icon("trash-2")}Delete tab</button>`}
        </div>` : ""}
    </span>`;
  }).join("");
}

function clientTabContentHTML(tab, data) {
  const canManage = data.can_manage;
  const canManageStatuses = Boolean(data.can_manage_statuses);
  const canUpdateProgress = Boolean(data.can_update_progress || canManage);
  if (!tab) return `<section class="panel"><p class="muted">Add a tab to this website.</p></section>`;
  if (tab.type === "config") {
    return clientWebsiteWidgetInstallHTML(data.website || {}, canManage);
  }
  if (tab.type === "doc_list") {
    return `<section class="panel">
      <div class="panel-head"><h2>${esc(tab.title)}</h2>${canManage ? `<button class="btn primary compact" id="addWebsiteDocBtn">${icon("plus")}Document</button>` : ""}</div>
      <div class="task-list">${clientDocumentRows(data.documents || [], canManage)}</div>
    </section>`;
  }
  if (tab.type === "task_board") {
    const statuses = clientTaskStatuses(tab, data.tasks || []);
    return `<section class="panel">
      <div class="panel-head"><h2>${esc(tab.title)}</h2>${canManage ? `<div class="toolbar">${canManageStatuses ? statusPickerHTML(statuses, statuses[0]?.value || "todo", "status_manager", "", { canManageStatuses: true, tabID: tab.id, triggerLabel: "Statuses" }) : ""}<button class="btn primary compact" id="addClientTaskBtn">${icon("plus")}Add task</button></div>` : ""}</div>
      ${clientTaskBoardHTML(data.tasks || [], tab, data.members || [], canManage, canManageStatuses, canUpdateProgress)}
    </section>`;
  }
  return `<section class="panel">
    <div class="panel-head"><h2>${esc(tab.title)}</h2></div>
    ${canManage ? `<form id="descriptionTabForm" class="form-grid">
      <div class="field"><label>Title</label><input name="title" value="${esc(tab.title)}" required></div>
      <div class="field"><label>Description</label><textarea name="content" data-mentionable>${esc(tab.content || "")}</textarea></div>
      <button class="btn primary">${icon("save")}Save tab</button>
      <p class="status-line"></p>
    </form>` : `<p>${chatText(tab.content || "No description yet.")}</p>`}
  </section>`;
}

function clientDocumentDialogHTML(id, title, websiteID = "") {
  return `<dialog id="${id}" class="modal client-dialog">
    <form class="form-grid" method="dialog" data-client-document-form="${esc(websiteID)}">
      <div class="modal-head"><h2>${esc(title)}</h2><button class="btn icon quiet" type="button" data-close-dialog="${id}" title="Close">${icon("x")}</button></div>
      <div class="field"><label>Document title</label><input name="title" required></div>
      <div class="field"><label>Type</label><select name="kind"><option value="note">Text note</option><option value="google_doc">Google Docs link</option><option value="file">File</option><option value="image">Image</option></select></div>
      <div class="field"><label>Text editor</label><textarea name="content" data-mentionable placeholder="Write notes or document description"></textarea></div>
      <div class="field"><label>Google Docs or external URL</label><input name="url" placeholder="https://docs.google.com/..."></div>
      <div class="field"><label>Upload file or image</label><input type="file" name="file"></div>
      <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Save</button><button class="btn" type="button" data-close-dialog="${id}">Cancel</button></div>
      <p class="status-line"></p>
    </form>
  </dialog>`;
}

async function refreshClientSidebarCache() {
  const clientData = await api("/api/client-projects").catch(() => ({ clients: [], websites: [] }));
  state.clientProjects = clientData.clients || [];
  state.clientWebsites = clientData.websites || [];
}

async function renderClientProjects() {
  await refreshClientSidebarCache();
  const canCreate = state.me?.role !== "owner_adm" && state.me?.role !== "client_admin";
  const sitesByClient = (state.clientWebsites || []).reduce((acc, site) => {
    (acc[site.client_id] ||= []).push(site);
    return acc;
  }, {});
  shell("Projects", `
    <div class="page-title">
      <div><h1>Projects</h1><p class="muted">Client folders and websites.</p></div>
      ${canCreate ? `<button class="btn primary" id="newClientBtn">${icon("folder-plus")}Add client</button>` : ""}
    </div>
    <section class="client-grid">
      ${(state.clientProjects || []).map((client) => `<article class="panel client-card">
        <div class="panel-head"><div><h2>${esc(client.name)}</h2><p class="muted">${esc(client.company_email || client.contact_name || "Client folder")}</p></div><span class="pill">${icon("folder")}client</span></div>
        <p>${chatText(client.details || "No client notes yet.")}</p>
        <div class="access-list">
          ${(sitesByClient[client.id] || []).map((site) => `<a class="access-row" href="/projects/${esc(client.id)}/sites/${esc(site.id)}"><span class="access-summary">${icon("globe-2")}<strong>${esc(site.name)}</strong><span>${esc(site.url || "")}</span></span></a>`).join("") || `<p class="muted">No websites yet.</p>`}
        </div>
        <div class="toolbar"><a class="btn primary" href="/projects/${esc(client.id)}">${icon("folder-open")}Open folder</a></div>
      </article>`).join("") || `<section class="panel"><p class="muted">No client projects yet.</p></section>`}
    </section>
    <dialog id="clientDialog" class="modal client-dialog">
      <form id="clientForm" class="form-grid" method="dialog">
        <div class="modal-head"><h2>Add client company</h2><button class="btn icon quiet" type="button" data-close-dialog="clientDialog" title="Close">${icon("x")}</button></div>
        <div class="field"><label>Company name</label><input name="name" required></div>
        <div class="grid-2"><div class="field"><label>Company email</label><input type="email" name="company_email"></div><div class="field"><label>Contact name</label><input name="contact_name"></div></div>
        <div class="field"><label>Client information</label><textarea name="details" data-mentionable></textarea></div>
        <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Create</button><button class="btn" type="button" data-close-dialog="clientDialog">Cancel</button></div>
        <p class="status-line"></p>
      </form>
    </dialog>`);
  $("#newClientBtn")?.addEventListener("click", () => $("#clientDialog")?.showModal());
  $("#clientForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const created = await api("/api/client-projects", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      window.location.href = `/projects/${created.client.id}`;
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  bindDialogCloseButtons();
}

async function submitClientDocument(form, clientID, websiteID = "") {
  const values = Object.fromEntries(new FormData(form).entries());
  values.website_id = websiteID;
  const file = form.file?.files?.[0];
  if (file) values.file_url = await upload(file);
  delete values.file;
  await api(`/api/client-projects/${clientID}/documents`, { method: "POST", body: JSON.stringify(values) });
}

async function renderClientProject(clientID) {
  const data = await api(`/api/client-projects/${clientID}`);
  const client = data.client;
  const canManage = Boolean(data.can_manage);
  const canManageMembers = Boolean(data.can_manage_members);
  const canDeleteFolder = Boolean(data.can_delete);
  const candidateData = canManageMembers ? await api(`/api/teams/${client.team_id}`).catch(() => ({ members: [] })) : { members: [] };
  shell(client.name, `
    <div class="page-title">
      <div><h1>${esc(client.name)}</h1><p class="muted">${esc(client.company_email || "Client folder")}</p></div>
      <div class="toolbar"><a class="btn" href="/projects">${icon("arrow-left")}Projects</a>${canManage ? `<button class="btn primary" id="editClientBtn">${icon("pencil")}Edit client</button>` : ""}${canDeleteFolder ? `<button class="btn danger" id="deleteClientFolderBtn" type="button">${icon("trash-2")}Delete folder</button>` : ""}</div>
    </div>
    <div class="grid-2">
      <section class="panel"><div class="panel-head"><h2>Client information</h2>${canManage ? `<button class="btn compact" id="addClientDocBtn">${icon("file-plus")}Document</button>` : ""}</div><p>${chatText(client.details || "No client information yet.")}</p><div class="task-list">${clientDocumentRows(data.documents || [], canManage)}</div></section>
      <section class="panel"><div class="panel-head"><h2>Folder team access</h2>${canManageMembers ? `<button class="btn compact primary" id="addClientMemberBtn">${icon("user-plus")}Add team</button>` : ""}</div><p class="muted">People added here can access every domain inside this folder.</p><div class="task-list">${clientMemberRows(data.members || [], canManageMembers)}</div></section>
    </div>
    <section class="panel"><div class="panel-head"><h2>Websites</h2>${canManage ? `<button class="btn primary compact" id="addClientWebsiteBtn">${icon("plus")}Website</button>` : ""}</div><div class="task-list">${clientWebsiteRows(data.websites || [], canManage, canManageMembers)}</div></section>
    <dialog id="editClientDialog" class="modal client-dialog">
      <form id="editClientForm" class="form-grid" method="dialog">
        <div class="modal-head"><h2>Edit client company</h2><button class="btn icon quiet" type="button" data-close-dialog="editClientDialog" title="Close">${icon("x")}</button></div>
        <div class="field"><label>Company name</label><input name="name" value="${esc(client.name)}" required></div>
        <div class="grid-2"><div class="field"><label>Company email</label><input type="email" name="company_email" value="${esc(client.company_email || "")}"></div><div class="field"><label>Contact name</label><input name="contact_name" value="${esc(client.contact_name || "")}"></div></div>
        <div class="field"><label>Client information</label><textarea name="details" data-mentionable>${esc(client.details || "")}</textarea></div>
        <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Save</button><button class="btn" type="button" data-close-dialog="editClientDialog">Cancel</button></div>
        <p class="status-line"></p>
      </form>
    </dialog>
    <dialog id="deleteClientFolderDialog" class="modal client-dialog">
      <form id="deleteClientFolderForm" class="form-grid" method="dialog">
        <div class="modal-head"><h2>Delete folder</h2><button class="btn icon quiet" type="button" data-close-dialog="deleteClientFolderDialog" title="Close">${icon("x")}</button></div>
        <p class="muted">This will delete ${esc(client.name)} and its websites, tabs, task boards, documents, comments, and logs.</p>
        <div class="field"><label>Type Confirm to delete</label><input name="confirm_text" autocomplete="off" required></div>
        <div class="toolbar"><button class="btn danger" type="submit">${icon("trash-2")}Delete folder</button><button class="btn" type="button" data-close-dialog="deleteClientFolderDialog">Cancel</button></div>
        <p class="status-line"></p>
      </form>
    </dialog>
    <dialog id="clientMemberDialog" class="modal client-dialog">
      <form id="clientMemberForm" class="form-grid" method="dialog">
        <div class="modal-head"><h2>Add team access</h2><button class="btn icon quiet" type="button" data-close-dialog="clientMemberDialog" title="Close">${icon("x")}</button></div>
        <p class="muted">Choose whether this person can access every domain in ${esc(client.name)} or only one specific domain.</p>
        <div class="field"><label>Team member</label><select name="user_id" required>${teamMemberOptionHTML(candidateData.members || [])}</select></div>
        <div class="grid-2">
          <div class="field"><label>Permission</label><select name="permission" data-client-access-permission><option value="all">All domains in this folder</option><option value="domain">Specific domain</option></select></div>
          <div class="field" data-client-access-domain-field hidden><label>Domain</label><select name="website_id">${(data.websites || []).map((site) => `<option value="${esc(site.id)}">${esc(site.name || site.url || "Untitled domain")}</option>`).join("") || `<option value="" disabled>No domains available</option>`}</select></div>
        </div>
        <div class="field"><label>User role</label><select name="role">${staffRoleOptions("internal")}</select></div>
        <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Add team</button><button class="btn" type="button" data-close-dialog="clientMemberDialog">Cancel</button></div>
        <p class="status-line"></p>
      </form>
    </dialog>
    <dialog id="clientWebsiteDialog" class="modal client-dialog">
      <form id="clientWebsiteForm" class="form-grid" method="dialog">
        <div class="modal-head"><h2>Add website</h2><button class="btn icon quiet" type="button" data-close-dialog="clientWebsiteDialog" title="Close">${icon("x")}</button></div>
        <div class="field"><label>Website name</label><input name="name" required></div>
        <div class="field"><label>Website URL</label><input name="url" placeholder="https://example.com"></div>
        <div class="field"><label>Website details</label><textarea name="details" data-mentionable></textarea></div>
        <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Create</button><button class="btn" type="button" data-close-dialog="clientWebsiteDialog">Cancel</button></div>
        <p class="status-line"></p>
      </form>
    </dialog>
    <dialog id="clientWebsiteAccessDialog" class="modal client-dialog">
      <form id="clientWebsiteAccessForm" class="form-grid" method="dialog">
        <div class="modal-head"><h2>Add team to domain</h2><button class="btn icon quiet" type="button" data-close-dialog="clientWebsiteAccessDialog" title="Close">${icon("x")}</button></div>
        <input type="hidden" name="website_id">
        <p class="muted" id="clientWebsiteAccessTitle">Domain access gives this person access only to the selected domain.</p>
        <div id="clientWebsiteAccessRows" class="task-list"></div>
        <div class="grid-2">
          <div class="field"><label>Team member</label><select name="user_id" required>${teamMemberOptionHTML(candidateData.members || [])}</select></div>
          <div class="field"><label>Domain role</label><select name="role">${staffRoleOptions("internal")}</select></div>
        </div>
        <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Add team</button><button class="btn" type="button" data-close-dialog="clientWebsiteAccessDialog">Cancel</button></div>
        <p class="status-line"></p>
      </form>
    </dialog>
    ${editClientWebsiteDialogHTML()}
    ${deleteClientWebsiteDialogHTML()}
    ${clientDocumentDialogHTML("clientDocumentDialog", "Add client document")}`);
  bindAccessRoleSelect($("#clientMemberForm"), candidateData.members || []);
  bindAccessRoleSelect($("#clientWebsiteAccessForm"), candidateData.members || []);
  const clientMemberForm = $("#clientMemberForm");
  const syncClientMemberPermission = () => {
    if (!clientMemberForm) return;
    const domainField = clientMemberForm.querySelector("[data-client-access-domain-field]");
    const domainSelect = clientMemberForm.elements.website_id;
    const domainMode = clientMemberForm.elements.permission?.value === "domain";
    if (domainField) domainField.hidden = !domainMode;
    if (domainSelect) domainSelect.required = domainMode;
  };
  clientMemberForm?.elements.permission?.addEventListener("change", syncClientMemberPermission);
  syncClientMemberPermission();
  $("#editClientBtn")?.addEventListener("click", () => $("#editClientDialog")?.showModal());
  $("#deleteClientFolderBtn")?.addEventListener("click", () => {
    const form = $("#deleteClientFolderForm");
    form?.reset();
    setFormStatus(form, "");
    $("#deleteClientFolderDialog")?.showModal();
  });
  $("#addClientMemberBtn")?.addEventListener("click", () => {
    const form = $("#clientMemberForm");
    form?.reset();
    form?.elements.user_id?.dispatchEvent(new Event("change"));
    if (form?.elements.permission) form.elements.permission.value = "all";
    syncClientMemberPermission();
    setFormStatus(form, "");
    $("#clientMemberDialog")?.showModal();
  });
  $("#addClientWebsiteBtn")?.addEventListener("click", () => $("#clientWebsiteDialog")?.showModal());
  $("#addClientDocBtn")?.addEventListener("click", () => $("#clientDocumentDialog")?.showModal());
  const websitesByID = Object.fromEntries((data.websites || []).map((site) => [site.id, site]));
  document.querySelectorAll("[data-share-client-website]").forEach((btn) => btn.addEventListener("click", () => {
    const site = websitesByID[btn.dataset.shareClientWebsite];
    const form = $("#clientWebsiteAccessForm");
    if (!site || !form) return;
    form.reset();
    form.elements.user_id?.dispatchEvent(new Event("change"));
    form.elements.website_id.value = site.id || "";
    $("#clientWebsiteAccessTitle").textContent = `Domain access gives this person access only to ${site.name || "this domain"}.`;
    $("#clientWebsiteAccessRows").innerHTML = clientWebsiteAccessRows(site, candidateData.members || []);
    $("#clientWebsiteAccessDialog")?.showModal();
    icons();
  }));
  $("#clientWebsiteAccessForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const websiteID = form.elements.website_id.value;
    try {
      await api(`/api/client-websites/${websiteID}/members`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      $("#clientWebsiteAccessDialog")?.close();
      await refreshClientSidebarCache();
      renderClientProject(clientID);
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  $("#clientWebsiteAccessRows")?.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-remove-domain-member]");
    if (!btn) return;
    const websiteID = $("#clientWebsiteAccessForm")?.elements.website_id.value || "";
    if (!websiteID || !confirm("Remove this member from the domain?")) return;
    await api(`/api/client-websites/${websiteID}/members/${btn.dataset.removeDomainMember}`, { method: "DELETE" });
    $("#clientWebsiteAccessDialog")?.close();
    await refreshClientSidebarCache();
    renderClientProject(clientID);
  });
  $("#editClientForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api(`/api/client-projects/${clientID}`, { method: "PATCH", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      await refreshClientSidebarCache();
      renderClientProject(clientID);
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  $("#deleteClientFolderForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (String(form.elements.confirm_text.value || "").trim() !== "Confirm") {
      setFormStatus(form, "Type Confirm exactly to delete this folder.", true);
      return;
    }
    try {
      await api(`/api/client-projects/${clientID}`, { method: "DELETE" });
      $("#deleteClientFolderDialog")?.close();
      await refreshClientSidebarCache();
      navigateApp("/projects", { replace: true });
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  $("#clientMemberForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const body = JSON.stringify({
        user_id: form.elements.user_id.value,
        role: form.elements.role.value,
      });
      if (form.elements.permission.value === "domain") {
        const websiteID = form.elements.website_id.value;
        if (!websiteID) {
          setFormStatus(form, "Choose a domain for specific domain access.", true);
          return;
        }
        await api(`/api/client-websites/${websiteID}/members`, { method: "POST", body });
      } else {
        await api(`/api/client-projects/${clientID}/members`, { method: "POST", body });
      }
      $("#clientMemberDialog")?.close();
      await refreshClientSidebarCache();
      renderClientProject(clientID);
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  $("#clientWebsiteForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const created = await api(`/api/client-projects/${clientID}/websites`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      await refreshClientSidebarCache();
      window.location.href = `/projects/${clientID}/sites/${created.website.id}`;
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  document.querySelector("[data-client-document-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await submitClientDocument(form, clientID);
      renderClientProject(clientID);
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  document.querySelectorAll("[data-remove-client-member]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!confirm("Remove this member from the client folder?")) return;
    await api(`/api/client-projects/${clientID}/members/${btn.dataset.removeClientMember}`, { method: "DELETE" });
    renderClientProject(clientID);
  }));
  document.querySelectorAll("[data-delete-client-doc]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!confirm("Delete this document?")) return;
    await api(`/api/client-documents/${btn.dataset.deleteClientDoc}`, { method: "DELETE" });
    renderClientProject(clientID);
  }));
  bindContextActionMenus(app);
  bindClientWebsiteEdit(data.websites || [], async () => {
    await renderClientProject(clientID);
  });
  bindClientWebsiteDelete(async () => {
    await renderClientProject(clientID);
  });
  bindDialogCloseButtons();
  bindMentionSuggestions(app);
  icons();
}

async function renderClientWebsite(clientID, websiteID) {
  const data = await api(`/api/client-websites/${websiteID}`);
  state.liveWebsiteSignature = clientWebsiteLiveSignature(data);
  const website = data.website;
  const canManage = Boolean(data.can_manage);
  const canManageStatuses = Boolean(data.can_manage_statuses);
  const routeParams = new URLSearchParams(location.search);
  const selectedTabID = routeParams.get("tab") || data.tabs?.[0]?.id || "";
  const autoOpenAnnotation = routeParams.get("new") === "annotation";
  const annotationReturnTo = routeParams.get("return") || "";
  const selectedTab = (data.tabs || []).find((tab) => tab.id === selectedTabID) || data.tabs?.[0] || null;
  const clientUsersByID = clientTaskUsersByID(data.members || []);
  const clientBoardStatuses = clientTaskStatuses(selectedTab, data.tasks || []);
  const annotationTasks = (data.tasks || []).filter((task) => task.type === "annotation" && (!selectedTab?.id || task.tab_id === selectedTab.id));
  const tabsByID = Object.fromEntries((data.tabs || []).map((tab) => [tab.id, tab]));
  shell(website.name, `
    <div class="page-title">
      <div><h1>${esc(website.name)}</h1><p class="muted">${esc(data.client?.name || "Client")} ${website.url ? " - " + esc(website.url) : ""}</p></div>
      <div class="toolbar"><a class="btn" href="/projects/${esc(clientID)}">${icon("arrow-left")}Client folder</a></div>
    </div>
    <section class="panel">
      <div class="tabs client-tabs">
        ${clientTabNavHTML(data.tabs || [], selectedTab, canManage)}
        ${canManage ? `<button class="client-tab-add" type="button" id="addClientTabInline">${icon("plus")}New tab</button>` : ""}
      </div>
    </section>
    ${clientTabContentHTML(selectedTab, data)}
    <dialog id="clientTabDialog" class="modal client-dialog">
      <form id="clientTabForm" class="form-grid" method="dialog">
        <div class="modal-head"><h2>Add tab</h2><button class="btn icon quiet" type="button" data-close-dialog="clientTabDialog" title="Close">${icon("x")}</button></div>
        <div class="field"><label>Tab option</label><select name="type"><option value="description">Description text editor</option><option value="doc_list">Document list</option><option value="task_board">Task board</option></select></div>
        <div class="field"><label>Tab title</label><input name="title" placeholder="Description"></div>
        <div class="field"><label>Starting note</label><textarea name="content" data-mentionable></textarea></div>
        <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Create</button><button class="btn" type="button" data-close-dialog="clientTabDialog">Cancel</button></div>
        <p class="status-line"></p>
      </form>
    </dialog>
    <dialog id="editClientTabDialog" class="modal client-dialog">
      <form id="editClientTabForm" class="form-grid" method="dialog">
        <div class="modal-head"><h2>Edit tab</h2><button class="btn icon quiet" type="button" data-close-dialog="editClientTabDialog" title="Close">${icon("x")}</button></div>
        <input type="hidden" name="tab_id">
        <div class="field"><label>Tab title</label><input name="title" required></div>
        <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Save</button><button class="btn" type="button" data-close-dialog="editClientTabDialog">Cancel</button></div>
        <p class="status-line"></p>
      </form>
    </dialog>
    ${clientDocumentDialogHTML("websiteDocumentDialog", "Add website document", websiteID)}
    <dialog id="clientTaskDialog" class="modal client-dialog task-choice-dialog">
      <div class="modal-head"><h2>Add task</h2><button class="btn icon quiet" type="button" data-close-dialog="clientTaskDialog" title="Close">${icon("x")}</button></div>
      <div class="task-choice-grid" data-client-task-choice>
        <button class="task-choice-card" type="button" id="chooseDescriptionTask">${icon("file-text")}<strong>Task description</strong><span>Use the current task form and workflow.</span></button>
        <button class="task-choice-card" type="button" id="chooseAnnotationTask">${icon("map-pin")}<strong>Annotation</strong><span>Open a full-page website annotation workspace.</span></button>
      </div>
      <form id="clientTaskForm" class="form-grid" method="dialog" hidden>
        <input type="hidden" name="type" value="description">
        <div class="toolbar compact-toolbar"><button class="btn compact" type="button" data-back-task-options>${icon("arrow-left")}Options</button></div>
        <div class="field"><label>Due date</label><input type="date" name="due_date"></div>
        ${recurrenceControlsHTML()}
        <div class="field"><label>Title</label><input name="title" maxlength="80" required></div>
        <div data-task-description-fields>
          <div class="field"><label>Task body</label>${contentBlockEditorHTML()}</div>
        </div>
        <div class="field"><label>Assignment</label>${assigneePickerHTML(data.members || [])}</div>
        <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Create task</button><button class="btn" type="button" data-close-dialog="clientTaskDialog">Cancel</button></div>
        <p class="status-line"></p>
      </form>
    </dialog>
    <dialog id="clientAnnotationDialog" class="modal annotation-task-dialog">
      <div class="annotation-task-form">
        <header class="annotation-task-head">
          <div><span class="muted">${esc(data.client?.name || "Client")} / ${esc(website.name || "Website")}</span><h2>Website annotation</h2></div>
          <button class="btn icon quiet" type="button" data-close-dialog="clientAnnotationDialog" title="Close">${icon("x")}</button>
        </header>
        <section class="annotation-url-step" id="clientAnnotationURLStep">
          <div class="panel">
            <h3>Choose page to annotate</h3>
            <p class="muted">Base domain: ${esc(websiteOrigin(website.url) || website.url || "No website URL set")}</p>
            <div class="grid-2">
              <div class="field"><label>Domain</label><input id="clientAnnotationBaseURL" value="${esc(websiteOrigin(website.url) || website.url || "")}" disabled></div>
              <div class="field"><label>Page URL or path</label><input id="clientAnnotationPageURL" value="${esc(annotationPageURL(website.url, ""))}" placeholder="/contact-us or https://example.com/contact-us"></div>
            </div>
            <p class="muted" id="clientAnnotationURLPreview">${esc(annotationPageURL(website.url, ""))}</p>
            <div class="toolbar"><button class="btn primary" type="button" id="openAnnotationPageBtn">${icon("map-pin")}Open annotation page</button><button class="btn" type="button" data-close-dialog="clientAnnotationDialog">Cancel</button></div>
            <p class="status-line"></p>
          </div>
        </section>
        <div class="annotation-task-body" id="clientAnnotationWorkspace" hidden>
          <section class="annotation-stage annotation-task-stage" id="clientAnnotationStage">
            <div class="annotation-empty"><p class="muted">Choose a page path first.</p></div>
          </section>
          <aside class="bug-side annotation-task-side feedback-side">
            <section class="feedback-sidebar-view" id="clientAnnotationListView">
              <div class="feedback-detail-toolbar annotation-sidebar-toolbar">
                <h2>Pin feedback</h2>
                <button class="btn icon quiet" type="button" data-toggle-annotation-sidebar title="Collapse annotations">${icon("panel-right-close")}</button>
              </div>
              <form id="clientAnnotationTaskForm" class="form-grid">
                <input type="hidden" name="type" value="annotation">
                <input type="hidden" name="pin_x">
                <input type="hidden" name="pin_y">
                <input type="hidden" name="page_width">
                <input type="hidden" name="page_height">
                <input type="hidden" name="screenshot_url">
                <div class="field"><label>Title</label><input name="title" maxlength="80" required placeholder="Annotation title"></div>
                <div class="field"><label>Coordinates</label><input id="clientAnnotationCoordLabel" disabled placeholder="Click the page to place a pin"></div>
                <div class="field"><label>Status</label>${statusPickerHTML(clientBoardStatuses, "todo", "status")}</div>
                <label class="feedback-url-field"><span>Page URL</span><input name="url" value="${esc(website.url || "")}" readonly required></label>
                <div class="field"><label>Assignee</label>${assigneePickerHTML(data.members || [])}</div>
                <div class="field annotation-screenshot-field">
                  <label>Section screenshot</label>
                  <input type="file" name="screenshot_file" accept="image/*" hidden>
                  <div class="toolbar compact-toolbar">
                    <button class="btn compact" type="button" id="captureClientAnnotationScreenshotBtn">${icon("camera")}Capture pinned section</button>
                    <button class="btn compact" type="button" id="uploadClientAnnotationScreenshotBtn">${icon("image-plus")}Upload image</button>
                  </div>
                  <div class="annotation-screenshot-preview" id="clientAnnotationScreenshotPreview" data-annotation-screenshot-preview hidden></div>
                </div>
                <div class="field"><label>Attachments</label><input type="file" name="attachments" multiple></div>
                <div class="field"><label>Details</label><textarea name="comment" data-mentionable placeholder="Write annotation details"></textarea></div>
                <div class="grid-2"><div class="field"><label>Due date</label><input type="date" name="due_date"></div></div>
                ${recurrenceControlsHTML()}
                <div class="toolbar"><button class="btn primary" type="submit">${icon("map-pin")}Save annotation</button><button class="btn" type="button" data-close-dialog="clientAnnotationDialog">Cancel</button></div>
                <p class="status-line"></p>
              </form>
              <hr>
              <div class="feedback-list" id="clientAnnotationTaskList"></div>
            </section>
            <section class="feedback-sidebar-view feedback-detail-view" id="clientAnnotationDetailView" hidden>
              <div class="feedback-detail-toolbar">
                <button class="btn compact" type="button" id="clientAnnotationBackBtn">${icon("arrow-left")}Back</button>
              </div>
              <div id="clientAnnotationDetailBody"></div>
            </section>
          </aside>
          <button class="btn icon annotation-sidebar-expand" type="button" data-toggle-annotation-sidebar title="Show annotations" hidden>${icon("panel-right-open")}</button>
        </div>
      </div>
    </dialog>`);
  document.querySelectorAll("[data-client-tab-link]").forEach((btn) => btn.addEventListener("click", () => {
    window.location.href = `/projects/${clientID}/sites/${websiteID}?tab=${btn.dataset.clientTabLink}`;
  }));
  $("#addClientTabInline")?.addEventListener("click", () => $("#clientTabDialog")?.showModal());
  document.querySelectorAll("[data-edit-client-tab]").forEach((btn) => btn.addEventListener("click", () => {
    const tab = tabsByID[btn.dataset.editClientTab];
    const form = $("#editClientTabForm");
    if (!tab || !form) return;
    form.reset();
    form.elements.tab_id.value = tab.id || "";
    form.elements.title.value = tab.title || "";
    $("#editClientTabDialog")?.showModal();
  }));
  bindContextActionMenus(app);
  $("#addWebsiteDocBtn")?.addEventListener("click", () => $("#websiteDocumentDialog")?.showModal());
  $("#addClientTaskBtn")?.addEventListener("click", () => {
    $("#clientTaskForm")?.setAttribute("hidden", "");
    document.querySelector("[data-client-task-choice]")?.removeAttribute("hidden");
    $("#clientTaskDialog")?.showModal();
  });
  $("#chooseDescriptionTask")?.addEventListener("click", () => {
    document.querySelector("[data-client-task-choice]")?.setAttribute("hidden", "");
    $("#clientTaskForm")?.removeAttribute("hidden");
    $("#clientTaskForm input[name='title']")?.focus();
  });
  document.querySelector("[data-back-task-options]")?.addEventListener("click", () => {
    $("#clientTaskForm")?.setAttribute("hidden", "");
    document.querySelector("[data-client-task-choice]")?.removeAttribute("hidden");
  });
  $("#chooseAnnotationTask")?.addEventListener("click", () => {
    $("#clientTaskDialog")?.close();
    currentClientAnnotationTask = null;
    currentClientAnnotationItems = [];
    $("#clientAnnotationURLStep")?.removeAttribute("hidden");
    $("#clientAnnotationWorkspace")?.setAttribute("hidden", "");
    $("#clientAnnotationPageURL").value = annotationPageURL(website.url, "");
    $("#clientAnnotationURLPreview").textContent = annotationPageURL(website.url, "");
    $("#clientAnnotationTaskForm input[name='url']").value = annotationPageURL(website.url, "");
    $("#clientAnnotationCoordLabel").value = "";
    $("#clientAnnotationTaskForm [name='pin_x']").value = "";
    $("#clientAnnotationTaskForm [name='pin_y']").value = "";
    $("#clientAnnotationTaskForm [name='page_width']").value = ANNOTATION_VIEWPORT.width;
    $("#clientAnnotationTaskForm [name='page_height']").value = ANNOTATION_TALL_FALLBACK_HEIGHT;
    setAnnotationScreenshotPreview($("#clientAnnotationTaskForm"), "");
    $("#clientAnnotationStage").innerHTML = `<div class="annotation-empty"><p class="muted">Fill the page URL, then open the annotation page.</p></div>`;
    $("#clientAnnotationDialog")?.showModal();
    $("#clientAnnotationPageURL")?.focus();
  });
  $("#clientAnnotationPageURL")?.addEventListener("input", (event) => {
    $("#clientAnnotationURLPreview").textContent = annotationPageURL(website.url, event.currentTarget.value);
    const line = $("#clientAnnotationURLStep .status-line");
    if (line) line.textContent = "";
  });
  const clientAnnotationTasks = [...annotationTasks];
  const clientAnnotationTasksByID = Object.fromEntries(clientAnnotationTasks.map((task) => [task.id, task]));
  let currentClientAnnotationTask = null;
  let currentClientAnnotationItems = [];
  let currentClientAnnotationURL = "";
  let currentClientAnnotationPageHeight = ANNOTATION_TALL_FALLBACK_HEIGHT;
  let currentClientAnnotationPageWidth = ANNOTATION_VIEWPORT.width;
  let clientAnnotationDirty = false;
  const selectorForID = (value) => (window.CSS?.escape ? CSS.escape(value) : String(value).replace(/"/g, '\\"'));
  const clientAnnotationsForPage = () => currentClientAnnotationItems.filter((item) => !currentClientAnnotationURL || item.url === currentClientAnnotationURL);
  const syncClientAnnotationStatusControls = (taskID, value) => {
    const status = feedbackStatusObject(clientBoardStatuses, value || "todo");
    document.querySelectorAll(`[data-client-annotation-status-form="${selectorForID(taskID)}"]`).forEach((box) => {
      const input = box.querySelector("input[name='status']");
      const trigger = box.querySelector("[data-status-trigger]");
      const label = box.querySelector("[data-status-trigger-label]");
      if (input) input.value = status.value;
      if (label) label.textContent = status.label;
      trigger?.style.setProperty("--status-icon-color", status.icon_color);
      trigger?.style.setProperty("--status-text-color", status.text_color);
    });
  };
  const bindClientAnnotationStatusForms = (root = document) => {
    root.querySelectorAll("[data-client-annotation-status-form]").forEach((box) => {
      if (box.dataset.clientAnnotationStatusBound === "1") return;
      box.dataset.clientAnnotationStatusBound = "1";
      box.addEventListener("change", async (event) => {
        if (!event.target.matches("input[name='status']")) return;
        const taskID = box.dataset.clientAnnotationStatusForm;
        const status = event.target.value || "todo";
        try {
          await api(`/api/client-tasks/${taskID}`, { method: "PATCH", body: JSON.stringify({ status }) });
          if (clientAnnotationTasksByID[taskID]) clientAnnotationTasksByID[taskID].status = status;
          clientAnnotationDirty = true;
          syncClientAnnotationStatusControls(taskID, status);
          setStatus("Annotation status updated.");
        } catch (error) {
          setStatus(error.message, true);
        }
      });
    });
  };
  const renderClientAnnotationPins = (extraPin = "") => {
    const layer = $("#clientAnnotationPinLayer");
    if (!layer) return;
    layer.innerHTML = `${clientAnnotationsForPage().map((item, index) => clientAnnotationItemPinHTML(item, index, currentClientAnnotationPageWidth, currentClientAnnotationPageHeight)).join("")}${extraPin}`;
    icons();
  };
  const renderClientAnnotationList = () => {
    const list = $("#clientAnnotationTaskList");
    if (!list) return;
    list.innerHTML = clientAnnotationItemRowsHTML(clientAnnotationsForPage(), clientBoardStatuses, clientUsersByID, { taskID: currentClientAnnotationTask?.id || "" });
    bindStatusPickers(list);
    if (currentClientAnnotationTask?.id) {
      bindClientAnnotationItemStatusForms(list, clientBoardStatuses, async (result, annotationID, status) => {
        currentClientAnnotationTask.annotations = result.annotations || currentClientAnnotationTask.annotations || [];
        currentClientAnnotationItems = clientTaskAnnotationItems(currentClientAnnotationTask);
        clientAnnotationDirty = true;
        syncClientAnnotationItemStatusControls(document, annotationID, clientBoardStatuses, status);
      });
    }
    bindClientAnnotationStatusForms(list);
    list.querySelectorAll("[data-open-client-annotation-item]").forEach((btn) => btn.addEventListener("click", () => openClientAnnotationDetail(btn.dataset.openClientAnnotationItem)));
    icons();
  };
  const highlightClientAnnotationPin = (taskID) => {
    document.querySelectorAll("[data-feedback-pin]").forEach((pin) => {
      const active = pin.dataset.feedbackPin === taskID;
      pin.classList.toggle("highlighted", active);
      pin.classList.toggle("expanded", active);
    });
    const pin = document.querySelector(`[data-feedback-pin="${selectorForID(taskID)}"]`);
    pin?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  };
  const showClientAnnotationList = () => {
    state.clientTaskReply = null;
    state.clientTaskCommentEdit = null;
    $("#clientAnnotationDetailView")?.setAttribute("hidden", "");
    $("#clientAnnotationListView")?.removeAttribute("hidden");
    const body = $("#clientAnnotationDetailBody");
    if (body) body.innerHTML = "";
    document.querySelectorAll("[data-feedback-pin]").forEach((pin) => pin.classList.remove("highlighted", "expanded"));
    document.querySelectorAll("[data-client-annotation-item-row]").forEach((row) => row.classList.remove("active"));
  };
  const refreshClientAnnotationComments = async (root, taskID, annotationID) => refreshClientTaskCommentList(root, taskID, clientUsersByID, canManage, (scope) => {
    bindAttachmentOpeners(scope);
    bindMentionSuggestions(scope);
    bindClientAnnotationCommentForm(scope, taskID, annotationID);
  });
  const bindClientAnnotationCommentForm = (root, taskID, annotationID = taskID) => {
    root.querySelectorAll("[data-toggle-comment-replies]").forEach((btn) => {
      if (btn.dataset.clientAnnotationRepliesBound === "1") return;
      btn.dataset.clientAnnotationRepliesBound = "1";
      btn.addEventListener("click", () => {
        const box = Array.from(root.querySelectorAll("[data-comment-replies]")).find((item) => item.dataset.commentReplies === btn.dataset.toggleCommentReplies);
        if (!box) return;
        const nextOpen = box.hidden;
        box.hidden = !nextOpen;
        btn.setAttribute("aria-expanded", nextOpen ? "true" : "false");
        btn.classList.toggle("active", nextOpen);
      });
    });
    root.querySelectorAll("[data-client-comment-reply]").forEach((btn) => {
      if (btn.dataset.clientAnnotationReplyBound === "1") return;
      btn.dataset.clientAnnotationReplyBound = "1";
      btn.addEventListener("click", () => {
        setClientTaskReply({ id: btn.dataset.clientCommentReply, text: btn.dataset.replyText || "Comment" }, root);
        root.querySelector("textarea[name='content']")?.focus();
      });
    });
    root.querySelectorAll("[data-edit-client-comment]").forEach((btn) => {
      if (btn.dataset.clientAnnotationEditBound === "1") return;
      btn.dataset.clientAnnotationEditBound = "1";
      btn.addEventListener("click", () => {
        setClientTaskCommentEdit({ id: btn.dataset.editClientComment, content: btn.dataset.commentContent || "" }, root);
      });
    });
    root.querySelectorAll("[data-delete-client-comment]").forEach((btn) => {
      if (btn.dataset.clientAnnotationDeleteBound === "1") return;
      btn.dataset.clientAnnotationDeleteBound = "1";
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this comment?")) return;
        await api(`/api/client-task-comments/${btn.dataset.deleteClientComment}`, { method: "DELETE" });
        await refreshClientAnnotationComments(root, taskID, annotationID);
      });
    });
    bindClientCommentReactions(root, async () => refreshClientAnnotationComments(root, taskID, annotationID), clientUsersByID);
    const form = root.querySelector(`[data-client-annotation-comment-form="${selectorForID(taskID)}"]`);
    if (!form || form.dataset.clientAnnotationCommentBound === "1") return;
    form.dataset.clientAnnotationCommentBound = "1";
    const textarea = form.elements.content;
    const attachmentInput = form.elements.attachment;
    const preview = form.querySelector("[data-client-task-attachment-preview]");
    form.querySelector("[data-client-comment-emoji]")?.addEventListener("click", (event) => openEmojiPicker(event.currentTarget, textarea));
    form.querySelector("[data-client-comment-attach]")?.addEventListener("click", () => attachmentInput?.click());
    attachmentInput?.addEventListener("change", () => {
      const file = attachmentInput.files?.[0];
      if (!file || !preview) return;
      const localURL = file.type.startsWith("image/") ? URL.createObjectURL(file) : "";
      preview.hidden = false;
      preview.innerHTML = `<span>${localURL ? `<img class="attachment-preview-mini" src="${esc(localURL)}" alt="${esc(file.name)} preview">` : icon("paperclip")}${esc(file.name)}</span><button class="btn icon quiet" type="button" data-clear-client-comment-attachment>${icon("x")}</button>`;
      preview.querySelector("[data-clear-client-comment-attachment]")?.addEventListener("click", () => {
        if (localURL) URL.revokeObjectURL(localURL);
        attachmentInput.value = "";
        preview.hidden = true;
        preview.innerHTML = "";
      });
      icons();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const content = String(textarea?.value || "").trim();
      const file = attachmentInput?.files?.[0];
      if (!content && !file) {
        setFormStatus(form, "Comment or attachment is required.", true);
        return;
      }
      const submit = form.querySelector("[type='submit']");
      if (submit) submit.disabled = true;
      try {
        if (state.clientTaskCommentEdit) {
          const body = { content };
          if (file) {
            body.attachment_url = await upload(file);
            body.attachment_name = file.name;
          }
          await api(`/api/client-task-comments/${state.clientTaskCommentEdit.id}`, { method: "PATCH", body: JSON.stringify(body) });
          resetClientCommentForm(form, root);
          await refreshClientAnnotationComments(root, taskID, annotationID);
          return;
        }
        const body = {
          content,
          reply_to_id: state.clientTaskReply?.id || "",
          reply_text: state.clientTaskReply?.text || "",
          attachment_url: "",
          attachment_name: "",
        };
        if (file) {
          body.attachment_url = await upload(file);
          body.attachment_name = file.name;
        }
        await api(`/api/client-tasks/${taskID}/comments`, { method: "POST", body: JSON.stringify(body) });
        resetClientCommentForm(form, root);
        await refreshClientAnnotationComments(root, taskID, annotationID);
      } catch (error) {
        setFormStatus(form, error.message, true);
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  };
  const openClientAnnotationDetail = async (annotationID) => {
    try {
      let latest = null;
      if (currentClientAnnotationTask?.id) {
        latest = await api(`/api/client-tasks/${currentClientAnnotationTask.id}`);
        currentClientAnnotationTask = latest.task || currentClientAnnotationTask;
        currentClientAnnotationItems = clientTaskAnnotationItems(currentClientAnnotationTask);
      }
      const annotation = currentClientAnnotationItems.find((item) => String(item.id) === String(annotationID));
      if (!annotation) return;
      const usersByID = clientTaskUsersByID(latest?.members || data.members || []);
      highlightClientAnnotationPin(annotationID);
      document.querySelectorAll("[data-client-annotation-item-row]").forEach((row) => row.classList.toggle("active", row.dataset.clientAnnotationItemRow === annotationID));
      $("#clientAnnotationListView")?.setAttribute("hidden", "");
      $("#clientAnnotationDetailView")?.removeAttribute("hidden");
      const body = $("#clientAnnotationDetailBody");
      if (body) {
        body.innerHTML = clientAnnotationTaskDetailHTML(annotation, clientBoardStatuses, usersByID, latest?.comments || [], canManage, { showStatus: false, commentTaskID: currentClientAnnotationTask?.id || annotation.id, annotationStatusTaskID: currentClientAnnotationTask?.id || "" });
        const detailView = $("#clientAnnotationDetailView");
        bindStatusPickers(detailView);
        if (currentClientAnnotationTask?.id) {
          bindClientAnnotationItemStatusForms(detailView, clientBoardStatuses, async (result, savedAnnotationID, status) => {
            currentClientAnnotationTask.annotations = result.annotations || currentClientAnnotationTask.annotations || [];
            currentClientAnnotationItems = clientTaskAnnotationItems(currentClientAnnotationTask);
            clientAnnotationDirty = true;
            syncClientAnnotationItemStatusControls(document, savedAnnotationID, clientBoardStatuses, status);
            renderClientAnnotationList();
          });
        }
        bindClientAnnotationStatusForms(detailView);
        bindAttachmentOpeners(detailView);
        bindMentionSuggestions(detailView);
        if (currentClientAnnotationTask?.id) bindClientAnnotationCommentForm(detailView, currentClientAnnotationTask.id, annotation.id);
        icons();
      }
    } catch (error) {
      setStatus(error.message, true);
    }
  };
  $("#clientAnnotationBackBtn")?.addEventListener("click", showClientAnnotationList);
  $("#clientAnnotationDialog")?.addEventListener("close", () => {
    if (annotationReturnTo.startsWith("/tasks")) {
      window.location.href = annotationReturnTo;
      return;
    }
    if (clientAnnotationDirty) renderClientWebsite(clientID, websiteID);
  });
  $("#openAnnotationPageBtn")?.addEventListener("click", () => {
    const form = $("#clientAnnotationTaskForm");
    const fullURL = annotationPageURL(website.url, $("#clientAnnotationPageURL")?.value || "");
    const line = $("#clientAnnotationURLStep .status-line");
    if (!fullURL || !/^https:\/\//i.test(fullURL)) {
      if (line) {
        line.textContent = "Website annotation requires an https domain.";
        line.style.color = "var(--danger)";
      }
      return;
    }
    $("#clientAnnotationStage").innerHTML = annotationFrameHTML({
      url: fullURL,
      title: `${website.name || "Website"} annotation page`,
      height: ANNOTATION_TALL_FALLBACK_HEIGHT,
      fallbackHeight: ANNOTATION_TALL_FALLBACK_HEIGHT,
      catcherID: "clientAnnotationClickCatcher",
      pinLayerID: "clientAnnotationPinLayer",
      pins: clientAnnotationsForPage().map((item, index) => ({ id: item.id, x: item.pin_x, y: item.pin_y, page_width: item.page_width, page_height: item.page_height, label: String(index + 1), title: item.title || "Annotation" })),
    });
    currentClientAnnotationURL = fullURL;
    currentClientAnnotationPageWidth = ANNOTATION_VIEWPORT.width;
    currentClientAnnotationPageHeight = ANNOTATION_TALL_FALLBACK_HEIGHT;
    $("#clientAnnotationURLStep")?.setAttribute("hidden", "");
    $("#clientAnnotationWorkspace")?.removeAttribute("hidden");
    bindAnnotationViewportResize($("#clientAnnotationStage"));
    bindAnnotationDeviceControls($("#clientAnnotationStage"), {
      fallbackHeight: ANNOTATION_TALL_FALLBACK_HEIGHT,
      onChange: ({ width, height }) => {
        currentClientAnnotationPageWidth = width;
        currentClientAnnotationPageHeight = height;
        if (form) {
          form.elements.page_width.value = width;
          form.elements.page_height.value = height;
          form.elements.pin_x.value = "";
          form.elements.pin_y.value = "";
        }
        const coord = $("#clientAnnotationCoordLabel");
        if (coord) coord.value = "";
        renderClientAnnotationPins();
      },
    });
    bindAnnotationFrameAutoHeight($("#clientAnnotationStage"), {
      fallbackHeight: ANNOTATION_TALL_FALLBACK_HEIGHT,
      onHeight: (height, width) => {
        currentClientAnnotationPageHeight = height;
        currentClientAnnotationPageWidth = width;
        if (form) {
          form.elements.page_width.value = width;
          form.elements.page_height.value = height;
        }
        renderClientAnnotationPins();
      },
    });
    showClientAnnotationList();
    renderClientAnnotationList();
    renderClientAnnotationPins();
    if (line) line.textContent = "";
    form.elements.url.value = fullURL;
    form.elements.page_width.value = currentClientAnnotationPageWidth;
    form.elements.page_height.value = currentClientAnnotationPageHeight;
    $("#clientAnnotationTaskForm input[name='title']")?.focus();
    bindClientAnnotationClick();
  });
  const bindClientAnnotationClick = () => {
    const catcher = $("#clientAnnotationClickCatcher");
    if (!catcher || catcher.dataset.bound === "1") return;
    catcher.dataset.bound = "1";
    catcher.addEventListener("click", (event) => {
      const viewport = event.currentTarget.closest("[data-annotation-viewport]");
      const form = $("#clientAnnotationTaskForm");
      if (!viewport || !form) return;
      const { x, y } = annotationPointFromEvent(event, viewport);
      form.elements.pin_x.value = x.toFixed(2);
      form.elements.pin_y.value = y.toFixed(2);
      $("#clientAnnotationCoordLabel").value = `${x.toFixed(1)}%, ${y.toFixed(1)}%`;
      renderClientAnnotationPins(annotationPinHTML({ x, y, target_page_width: currentClientAnnotationPageWidth, target_page_height: currentClientAnnotationPageHeight, label: String(clientAnnotationsForPage().length + 1), title: "New annotation" }));
      $("#clientAnnotationTaskForm textarea[name='comment']")?.focus();
      icons();
    });
  };
  bindClientAnnotationClick();
  $("#captureClientAnnotationScreenshotBtn")?.addEventListener("click", async (event) => {
    const form = $("#clientAnnotationTaskForm");
    const stop = setButtonLoading(event.currentTarget, true, "Capturing...");
    try {
      if (!form?.elements?.pin_x?.value || !form?.elements?.pin_y?.value) {
        throw new Error("Click the page first");
      }
      setFormStatus(form, "Choose this browser tab when your browser asks what to share.");
      const file = await captureAnnotationSectionFile($("#clientAnnotationStage"), {
        pinX: form?.elements?.pin_x?.value,
        pinY: form?.elements?.pin_y?.value,
      });
      const url = await upload(file);
      setAnnotationScreenshotPreview(form, url, file.name);
      setFormStatus(form, "Pinned section screenshot captured.");
    } catch (error) {
      setFormStatus(form, error.message || "Could not capture screenshot.", true);
    } finally {
      stop();
    }
  });
  $("#uploadClientAnnotationScreenshotBtn")?.addEventListener("click", () => $("#clientAnnotationTaskForm")?.elements.screenshot_file?.click());
  $("#clientAnnotationTaskForm")?.elements.screenshot_file?.addEventListener("change", async (event) => {
    const form = $("#clientAnnotationTaskForm");
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      setFormStatus(form, "Uploading section screenshot...");
      const url = await upload(file);
      setAnnotationScreenshotPreview(form, url, file.name);
      setFormStatus(form, "Section screenshot uploaded.");
    } catch (error) {
      setFormStatus(form, error.message || "Could not upload screenshot.", true);
    } finally {
      event.currentTarget.value = "";
    }
  });
  $("#clientAnnotationStage")?.addEventListener("click", (event) => {
    const pin = event.target.closest("[data-feedback-pin]");
    if (pin) openClientAnnotationDetail(pin.dataset.feedbackPin);
  });
  $("#copyClientWidgetCode")?.addEventListener("click", async (event) => {
    const code = $("#clientWidgetInstallCode")?.value || "";
    const line = $("#clientWidgetInstallStatus");
    try {
      await navigator.clipboard.writeText(code);
      if (line) line.textContent = "Widget code copied.";
      const stop = setButtonLoading(event.currentTarget, true, "Copied");
      setTimeout(stop, 900);
    } catch (error) {
      $("#clientWidgetInstallCode")?.select();
      if (line) {
        line.textContent = "Select and copy the widget code manually.";
        line.classList.add("error");
      }
    }
  });
  $("#clientTabForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const created = await api(`/api/client-websites/${websiteID}/tabs`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      window.location.href = `/projects/${clientID}/sites/${websiteID}?tab=${created.tab.id}`;
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  $("#descriptionTabForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api(`/api/client-tabs/${selectedTab.id}`, { method: "PATCH", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      renderClientWebsite(clientID, websiteID);
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  $("#editClientTabForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const tabID = form.elements.tab_id.value;
    try {
      await api(`/api/client-tabs/${tabID}`, { method: "PATCH", body: JSON.stringify({ title: form.elements.title.value }) });
      renderClientWebsite(clientID, websiteID);
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  document.querySelector("[data-client-document-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await submitClientDocument(form, clientID, websiteID);
      renderClientWebsite(clientID, websiteID);
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  $("#clientTaskForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const stopLoading = beginFormLoading(form, event.submitter, "Creating task...", "Creating...");
    try {
      syncRichEditors(form);
      const body = Object.fromEntries(new FormData(form).entries());
      body.title = compactClientTaskTitle(body.title);
      body.assignee_ids = selectedAssigneeIDs(form);
      body.blocks = readContentBlocks(form);
      body.content = contentFromBlocks(body.blocks);
      body.checklist = checklistFromBlocks(body.blocks);
      body.recurrence = recurrencePayloadFromForm(form);
      body.attachments = [];
      if (body.type === "annotation") {
        body.comment = String(body.comment || "").trim();
        body.content = body.comment;
        body.checklist = [];
        if (!String(body.url || "").startsWith("https://")) {
          throw new Error("annotation URL must start with https://");
        }
        for (const file of Array.from(form.attachments?.files || [])) {
          body.attachments.push(await upload(file));
        }
      } else {
        body.content = String(body.content || "").trim();
        body.comment = "";
        body.url = "";
      }
      await api(`/api/client-tabs/${selectedTab.id}/tasks`, { method: "POST", body: JSON.stringify(body) });
      renderClientWebsite(clientID, websiteID);
    } catch (error) {
      setFormStatus(form, error.message, true);
    } finally {
      stopLoading();
    }
  });
  $("#clientAnnotationTaskForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const stopLoading = beginFormLoading(form, event.submitter, "Saving annotation...", "Saving...");
    try {
      syncRichEditors(form);
      const body = Object.fromEntries(new FormData(form).entries());
      body.type = "annotation";
      body.title = compactClientTaskTitle(body.title);
      body.comment = String(body.comment || "").trim();
      body.content = body.comment;
      body.checklist = [];
      body.blocks = [];
      body.assignee_ids = selectedAssigneeIDs(form);
      body.recurrence = recurrencePayloadFromForm(form);
      body.attachments = [];
      body.screenshot_url = String(body.screenshot_url || "").trim();
      body.page_width = Number(body.page_width || currentClientAnnotationPageWidth || ANNOTATION_VIEWPORT.width);
      body.page_height = Number(body.page_height || currentClientAnnotationPageHeight || ANNOTATION_TALL_FALLBACK_HEIGHT);
      if (!String(body.url || "").startsWith("https://")) {
        throw new Error("annotation URL must start with https://");
      }
      if (!body.pin_x || !body.pin_y) {
        throw new Error("Click the page first");
      }
      body.pin_x = Number(body.pin_x);
      body.pin_y = Number(body.pin_y);
      if (!body.screenshot_url) {
        try {
          setFormStatus(form, "Capturing the pinned section...");
          const screenshotFile = await captureAnnotationSectionFile($("#clientAnnotationStage"), { pinX: body.pin_x, pinY: body.pin_y });
          body.screenshot_url = await upload(screenshotFile);
          setAnnotationScreenshotPreview(form, body.screenshot_url, screenshotFile.name);
        } catch (captureError) {
          console.warn("Could not auto-capture annotation screenshot", captureError);
        }
      }
      for (const file of Array.from(form.attachments?.files || [])) {
        body.attachments.push(await upload(file));
      }
      const annotation = {
        title: body.title,
        url: body.url,
        comment: body.comment,
        screenshot_url: body.screenshot_url,
        pin_x: body.pin_x,
        pin_y: body.pin_y,
        page_width: body.page_width,
        page_height: body.page_height,
        attachments: body.attachments,
        assignee_ids: body.assignee_ids,
        status: body.status || "todo",
      };
      if (!currentClientAnnotationTask?.id) {
        body.annotations = [annotation];
        const created = await api(`/api/client-tabs/${selectedTab.id}/tasks`, { method: "POST", body: JSON.stringify(body) });
        if (created.task?.id) {
          currentClientAnnotationTask = created.task;
          currentClientAnnotationItems = clientTaskAnnotationItems(created.task);
          clientAnnotationTasks.unshift(created.task);
          clientAnnotationTasksByID[created.task.id] = created.task;
        }
      } else {
        const annotations = [...currentClientAnnotationItems, annotation];
        await api(`/api/client-tasks/${currentClientAnnotationTask.id}`, { method: "PATCH", body: JSON.stringify({ annotations, page_width: body.page_width, page_height: body.page_height }) });
        const latest = await api(`/api/client-tasks/${currentClientAnnotationTask.id}`);
        currentClientAnnotationTask = latest.task || currentClientAnnotationTask;
        currentClientAnnotationItems = clientTaskAnnotationItems(currentClientAnnotationTask);
        clientAnnotationTasksByID[currentClientAnnotationTask.id] = currentClientAnnotationTask;
      }
      clientAnnotationDirty = true;
      form.reset();
      form.elements.url.value = currentClientAnnotationURL;
      form.elements.page_width.value = currentClientAnnotationPageWidth;
      form.elements.page_height.value = currentClientAnnotationPageHeight;
      form.elements.pin_x.value = "";
      form.elements.pin_y.value = "";
      setAnnotationScreenshotPreview(form, "");
      $("#clientAnnotationCoordLabel").value = "";
      renderClientAnnotationList();
      renderClientAnnotationPins();
      setFormStatus(form, currentClientAnnotationTask?.id ? "Annotation saved to this task." : "Annotation created.");
    } catch (error) {
      setFormStatus(form, error.message, true);
    } finally {
      stopLoading();
    }
  });
  document.querySelectorAll("[data-auto-client-task-status]").forEach((btn) => btn.addEventListener("click", async () => {
    await api(`/api/client-tasks/${btn.dataset.autoClientTaskStatus}`, { method: "PATCH", body: JSON.stringify({ status: btn.dataset.statusOption }) });
    renderClientWebsite(clientID, websiteID);
  }));
  document.querySelectorAll("[data-due-calendar]").forEach((btn) => btn.addEventListener("click", () => showDueDateCalendar(btn.dataset.dueCalendar)));
  document.querySelectorAll("[data-open-client-task]").forEach((btn) => btn.addEventListener("click", () => openClientTaskWithProgress(btn.dataset.openClientTask, "", btn)));
  document.querySelectorAll("[data-delete-client-task]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!confirm("Delete this task?")) return;
    await api(`/api/client-tasks/${btn.dataset.deleteClientTask}`, { method: "DELETE" });
    renderClientWebsite(clientID, websiteID);
  }));
  document.querySelectorAll("[data-delete-client-doc]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!confirm("Delete this document?")) return;
    await api(`/api/client-documents/${btn.dataset.deleteClientDoc}`, { method: "DELETE" });
    renderClientWebsite(clientID, websiteID);
  }));
  document.querySelectorAll("[data-delete-client-tab]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!confirm("Delete this tab and its tasks?")) return;
    await api(`/api/client-tabs/${btn.dataset.deleteClientTab}`, { method: "DELETE" });
    renderClientWebsite(clientID, websiteID);
  }));
  bindClientTaskTypeToggle($("#clientTaskForm"));
  bindAssigneePickers(app);
  bindStatusPickers(app);
  if (canManageStatuses) {
    bindStatusAddControls(app, selectedTab, data.tasks || [], async () => {
      renderClientWebsite(clientID, websiteID);
    });
    bindClientStatusColumnSort(app, selectedTab, data.tasks || [], canManageStatuses, async () => {
      renderClientWebsite(clientID, websiteID);
    });
  }
  bindClientBoardDrag(app, async () => {
    renderClientWebsite(clientID, websiteID);
  });
  bindRichEditors(app);
  bindChecklistBuilders(app);
  bindContentBlockEditors(app);
  bindRecurrenceControls(app);
  bindAttachmentOpeners(app);
  bindDialogCloseButtons();
  bindMentionSuggestions(app);
  bindAnnotationSidebarToggles(app);
  if (autoOpenAnnotation) {
    const url = new URL(location.href);
    url.searchParams.delete("new");
    history.replaceState(null, "", `${url.pathname}${url.search}`);
    setTimeout(() => $("#chooseAnnotationTask")?.click(), 0);
  }
  icons();
}

function assignedIndexByID(items = []) {
  return Object.fromEntries((items || []).map((item) => [item.id, item]).filter(([id]) => id));
}

function assignedTaskDueBucket(task = {}) {
  const due = parseLocalDate(taskDueInfo(task).date || task.due_date);
  if (!due) return "no_due";
  const today = todayLocalDate();
  if (due < today) return "overdue";
  if (due.getTime() === today.getTime()) return "today";
  if (due <= addDays(today, 7)) return "next7";
  return "later";
}

function assignedTaskStatus(task = {}, tab = {}) {
  const statuses = clientTaskStatuses(tab, [task]);
  return statuses.find((item) => item.value === (task.status || "todo")) || statuses[0] || { value: "todo", label: "To do" };
}

function assignedTaskStatusOptions(tasks = [], tabsByID = {}) {
  const options = new Map();
  (tasks || []).forEach((task) => {
    const status = assignedTaskStatus(task, tabsByID[task.tab_id] || {});
    if (status.value && !options.has(status.value)) options.set(status.value, status.label);
  });
  return Array.from(options.entries()).sort((a, b) => a[1].localeCompare(b[1]));
}

function assignedTaskBoardTabsByWebsite(tabs = []) {
  const byWebsite = {};
  (tabs || []).forEach((tab) => {
    if (tab.type !== "task_board" || !tab.website_id || byWebsite[tab.website_id]) return;
    byWebsite[tab.website_id] = tab;
  });
  return byWebsite;
}

function taskReportPDFURL(params = {}, options = {}) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (String(value || "").trim()) query.set(key, value);
  });
  if (!query.has("period")) query.set("period", "all");
  if (options.includeToken !== false && state.access) query.set("token", state.access);
  return `/api/reports/tasks/export.pdf?${query.toString()}`;
}

function taskReportPreviewURL(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (String(value || "").trim()) query.set(key, value);
  });
  if (!query.has("period")) query.set("period", "all");
  return `/api/reports/tasks/preview?${query.toString()}`;
}

function taskReportLinkHTML(params, label, className = "") {
  return `<a class="${esc(className || "btn compact")}" href="${esc(taskReportPDFURL(params))}" target="_blank" rel="noopener" title="${esc(label)}">${icon("file-down")}${esc(label)}</a>`;
}

function clientTaskTransferURL(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (String(value || "").trim()) query.set(key, value);
  });
  if (state.access) query.set("token", state.access);
  return `/api/client-tasks/export.json?${query.toString()}`;
}

function clientTaskImportURL(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (String(value || "").trim()) query.set(key, value);
  });
  const suffix = query.toString();
  return `/api/client-tasks/import${suffix ? `?${suffix}` : ""}`;
}

function clientTaskTransferLinkHTML(params, label, className = "") {
  return `<a class="${esc(className || "btn compact")}" href="${esc(clientTaskTransferURL(params))}" target="_blank" rel="noopener" title="${esc(label)}">${icon("download")}${esc(label)}</a>`;
}

function clientTaskImportButtonHTML(params, label, className = "") {
  return `<button class="${esc(className || "btn compact")}" type="button"
    data-import-client-tasks
    data-import-client-id="${esc(params?.client_id || "")}"
    data-import-website-id="${esc(params?.website_id || "")}"
    title="${esc(label)}">${icon("upload")}${esc(label)}</button>`;
}

function assignedTaskRowHTML(task, context) {
  const client = context.clientsByID[task.client_id] || {};
  const website = context.websitesByID[task.website_id] || {};
  const tab = context.tabsByID[task.tab_id] || {};
  const status = assignedTaskStatus(task, tab);
  const dueInfo = taskDueInfo(task);
  const dueBucket = assignedTaskDueBucket(task);
  const dueText = dueInfo.date || task.due_date ? fmtDate(dueInfo.date || task.due_date) : "No due date";
  const categoryLabel = task.type === "annotation" ? "Annotation" : "Description";
  const searchText = [
    task.title,
    task.type,
    client.name,
    website.name,
    website.url,
    tab.title,
    status.label,
    dueInfo.text,
    fmtDateTime(task.created_at),
  ].filter(Boolean).join(" ").toLowerCase();
  return `<div class="assigned-task-row"
      data-assigned-task
      data-client-id="${esc(task.client_id || "")}"
      data-website-id="${esc(task.website_id || "")}"
      data-status="${esc(status.value || "")}"
      data-due-bucket="${esc(dueBucket)}"
      data-search="${esc(searchText)}">
    <button class="assigned-task-open" type="button" data-open-client-task="${esc(task.id)}">
      <span class="assigned-task-title" title="${esc(compactClientTaskTitle(task.title) || "Untitled task")}">
        <strong>${esc(compactClientTaskTitle(task.title) || "Untitled task")}</strong>
      </span>
      <time>${esc(fmtDateTime(task.created_at))}</time>
      <span class="assigned-task-due ${dueBucket === "overdue" ? "overdue" : ""}">${icon("calendar-days")}${esc(dueText)}</span>
      <span class="assigned-task-assignees">${assigneeAvatarsHTML(task.assignee_ids || [], context.usersByID) || `<span class="muted">Unassigned</span>`}</span>
      <span class="assigned-task-category">${icon(task.type === "annotation" ? "map-pin" : "file-text")}${esc(categoryLabel)}</span>
    </button>
    <span class="assigned-transfer-icons">
      <a class="assigned-export-icon" href="${esc(clientTaskTransferURL({ scope: "task", task_id: task.id }))}" target="_blank" rel="noopener" title="Export this task JSON" aria-label="Export this task JSON">${icon("download")}</a>
      <button class="assigned-export-icon" type="button" data-import-client-tasks data-import-website-id="${esc(task.website_id || "")}" title="Import task JSON into this domain" aria-label="Import task JSON into this domain">${icon("upload")}</button>
    </span>
  </div>`;
}

function assignedInlineTaskFormHTML(client, website, tab, context) {
  if (!context.canCreate) return "";
  if (!tab?.id) {
    return `<div class="assigned-domain-actions"><button class="btn compact" type="button" disabled title="Create a task board tab on this domain first">${icon("plus")}Add task</button><button class="btn compact" type="button" disabled title="Create a task board tab on this domain first">${icon("map-pin")}Add Annotation</button></div>`;
  }
  const statuses = clientTaskStatuses(tab, []);
  const defaultStatus = statuses[0]?.value || "todo";
  const selectedAssignees = context.assignedOnly && state.me?.id ? [state.me.id] : [];
  const formID = `inlineTaskForm-${website.id}`;
  return `<div class="assigned-domain-actions">
    <button class="btn compact" type="button" data-show-inline-task="${esc(formID)}">${icon("plus")}Add task</button>
    <button class="btn compact" type="button" data-start-domain-annotation data-client-id="${esc(client.id || "")}" data-website-id="${esc(website.id || "")}" data-tab-id="${esc(tab.id)}">${icon("map-pin")}Add Annotation</button>
  </div>
  <form class="assigned-inline-task-form" id="${esc(formID)}" data-inline-domain-task-form data-tab-id="${esc(tab.id)}" hidden>
    <input type="hidden" name="status" value="${esc(defaultStatus)}">
    <input name="title" maxlength="80" placeholder="Task title" required>
    <input type="date" name="due_date" aria-label="Due date">
    ${assigneePickerHTML(context.memberEntries || [], selectedAssignees)}
    <button class="btn primary compact" type="submit">${icon("save")}Create</button>
    <button class="btn compact" type="button" data-cancel-inline-task="${esc(formID)}">Cancel</button>
    <p class="status-line"></p>
  </form>`;
}

function assignedTaskGroupsHTML(tasks = [], context) {
  const groups = new Map();
  const ensureClientGroup = (client) => {
    if (!groups.has(client.id)) groups.set(client.id, { client, websites: new Map(), count: 0 });
    return groups.get(client.id);
  };
  const ensureDomainGroup = (client, website) => {
    const clientGroup = ensureClientGroup(client);
    if (!clientGroup.websites.has(website.id)) clientGroup.websites.set(website.id, { website, tasks: [] });
    return clientGroup.websites.get(website.id);
  };
  (context.clients || []).forEach((client) => ensureClientGroup(client));
  (context.websites || []).forEach((website) => {
    const client = context.clientsByID[website.client_id] || { id: website.client_id, name: "Unknown folder" };
    ensureDomainGroup(client, website);
  });
  tasks.forEach((task) => {
    const client = context.clientsByID[task.client_id] || { id: task.client_id, name: "Unknown folder" };
    const website = context.websitesByID[task.website_id] || { id: task.website_id, client_id: task.client_id, name: "Unknown domain" };
    const clientGroup = ensureClientGroup(client);
    ensureDomainGroup(client, website).tasks.push(task);
    clientGroup.count += 1;
  });
  if (!groups.size) {
    return context.assignedOnly
      ? `<section class="panel empty-state"><h2>No assigned tasks yet</h2><p class="muted">Tasks assigned to you from domain boards will show here.</p></section>`
      : `<section class="panel empty-state"><h2>No tasks yet</h2><p class="muted">Domain tasks will show here.</p></section>`;
  }
  return `<div class="assigned-task-groups">
    ${Array.from(groups.values()).map((clientGroup) => `<section class="assigned-client-group" data-assigned-client-group>
      <div class="assigned-client-heading-row">
        <button class="assigned-client-heading" type="button" data-toggle-task-folder aria-expanded="true">
          <div><span data-toggle-icon>${icon("chevron-down")}</span>${icon("folder")}<strong>${esc(clientGroup.client.name || "Client folder")}</strong></div>
          <span class="pill">${clientGroup.count} ${clientGroup.count === 1 ? "task" : "tasks"}</span>
        </button>
        <div class="assigned-transfer-actions">
          ${clientTaskTransferLinkHTML({ scope: "client", client_id: clientGroup.client.id }, "Export", "btn compact assigned-export-link")}
          ${clientTaskImportButtonHTML({ client_id: clientGroup.client.id }, "Import", "btn compact assigned-export-link")}
        </div>
      </div>
      <div class="assigned-domain-list" data-task-folder-body>
        ${Array.from(clientGroup.websites.values()).map((domainGroup) => {
          const website = domainGroup.website;
          const tab = context.taskBoardTabsByWebsiteID[website.id] || null;
          const domainSearch = [clientGroup.client.name, website.name, website.url].filter(Boolean).join(" ").toLowerCase();
          return `<section class="assigned-domain-group" data-assigned-domain-group data-client-id="${esc(clientGroup.client.id || "")}" data-website-id="${esc(website.id || "")}" data-search="${esc(domainSearch)}">
          <div class="assigned-domain-heading-row">
            <button class="assigned-domain-heading" type="button" data-toggle-task-domain aria-expanded="true">
              <div><span data-toggle-icon>${icon("chevron-down")}</span>${icon("globe-2")}<strong>${esc(website.name || "Domain")}</strong>${website.url ? `<span>${esc(website.url)}</span>` : ""}</div>
              <span class="muted">${domainGroup.tasks.length} ${domainGroup.tasks.length === 1 ? "task" : "tasks"}</span>
            </button>
            <div class="assigned-transfer-actions">
              ${clientTaskTransferLinkHTML({ scope: "domain", client_id: clientGroup.client.id, website_id: website.id }, "Export", "btn compact assigned-export-link")}
              ${clientTaskImportButtonHTML({ website_id: website.id }, "Import", "btn compact assigned-export-link")}
            </div>
          </div>
          <div class="assigned-domain-content" data-task-domain-body>
            <div class="assigned-domain-tasks">${domainGroup.tasks.map((task) => assignedTaskRowHTML(task, context)).join("") || `<p class="assigned-domain-empty muted">No tasks yet.</p>`}</div>
            ${assignedInlineTaskFormHTML(clientGroup.client, website, tab, context)}
          </div>
        </section>`;
        }).join("")}
      </div>
    </section>`).join("")}
    <section id="assignedNoResults" class="panel empty-state" hidden><h2>No matching tasks</h2><p class="muted">Try a different folder, domain, status, due date, or search term.</p></section>
  </div>`;
}

function bindAssignedTaskFilters() {
  const rows = Array.from(document.querySelectorAll("[data-assigned-task]"));
  const filters = Array.from(document.querySelectorAll("[data-assigned-filter]"));
  const search = document.querySelector("[data-assigned-search]");
  const noResults = $("#assignedNoResults");
  const valueFor = (name) => document.querySelector(`[data-assigned-filter="${name}"]`)?.value || "";
  const apply = () => {
    const clientID = valueFor("client");
    const websiteID = valueFor("website");
    const status = valueFor("status");
    const due = valueFor("due");
    const query = String(search?.value || "").trim().toLowerCase();
    let visibleCount = 0;
    rows.forEach((row) => {
      const dueBucket = row.dataset.dueBucket || "";
      const dueMatches = !due || dueBucket === due || (due === "next7" && (dueBucket === "today" || dueBucket === "next7"));
      const visible = (!clientID || row.dataset.clientId === clientID)
        && (!websiteID || row.dataset.websiteId === websiteID)
        && (!status || row.dataset.status === status)
        && dueMatches
        && (!query || (row.dataset.search || "").includes(query));
      row.hidden = !visible;
      if (visible) visibleCount += 1;
    });
    let visibleDomainCount = 0;
    document.querySelectorAll("[data-assigned-domain-group]").forEach((group) => {
      const domainRows = Array.from(group.querySelectorAll("[data-assigned-task]"));
      const hasVisibleTask = Boolean(group.querySelector("[data-assigned-task]:not([hidden])"));
      const domainMatches = (!clientID || group.dataset.clientId === clientID)
        && (!websiteID || group.dataset.websiteId === websiteID)
        && (!query || (group.dataset.search || "").includes(query));
      const taskOnlyFiltersActive = Boolean(status || due);
      group.hidden = domainRows.length ? !hasVisibleTask : !(domainMatches && !taskOnlyFiltersActive);
      if (!group.hidden) visibleDomainCount += 1;
    });
    document.querySelectorAll("[data-assigned-client-group]").forEach((group) => {
      group.hidden = !group.querySelector("[data-assigned-domain-group]:not([hidden])");
    });
    if (noResults) noResults.hidden = visibleCount !== 0 || visibleDomainCount !== 0;
  };
  filters.forEach((filter) => filter.addEventListener("change", apply));
  search?.addEventListener("input", apply);
  apply();
}

function bindAssignedTaskCollapsers() {
  document.querySelectorAll("[data-toggle-task-folder]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const group = btn.closest("[data-assigned-client-group]");
      const body = group?.querySelector("[data-task-folder-body]");
      const expanded = btn.getAttribute("aria-expanded") !== "true";
      btn.setAttribute("aria-expanded", expanded ? "true" : "false");
      group?.classList.toggle("is-collapsed", !expanded);
      if (body) body.hidden = !expanded;
      const slot = btn.querySelector("[data-toggle-icon]");
      if (slot) slot.innerHTML = icon(expanded ? "chevron-down" : "chevron-right");
      icons();
    });
  });
  document.querySelectorAll("[data-toggle-task-domain]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const group = btn.closest("[data-assigned-domain-group]");
      const body = group?.querySelector("[data-task-domain-body]");
      const expanded = btn.getAttribute("aria-expanded") !== "true";
      btn.setAttribute("aria-expanded", expanded ? "true" : "false");
      group?.classList.toggle("is-collapsed", !expanded);
      if (body) body.hidden = !expanded;
      const slot = btn.querySelector("[data-toggle-icon]");
      if (slot) slot.innerHTML = icon(expanded ? "chevron-down" : "chevron-right");
      icons();
    });
  });
}

function bindAssignedTaskCreation() {
  document.querySelectorAll("[data-show-inline-task]").forEach((btn) => btn.addEventListener("click", () => {
    const form = document.getElementById(btn.dataset.showInlineTask);
    if (!form) return;
    form.hidden = false;
    form.querySelector("input[name='title']")?.focus();
  }));
  document.querySelectorAll("[data-cancel-inline-task]").forEach((btn) => btn.addEventListener("click", () => {
    const form = document.getElementById(btn.dataset.cancelInlineTask);
    if (!form) return;
    form.reset();
    form.hidden = true;
    form.querySelector(".status-line").textContent = "";
  }));
  document.querySelectorAll("[data-start-domain-annotation]").forEach((btn) => btn.addEventListener("click", () => {
    const clientID = btn.dataset.clientId;
    const websiteID = btn.dataset.websiteId;
    const tabID = btn.dataset.tabId;
    if (!clientID || !websiteID || !tabID) return;
    const returnTo = encodeURIComponent(`${location.pathname}${location.search}`);
    window.location.href = `/projects/${clientID}/sites/${websiteID}?tab=${tabID}&new=annotation&return=${returnTo}`;
  }));
  document.querySelectorAll("[data-inline-domain-task-form]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const stopLoading = beginFormLoading(form, event.submitter, "Creating task...", "Creating...");
    try {
      const body = {
        type: "description",
        title: form.elements.title.value,
        status: form.elements.status.value,
        due_date: form.elements.due_date.value,
        assignee_ids: selectedAssigneeIDs(form),
        blocks: [],
        content: "",
      };
      await api(`/api/client-tabs/${form.dataset.tabId}/tasks`, { method: "POST", body: JSON.stringify(body) });
      renderTasks();
    } catch (error) {
      setFormStatus(form, error.message, true);
    } finally {
      stopLoading();
    }
  }));
}

function bindClientTaskTransferControls() {
  document.querySelectorAll("[data-import-client-tasks]").forEach((btn) => btn.addEventListener("click", () => {
    const params = {};
    if (btn.dataset.importClientId) params.client_id = btn.dataset.importClientId;
    if (btn.dataset.importWebsiteId) params.website_id = btn.dataset.importWebsiteId;
    openClientTaskImportPicker(params);
  }));
}

function openClientTaskImportPicker(params = {}) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      const result = await api(clientTaskImportURL(params), { method: "POST", body: JSON.stringify(bundle) });
      await renderTasks();
      setStatus(`Imported ${result.imported || 0} tasks.`);
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      input.remove();
    }
  }, { once: true });
  document.body.appendChild(input);
  input.click();
}

async function renderTasks(projectID = "") {
  const routeParams = new URLSearchParams(location.search);
  const view = routeParams.get("view") || "all";
  const assignedOnly = view === "assigned";
  const data = await api(`/api/client-tasks/assigned${assignedOnly ? "?scope=assigned" : ""}`);
  state.liveTaskSignature = taskListLiveSignature(data);
  const tasks = data.tasks || [];
  const clients = data.clients || [];
  const websites = data.websites || [];
  const tabs = data.tabs || [];
  const canCreate = Boolean(data.can_create_tasks);
  const clientsByID = assignedIndexByID(clients);
  const websitesByID = assignedIndexByID(websites);
  const tabsByID = assignedIndexByID(tabs);
  const usersByID = clientTaskUsersByID(data.members || []);
  const taskBoardTabsByWebsiteID = assignedTaskBoardTabsByWebsite(tabs);
  const initialSearch = routeParams.get("search") || "";
  const statusOptions = assignedTaskStatusOptions(tasks, tabsByID);
  const context = { clients, websites, tabs, clientsByID, websitesByID, tabsByID, usersByID, taskBoardTabsByWebsiteID, memberEntries: data.members || [], canCreate, assignedOnly };
  const pageTitle = assignedOnly ? "Assigned to me" : "Tasks";
  shell(pageTitle, `
    <div class="page-title assigned-task-page-title">
      <div><h1>${esc(pageTitle)}</h1><p class="muted">${assignedOnly ? "Tasks assigned to you, grouped by project folder and domain." : "All tasks you can access, grouped by project folder and domain."}</p><p class="status-line assigned-transfer-status"></p></div>
      <div class="assigned-task-filters">
        ${clientTaskTransferLinkHTML({ scope: assignedOnly ? "assigned" : "all" }, assignedOnly ? "Export assigned" : "Export all", "btn compact assigned-page-export")}
        ${clientTaskImportButtonHTML({}, "Import", "btn compact assigned-page-export")}
        <label><span>Folder</span><select data-assigned-filter="client"><option value="">All folders</option>${clients.map((client) => `<option value="${esc(client.id)}">${esc(client.name)}</option>`).join("")}</select></label>
        <label><span>Domain</span><select data-assigned-filter="website"><option value="">All domains</option>${websites.map((website) => `<option value="${esc(website.id)}">${esc(website.name)}</option>`).join("")}</select></label>
        <label><span>Status</span><select data-assigned-filter="status"><option value="">All statuses</option>${statusOptions.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join("")}</select></label>
        <label><span>Due date</span><select data-assigned-filter="due"><option value="">Any due date</option><option value="overdue">Overdue</option><option value="today">Today</option><option value="next7">Next 7 days</option><option value="later">Later</option><option value="no_due">No due date</option></select></label>
        <label class="assigned-search"><span>Search</span><input type="search" data-assigned-search placeholder="Search tasks" value="${esc(initialSearch)}"></label>
      </div>
    </div>
    ${assignedTaskGroupsHTML(tasks, context)}`);
  bindAssignedTaskFilters();
  bindAssignedTaskCollapsers();
  bindAssignedTaskCreation();
  bindClientTaskTransferControls();
  bindAssigneePickers(app);
  document.querySelectorAll("[data-open-client-task]").forEach((btn) => btn.addEventListener("click", () => openClientTaskWithProgress(btn.dataset.openClientTask, "", btn)));
  icons();
  const openTaskID = routeParams.get("task_id") || "";
  const openCommentID = routeParams.get("comment_id") || "";
  if (openTaskID) {
    setTimeout(async () => {
      if (openCommentID) {
        const readData = await api(`/api/client-task-comments/${openCommentID}/read`, { method: "POST", body: JSON.stringify({}) }).catch(() => ({}));
        if (readData.unread_count !== undefined) updateInboxBadge(readData.unread_count);
      }
      await openClientTaskWithProgress(openTaskID, openCommentID);
    }, 0);
  }
}

function renderTaskView(view, tasks, list) {
  if (view === "board") {
    const statuses = list?.statuses || ["To Do", "In Progress", "Done"];
    return `<div class="kanban">${statuses.map((status) => `
      <section class="kanban-column" data-status="${esc(status)}">
        <h3>${esc(status)}</h3>
        ${tasks.filter((task) => task.status === status).map(taskCard).join("")}
      </section>`).join("")}</div>`;
  }
  if (view === "calendar") {
    const days = Array.from({ length: 21 }, (_, i) => {
      const day = new Date();
      day.setDate(day.getDate() + i);
      const iso = day.toISOString().slice(0, 10);
      const due = tasks.filter((task) => (task.due_date || "").startsWith(iso));
      return `<div class="calendar-day"><strong>${day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</strong>${due.map((task) => `<p class="pill">${esc(task.title)}</p>`).join("")}</div>`;
    });
    return `<div class="calendar-grid">${days.join("")}</div>`;
  }
  return `<div class="task-list">${taskRows(tasks)}</div>`;
}

function taskCard(task) {
  return `<article class="task-card" draggable="true" data-task-id="${task.id}">
    <strong>${esc(task.title)}</strong>
    <p class="muted">${esc(task.priority)} ${task.due_date ? " · " + fmtDate(task.due_date) : ""}</p>
    <button class="btn" data-start-timer="${task.id}">${icon("play")}Start</button>
  </article>`;
}

function bindTaskActions() {
  document.querySelectorAll("[data-start-timer]").forEach((btn) => btn.addEventListener("click", async () => {
    await api("/api/time-entries/start", { method: "POST", body: JSON.stringify({ task_id: btn.dataset.startTimer }) });
    refreshTimerWidget();
  }));
}

function bindTaskComments() {
  document.querySelectorAll("[data-task-comment]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = form.content;
    const content = input.value.trim();
    if (!content) return;
    try {
      await api(`/api/tasks/${form.dataset.taskComment}/comments`, { method: "POST", body: JSON.stringify({ content }) });
      input.value = "";
      route();
    } catch (error) {
      setStatus(error.message, true);
    }
  }));
}

function showTaskDetailDialog(data, activeCommentID = "") {
  const task = data.task || {};
  const project = data.project || {};
  const list = data.list || {};
  const usersByID = Object.fromEntries((data.users || []).map((user) => [user.id, user]));
  let dialog = $("#taskDetailDialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "taskDetailDialog";
    dialog.className = "task-detail-modal";
    document.body.appendChild(dialog);
  }
  dialog.dataset.liveTaskId = task.id || "";
  dialog.dataset.liveCommentId = activeCommentID || "";
  dialog.dataset.liveSignature = liveStableString({ task });
  const comments = task.comments || [];
  dialog.innerHTML = `
    <div class="task-detail-shell">
      <header class="task-detail-head">
        <div>
          <span class="muted">${esc(project.name || "Project")}${list.name ? " / " + esc(list.name) : ""}</span>
          <h2>${esc(task.title || "Untitled task")}</h2>
        </div>
        <button class="btn icon quiet" type="button" data-close-task-detail title="Close">${icon("x")}</button>
      </header>
      <div class="task-detail-body">
        <section class="task-detail-main">
          <div class="task-detail-meta">
            <span class="pill">${esc(task.status || "To Do")}</span>
            <span class="priority-flag ${String(task.priority || "normal").toLowerCase()}">${icon("flag")}${esc(task.priority || "Normal")}</span>
            ${task.due_date ? `<span class="pill warn">${icon("calendar-days")}${esc(fmtDate(task.due_date))}</span>` : ""}
          </div>
          <h3>Description</h3>
          <p>${mentionText(task.description || "No description yet.")}</p>
          <h3>Comments</h3>
          <div class="detail-comment-list">
            ${comments.length ? comments.map((comment) => {
              const author = usersByID[comment.author_id] || {};
              const authorName = author.name || author.username || "Someone";
              return `<article class="detail-comment ${String(comment.id) === String(activeCommentID) ? "active" : ""}">
                <span class="avatar-dot">${esc(authorName.slice(0, 1).toUpperCase())}</span>
                <div>
                  <div class="detail-comment-head"><strong>${esc(authorName)}</strong><time>${inboxTime(comment.created_at)}</time></div>
                  <p>${mentionText(comment.content || "")}</p>
                </div>
              </article>`;
            }).join("") : `<p class="muted">No comments yet.</p>`}
          </div>
          <form class="inline-comment detail-comment-form" data-detail-task-comment="${esc(task.id)}">
            <input name="content" data-mentionable placeholder="Comment @username">
            <button class="btn icon primary" title="Add comment">${icon("send")}</button>
          </form>
        </section>
      </div>
    </div>`;
  dialog.querySelector("[data-close-task-detail]")?.addEventListener("click", () => dialog.close());
  dialog.onclick = (event) => {
    if (event.target === dialog) dialog.close();
  };
  dialog.querySelector("[data-detail-task-comment]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const content = form.content.value.trim();
    if (!content) return;
    try {
      const created = await api(`/api/tasks/${form.dataset.detailTaskComment}/comments`, { method: "POST", body: JSON.stringify({ content }) });
      const refreshed = await api(`/api/tasks/${form.dataset.detailTaskComment}`);
      showTaskDetailDialog(refreshed, created.comment?.id || "");
    } catch (error) {
      setStatus(error.message, true);
    }
  });
  bindMentionSuggestions(dialog);
  icons();
  if (!dialog.open) dialog.showModal();
}

function bindBoardDrag(list) {
  document.querySelectorAll(".kanban-column").forEach((column) => {
    if (window.Sortable) {
      Sortable.create(column, {
        group: "tasks",
        animation: 150,
        draggable: ".task-card",
        onAdd: async (event) => {
          await api(`/api/tasks/${event.item.dataset.taskId}`, { method: "PATCH", body: JSON.stringify({ status: column.dataset.status }) });
        },
      });
    }
  });
}

async function renderWebsites() {
  const data = await api("/api/websites");
  const websites = data.websites || [];
  shell("Websites", `
    <div class="page-title"><div><h1>Websites</h1><p class="muted">Tracked sites and screenshot feedback boards.</p></div></div>
    <div class="grid-2">
      <section class="panel">
        <h2>Add website</h2>
        <form id="websiteForm" class="form-grid">
          <div class="field"><label>Name</label><input name="name" required></div>
          <div class="field"><label>URL</label><input name="url" placeholder="https://example.com" required></div>
          <div class="field"><label>Mode</label><select name="embed_mode"><option value="iframe">Iframe</option><option value="screenshot">Screenshot</option></select></div>
          <div class="field"><label>Screenshot</label><input type="file" name="screenshot" accept="image/*"></div>
          <button class="btn primary" type="submit">${icon("plus")}Add</button>
          <p class="status-line"></p>
        </form>
      </section>
      <section class="website-grid">${websites.map((site) => `<article class="panel"><h3>${esc(site.name)}</h3><p class="muted">${esc(site.url)}</p><span class="pill">${esc(site.embed_mode)}</span><p><a class="btn primary" href="/websites/${site.id}/annotate">${icon("map-pin")}Annotate</a></p></article>`).join("") || `<p class="muted">No websites yet.</p>`}</section>
    </div>`);
  $("#websiteForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const formEl = event.currentTarget;
      const values = Object.fromEntries(new FormData(formEl).entries());
      const file = formEl.screenshot.files[0];
      if (file) values.screenshot_url = await upload(file);
      delete values.screenshot;
      await api("/api/websites", { method: "POST", body: JSON.stringify(values) });
      renderWebsites();
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

async function upload(file) {
  const body = new FormData();
  body.append("file", file);
  const data = await api("/api/uploads", { method: "POST", body });
  return data.url;
}

async function renderAnnotate(id) {
  const site = (await api(`/api/websites/${id}`)).website;
  const bugs = (await api(`/api/websites/${id}/bugs`)).bugs || [];
  const teamData = site.team_id ? await api(`/api/teams/${site.team_id}`).catch(() => ({ members: [] })) : { members: [] };
  const members = teamData.members || [];
  const memberEntries = feedbackMemberEntries(members.length ? members : [state.me].filter(Boolean));
  const usersByID = Object.fromEntries([...(members || []), state.me].filter((user) => user?.id).map((user) => [user.id, user]));
  const statuses = feedbackTaskStatuses(bugs);
  const bugsByID = Object.fromEntries(bugs.map((bug) => [bug.id, bug]));
  shell(site.name, `
    <div class="annotate-layout">
      <section class="annotation-stage" id="annotationStage">
        ${annotationFrameHTML({
          url: site.url,
          imageURL: site.embed_mode === "screenshot" ? site.screenshot_url : "",
          title: site.name,
          catcherID: "clickCatcher",
          pinLayerID: "feedbackPinLayer",
          pins: bugs.map((bug, i) => ({ id: bug.id, x: bug.pin_x, y: bug.pin_y, label: String(i + 1), title: feedbackBugTitle(bug) })),
        })}
      </section>
      <aside class="bug-side feedback-side">
        <section class="feedback-sidebar-view" id="feedbackListView">
          <h2>Pin feedback</h2>
          <form id="bugForm" class="form-grid">
            <input type="hidden" name="pin_x">
            <input type="hidden" name="pin_y">
            <div class="field"><label>Title</label><input name="title" maxlength="80" required placeholder="Annotation title"></div>
            <div class="field"><label>Coordinates</label><input id="coordLabel" disabled></div>
            <div class="field"><label>Status</label>${statusPickerHTML(statuses, "todo", "status")}</div>
            <div class="field"><label>Assignee</label>${assigneePickerHTML(memberEntries)}</div>
            <div class="field"><label>Attachments</label><input type="file" name="attachments" multiple></div>
            <div class="field"><label>Details</label><textarea name="description" data-mentionable placeholder="Use @username to mention a teammate"></textarea></div>
            <button class="btn primary" type="submit">${icon("map-pin")}Save annotation</button>
            <p class="status-line"></p>
          </form>
          <hr>
          <div class="feedback-list">${feedbackBugRowsHTML(bugs, statuses, usersByID)}</div>
        </section>
        <section class="feedback-sidebar-view feedback-detail-view" id="feedbackDetailView" hidden>
          <div class="feedback-detail-toolbar">
            <button class="btn compact" type="button" id="feedbackBackBtn">${icon("arrow-left")}Back</button>
          </div>
          <div id="feedbackSidebarDetailBody"></div>
        </section>
      </aside>
    </div>`);
  const stage = $("#annotationStage");
  bindAnnotationViewportResize(stage);
  bindStatusPickers(app);
  bindAssigneePickers(app);
  const selectorForID = (value) => (window.CSS?.escape ? CSS.escape(value) : String(value).replace(/"/g, '\\"'));
  const syncFeedbackStatusControls = (bugID, value) => {
    const status = feedbackStatusObject(statuses, value);
    document.querySelectorAll(`[data-feedback-status-form="${selectorForID(bugID)}"]`).forEach((form) => {
      const input = form.querySelector("input[name='status']");
      const trigger = form.querySelector("[data-status-trigger]");
      const label = form.querySelector("[data-status-trigger-label]");
      if (input) input.value = status.value;
      if (label) label.textContent = status.label;
      trigger?.style.setProperty("--status-icon-color", status.icon_color);
      trigger?.style.setProperty("--status-text-color", status.text_color);
    });
  };
  const bindFeedbackStatusForms = (root = document) => {
    root.querySelectorAll("[data-feedback-status-form]").forEach((form) => {
      if (form.dataset.feedbackStatusBound === "1") return;
      form.dataset.feedbackStatusBound = "1";
      form.addEventListener("change", async (event) => {
        if (!event.target.matches("input[name='status']")) return;
        const bugID = form.dataset.feedbackStatusForm;
        const status = feedbackStatusValue(event.target.value);
        try {
          await api(`/api/bugs/${bugID}`, { method: "PATCH", body: JSON.stringify({ status, severity: status }) });
          if (bugsByID[bugID]) {
            bugsByID[bugID].status = status;
            bugsByID[bugID].severity = status;
          }
          syncFeedbackStatusControls(bugID, status);
          setStatus("Annotation status updated.");
        } catch (error) {
          setStatus(error.message, true);
        }
      });
    });
  };
  const renderFeedbackDetail = (bugID) => {
    const bug = bugsByID[bugID];
    const body = $("#feedbackSidebarDetailBody");
    const detailView = $("#feedbackDetailView");
    const listView = $("#feedbackListView");
    if (!bug || !body || !detailView || !listView) return;
    body.innerHTML = feedbackBugDetailHTML(bug, statuses, usersByID);
    listView.hidden = true;
    detailView.hidden = false;
    bindStatusPickers(detailView);
    bindFeedbackStatusForms(detailView);
    bindAttachmentOpeners(detailView);
    bindMentionSuggestions(detailView);
    bindFeedbackCommentForm(detailView, bugID);
    icons();
  };
  const bindFeedbackCommentForm = (root, bugID) => {
    const form = root.querySelector(`[data-feedback-comment-form="${selectorForID(bugID)}"]`);
    if (!form || form.dataset.feedbackCommentBound === "1") return;
    form.dataset.feedbackCommentBound = "1";
    const textarea = form.elements.comment;
    const attachmentInput = form.elements.attachment;
    const preview = form.querySelector("[data-feedback-attachment-preview]");
    form.querySelector("[data-feedback-comment-emoji]")?.addEventListener("click", (event) => openEmojiPicker(event.currentTarget, textarea));
    form.querySelector("[data-feedback-comment-attach]")?.addEventListener("click", () => attachmentInput?.click());
    attachmentInput?.addEventListener("change", () => {
      const file = attachmentInput.files?.[0];
      if (!file || !preview) return;
      const isImage = file.type.startsWith("image/");
      const localURL = isImage ? URL.createObjectURL(file) : "";
      preview.hidden = false;
      preview.innerHTML = `<span>${localURL ? `<img class="attachment-preview-mini" src="${esc(localURL)}" alt="${esc(file.name)} preview">` : icon("paperclip")}${esc(file.name)}</span><button class="btn icon quiet" type="button" data-clear-feedback-attachment>${icon("x")}</button>`;
      preview.querySelector("[data-clear-feedback-attachment]")?.addEventListener("click", () => {
        attachmentInput.value = "";
        preview.hidden = true;
        preview.innerHTML = "";
      });
      icons();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = form.querySelector("[type='submit']");
      const content = String(textarea?.value || "").trim();
      const file = attachmentInput?.files?.[0];
      if (!content && !file) {
        setFormStatus(form, "Comment or attachment is required.", true);
        return;
      }
      if (submit) submit.disabled = true;
      try {
        const payload = { comment: content, attachment_url: "", attachment_name: "" };
        if (file) {
          payload.attachment_url = await upload(file);
          payload.attachment_name = file.name;
        }
        await api(`/api/bugs/${bugID}`, { method: "PATCH", body: JSON.stringify(payload) });
        const bug = bugsByID[bugID];
        if (bug) {
          bug.comments = [...(bug.comments || []), {
            id: `local-${Date.now()}`,
            author_id: state.me?.id,
            content,
            attachment_url: payload.attachment_url,
            attachment_name: payload.attachment_name,
            created_at: new Date().toISOString(),
          }];
        }
        renderFeedbackDetail(bugID);
      } catch (error) {
        setFormStatus(form, error.message, true);
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  };
  const renderPins = (extraPin = "") => {
    const viewport = stage?.querySelector("[data-annotation-viewport]");
    const targetWidth = Number(viewport?.dataset.annotationWidth || ANNOTATION_VIEWPORT.width);
    const targetHeight = Number(viewport?.dataset.annotationHeight || ANNOTATION_VIEWPORT.height);
    const layer = $("#feedbackPinLayer");
    if (layer) layer.innerHTML = `${bugs.map((bug, i) => annotationPinHTML({ id: bug.id, x: bug.pin_x, y: bug.pin_y, target_page_width: targetWidth, target_page_height: targetHeight, label: String(i + 1), title: feedbackBugTitle(bug) })).join("")}${extraPin}`;
  };
  bindAnnotationDeviceControls(stage, { onChange: () => renderPins() });
  const highlightFeedbackPin = (bugID) => {
    document.querySelectorAll("[data-feedback-pin]").forEach((pin) => {
      const active = pin.dataset.feedbackPin === bugID;
      pin.classList.toggle("highlighted", active);
      pin.classList.toggle("expanded", active);
    });
    const pin = document.querySelector(`[data-feedback-pin="${selectorForID(bugID)}"]`);
    pin?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  };
  const openFeedbackDetail = (bugID) => {
    const bug = bugsByID[bugID];
    if (!bug) return;
    highlightFeedbackPin(bugID);
    document.querySelectorAll("[data-feedback-row]").forEach((row) => row.classList.toggle("active", row.dataset.feedbackRow === bugID));
    renderFeedbackDetail(bugID);
  };
  $("#feedbackBackBtn")?.addEventListener("click", () => {
    $("#feedbackDetailView")?.setAttribute("hidden", "");
    $("#feedbackListView")?.removeAttribute("hidden");
    const body = $("#feedbackSidebarDetailBody");
    if (body) body.innerHTML = "";
    document.querySelectorAll("[data-feedback-pin]").forEach((pin) => pin.classList.remove("highlighted", "expanded"));
    document.querySelectorAll("[data-feedback-row]").forEach((row) => row.classList.remove("active"));
  });
  stage?.addEventListener("click", (event) => {
    const pin = event.target.closest("[data-feedback-pin]");
    if (pin) openFeedbackDetail(pin.dataset.feedbackPin);
  });
  $("#clickCatcher").addEventListener("click", (event) => {
    const viewport = event.currentTarget.closest("[data-annotation-viewport]");
    const { x, y } = annotationPointFromEvent(event, viewport);
    $("[name=pin_x]").value = x.toFixed(2);
    $("[name=pin_y]").value = y.toFixed(2);
    $("#coordLabel").value = `${x.toFixed(1)}%, ${y.toFixed(1)}%`;
    const targetWidth = Number(viewport?.dataset.annotationWidth || ANNOTATION_VIEWPORT.width);
    const targetHeight = Number(viewport?.dataset.annotationHeight || ANNOTATION_VIEWPORT.height);
    renderPins(annotationPinHTML({ x, y, target_page_width: targetWidth, target_page_height: targetHeight, label: String(bugs.length + 1), title: "New pin" }));
    icons();
  });
  $("#bugForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const submitBtn = formEl.querySelector("[type='submit']");
    try {
      if (!formEl.elements.pin_x.value) throw new Error("Click the page first");
      if (submitBtn) submitBtn.disabled = true;
      const files = Array.from(formEl.elements.attachments?.files || []);
      const attachments = [];
      for (const file of files) attachments.push(await upload(file));
      const status = formEl.elements.status.value || "todo";
      await api("/api/bugs", {
        method: "POST",
        body: JSON.stringify({
          website_id: id,
          pin_x: Number(formEl.elements.pin_x.value),
          pin_y: Number(formEl.elements.pin_y.value),
          page_url: site.url,
          title: formEl.elements.title.value,
          description: formEl.elements.description.value,
          status,
          severity: status,
          assignee_ids: selectedAssigneeIDs(formEl),
          attachments,
        }),
      });
      renderAnnotate(id);
    } catch (error) {
      setFormStatus(formEl, error.message, true);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
  document.querySelectorAll("[data-open-feedback-bug]").forEach((btn) => btn.addEventListener("click", () => openFeedbackDetail(btn.dataset.openFeedbackBug)));
  bindFeedbackStatusForms(app);
  const focusBugID = new URLSearchParams(window.location.search).get("bug_id") || "";
  if (focusBugID && bugsByID[focusBugID]) {
    setTimeout(() => openFeedbackDetail(focusBugID), 0);
  }
}

async function renderBilling() {
  const params = new URLSearchParams(location.search);
  const paymentState = params.get("payment") || "";
  const paymentMessage = params.get("message") || "";
  const paymentNotice = paymentState ? `<section class="panel soft-panel payment-result ${paymentState === "success" ? "success" : paymentState === "cancelled" ? "warn" : "danger"}">
    <strong>${paymentState === "success" ? "PayPal payment completed" : paymentState === "cancelled" ? "PayPal checkout cancelled" : "PayPal payment needs attention"}</strong>
    <span>${esc(paymentMessage || (paymentState === "success" ? "Your membership is active and the invoice is available below." : paymentState === "cancelled" ? "No payment was captured." : "No membership was activated."))}</span>
  </section>` : "";
  const plans = (await api("/api/subscriptions/plans")).plans || [];
  const membership = activeWorkspaceMembership();
  const billingTeamID = activeWorkspaceTeamID() || state.team?.id || state.personalTeam?.id || "";
  const invoices = billingTeamID ? ((await api(`/api/subscriptions/${billingTeamID}/invoices`)).invoices || []) : [];
  const paidMembership = currentMembershipIsPaid(membership);
  shell("Billing", `
    <div class="page-title"><div><h1>Billing</h1><p class="muted">${paidMembership ? "Membership details and receipts." : "Plans, trial state, approvals, and receipts."}</p></div></div>
    ${paymentNotice}
    ${paidMembership ? billingMembershipDetailsHTML(membership, plans) : `
      <section class="panel paywall-panel">
        <h2>${membership.status === "trialing" ? "Trial membership" : "Choose a package"}</h2>
        ${membership.status === "trialing" ? `<p class="muted">Your trial is active until ${esc(usefulBillingDate(membership.trial_ends_at) || "the trial expiry date")}. Upgrade when you are ready to keep access after the trial.</p>` : ""}
        ${pricingCardsHTML(plans)}
      </section>`}
    ${billingInvoicesPanelHTML(invoices, { className: "billing-page-invoices" })}`);
  if (!paidMembership) bindPurchaseButtons(renderBilling);
}

async function renderAdminLegacy() {
  const users = (await api("/api/admin/users")).users || [];
  shell("Admin", `
    <div class="page-title"><div><h1>Owner Admin</h1><p class="muted">Platform accounts, emails, settings, and pages.</p></div></div>
    <div class="toolbar"><a class="btn" href="/admin/settings">${icon("settings")}Settings</a><a class="btn" href="/admin/plans">${icon("badge-dollar-sign")}Plans</a><a class="btn" href="/admin/pages">${icon("file-pen")}Pages</a></div>
    <div class="grid-2">
      <section class="panel">
        <h2>Users</h2>
        <div class="task-list">
          ${users.map((u) => `
            <article class="task-row">
              <div>
                <h3>${esc(u.name)}</h3>
                <span class="muted">@${esc(u.username || "pending")} · ${esc(u.email)}</span>
              </div>
              <span class="pill">${esc(staffRoleLabel(u.staff_role) || u.role)}</span>
              <span class="pill ${u.status === "suspended" ? "danger" : u.status === "pending_approval" ? "warn" : ""}">${esc(u.status)}</span>
              <div class="toolbar">
                ${u.status === "pending_approval" ? `<button class="btn" data-approve-user="${u.id}">${icon("check")}Approve</button>` : ""}
                <button class="btn" data-edit-user="${u.id}">${icon("pencil")}Edit</button>
                <button class="btn" data-message-user="${u.id}">${icon("message-square")}Message</button>
                <button class="btn" data-toggle-user="${u.id}" data-next-status="${u.status === "suspended" ? "active" : "suspended"}">${icon(u.status === "suspended" ? "rotate-ccw" : "ban")}${u.status === "suspended" ? "Reactivate" : "Suspend"}</button>
                <button class="btn danger" data-remove-user="${u.id}">${icon("trash-2")}Remove</button>
              </div>
            </article>`).join("") || `<p class="muted">No users found.</p>`}
        </div>
      </section>
      <section class="panel">
        <h2>Email composer</h2>
        <form id="emailForm" class="form-grid">
          <div class="field"><label>Segment</label><select name="segment"><option value="all">All users</option><option value="team_admins">Team admins</option></select></div>
          <div class="field"><label>Type</label><select name="type"><option>marketing</option><option>reminder</option><option>warning</option></select></div>
          <div class="field"><label>Subject</label><input name="subject" required></div>
          <div class="field"><label>HTML body</label><textarea name="body_html" required></textarea></div>
          <button class="btn primary" type="submit">${icon("send")}Queue</button>
          <p class="status-line"></p>
        </form>
      </section>
    </div>
    <dialog id="userEditDialog" class="modal">
      <form id="userEditForm" class="form-grid" method="dialog">
        <div class="modal-head"><h2>Edit user</h2><button class="btn icon quiet" type="button" data-close-dialog="userEditDialog" title="Close">${icon("x")}</button></div>
        <input type="hidden" name="id">
        <div class="field"><label>Name</label><input name="name" required></div>
        <div class="field"><label>Email</label><input type="email" name="email" required></div>
        <div class="grid-2">
          <div class="field"><label>Username</label><input name="username" required pattern="[a-zA-Z0-9_]{3,24}"></div>
          <div class="field"><label>Staff role</label><select name="staff_role">${staffRoleOptions()}</select></div>
        </div>
        <div class="grid-2">
          <div class="field"><label>Role</label><select name="role"><option value="owner_adm">owner_adm</option><option value="users_admin">users_admin</option><option value="users_member">users_member</option><option value="client_admin">client_admin</option></select></div>
          <div class="field"><label>Status</label><select name="status"><option value="active">active</option><option value="pending_approval">pending_approval</option><option value="suspended">suspended</option></select></div>
        </div>
        <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Save</button><button class="btn" type="button" data-close-dialog="userEditDialog">Cancel</button></div>
        <p class="status-line"></p>
      </form>
    </dialog>
    <dialog id="userMessageDialog" class="modal">
      <form id="userMessageForm" class="form-grid" method="dialog">
        <div class="modal-head"><h2>Send message</h2><button class="btn icon quiet" type="button" data-close-dialog="userMessageDialog" title="Close">${icon("x")}</button></div>
        <input type="hidden" name="id">
        <p class="muted" id="messageTarget"></p>
        <div class="field"><label>Message</label><textarea name="content" required data-mentionable></textarea></div>
        <div class="toolbar"><button class="btn primary" type="submit">${icon("send")}Send</button><button class="btn" type="button" data-close-dialog="userMessageDialog">Cancel</button></div>
        <p class="status-line"></p>
      </form>
    </dialog>`);

  const usersByID = Object.fromEntries(users.map((user) => [user.id, user]));
  document.querySelectorAll("[data-approve-user]").forEach((btn) => btn.addEventListener("click", async () => {
    await api(`/api/admin/users/${btn.dataset.approveUser}/approve`, { method: "POST" });
    renderAdmin();
  }));
  document.querySelectorAll("[data-toggle-user]").forEach((btn) => btn.addEventListener("click", async () => {
    await api(`/api/admin/users/${btn.dataset.toggleUser}`, { method: "PATCH", body: JSON.stringify({ status: btn.dataset.nextStatus }) });
    renderAdmin();
  }));
  document.querySelectorAll("[data-remove-user]").forEach((btn) => btn.addEventListener("click", async () => {
    const user = usersByID[btn.dataset.removeUser];
    if (!confirm(`Remove ${user?.email || "this user"}? This deletes the account login.`)) return;
    await api(`/api/admin/users/${btn.dataset.removeUser}`, { method: "DELETE" });
    renderAdmin();
  }));
  document.querySelectorAll("[data-edit-user]").forEach((btn) => btn.addEventListener("click", () => {
    const user = usersByID[btn.dataset.editUser];
    const form = $("#userEditForm");
    form.elements.id.value = user.id;
    form.elements.name.value = user.name || "";
    form.elements.email.value = user.email || "";
    form.elements.username.value = user.username || "";
    form.elements.staff_role.value = user.staff_role === "marketing it" ? "marketing" : (user.staff_role || "internal");
    form.elements.role.value = user.role || "users_member";
    form.elements.status.value = user.status || "active";
    $("#userEditDialog").showModal();
  }));
  document.querySelectorAll("[data-message-user]").forEach((btn) => btn.addEventListener("click", () => {
    const user = usersByID[btn.dataset.messageUser];
    const form = $("#userMessageForm");
    form.elements.id.value = user.id;
    form.elements.content.value = "";
    $("#messageTarget").textContent = `${user.name} <${user.email}>`;
    $("#userMessageDialog").showModal();
  }));
  bindDialogCloseButtons();
  $("#userEditForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api(`/api/admin/users/${form.elements.id.value}`, {
        method: "PATCH",
        body: JSON.stringify({ name: form.elements.name.value, email: form.elements.email.value, username: form.elements.username.value, staff_role: form.elements.staff_role.value, role: form.elements.role.value, status: form.elements.status.value }),
      });
      $("#userEditDialog").close();
      renderAdmin();
    } catch (error) {
      const line = form.querySelector(".status-line");
      line.textContent = error.message;
      line.style.color = "var(--danger)";
    }
  });
  $("#userMessageForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api(`/api/admin/users/${form.elements.id.value}/message`, { method: "POST", body: JSON.stringify({ content: form.elements.content.value }) });
      $("#userMessageDialog").close();
      alert("Message sent.");
    } catch (error) {
      const line = form.querySelector(".status-line");
      line.textContent = error.message;
      line.style.color = "var(--danger)";
    }
  });
  $("#emailForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await api("/api/admin/emails/send", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) });
      setStatus(`Queued ${result.queued} emails`);
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

function adminMembershipLabel(value = "") {
  const labels = {
    active: "Active",
    trialing: "Trialing",
    pending_approval: "Pending approval",
    expired: "Expired",
    no_membership: "No membership",
    unknown: "Unknown",
  };
  return labels[value] || String(value || "Unknown").replaceAll("_", " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function adminMembershipClass(value = "") {
  if (["expired", "no_membership"].includes(value)) return "danger";
  if (["trialing", "pending_approval", "unknown"].includes(value)) return "warn";
  return "";
}

function adminPaymentMethodsText(user = {}) {
  const methods = Array.isArray(user.payment_methods) ? user.payment_methods.filter(Boolean) : [];
  if (methods.length) return methods.map((item) => item.replace(/\b\w/g, (ch) => ch.toUpperCase())).join(", ");
  return user.payment_provider ? String(user.payment_provider).replace(/\b\w/g, (ch) => ch.toUpperCase()) : "No payment method";
}

function adminUserSearchText(user = {}) {
  return [user.name, user.email, user.username, user.role, user.staff_role, user.team?.name, user.plan?.name, user.membership_status, adminPaymentMethodsText(user)].filter(Boolean).join(" ").toLowerCase();
}

function adminUserProtectedHTML(user = {}) {
  return user.role === "owner_adm" ? `<span class="pill warn">${icon("shield-check")}Protected</span>` : "";
}

function adminUserRowHTML(user = {}) {
  const membership = user.membership_status || "no_membership";
  const planName = user.plan?.id && user.plan.id !== NIL_OBJECT_ID ? user.plan.name : "No plan";
  const expiryText = user.membership_expires_at ? `Expires ${fmtDate(user.membership_expires_at)}` : user.trial_ends_at ? `Trial ends ${fmtDate(user.trial_ends_at)}` : "No expiry date";
  const paymentText = adminPaymentMethodsText(user);
  return `<article class="admin-user-row" data-admin-user-row data-user-id="${esc(user.id)}" data-level="${esc(user.role || "")}" data-membership="${esc(membership)}" data-payment="${esc(paymentText.toLowerCase())}" data-search="${esc(adminUserSearchText(user))}">
    <div class="admin-user-identity">
      ${userChip(user)}
      <div>
        <h3>${esc(user.name || user.email || "Unnamed user")}</h3>
        <span class="muted">@${esc(user.username || "pending")} - ${esc(user.email || "")}</span>
      </div>
    </div>
    <div class="admin-user-meta">
      <span class="pill">${esc(roleLabel(user.role))}</span>
      <span class="pill">${esc(staffRoleLabel(user.staff_role) || "No staff role")}</span>
      <span class="pill ${user.status === "suspended" ? "danger" : user.status === "pending_approval" ? "warn" : ""}">${esc(user.status || "unknown")}</span>
      <span class="pill ${adminMembershipClass(membership)}">${esc(adminMembershipLabel(membership))}</span>
    </div>
    <div class="admin-user-membership">
      <strong>${esc(planName)}</strong>
      <span>${esc(user.team?.name || "No company workspace")}</span>
      <span>${esc(expiryText)}</span>
      <span>${esc(paymentText)}${user.payment_transaction ? ` - ${esc(user.payment_transaction)}` : ""}</span>
    </div>
    <div class="admin-user-actions">
      <button class="btn compact" type="button" data-view-user="${esc(user.id)}">${icon("panel-right-open")}Details</button>
      ${user.status === "pending_approval" ? `<button class="btn compact" type="button" data-approve-user="${esc(user.id)}">${icon("check")}Approve</button>` : ""}
      ${user.role !== "owner_adm" ? `<button class="btn compact" type="button" data-membership-user="${esc(user.id)}">${icon("badge-dollar-sign")}Membership</button>` : ""}
      <button class="btn compact" type="button" data-edit-user="${esc(user.id)}">${icon("pencil")}Edit</button>
      <button class="btn compact" type="button" data-message-user="${esc(user.id)}">${icon("message-square")}Message</button>
      <button class="btn compact" type="button" data-toggle-user="${esc(user.id)}" data-next-status="${user.status === "suspended" ? "active" : "suspended"}">${icon(user.status === "suspended" ? "rotate-ccw" : "ban")}${user.status === "suspended" ? "Activate" : "Suspend"}</button>
      ${user.role === "owner_adm" ? adminUserProtectedHTML(user) : `<button class="btn compact danger" type="button" data-remove-user="${esc(user.id)}">${icon("trash-2")}Delete</button>`}
    </div>
  </article>`;
}

function adminStatHTML(label, value) {
  return `<div class="admin-detail-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

function adminMiniRows(items = [], emptyText = "Nothing found.", render) {
  if (!items.length) return `<p class="muted">${esc(emptyText)}</p>`;
  return `<div class="admin-mini-list">${items.slice(0, 12).map(render).join("")}</div>`;
}

function adminUserDetailHTML(data = {}) {
  const user = data.user || {};
  const membership = user.membership_status || "no_membership";
  const teams = data.teams || [];
  const subs = data.subscriptions || [];
  const plansByID = Object.fromEntries((data.plans || []).map((plan) => [plan.id, plan]));
  const invoices = data.invoices || [];
  const clientProjects = data.client_projects || [];
  const clientWebsites = data.client_websites || [];
  const clientTasks = data.client_tasks || [];
  const workspaceProjects = data.workspace_projects || [];
  const workspaceTasks = data.workspace_tasks || [];
  return `
    <div class="admin-detail-head">
      <div class="admin-user-identity">${userChip(user)}<div><h2>${esc(user.name || user.email || "User details")}</h2><span class="muted">@${esc(user.username || "pending")} - ${esc(user.email || "")}</span></div></div>
      <div class="toolbar compact-toolbar">
        ${user.status === "pending_approval" ? `<button class="btn compact" type="button" data-approve-user="${esc(user.id)}">${icon("check")}Approve</button>` : ""}
        ${user.role !== "owner_adm" ? `<button class="btn compact" type="button" data-membership-user="${esc(user.id)}">${icon("badge-dollar-sign")}Membership</button>` : ""}
        <button class="btn compact" type="button" data-edit-user="${esc(user.id)}">${icon("pencil")}Edit</button>
        <button class="btn compact" type="button" data-message-user="${esc(user.id)}">${icon("message-square")}Message</button>
        <button class="btn compact" type="button" data-toggle-user="${esc(user.id)}" data-next-status="${user.status === "suspended" ? "active" : "suspended"}">${icon(user.status === "suspended" ? "rotate-ccw" : "ban")}${user.status === "suspended" ? "Activate" : "Suspend"}</button>
        ${user.role === "owner_adm" ? adminUserProtectedHTML(user) : `<button class="btn compact danger" type="button" data-remove-user="${esc(user.id)}">${icon("trash-2")}Delete</button>`}
      </div>
    </div>
    <div class="admin-detail-stats">
      ${adminStatHTML("Account level", roleLabel(user.role))}
      ${adminStatHTML("Status", user.status || "unknown")}
      ${adminStatHTML("Membership", adminMembershipLabel(membership))}
      ${adminStatHTML("Membership term", user.subscription?.id && !user.subscription.id.startsWith(NIL_OBJECT_ID.slice(0, 6)) ? subscriptionDurationText(user.subscription) : "No term")}
      ${adminStatHTML("Payment methods", adminPaymentMethodsText(user))}
      ${adminStatHTML("Registered", fmtDate(user.created_at))}
      ${adminStatHTML("Last active", user.last_active_at ? fmtDate(user.last_active_at) : "No activity yet")}
      ${adminStatHTML("2FA", user.two_factor_enabled ? "Enabled" : "Not enabled")}
      ${adminStatHTML("Tasks", String(clientTasks.length + workspaceTasks.length))}
    </div>
    <section class="admin-detail-section"><h3>Membership and payment</h3>
      ${adminMiniRows(subs, "No subscriptions found.", (sub) => {
        const plan = plansByID[sub.plan_id] || {};
        const status = adminMembershipLabel(sub.expires_at && new Date(sub.expires_at) < new Date() ? "expired" : sub.status);
        return `<article><strong>${esc(plan.name || "Unknown plan")}</strong><span>${esc(status)} - ${esc(sub.payment_provider || "No payment provider")}</span><span>Started ${esc(fmtDate(sub.started_at))}${sub.expires_at ? ` - Expires ${esc(fmtDate(sub.expires_at))}` : ""}${sub.trial_ends_at ? ` - Trial ends ${esc(fmtDate(sub.trial_ends_at))}` : ""}</span><span>${sub.external_transaction_id ? `Transaction ${esc(sub.external_transaction_id)}` : "No transaction ID"}</span></article>`;
      })}
      ${adminMiniRows(invoices, "No invoices found.", (invoice) => `<article><strong>${esc(money(invoice.amount))} ${esc(String(invoice.currency || "USD").toUpperCase())}</strong><span>${esc(invoice.status || "unknown")} - ${esc(invoice.payment_provider || "No provider")}</span><span>${esc(fmtDate(invoice.issued_at))}${invoice.external_invoice_url ? ` - <a class="text-link" href="${esc(invoice.external_invoice_url)}" target="_blank" rel="noopener noreferrer">Receipt</a>` : ""}</span></article>`)}
    </section>
    <section class="admin-detail-section"><h3>Companies and workspaces</h3>
      ${adminMiniRows(teams, "No teams found.", (team) => `<article><strong>${esc(team.name || "Unnamed workspace")}</strong><span>${esc(team.company_email || "No company email")} - ${team.member_ids?.length || 0} members</span><span>Created ${esc(fmtDate(team.created_at))}</span></article>`)}
    </section>
    <section class="admin-detail-section"><h3>Projects and domains</h3>
      ${adminMiniRows(clientProjects, "No client projects found.", (project) => `<article><strong>${esc(project.name || "Client project")}</strong><span>${esc(project.company_email || "No company email")} - ${project.member_ids?.length || 0} members - ${project.client_admin_ids?.length || 0} client admins</span><span>Updated ${esc(fmtDate(project.updated_at))}</span></article>`)}
      ${adminMiniRows(clientWebsites, "No domains found.", (site) => `<article><strong>${esc(site.name || "Website")}</strong><span>${esc(site.url || "No URL")}</span><span>Updated ${esc(fmtDate(site.updated_at))}</span></article>`)}
      ${adminMiniRows(workspaceProjects, "No workspace projects found.", (project) => `<article><strong>${esc(project.name || "Workspace project")}</strong><span>${project.list_ids?.length || 0} lists</span><span>Created ${esc(fmtDate(project.created_at))}</span></article>`)}
    </section>
    <section class="admin-detail-section"><h3>Tasks</h3>
      ${adminMiniRows(clientTasks, "No domain tasks found.", (task) => `<article><strong>${esc(task.title || "Task")}</strong><span>${esc(task.status || "todo")} - ${esc(task.type || "description")}</span><span>${task.due_date ? `Due ${esc(fmtDate(task.due_date))}` : "No due date"} - Updated ${esc(fmtDateTime(task.updated_at))}</span></article>`)}
      ${adminMiniRows(workspaceTasks, "No workspace tasks found.", (task) => `<article><strong>${esc(task.title || "Task")}</strong><span>${esc(task.status || "todo")} - ${esc(task.priority || "Normal")}</span><span>${task.due_date ? `Due ${esc(fmtDate(task.due_date))}` : "No due date"} - Updated ${esc(fmtDateTime(task.updated_at))}</span></article>`)}
    </section>`;
}

async function renderAdmin() {
  let users = [];
  let plans = [];
  try {
    const [usersResult, plansResult] = await Promise.all([api("/api/admin/users"), api("/api/admin/plans")]);
    users = usersResult.users || [];
    plans = plansResult.plans || [];
  } catch (error) {
    shell("Admin Users", `
      <div class="page-title">
        <div><h1>Manage users</h1><p class="muted">Owner admin controls for accounts, memberships, payments, projects, domains, and tasks.</p></div>
      </div>
      <section class="panel">
        <h2>Unable to load users</h2>
        <p class="muted">${esc(error.message)}</p>
        <div class="toolbar"><a class="btn primary" href="/dashboard">${icon("arrow-left")}Back to dashboard</a><button class="btn" type="button" onclick="window.location.reload()">${icon("refresh-cw")}Retry</button></div>
      </section>`);
    return;
  }
  shell("Admin Users", `
    <div class="page-title">
      <div><h1>Manage users</h1><p class="muted">Owner admin controls for accounts, memberships, payments, projects, domains, and tasks.</p></div>
      <div class="toolbar"><button class="btn primary" id="newOwnerUserBtn">${icon("user-plus")}Add user</button><a class="btn" href="/admin/settings">${icon("settings")}Settings</a><a class="btn" href="/admin/plans">${icon("badge-dollar-sign")}Pricing plans</a><a class="btn" href="/admin/pages">${icon("file-pen")}Pages</a></div>
    </div>
    <div class="admin-user-filters">
      <label><span>Search</span><input type="search" data-admin-filter-search placeholder="Name, email, company, plan"></label>
      <label><span>Membership</span><select data-admin-filter="membership"><option value="">All memberships</option><option value="active">Active</option><option value="trialing">Trialing</option><option value="pending_approval">Pending approval</option><option value="expired">Expired</option><option value="no_membership">No membership</option></select></label>
      <label><span>Level</span><select data-admin-filter="level"><option value="">All levels</option><option value="owner_adm">Owner admin</option><option value="users_admin">User admin</option><option value="users_member">User member</option><option value="client_admin">Client admin</option></select></label>
      <label><span>Payment</span><select data-admin-filter="payment"><option value="">All payment methods</option><option value="paypal">PayPal</option><option value="no payment method">No payment method</option></select></label>
    </div>
    <div class="owner-admin-layout">
      <section class="panel owner-users-panel"><div class="panel-head"><h2>Users</h2><span class="pill" id="adminUserCount">${users.length} users</span></div><div class="admin-user-list">${users.map(adminUserRowHTML).join("") || `<p class="muted">No users found.</p>`}</div><p id="adminUserNoResults" class="muted" hidden>No users match the current filters.</p></section>
      <section class="panel owner-user-detail" id="ownerUserDetail"><h2>User details</h2><p class="muted">Select a user to view membership, payment, projects, domains, and tasks.</p></section>
    </div>
    <section class="panel admin-email-panel">
      <h2>Email composer</h2>
      <form id="emailForm" class="form-grid">
        <div class="grid-3"><div class="field"><label>Segment</label><select name="segment"><option value="all">All users</option><option value="team_admins">Team admins</option></select></div><div class="field"><label>Type</label><select name="type"><option>marketing</option><option>reminder</option><option>warning</option></select></div><div class="field"><label>Subject</label><input name="subject" required></div></div>
        <div class="field"><label>HTML body</label><textarea name="body_html" required></textarea></div>
        <button class="btn primary" type="submit">${icon("send")}Queue</button><p class="status-line"></p>
      </form>
    </section>
    ${adminUserDialogsHTML(plans)}`);
  const usersByID = Object.fromEntries(users.map((user) => [user.id, user]));
  const loadDetail = async (userID) => {
    const panel = $("#ownerUserDetail");
    if (!panel) return;
    panel.innerHTML = `<p class="muted">Loading user details...</p>`;
    document.querySelectorAll("[data-admin-user-row]").forEach((row) => row.classList.toggle("active", row.dataset.userId === userID));
    try {
      const detail = await api(`/api/admin/users/${userID}`);
      panel.innerHTML = adminUserDetailHTML(detail);
      if (detail.user?.id) usersByID[detail.user.id] = detail.user;
      bindAdminUserActions(usersByID, loadDetail, plans);
      icons();
    } catch (error) {
      panel.innerHTML = `<h2>User details</h2><p class="muted">${esc(error.message)}</p>`;
    }
  };
  const applyAdminFilters = () => {
    const query = String(document.querySelector("[data-admin-filter-search]")?.value || "").trim().toLowerCase();
    const membership = document.querySelector("[data-admin-filter='membership']")?.value || "";
    const level = document.querySelector("[data-admin-filter='level']")?.value || "";
    const payment = document.querySelector("[data-admin-filter='payment']")?.value || "";
    let count = 0;
    document.querySelectorAll("[data-admin-user-row]").forEach((row) => {
      const visible = (!query || (row.dataset.search || "").includes(query)) && (!membership || row.dataset.membership === membership) && (!level || row.dataset.level === level) && (!payment || (row.dataset.payment || "").includes(payment));
      row.hidden = !visible;
      if (visible) count += 1;
    });
    const countEl = $("#adminUserCount");
    if (countEl) countEl.textContent = `${count} ${count === 1 ? "user" : "users"}`;
    const empty = $("#adminUserNoResults");
    if (empty) empty.hidden = count !== 0;
  };
  document.querySelectorAll("[data-admin-filter], [data-admin-filter-search]").forEach((input) => input.addEventListener(input.tagName === "SELECT" ? "change" : "input", applyAdminFilters));
  document.querySelectorAll("[data-admin-user-row]").forEach((row) => row.addEventListener("click", (event) => {
    if (event.target.closest("button, a, input, select, textarea")) return;
    loadDetail(row.dataset.userId);
  }));
  bindAdminUserActions(usersByID, loadDetail, plans);
  bindDialogCloseButtons();
  $("#newOwnerUserBtn")?.addEventListener("click", () => $("#userCreateDialog")?.showModal());
  $("#userCreateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api("/api/admin/users", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      $("#userCreateDialog")?.close();
      await renderAdmin();
      setStatus("User created.");
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  $("#userEditForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api(`/api/admin/users/${form.elements.id.value}`, { method: "PATCH", body: JSON.stringify({ name: form.elements.name.value, email: form.elements.email.value, username: form.elements.username.value, staff_role: form.elements.staff_role.value, role: form.elements.role.value, status: form.elements.status.value }) });
      $("#userEditDialog").close();
      await renderAdmin();
      setStatus("User updated.");
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  $("#userMessageForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api(`/api/admin/users/${form.elements.id.value}/message`, { method: "POST", body: JSON.stringify({ content: form.elements.content.value }) });
      $("#userMessageDialog").close();
      setStatus("Message sent.");
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  $("#userMembershipForm")?.addEventListener("input", (event) => {
    if (event.target.matches("select, input")) updateMembershipPreview(event.currentTarget, plans);
  });
  $("#userMembershipForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const body = Object.fromEntries(new FormData(form).entries());
      body.quantity = Number(body.quantity || 1);
      const result = await api(`/api/admin/users/${form.elements.id.value}/membership`, { method: "PATCH", body: JSON.stringify(body) });
      $("#userMembershipDialog").close();
      await renderAdmin();
      setStatus(`Membership updated. Expires ${fmtDate(result.expires_at)}.`);
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  $("#emailForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await api("/api/admin/emails/send", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) });
      setStatus(`Queued ${result.queued} emails`);
    } catch (error) {
      setStatus(error.message, true);
    }
  });
  applyAdminFilters();
  if (users[0]) loadDetail(users[0].id);
}

function adminUserDialogsHTML(plans = []) {
  return `<dialog id="userCreateDialog" class="modal">
    <form id="userCreateForm" class="form-grid" method="dialog">
      <div class="modal-head"><h2>Add user manually</h2><button class="btn icon quiet" type="button" data-close-dialog="userCreateDialog" title="Close">${icon("x")}</button></div>
      <div class="grid-2"><div class="field"><label>Name</label><input name="name" required></div><div class="field"><label>Email</label><input type="email" name="email" required></div></div>
      <div class="grid-2"><div class="field"><label>Username</label><input name="username" required pattern="[a-zA-Z0-9_]{3,24}"></div><div class="field"><label>Temporary password</label><input name="password" type="password" minlength="8" required></div></div>
      <div class="field"><label>Company name</label><input name="company_name" placeholder="Company workspace name"></div>
      <div class="grid-2"><div class="field"><label>Role</label><select name="role"><option value="users_admin">users_admin</option><option value="owner_adm">owner_adm</option><option value="users_member">users_member</option><option value="client_admin">client_admin</option></select></div><div class="field"><label>Status</label><select name="status"><option value="active">active</option><option value="pending_approval">pending_approval</option><option value="suspended">suspended</option></select></div></div>
      <div class="field"><label>Staff role</label><select name="staff_role">${staffRoleOptions("manager")}</select></div>
      <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Create user</button><button class="btn" type="button" data-close-dialog="userCreateDialog">Cancel</button></div><p class="status-line"></p>
    </form>
  </dialog>
  <dialog id="userEditDialog" class="modal">
    <form id="userEditForm" class="form-grid" method="dialog">
      <div class="modal-head"><h2>Edit user</h2><button class="btn icon quiet" type="button" data-close-dialog="userEditDialog" title="Close">${icon("x")}</button></div>
      <input type="hidden" name="id"><div class="field"><label>Name</label><input name="name" required></div><div class="field"><label>Email</label><input type="email" name="email" required></div>
      <div class="grid-2"><div class="field"><label>Username</label><input name="username" required pattern="[a-zA-Z0-9_]{3,24}"></div><div class="field"><label>Staff role</label><select name="staff_role">${staffRoleOptions()}</select></div></div>
      <div class="grid-2"><div class="field"><label>Role</label><select name="role"><option value="owner_adm">owner_adm</option><option value="users_admin">users_admin</option><option value="users_member">users_member</option><option value="client_admin">client_admin</option></select></div><div class="field"><label>Status</label><select name="status"><option value="active">active</option><option value="pending_approval">pending_approval</option><option value="suspended">suspended</option></select></div></div>
      <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Save</button><button class="btn" type="button" data-close-dialog="userEditDialog">Cancel</button></div><p class="status-line"></p>
    </form>
  </dialog>
  <dialog id="userMessageDialog" class="modal">
    <form id="userMessageForm" class="form-grid" method="dialog">
      <div class="modal-head"><h2>Send message</h2><button class="btn icon quiet" type="button" data-close-dialog="userMessageDialog" title="Close">${icon("x")}</button></div>
      <input type="hidden" name="id"><p class="muted" id="messageTarget"></p><div class="field"><label>Message</label><textarea name="content" required data-mentionable></textarea></div>
      <div class="toolbar"><button class="btn primary" type="submit">${icon("send")}Send</button><button class="btn" type="button" data-close-dialog="userMessageDialog">Cancel</button></div><p class="status-line"></p>
    </form>
  </dialog>
  <dialog id="userMembershipDialog" class="modal">
    <form id="userMembershipForm" class="form-grid" method="dialog">
      <div class="modal-head"><h2>Set membership</h2><button class="btn icon quiet" type="button" data-close-dialog="userMembershipDialog" title="Close">${icon("x")}</button></div>
      <input type="hidden" name="id">
      <p class="muted" id="membershipTarget"></p>
      <div class="field"><label>Pricing plan</label><select name="plan_id" required>${planOptionsHTML(plans)}</select></div>
      <div class="grid-3">
        <div class="field"><label>Period</label><select name="billing_period"><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></div>
        <div class="field"><label>Amount</label><input type="number" name="quantity" min="1" max="120" step="1" value="1"></div>
        <div class="field"><label>Status</label><select name="status"><option value="active">active</option><option value="trialing">trialing</option><option value="pending_approval">pending_approval</option></select></div>
      </div>
      <div class="grid-2">
        <div class="field"><label>Payment provider</label><select name="payment_provider"><option value="manual">manual</option><option value="paypal">paypal</option></select></div>
        <div class="field"><label>Transaction/reference</label><input name="external_transaction_id" placeholder="Optional"></div>
      </div>
      <p class="muted" id="membershipPreview">Select a plan and duration.</p>
      <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Save membership</button><button class="btn" type="button" data-close-dialog="userMembershipDialog">Cancel</button></div><p class="status-line"></p>
    </form>
  </dialog>`;
}

function updateMembershipPreview(form, plans = []) {
  if (!form) return;
  const plan = plans.find((item) => item.id === form.elements.plan_id?.value);
  const period = form.elements.billing_period?.value || "monthly";
  const quantity = Math.max(1, Number(form.elements.quantity?.value || 1));
  const preview = $("#membershipPreview");
  if (!preview || !plan) {
    if (preview) preview.textContent = "Select a plan and duration.";
    return;
  }
  const unit = planUnitAmount(plan, period);
  const suffix = plan.pricing_model === "per_seat" ? " per seat" : "";
  const total = unit * quantity;
  preview.textContent = `${plan.name}: ${money(unit)}${suffix} x ${quantity} ${billingUnitLabel(period)}${quantity === 1 ? "" : "s"} = ${money(total)} before seat multiplication where applicable.`;
}

function bindAdminUserActions(usersByID = {}, afterAction = () => {}, plans = []) {
  document.querySelectorAll("[data-view-user]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => afterAction(btn.dataset.viewUser));
  });
  document.querySelectorAll("[data-approve-user]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      try {
        await api(`/api/admin/users/${btn.dataset.approveUser}/approve`, { method: "POST" });
        await renderAdmin();
        setStatus("User approved.");
      } catch (error) {
        setStatus(error.message, true);
      }
    });
  });
  document.querySelectorAll("[data-toggle-user]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const user = usersByID[btn.dataset.toggleUser];
      if (btn.dataset.nextStatus === "suspended" && !confirm(`Suspend ${user?.email || "this user"}?`)) return;
      try {
        await api(`/api/admin/users/${btn.dataset.toggleUser}`, { method: "PATCH", body: JSON.stringify({ status: btn.dataset.nextStatus }) });
        await renderAdmin();
        setStatus(btn.dataset.nextStatus === "suspended" ? "User suspended." : "User activated.");
      } catch (error) {
        setStatus(error.message, true);
      }
    });
  });
  document.querySelectorAll("[data-remove-user]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const user = usersByID[btn.dataset.removeUser];
      if (!confirm(`Delete ${user?.email || "this user"}? This removes the account login.`)) return;
      try {
        await api(`/api/admin/users/${btn.dataset.removeUser}`, { method: "DELETE" });
        await renderAdmin();
        setStatus("User deleted.");
      } catch (error) {
        setStatus(error.message, true);
      }
    });
  });
  document.querySelectorAll("[data-edit-user]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const user = usersByID[btn.dataset.editUser];
      const form = $("#userEditForm");
      if (!user || !form) return;
      form.elements.id.value = user.id;
      form.elements.name.value = user.name || "";
      form.elements.email.value = user.email || "";
      form.elements.username.value = user.username || "";
      form.elements.staff_role.value = user.staff_role === "marketing it" ? "marketing" : (user.staff_role || "internal");
      form.elements.role.value = user.role || "users_member";
      form.elements.role.disabled = user.role === "owner_adm";
      form.elements.status.value = user.status || "active";
      $("#userEditDialog").showModal();
    });
  });
  document.querySelectorAll("[data-message-user]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const user = usersByID[btn.dataset.messageUser];
      const form = $("#userMessageForm");
      if (!user || !form) return;
      form.elements.id.value = user.id;
      form.elements.content.value = "";
      $("#messageTarget").textContent = `${user.name} <${user.email}>`;
      $("#userMessageDialog").showModal();
    });
  });
  document.querySelectorAll("[data-membership-user]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const user = usersByID[btn.dataset.membershipUser];
      const form = $("#userMembershipForm");
      if (!user || !form) return;
      const currentPlanID = user.subscription?.plan_id || user.plan?.id || plans[0]?.id || "";
      form.reset();
      form.elements.id.value = user.id;
      form.elements.plan_id.value = currentPlanID;
      form.elements.billing_period.value = user.subscription?.billing_period || "monthly";
      form.elements.quantity.value = user.subscription?.billing_quantity || 1;
      form.elements.status.value = user.membership_status === "trialing" ? "trialing" : user.membership_status === "pending_approval" ? "pending_approval" : "active";
      form.elements.payment_provider.value = (user.subscription?.payment_provider || user.payment_provider) === "paypal" ? "paypal" : "manual";
      form.elements.external_transaction_id.value = user.subscription?.external_transaction_id || user.payment_transaction || "";
      $("#membershipTarget").textContent = `${user.name || user.email} - ${user.team?.name || "Company workspace"}`;
      updateMembershipPreview(form, plans);
      $("#userMembershipDialog").showModal();
    });
  });
}

async function renderPlansAdmin() {
  const plans = (await api("/api/admin/plans")).plans || [];
  shell("Plan Pricing", `
    <div class="page-title"><div><h1>Plans</h1><p class="muted">Owner-only monthly and yearly pricing controls. Amounts are entered in USD.</p></div></div>
    <div class="grid-3">
      ${plans.map((plan) => `
        <section class="panel">
          <form class="form-grid plan-form" data-plan-id="${plan.id}">
            <div>
              <h2>${esc(plan.name)}</h2>
              <span class="pill">flat package</span>
              ${plan.featured ? `<span class="pill warn">featured</span>` : ""}
            </div>
            <div class="field"><label>Name</label><input name="name" value="${esc(plan.name)}" required></div>
            <div class="field"><label>Description</label><textarea name="description">${esc(plan.description || "")}</textarea></div>
            <input type="hidden" name="pricing_model" value="flat">
            <div class="grid-2">
              <div class="field"><label>Flat monthly USD</label><input type="number" min="0" step="0.01" name="price_dollars" value="${dollars(plan.price)}"></div>
              <div class="field"><label>Flat yearly USD</label><input type="number" min="0" step="0.01" name="price_yearly_dollars" value="${dollars(plan.price_yearly || (plan.price || 0) * 12)}"></div>
            </div>
            <div class="grid-2">
              <div class="field"><label>Trial days</label><input type="number" min="0" step="1" name="trial_days" value="${plan.trial_days || 0}"></div>
              <div class="field"><label>Seat limit</label><input type="number" min="1" step="1" name="seat_limit" value="${plan.seat_limit || 1}"></div>
            </div>
            <div class="grid-2">
              <div class="field"><label>Project limit</label><input type="number" min="1" step="1" name="project_limit" value="${plan.project_limit || 1}"></div>
              <div class="field"><label>Storage MB</label><input type="number" min="1" step="1" name="storage_limit_mb" value="${plan.storage_limit_mb || 1}"></div>
            </div>
            <label class="check-row"><input type="checkbox" name="featured" ${plan.featured ? "checked" : ""}> Featured trial plan</label>
            <button class="btn primary" type="submit">${icon("save")}Save plan</button>
            <p class="status-line"></p>
          </form>
        </section>`).join("")}
    </div>`);

  document.querySelectorAll(".plan-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const body = {
      name: data.name,
      description: data.description,
      pricing_model: data.pricing_model,
      price: cents(data.price_dollars),
      price_yearly: cents(data.price_yearly_dollars),
      price_per_seat: 0,
      price_per_seat_yearly: 0,
      trial_days: Number(data.trial_days),
      seat_limit: Number(data.seat_limit),
      project_limit: Number(data.project_limit),
      storage_limit_mb: Number(data.storage_limit_mb),
      featured: form.featured.checked,
    };
    try {
      await api(`/api/admin/plans/${form.dataset.planId}`, { method: "PATCH", body: JSON.stringify(body) });
      await renderPlansAdmin();
    } catch (error) {
      const line = form.querySelector(".status-line");
      if (line) {
        line.textContent = error.message;
        line.style.color = "var(--danger)";
      }
    }
  }));
}

const SOCIAL_LINK_TYPES = [
  ["link", "Link", "external-link"],
  ["mail", "Mail", "mail"],
  ["contact", "Contact", "contact"],
  ["phone", "Phone", "phone"],
  ["whatsapp", "WhatsApp", "message-circle"],
  ["facebook", "Facebook", "facebook"],
  ["instagram", "Instagram", "instagram"],
  ["tiktok", "TikTok", "music-2"],
  ["youtube", "YouTube", "youtube"],
];

function socialLinkTypeLabel(value = "") {
  return SOCIAL_LINK_TYPES.find(([key]) => key === value)?.[1] || "Link";
}

function socialLinkTypeIcon(value = "") {
  return SOCIAL_LINK_TYPES.find(([key]) => key === value)?.[2] || "external-link";
}

function socialLinkTypeOptions(selected = "link") {
  return SOCIAL_LINK_TYPES.map(([value, label]) => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(label)}</option>`).join("");
}

function socialLinkRowHTML(item = {}) {
  const iconValue = item.icon || "link";
  return `<article class="social-link-row" data-social-link-row>
    <span class="social-link-row-icon" data-social-row-icon>${icon(socialLinkTypeIcon(iconValue))}</span>
    <input type="hidden" name="social_id" value="${esc(item.id || crypto.randomUUID())}">
    <label><span>Icon</span><select name="social_icon">${socialLinkTypeOptions(iconValue)}</select></label>
    <label><span>Label</span><input name="social_label" value="${esc(item.label || socialLinkTypeLabel(iconValue))}" placeholder="Instagram"></label>
    <label><span>URL</span><input name="social_url" value="${esc(item.url || "")}" placeholder="https://..."></label>
    <label class="check-row social-visible"><input type="checkbox" name="social_visible" ${item.visible !== false ? "checked" : ""}>Show</label>
    <button class="btn icon quiet danger-text" type="button" data-remove-social-link title="Remove">${icon("trash-2")}</button>
  </article>`;
}

function socialLinksBuilderHTML(items = []) {
  const rows = (Array.isArray(items) && items.length ? items : []).map(socialLinkRowHTML).join("");
  return `<div class="social-links-builder" data-social-links-builder>
    <div class="panel-head compact">
      <div>
        <h2>Social and contact links</h2>
        <p class="muted">Use these with [[social_links]] or [[company_contact_card]] shortcodes.</p>
      </div>
      <button class="btn compact" type="button" data-add-social-link>${icon("plus")}Add link</button>
    </div>
    <div class="social-links-list" data-social-links-list>${rows || `<p class="muted">No social links yet.</p>`}</div>
  </div>`;
}

function bindSocialLinksBuilder(root = document) {
  const builder = root.querySelector("[data-social-links-builder]");
  if (!builder) return;
  const list = builder.querySelector("[data-social-links-list]");
  const ensureRows = () => {
    if (!list.querySelector("[data-social-link-row]")) list.innerHTML = `<p class="muted">No social links yet.</p>`;
  };
  const bindRow = (row) => {
    const select = row.querySelector("select[name='social_icon']");
    const label = row.querySelector("input[name='social_label']");
    const iconHolder = row.querySelector("[data-social-row-icon]");
    select?.addEventListener("change", () => {
      iconHolder.innerHTML = icon(socialLinkTypeIcon(select.value));
      if (!label.value.trim()) label.value = socialLinkTypeLabel(select.value);
      icons();
    });
    row.querySelector("[data-remove-social-link]")?.addEventListener("click", () => {
      row.remove();
      ensureRows();
    });
  };
  list.querySelectorAll("[data-social-link-row]").forEach(bindRow);
  builder.querySelector("[data-add-social-link]")?.addEventListener("click", () => {
    if (!list.querySelector("[data-social-link-row]")) list.innerHTML = "";
    list.insertAdjacentHTML("beforeend", socialLinkRowHTML({ icon: "link", label: "New link", visible: true }));
    bindRow(list.lastElementChild);
    icons();
  });
}

function collectSocialLinks(form) {
  return Array.from(form.querySelectorAll("[data-social-link-row]")).map((row, index) => ({
    id: row.querySelector("input[name='social_id']")?.value || crypto.randomUUID(),
    icon: row.querySelector("select[name='social_icon']")?.value || "link",
    label: row.querySelector("input[name='social_label']")?.value.trim() || "",
    url: row.querySelector("input[name='social_url']")?.value.trim() || "",
    visible: Boolean(row.querySelector("input[name='social_visible']")?.checked),
    order: index + 1,
  })).filter((item) => item.label && item.url);
}

function supportedTimeZones() {
  const preferred = [
    "UTC",
    "Asia/Bangkok",
    "Asia/Jakarta",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Australia/Sydney",
    "Europe/London",
    "Europe/Paris",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
  ];
  let browserZones = [];
  try {
    browserZones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  } catch {
    browserZones = [];
  }
  return [...new Set([...preferred, ...browserZones])].sort((a, b) => a.localeCompare(b));
}

function timeZoneOptionLabel(zone) {
  try {
    const sample = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).format(new Date());
    return `${zone} (${sample})`;
  } catch {
    return zone;
  }
}

function timeZoneOptionsHTML(selected = "UTC") {
  const value = selected || "UTC";
  return [...new Set([value, ...supportedTimeZones()])].map((zone) => `<option value="${esc(zone)}" ${zone === value ? "selected" : ""}>${esc(timeZoneOptionLabel(zone))}</option>`).join("");
}

async function renderSettings() {
  const settings = (await api("/api/admin/settings")).settings;
  const colorDefaults = {
    theme_primary_color: "#0b8f7a",
    theme_primary_strong_color: "#066d5d",
    theme_button_color: "#0b8f7a",
    theme_button_text_color: "#ffffff",
    theme_font_color: "#18231f",
    theme_heading_color: "#18231f",
    theme_background_color: "#f7f8f4",
  };
  const colorValue = (key) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(settings[key] || "") ? settings[key] : colorDefaults[key];
  const secretField = (label, name, savedKey, clearName) => `
    <div class="field">
      <label>${esc(label)}</label>
      <input type="password" name="${esc(name)}" value="" placeholder="${settings[savedKey] ? "Saved - leave blank to keep" : "Enter secret"}" autocomplete="new-password">
      ${settings[savedKey] ? `<label class="check-row subtle"><input type="checkbox" name="${esc(clearName)}"> Clear saved value</label>` : ""}
    </div>`;
  const colorField = (label, name) => `
    <div class="field color-setting-field">
      <label>${esc(label)}</label>
      <input type="color" name="${esc(name)}" value="${esc(colorValue(name))}">
      <input value="${esc(colorValue(name))}" data-color-text="${esc(name)}" aria-label="${esc(label)} hex">
    </div>`;
  const platformAssetField = (label, name, inputID, previewID, value = "", initial = "P") => `
    <div class="logo-setting platform-asset-upload">
      <div class="company-logo-preview" id="${esc(previewID)}">${value ? `<img src="${esc(value)}" alt="">` : esc(initial)}</div>
      <div class="field">
        <label>${esc(label)}</label>
        <input id="${esc(inputID)}" type="file" accept="image/png,image/jpeg,image/gif,image/webp">
        <input id="${esc(`${inputID}Url`)}" name="${esc(name)}" value="${esc(value || "")}" readonly placeholder="/uploads/users/.../image.png">
        <small class="muted">Recommended size: 500x500px. Uploaded images are resized to max 500x500px.</small>
      </div>
    </div>`;
  shell("Settings", `
    <div class="page-title"><div><h1>Platform Settings</h1><p class="muted">Owner-only controls for identity, sign in, email, payments, and app colors.</p></div></div>
    <section class="panel platform-settings-panel">
      <div class="settings-tabs" role="tablist">
        <button class="active" type="button" data-settings-tab="identity">${icon("building-2")}Identity</button>
        <button type="button" data-settings-tab="localization">${icon("clock")}Time zone</button>
        <button type="button" data-settings-tab="google">${icon("key-round")}Google sign in</button>
        <button type="button" data-settings-tab="smtp">${icon("mail")}SMTP mail</button>
        <button type="button" data-settings-tab="notifications">${icon("bell")}Notifications</button>
        <button type="button" data-settings-tab="payments">${icon("credit-card")}Payments</button>
        <button type="button" data-settings-tab="colors">${icon("palette")}Colors</button>
      </div>
      <form id="settingsForm" class="settings-tab-form">
        <section data-settings-panel="identity" class="settings-tab-section">
          <div class="grid-2">
            <div class="field"><label>Site name</label><input name="site_name" value="${esc(settings.site_name || "")}"></div>
            <div class="field"><label>Slogan</label><input name="company_slogan" value="${esc(settings.company_slogan || "")}" placeholder="Your platform slogan"></div>
          </div>
          <div class="grid-2">
            <div class="field"><label>Company email</label><input type="email" name="company_email" value="${esc(settings.company_email || "")}"></div>
            <div class="field"><label>Company contact</label><input name="company_contact" value="${esc(settings.company_contact || "")}" placeholder="Phone, WhatsApp, or contact text"></div>
          </div>
          <div class="grid-2">
            <div class="field"><label>Owner name</label><input name="owner_name" value="${esc(settings.owner_name || "")}"></div>
            <div class="field"><label>Support phone</label><input name="support_phone" value="${esc(settings.support_phone || "")}"></div>
          </div>
          <div class="field"><label>Company address</label><textarea name="company_address" rows="3">${esc(settings.company_address || "")}</textarea></div>
          <div class="grid-2">
            ${platformAssetField("Platform logo", "logo_url", "platformLogoFile", "platformLogoPreview", settings.logo_url || "", (settings.site_name || "P").slice(0, 1).toUpperCase())}
            ${platformAssetField("Favicon", "favicon_url", "platformFaviconFile", "platformFaviconPreview", settings.favicon_url || "", "F")}
          </div>
          ${socialLinksBuilderHTML(settings.social_links || [])}
        </section>
        <section data-settings-panel="localization" class="settings-tab-section" hidden>
          <div class="settings-provider">
            <h2>Platform time zone</h2>
            <p class="muted">Task, comment, reply, notification, and activity timestamps use this timezone and show AM/PM time.</p>
            <div class="field">
              <label>Time zone</label>
              <select name="time_zone" id="settingsTimeZoneSelect">${timeZoneOptionsHTML(settings.time_zone || "UTC")}</select>
            </div>
            <p class="muted">Preview: <span id="settingsTimeZonePreview">${esc(fmtDateTimeInTimeZone(new Date().toISOString(), settings.time_zone || "UTC"))}</span></p>
          </div>
        </section>
        <section data-settings-panel="google" class="settings-tab-section" hidden>
          <label class="check-row"><input type="checkbox" name="google_signin_enabled" ${settings.google_signin_enabled ? "checked" : ""}> Enable Google sign in and registration</label>
          <div class="grid-2">
            <div class="field"><label>Google client ID</label><input name="google_client_id" value="${esc(settings.google_client_id || "")}" autocomplete="off"></div>
            <div class="field"><label>Redirect URL</label><input name="google_redirect_url" value="${esc(settings.google_redirect_url || `${location.origin}/api/auth/google/callback`)}"></div>
          </div>
          ${secretField("Google client secret", "google_client_secret", "google_client_secret_set", "clear_google_client_secret")}
        </section>
        <section data-settings-panel="smtp" class="settings-tab-section" hidden>
          <label class="check-row"><input type="checkbox" name="smtp_enabled" ${settings.smtp_enabled ? "checked" : ""}> Enable SMTP delivery</label>
          <div class="grid-3">
            <div class="field"><label>SMTP host</label><input name="smtp_host" value="${esc(settings.smtp_host || "")}" placeholder="smtp.example.com"></div>
            <div class="field"><label>SMTP port</label><input name="smtp_port" value="${esc(settings.smtp_port || "587")}" inputmode="numeric"></div>
            <div class="field"><label>From email</label><input type="email" name="smtp_from" value="${esc(settings.smtp_from || "")}"></div>
          </div>
          <div class="grid-2">
            <div class="field"><label>SMTP username</label><input name="smtp_user" value="${esc(settings.smtp_user || "")}" autocomplete="off"></div>
            ${secretField("SMTP password", "smtp_password", "smtp_password_set", "clear_smtp_password")}
          </div>
          <div class="smtp-test-box">
            <div>
              <h2>Test delivery</h2>
              <p class="muted">Saves the current SMTP settings, then sends a real test email.</p>
            </div>
            <div class="smtp-test-row">
              <div class="field"><label>Test recipient</label><input id="smtpTestRecipient" type="email" value="${esc(state.me?.email || settings.company_email || "")}" placeholder="owner@example.com"></div>
              <button class="btn" id="smtpTestBtn" type="button">${icon("send")}Send test email</button>
            </div>
            <p class="status-line"></p>
          </div>
        </section>
        <section data-settings-panel="notifications" class="settings-tab-section" hidden>
          <div class="settings-provider">
            <h2>Owner email notifications</h2>
            <p class="muted">These emails use the SMTP settings. Chat emails are sent once when a chat room is created, not for every message.</p>
            <div class="field"><label>Send owner emails to</label><input type="email" name="owner_notification_email" value="${esc(settings.owner_notification_email || settings.company_email || "")}" placeholder="owner@example.com"></div>
            <div class="check-list">
              <label class="check-row"><input type="checkbox" name="owner_notify_registration" ${settings.owner_notify_registration ? "checked" : ""}> New user registration</label>
              <label class="check-row"><input type="checkbox" name="owner_notify_purchase" ${settings.owner_notify_purchase ? "checked" : ""}> Successful PayPal purchase</label>
              <label class="check-row"><input type="checkbox" name="owner_notify_new_chat" ${settings.owner_notify_new_chat ? "checked" : ""}> New chat session</label>
            </div>
          </div>
        </section>
        <section data-settings-panel="payments" class="settings-tab-section" hidden>
          <article class="settings-provider">
            <h2>PayPal</h2>
            <label class="check-row"><input type="checkbox" name="paypal_enabled" ${settings.paypal_enabled ? "checked" : ""}> Enable PayPal checkout</label>
            <div class="grid-2">
              <div class="field"><label>Mode</label><select name="paypal_mode"><option value="sandbox" ${(settings.paypal_mode || "sandbox") === "sandbox" ? "selected" : ""}>Sandbox</option><option value="live" ${settings.paypal_mode === "live" ? "selected" : ""}>Live</option></select></div>
              <div class="field"><label>Client ID</label><input name="paypal_client_id" value="${esc(settings.paypal_client_id || "")}" autocomplete="off"></div>
            </div>
            <div class="grid-2">
              ${secretField("Client secret", "paypal_client_secret", "paypal_client_secret_set", "clear_paypal_client_secret")}
              <div class="field"><label>Webhook ID</label><input name="paypal_webhook_id" value="${esc(settings.paypal_webhook_id || "")}" autocomplete="off"></div>
            </div>
          </article>
        </section>
        <section data-settings-panel="colors" class="settings-tab-section" hidden>
          <div class="settings-color-preview">
            <div>
              <h2>Preview heading</h2>
              <p>Body text and buttons will follow these saved platform colors.</p>
            </div>
            <button class="btn primary" type="button">Primary button</button>
          </div>
          <div class="grid-3">
            ${colorField("Primary accent", "theme_primary_color")}
            ${colorField("Primary hover", "theme_primary_strong_color")}
            ${colorField("Primary button", "theme_button_color")}
            ${colorField("Button text", "theme_button_text_color")}
            ${colorField("Font text", "theme_font_color")}
            ${colorField("Heading text", "theme_heading_color")}
            ${colorField("Page background", "theme_background_color")}
          </div>
        </section>
        <div class="settings-save-row">
          <button class="btn primary" type="submit">${icon("save")}Save settings</button>
        </div>
        <p class="status-line" id="settingsFormStatus"></p>
      </form>
    </section>`);
  document.querySelectorAll("[data-settings-tab]").forEach((button) => button.addEventListener("click", () => {
    const tab = button.dataset.settingsTab;
    document.querySelectorAll("[data-settings-tab]").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll("[data-settings-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.settingsPanel !== tab;
    });
  }));
  $("#settingsTimeZoneSelect")?.addEventListener("change", (event) => {
    const preview = $("#settingsTimeZonePreview");
    if (preview) preview.textContent = fmtDateTimeInTimeZone(new Date().toISOString(), event.currentTarget.value);
  });
  document.querySelectorAll(".color-setting-field input[type='color']").forEach((input) => {
    const textInput = document.querySelector(`[data-color-text="${selectorEscape(input.name)}"]`);
    input.addEventListener("input", () => {
      if (textInput) textInput.value = input.value;
      state.platformSettings = { ...(state.platformSettings || {}), [input.name]: input.value };
      applyPlatformTheme(state.platformSettings || {});
    });
  });
  document.querySelectorAll("[data-color-text]").forEach((input) => {
    const colorInput = document.querySelector(`input[type='color'][name="${selectorEscape(input.dataset.colorText)}"]`);
    input.addEventListener("input", () => {
      const value = input.value.trim();
      if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
        if (colorInput) colorInput.value = value;
        state.platformSettings = { ...(state.platformSettings || {}), [input.dataset.colorText]: value };
        applyPlatformTheme(state.platformSettings || {});
      }
    });
  });
  bindSocialLinksBuilder($("#settingsForm"));
  icons();
  const settingsPayloadFromForm = (form) => {
    const body = Object.fromEntries(new FormData(form).entries());
    [
      "google_signin_enabled",
      "smtp_enabled",
      "owner_notify_registration",
      "owner_notify_purchase",
      "owner_notify_new_chat",
      "paypal_enabled",
      "clear_google_client_secret",
      "clear_smtp_password",
      "clear_paypal_client_secret",
    ].forEach((key) => {
      body[key] = Boolean(form.elements[key]?.checked);
    });
    body.social_links = collectSocialLinks(form);
    return body;
  };
  const setSettingsStatus = (text, error = false) => {
    const line = $("#settingsFormStatus");
    if (!line) return;
    line.textContent = text || "";
    line.style.color = error ? "var(--danger)" : "var(--text-secondary)";
  };
  const bindPlatformAssetUpload = (fileID, urlID, previewID, purpose, label) => {
    $(`#${fileID}`)?.addEventListener("change", async (event) => {
      const file = event.currentTarget.files?.[0];
      if (!file) return;
      try {
        setSettingsStatus(`Uploading ${label}...`);
        const data = await uploadResizedImage(file, purpose, 500);
        const urlInput = $(`#${urlID}`);
        if (urlInput) urlInput.value = data.url || "";
        const preview = $(`#${previewID}`);
        if (preview) preview.innerHTML = `<img src="${esc(data.url || "")}" alt="">`;
        if (purpose === "platform_favicon") {
          applyPlatformFavicon({ ...(state.platformSettings || {}), favicon_url: data.url || "" });
        }
        setSettingsStatus(`${label} uploaded at max 500x500. Save settings to apply it.`);
      } catch (error) {
        setSettingsStatus(error.message, true);
      }
    });
  };
  bindPlatformAssetUpload("platformLogoFile", "platformLogoFileUrl", "platformLogoPreview", "platform_logo", "Platform logo");
  bindPlatformAssetUpload("platformFaviconFile", "platformFaviconFileUrl", "platformFaviconPreview", "platform_favicon", "Favicon");
  $("#smtpTestBtn")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const box = button.closest(".smtp-test-box");
    const form = $("#settingsForm");
    const recipient = String($("#smtpTestRecipient")?.value || "").trim();
    try {
      button.disabled = true;
      setFormStatus(box, "Saving SMTP settings...");
      const result = await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(settingsPayloadFromForm(form)) });
      state.platformSettings = result.settings || state.platformSettings;
      applyPlatformTheme(state.platformSettings || {});
      applyPlatformFavicon(state.platformSettings || {});
      setSettingsStatus("Saved before SMTP test.");
      setFormStatus(box, "Sending test email...");
      const sent = await api("/api/admin/settings/smtp/test", { method: "POST", body: JSON.stringify({ recipient }) });
      setFormStatus(box, `Test email sent to ${sent.recipient}. Check the inbox and spam folder.`);
    } catch (error) {
      setFormStatus(box, error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  $("#settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const body = settingsPayloadFromForm(form);
      const result = await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(body) });
      state.platformSettings = result.settings || state.platformSettings;
      applyPlatformTheme(state.platformSettings || {});
      applyPlatformFavicon(state.platformSettings || {});
      setSettingsStatus("Saved");
    } catch (error) {
      setSettingsStatus(error.message, true);
    }
  });
}

async function renderCompanySettings() {
  const team = state.team || {};
  const personalTeam = state.personalTeam || (state.me?.role === "users_member" ? null : team);
  const canManageCurrentTeam = state.me?.role === "users_admin";
  const canEditCompany = state.me?.role !== "owner_adm";
  const invitationData = canManageCurrentTeam && team.id ? await api(`/api/teams/${team.id}/invitations`).catch(() => ({ invitations: [] })) : { invitations: [] };
  const pendingInvitationData = await api("/api/users/me/invitations").catch(() => ({ invitations: [] }));
  const invitations = invitationData.invitations || [];
  const pendingInvitations = pendingInvitationData.invitations || [];
  const showBillingSettings = state.me?.role !== "owner_adm";
  const settingsMembership = activeWorkspaceMembership();
  const settingsPlanData = showBillingSettings ? await api("/api/subscriptions/plans").catch(() => ({ plans: settingsMembership.plans || [] })) : { plans: [] };
  const settingsPlans = settingsPlanData.plans || settingsMembership.plans || [];
  const settingsBillingTeamID = activeWorkspaceTeamID() || state.team?.id || state.personalTeam?.id || "";
  const settingsInvoiceData = showBillingSettings && settingsBillingTeamID ? await api(`/api/subscriptions/${settingsBillingTeamID}/invoices`).catch(() => ({ invoices: [] })) : { invoices: [] };
  const settingsInvoices = settingsInvoiceData.invoices || [];
  const settingsPaidMembership = currentMembershipIsPaid(settingsMembership);
  const personalCompanyName = personalTeam?.name || `${state.me?.name || "My"}'s Company`;
  const logoMarkup = personalTeam?.logo_url ? `<img src="${esc(personalTeam.logo_url)}" alt="">` : esc((personalCompanyName || "P").slice(0, 1).toUpperCase());
  const profileAvatarMarkup = state.me?.avatar_url ? `<img src="${esc(state.me.avatar_url)}" alt="">` : userInitial();
  const companyAccess = state.companyAccess || {};
  const joinedAt = companyAccess.joined_at || state.me?.created_at;
  const accessCompany = companyAccess.company_name || team.name || "Assigned company";
  const accessRole = staffRoleLabel(companyAccess.staff_role || state.me?.staff_role) || "staff";
  const accessStatus = membershipStatusLabel(companyAccess.status || state.me?.status);
  shell("Settings", `
    <div class="page-title">
      <div>
        <h1>Settings</h1>
        <p class="muted">@${esc(state.me?.username || "profile")} - Personal profile and security</p>
      </div>
      <div class="toolbar">
        ${state.me?.role === "owner_adm" ? `<a class="btn" href="/admin/settings">${icon("shield-check")}Platform settings</a>` : ""}
        <button class="btn" id="settingsHelpBtn" type="button">${icon("circle-help")}Help</button>
      </div>
    </div>
    <div class="settings-stack">
      <section class="panel">
        <h2>My Profile</h2>
        <form id="myProfileForm" class="form-grid">
          <div class="logo-setting">
            <div class="company-logo-preview" id="profileAvatarPreview">${profileAvatarMarkup}</div>
            <div class="field">
              <label>Profile photo</label>
              <input id="profilePhotoFile" type="file" accept="image/*">
              <input id="profileAvatarUrl" name="avatar_url" value="${esc(state.me?.avatar_url || "")}" placeholder="/uploads/avatar.png">
            </div>
          </div>
          <div class="grid-3">
            <div class="field"><label>Name</label><input name="name" value="${esc(state.me?.name || "")}" required></div>
            <div class="field"><label>Username</label><input name="username" value="${esc(state.me?.username || "")}" required pattern="[a-zA-Z0-9_]{3,24}"></div>
            <div class="field"><label>Email</label><input type="email" name="email" value="${esc(state.me?.email || "")}" required></div>
          </div>
          <div class="grid-2">
            <div class="field"><label>Account role</label><input value="${esc(accountRoleLabel())}" disabled></div>
            <div class="field"><label>Account status</label><input value="${esc(state.me?.status || "active")}" disabled></div>
          </div>
          <button class="btn primary" type="submit">${icon("save")}Save profile</button>
          <p class="status-line"></p>
        </form>
      </section>
      ${state.me?.role === "users_member" ? `
        <section class="panel">
          <h2>Invited Company Access</h2>
          <div class="access-list">
            <article class="access-row">
              <div class="access-summary">
                <strong>${esc(accessCompany)}</strong>
                <span class="muted">Listed as ${esc(accessRole)} since ${esc(fmtDayMonthYear(joinedAt))}</span>
                <span class="pill ${accessStatus === "blocked" || accessStatus === "left company" ? "danger" : ""}">${esc(accessStatus)}</span>
              </div>
              <button class="btn danger compact" id="leaveCompanyBtn" type="button">${icon("log-out")}Leave</button>
            </article>
          </div>
          <p class="status-line"></p>
        </section>` : ""}
      ${pendingInvitations.length ? `
        <section class="panel">
          <h2>Pending Invitations</h2>
          <div class="access-list">${pendingInvitations.map((invite) => `
            <article class="access-row">
              <div class="access-summary">
                <strong>${esc(invite.company_name || "Company invitation")}</strong>
                <span class="muted">Invited to join with @${esc(invite.username || "username")}</span>
              </div>
              <span class="pill warn">${esc(invite.status || "pending")}</span>
              <button class="btn danger compact" type="button" data-decline-settings-invite="${invite.id}">${icon("x")}Decline</button>
            </article>`).join("")}</div>
        </section>` : ""}
      ${canEditCompany ? `
        <section class="panel">
          <h2>Company Profile</h2>
          <form id="companyProfileForm" class="form-grid">
            <div class="logo-setting">
              <div class="company-logo-preview" id="companyLogoPreview">${logoMarkup}</div>
              <div class="field">
                <label>Company logo</label>
                <input id="companyLogoFile" type="file" accept="image/*">
                <input id="companyLogoUrl" name="logo_url" value="${esc(personalTeam?.logo_url || "")}" placeholder="/uploads/logo.png">
              </div>
            </div>
            <div class="grid-2">
              <div class="field"><label>Company name</label><input name="name" value="${esc(personalCompanyName)}" required></div>
              <div class="field"><label>Company email</label><input type="email" name="company_email" value="${esc(personalTeam?.company_email || state.me?.email || "")}"></div>
            </div>
            <button class="btn primary" type="submit">${icon("save")}Save company</button>
            <p class="status-line"></p>
          </form>
        </section>` : ""}
      ${canManageCurrentTeam ? `
        <section class="panel">
          <h2>Add Staff</h2>
          <form id="staffInviteForm" class="form-grid">
            <div class="field"><label>Email or @username</label><input name="recipient" required placeholder="staff@company.com or @alex_dev" autocomplete="off"></div>
            <button class="btn primary" type="submit">${icon("user-plus")}Send invitation</button>
            <p class="status-line"></p>
          </form>
          <div class="task-list invite-history">${invitationStatusRows(invitations)}</div>
        </section>` : ""}
      ${showBillingSettings ? `
        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>Billing</h2>
              <p class="muted">${settingsPaidMembership ? "Membership details and receipts for this workspace." : "Plans, trial state, approvals, and receipts for this workspace."}</p>
            </div>
            <a class="btn compact" href="/settings/billing">${icon("external-link")}Open billing page</a>
          </div>
        </section>
        ${settingsPaidMembership ? billingMembershipDetailsHTML(settingsMembership, settingsPlans) : `
          <section class="panel paywall-panel">
            <h2>${settingsMembership.status === "trialing" ? "Trial membership" : "Choose a package"}</h2>
            ${settingsMembership.status === "trialing" ? `<p class="muted">Your trial is active until ${esc(usefulBillingDate(settingsMembership.trial_ends_at) || "the trial expiry date")}. Upgrade when you are ready to keep access after the trial.</p>` : ""}
            ${pricingCardsHTML(settingsPlans)}
          </section>`}
        ${billingInvoicesPanelHTML(settingsInvoices)}
      ` : ""}
      <section class="panel">
        <h2>Update Password</h2>
        <div id="passwordUpdatePanel" class="form-grid">
          <p class="muted">Password changes require a 6-digit code sent to ${esc(state.me?.email || "your email")}.</p>
          <button class="btn primary" id="requestPasswordOtpBtn" type="button">${icon("key-round")}Update password</button>
          <form id="passwordForm" class="form-grid" hidden>
            <div class="grid-3">
              <div class="field"><label>Email code</label><input name="code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" required></div>
              <div class="field"><label>New password</label><input type="password" name="new_password" required minlength="8" autocomplete="new-password"></div>
              <div class="field"><label>Confirm password</label><input type="password" name="confirm_password" required minlength="8" autocomplete="new-password"></div>
            </div>
            <div class="toolbar">
              <button class="btn primary" type="submit">${icon("save")}Save new password</button>
              <button class="btn ghost" id="cancelPasswordUpdateBtn" type="button">${icon("x")}Cancel</button>
            </div>
          </form>
          <p class="status-line"></p>
        </div>
      </section>
      <section class="panel">
        <h2>Two-factor Authentication</h2>
        ${state.me?.two_factor_enabled ? `
          <p class="pill">Enabled</p>
          <form id="disable2faForm" class="form-grid" style="margin-top:12px">
            <div class="field"><label>Current password</label><input type="password" name="current_password" required></div>
            <button class="btn danger" type="submit">${icon("shield-off")}Disable 2FA</button>
            <p class="status-line"></p>
          </form>
        ` : `
          <button class="btn primary" id="setup2faBtn" type="button">${icon("shield-check")}Set up 2FA</button>
          <div class="two-factor-setup" id="twoFactorSetup" hidden>
            <div class="two-factor-scan">
              <div class="two-factor-qr-wrap">
                <div class="two-factor-qr-card">
                  <img id="twoFactorQRCodeImage" alt="Authenticator QR code" hidden>
                  <canvas id="twoFactorQRCode" width="180" height="180" hidden></canvas>
                  <span id="twoFactorQRPlaceholder">QR</span>
                </div>
                <p class="two-factor-qr-note muted" id="twoFactorQRStatus">Generating scan code...</p>
              </div>
              <div class="secret-box">
                <span class="muted">Authenticator setup key</span>
                <code id="twoFactorSecretText"></code>
                <div class="field"><label>Authenticator URL</label><input id="twoFactorURI" readonly></div>
                <button class="btn compact" id="copyTwoFactorSecretBtn" type="button">${icon("copy")}Copy setup key</button>
              </div>
            </div>
            <form id="enable2faForm" class="form-grid" style="margin-top:12px">
              <input type="hidden" name="secret" id="twoFactorSecret">
              <div class="field"><label>Authenticator code</label><input name="code" inputmode="numeric" maxlength="6" required></div>
              <button class="btn primary" type="submit">${icon("shield-check")}Enable 2FA</button>
              <p class="status-line"></p>
            </form>
          </div>
        `}
      </section>
    </div>`);

  $("#settingsHelpBtn")?.addEventListener("click", openHelpChatWidget);
  if (showBillingSettings && !settingsPaidMembership) {
    bindPurchaseButtons(async () => {
      await loadMe();
      await renderCompanySettings();
    });
  }

  $("#profilePhotoFile")?.addEventListener("change", async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const form = $("#myProfileForm");
    try {
      const uploadFile = await resizeProfilePhotoFile(file, 500);
      const body = new FormData();
      body.append("purpose", "profile");
      body.append("file", uploadFile);
      const data = await api("/api/uploads", { method: "POST", body });
      $("#profileAvatarUrl").value = data.url;
      $("#profileAvatarPreview").innerHTML = `<img src="${esc(data.url)}" alt="">`;
      setFormStatus(form, "Photo uploaded at max 500x500. Save profile to apply it.");
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });

  $("#myProfileForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api("/api/users/me", { method: "PATCH", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      await loadMe();
      await renderCompanySettings();
      setFormStatus($("#myProfileForm"), "Profile updated");
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });

  $("#companyLogoFile")?.addEventListener("change", async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const form = $("#companyProfileForm");
    try {
      const body = new FormData();
      body.append("file", file);
      const data = await api("/api/uploads", { method: "POST", body });
      $("#companyLogoUrl").value = data.url;
      $("#companyLogoPreview").innerHTML = `<img src="${esc(data.url)}" alt="">`;
      setFormStatus(form, "Logo uploaded. Save company to apply it.");
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });

  $("#companyProfileForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!canEditCompany) return;
    const form = event.currentTarget;
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      await api("/api/users/me/company-profile", { method: "PATCH", body: JSON.stringify(data) });
      await loadMe();
      await renderCompanySettings();
      setFormStatus($("#companyProfileForm"), "Company updated");
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });

  $("#staffInviteForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api(`/api/teams/${state.team.id}/invitations`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      form.reset();
      await renderCompanySettings();
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });

  $("#leaveCompanyBtn")?.addEventListener("click", async (event) => {
    const panel = event.currentTarget.closest(".panel");
    const typed = prompt(`Type Confirm to leave ${accessCompany}.`);
    if (typed === null) return;
    if (typed.trim() !== "Confirm") {
      setFormStatus(panel, "Leave company canceled. Type Confirm exactly to proceed.", true);
      return;
    }
    try {
      const data = await api("/api/users/me/company-access", { method: "DELETE" });
      if (data.access_token && data.refresh_token) storeTokens(data.access_token, data.refresh_token);
      await loadMe();
      await renderCompanySettings();
    } catch (error) {
      setFormStatus(panel, error.message, true);
    }
  });

  document.querySelectorAll("[data-decline-settings-invite]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!confirm("Decline this invitation?")) return;
    try {
      await api(`/api/invitations/${btn.dataset.declineSettingsInvite}/decline`, { method: "POST", body: JSON.stringify({}) });
      await loadMe();
      await renderCompanySettings();
    } catch (error) {
      setStatus(error.message, true);
    }
  }));

  bindInvitationCancels(renderCompanySettings);

  $("#requestPasswordOtpBtn")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const panel = $("#passwordUpdatePanel");
    try {
      button.disabled = true;
      setFormStatus(panel, "Sending verification code...");
      const data = await api("/api/users/me/password/otp", { method: "POST", body: JSON.stringify({}) });
      $("#passwordForm")?.removeAttribute("hidden");
      $("#passwordForm")?.querySelector("input[name='code']")?.focus();
      setFormStatus(panel, `Code sent to ${data.email || "your email"}. It expires in ${data.expires_in_minutes || 10} minutes.`);
    } catch (error) {
      setFormStatus(panel, error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  $("#cancelPasswordUpdateBtn")?.addEventListener("click", () => {
    const form = $("#passwordForm");
    form?.reset();
    form?.setAttribute("hidden", "");
    setFormStatus($("#passwordUpdatePanel"), "");
  });

  $("#passwordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const panel = $("#passwordUpdatePanel");
    try {
      const body = Object.fromEntries(new FormData(form).entries());
      if (body.new_password !== body.confirm_password) {
        setFormStatus(panel, "New password and confirmation do not match.", true);
        return;
      }
      delete body.confirm_password;
      const data = await api("/api/users/me/password", { method: "PATCH", body: JSON.stringify(body) });
      if (data.access_token && data.refresh_token) storeTokens(data.access_token, data.refresh_token);
      form.reset();
      form.setAttribute("hidden", "");
      setFormStatus(panel, "Password updated.");
    } catch (error) {
      setFormStatus(panel, error.message, true);
    }
  });

  $("#setup2faBtn")?.addEventListener("click", async () => {
    try {
      const data = await api("/api/users/me/2fa/setup", { method: "POST", body: JSON.stringify({}) });
      $("#twoFactorSetup").removeAttribute("hidden");
      $("#twoFactorSecret").value = data.secret;
      $("#twoFactorSecretText").textContent = data.secret;
      $("#twoFactorURI").value = data.otpauth_url;
      renderTwoFactorQRCode(data.otpauth_url, data.qr_png_data_url);
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  $("#copyTwoFactorSecretBtn")?.addEventListener("click", async () => {
    const secret = $("#twoFactorSecretText")?.textContent || "";
    try {
      await navigator.clipboard.writeText(secret);
      setFormStatus($("#enable2faForm"), "Setup key copied.");
    } catch {
      setFormStatus($("#enable2faForm"), "Select and copy the setup key manually.", true);
    }
  });

  $("#enable2faForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api("/api/users/me/2fa/enable", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      setFormStatus(form, "2FA enabled.");
      await loadMe();
      await renderCompanySettings();
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });

  $("#disable2faForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api("/api/users/me/2fa/disable", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      await loadMe();
      await renderCompanySettings();
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
}

async function renderPages() {
  const data = await api("/api/admin/pages");
  const pages = (data.pages || []).slice().sort((a, b) => (a.slug === "home" ? -1 : b.slug === "home" ? 1 : 0));
  const navItems = data.nav_items || [];
  const navSettings = data.nav_settings || {};
  shell("Pages", `
    <div class="page-title"><div><h1>Pages</h1><p class="muted">Build the home page, public pages, and the public navigation.</p></div></div>
    <div class="grid-2">
      <section class="panel"><h2>Visual pages</h2><div class="task-list">${pages.map(pageListRowHTML).join("") || `<p class="muted">No pages yet.</p>`}</div></section>
      <section class="panel">
        <h2>New page</h2>
        <form id="pageForm" class="form-grid"><div class="field"><label>Title</label><input name="title" required placeholder="About us"></div><div class="field"><label>Slug</label><input name="slug" required placeholder="about-us or home"></div><button class="btn primary">${icon("plus")}Create</button><p class="status-line"></p></form>
      </section>
    </div>
    <section class="panel">
      <div class="panel-head"><div><h2>Public nav bar</h2><p class="muted">Customize the links shown on the home page and public pages.</p></div><button class="btn" id="addNavItemBtn" type="button">${icon("plus")}Add link</button></div>
      <form id="publicNavForm" class="form-grid">
        ${publicNavSettingsHTML(navSettings)}
        <div id="publicNavRows" class="public-nav-builder">${publicNavRowsHTML(navItems)}</div>
        <button class="btn primary" type="submit">${icon("save")}Save nav bar</button>
        <p class="status-line"></p>
      </form>
    </section>`);
  $("#pageForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = await api("/api/admin/pages", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) });
      window.location.href = `/admin/pages/${data.page.slug}/edit`;
    } catch (error) {
      setStatus(error.message, true);
    }
  });
  bindPublicNavBuilder(navItems, navSettings);
}

function pageListRowHTML(page) {
  const url = publicPageURL(page.slug);
  const helper = page.slug === "home" && page.status !== "published" ? "Home page draft. Publish it to replace the current / page." : url;
  return `<article class="task-row"><div><h3>${esc(page.slug === "home" ? "Home page" : page.title)}</h3><span class="muted">${esc(helper)}</span></div><span class="pill">${esc(page.status)}</span><a class="btn compact" href="${esc(url)}" target="_blank" rel="noopener">${icon("external-link")}View</a><a class="btn" href="/admin/pages/${page.slug}/edit">${icon("file-pen")}Edit</a></article>`;
}

function publicPageURL(slug) {
  if (slug === "home") return "/";
  return `/p/${slug}`;
}

function publicNavRowsHTML(items = []) {
  const rows = items.length ? items : [
    { id: "home", label: "Home", url: "/", visible: true },
    { id: "pricing", label: "Pricing", url: "/pricing", visible: true },
    { id: "login", label: "Login", url: "/login", visible: true },
  ];
  return rows.map((item, index) => publicNavRowHTML(item, index)).join("");
}

function publicNavSettingsHTML(settings = {}) {
  const logoURL = String(settings.logo_url || "");
  const companyName = String(settings.company_name || state.platformSettings?.site_name || "bugmega");
  const initial = String(settings.brand_initial || companyName.slice(0, 1) || "P").toUpperCase();
  const buttonStyle = String(settings.button_style || "primary");
  return `<div class="public-nav-settings">
    <div class="logo-setting platform-asset-upload">
      <div class="company-logo-preview" id="publicNavLogoPreview">${logoURL ? `<img src="${esc(logoURL)}" alt="">` : esc(initial)}</div>
      <div class="field">
        <label>Navbar logo</label>
        <input id="publicNavLogoFile" type="file" accept="image/png,image/jpeg,image/gif,image/webp">
        <input id="publicNavLogoFileUrl" name="logo_url" value="${esc(logoURL)}" readonly placeholder="/uploads/users/.../logo.png">
        <small class="muted">Recommended size: 500x500px. Uploaded images are resized to max 500x500px.</small>
      </div>
    </div>
    <div class="grid-2">
      <div class="field"><label>Company name</label><input name="company_name" value="${esc(companyName)}" placeholder="Company name"></div>
      <div class="field"><label>Button text</label><input name="button_text" value="${esc(settings.button_text || "Get Started")}" placeholder="Get Started"></div>
    </div>
    <div class="grid-2">
      <div class="field"><label>Button link</label><input name="button_url" value="${esc(settings.button_url || "/register")}" placeholder="/register or https://example.com"></div>
      <div class="field"><label>Button style</label><select name="button_style">
        <option value="primary" ${buttonStyle === "primary" ? "selected" : ""}>Primary button</option>
        <option value="default" ${["default", "outline", "secondary"].includes(buttonStyle) ? "selected" : ""}>Outline button</option>
        <option value="quiet" ${buttonStyle === "quiet" ? "selected" : ""}>Plain button</option>
      </select></div>
    </div>
  </div>`;
}

function publicNavRowHTML(item = {}, index = 0) {
  return `<article class="public-nav-row" data-nav-row>
    <input type="hidden" name="id" value="${esc(item.id || crypto.randomUUID())}">
    <label><span>Label</span><input name="label" value="${esc(item.label || "")}" placeholder="About"></label>
    <label><span>URL</span><input name="url" value="${esc(item.url || "")}" placeholder="/p/about"></label>
    <label class="inline-check"><input type="checkbox" name="visible" ${item.visible !== false ? "checked" : ""}> Visible</label>
    <div class="toolbar">
      <button class="btn icon quiet" type="button" data-nav-move="-1" title="Move up">${icon("arrow-up")}</button>
      <button class="btn icon quiet" type="button" data-nav-move="1" title="Move down">${icon("arrow-down")}</button>
      <button class="btn icon quiet danger-text" type="button" data-nav-remove title="Remove">${icon("trash-2")}</button>
    </div>
  </article>`;
}

function bindPublicNavBuilder(initialItems = [], initialSettings = {}) {
  let items = (initialItems.length ? initialItems : [
    { id: "home", label: "Home", url: "/", visible: true },
    { id: "pricing", label: "Pricing", url: "/pricing", visible: true },
    { id: "login", label: "Login", url: "/login", visible: true },
  ]).map((item) => ({ ...item }));
  const rows = $("#publicNavRows");
  const draw = () => {
    rows.innerHTML = publicNavRowsHTML(items);
    rows.querySelectorAll("[data-nav-remove]").forEach((btn) => btn.addEventListener("click", () => {
      const index = [...rows.querySelectorAll("[data-nav-row]")].indexOf(btn.closest("[data-nav-row]"));
      items = collect();
      items.splice(index, 1);
      draw();
    }));
    rows.querySelectorAll("[data-nav-move]").forEach((btn) => btn.addEventListener("click", () => {
      const index = [...rows.querySelectorAll("[data-nav-row]")].indexOf(btn.closest("[data-nav-row]"));
      const next = index + Number(btn.dataset.navMove || 0);
      if (next < 0 || next >= items.length) return;
      items = collect();
      const moved = items.splice(index, 1)[0];
      items.splice(next, 0, moved);
      draw();
    }));
    icons();
  };
  const collect = () => [...rows.querySelectorAll("[data-nav-row]")].map((row, index) => ({
    id: row.querySelector("input[name='id']").value || crypto.randomUUID(),
    label: row.querySelector("input[name='label']").value.trim(),
    url: row.querySelector("input[name='url']").value.trim(),
    visible: row.querySelector("input[name='visible']").checked,
    order: index + 1,
  })).filter((item) => item.label && item.url);
  const form = $("#publicNavForm");
  const collectSettings = () => ({
    logo_url: form?.elements.logo_url?.value.trim() || "",
    company_name: form?.elements.company_name?.value.trim() || "",
    button_text: form?.elements.button_text?.value.trim() || "",
    button_url: form?.elements.button_url?.value.trim() || "",
    button_style: form?.elements.button_style?.value || "primary",
  });
  const fillSettings = (settings = {}) => {
    if (!form) return;
    if (form.elements.logo_url) form.elements.logo_url.value = settings.logo_url || "";
    if (form.elements.company_name) form.elements.company_name.value = settings.company_name || "";
    if (form.elements.button_text) form.elements.button_text.value = settings.button_text || "Get Started";
    if (form.elements.button_url) form.elements.button_url.value = settings.button_url || "/register";
    if (form.elements.button_style) form.elements.button_style.value = settings.button_style || "primary";
    const preview = $("#publicNavLogoPreview");
    if (preview) preview.innerHTML = settings.logo_url ? `<img src="${esc(settings.logo_url)}" alt="">` : esc((settings.brand_initial || settings.company_name || "P").slice(0, 1).toUpperCase());
  };
  fillSettings(initialSettings);
  $("#publicNavLogoFile")?.addEventListener("change", async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file || !form) return;
    try {
      setFormStatus(form, "Uploading navbar logo...");
      const data = await uploadResizedImage(file, "public_nav_logo", 500);
      if (form.elements.logo_url) form.elements.logo_url.value = data.url || "";
      const preview = $("#publicNavLogoPreview");
      if (preview) preview.innerHTML = `<img src="${esc(data.url || "")}" alt="">`;
      setFormStatus(form, "Navbar logo uploaded. Save nav bar to apply it.");
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  $("#addNavItemBtn")?.addEventListener("click", () => {
    items = collect();
    items.push({ id: crypto.randomUUID(), label: "New page", url: "/p/new-page", visible: true });
    draw();
  });
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      items = collect();
      const data = await api("/api/admin/pages/nav", { method: "PUT", body: JSON.stringify({ ...collectSettings(), items }) });
      items = data.nav_items || items;
      fillSettings(data.nav_settings || collectSettings());
      draw();
      setFormStatus(form, "Navigation saved");
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  draw();
}

function pageBuilderSlug(value = "") {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function pageBuilderShortcodesHTML(plans = []) {
  const scalarShortcodes = [
    ["building-2", "[[site_name]]", "Platform/company name"],
    ["sparkles", "[[company_slogan]]", "Platform slogan"],
    ["mail", "[[company_email]]", "Company email"],
    ["contact", "[[company_contact]]", "Company contact"],
    ["map-pin", "[[company_address]]", "Company address"],
    ["calendar", "[[current_date]]", "Current date"],
    ["badge-dollar-sign", "[[pricing]]", "All pricing plans"],
    ["share-2", "[[social_links]]", "Social media list"],
    ["id-card", "[[company_contact_card]]", "Contact card"],
  ];
  const planShortcodes = (plans || []).map((plan) => [
    "badge-dollar-sign",
    `[[pricing:${pageBuilderSlug(plan.name || plan.id)}]]`,
    `Single plan: ${plan.name || "Plan"}`,
  ]);
  return `<div class="builder-shortcodes">
    <div class="panel-head compact"><div><strong>Shortcodes</strong><p class="muted">Click to insert into the selected editor field.</p></div></div>
    <div class="builder-shortcode-grid">
      ${[...scalarShortcodes, ...planShortcodes].map(([iconName, code, label]) => `<button class="builder-shortcode" type="button" data-insert-shortcode="${esc(code)}" title="${esc(label)}">${icon(iconName)}<span>${esc(code)}</span><small>${esc(label)}</small></button>`).join("")}
    </div>
  </div>`;
}

function insertTextIntoField(target, value) {
  if (!target || !value) return;
  if (target.isContentEditable) {
    target.focus();
    document.execCommand("insertText", false, value);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  if ("value" in target) {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    target.value = `${target.value.slice(0, start)}${value}${target.value.slice(end)}`;
    const next = start + value.length;
    target.focus();
    target.setSelectionRange?.(next, next);
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function bindPageBuilderShortcodes(root = document) {
  root.querySelectorAll("[data-insert-shortcode]").forEach((btn) => {
    btn.addEventListener("mousedown", (event) => event.preventDefault());
    btn.addEventListener("click", () => {
      const active = document.activeElement;
      const target = root.contains(active) && (active?.matches?.("input:not([type='hidden']), textarea") || active?.isContentEditable)
        ? active
        : root.querySelector("[data-page-rich-editor], textarea[name='text'], textarea[name='html'], input[name='heading']");
      insertTextIntoField(target, btn.dataset.insertShortcode);
    });
  });
}

async function renderPageEditor(slug) {
  const data = await api(`/api/admin/pages/${slug}`);
  const plans = (await api("/api/admin/plans").catch(() => ({ plans: [] }))).plans || [];
  let page = data.page;
  page.page_width = page.page_width || (page.slug === "home" ? "100%" : "840px");
  let blocks = normalizePageBuilderBlocks(page.blocks || []);
  shell("Page Builder", `
    <div class="page-title"><div><h1>${esc(page.title)}</h1><p class="muted">${esc(publicPageURL(page.slug))}</p></div><div class="toolbar"><a class="btn" href="${esc(publicPageURL(page.slug))}" target="_blank" rel="noopener">${icon("external-link")}View</a><button class="btn primary" id="publishPage">${icon("upload")}Publish</button><button class="btn" id="savePage">${icon("save")}Save draft</button></div></div>
    <div class="builder visual-builder">
      <aside class="builder-pane builder-palette"><h2>Blocks</h2>${pageBuilderPaletteHTML("root")}</aside>
      <section class="builder-pane builder-canvas-pane"><div class="panel-head"><h2>Live preview</h2><span class="pill">${esc(page.status || "draft")}</span></div><div id="builderCanvas" class="builder-canvas visual-canvas"></div></section>
      <aside class="builder-pane"><h2>Settings</h2><form id="blockSettings" class="form-grid"><p class="muted">Select a block.</p></form><p class="status-line"></p></aside>
    </div>`);
  let selectedID = blocks[0]?.id || "";
  let addMenuID = "";
  function applyCurrentSettings() {
    const formEl = $("#blockSettings");
    if (!formEl) return;
    syncRichEditors(formEl);
    syncPageRichEditors(formEl);
    const form = Object.fromEntries(new FormData(formEl).entries());
    page.title = form.page_title || page.title;
    page.page_width = form.page_width || page.page_width || "840px";
    delete form.page_title;
    delete form.page_width;
    const selected = findPageBlock(blocks, selectedID);
    if (selected) {
      selected.props = normalizePageBlockProps(selected.type, { ...selected.props, ...form });
      if (selected.type === "columns") normalizeColumnsBlock(selected);
    }
  }
  function draw() {
    blocks = normalizePageBuilderBlocks(blocks);
    $("#builderCanvas").innerHTML = blocks.length ? blocks.map((block) => pageBuilderBlockHTML(block, selectedID, addMenuID)).join("") : `<div class="builder-empty-state">Add a block from the left to start building this page.</div>`;
    document.querySelectorAll("[data-select-builder-block]").forEach((el) => el.addEventListener("click", (event) => {
      event.stopPropagation();
      selectedID = el.dataset.selectBuilderBlock;
      addMenuID = "";
      draw();
      drawSettings();
    }));
    document.querySelectorAll("[data-toggle-add-child]").forEach((btn) => btn.addEventListener("click", (event) => {
      event.stopPropagation();
      addMenuID = addMenuID === btn.dataset.toggleAddChild ? "" : btn.dataset.toggleAddChild;
      draw();
    }));
    document.querySelectorAll("[data-add-child-block]").forEach((btn) => btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const target = findPageBlock(blocks, btn.dataset.addChildTarget);
      if (!target || target.type !== "column") return;
      const block = createPageBlock(btn.dataset.addChildBlock);
      target.children = target.children || [];
      target.children.push(block);
      selectedID = block.id;
      addMenuID = "";
      draw();
      drawSettings();
    }));
    if (window.Sortable) {
      Sortable.create($("#builderCanvas"), {
        animation: 150,
        onEnd: (event) => {
          const moved = blocks.splice(event.oldIndex, 1)[0];
          blocks.splice(event.newIndex, 0, moved);
          selectedID = moved.id;
          draw();
          drawSettings();
        },
      });
    }
    icons();
  }
  function drawSettings() {
    const block = findPageBlock(blocks, selectedID);
    if (!block) {
      $("#blockSettings").innerHTML = pageSettingsHTML(page, plans);
      bindPageSettingsOnly();
      bindPageBuilderShortcodes($("#blockSettings"));
      icons();
      return;
    }
    const canDelete = block.type !== "column";
    const canDuplicate = block.type !== "column";
    $("#blockSettings").innerHTML = `
      ${pageSettingsHTML(page, plans)}
      <hr>
      <div class="field"><label>Selected block</label><input disabled value="${esc(pageBlockTypeLabel(block.type))}"></div>
      ${pageBlockSettingsFields(block)}
      <button class="btn primary" type="submit">${icon("check")}Apply</button>
      ${block.type === "column" ? `<div class="builder-field-group"><strong>Add inside this column</strong><div class="builder-mini-palette">${pageBuilderPaletteHTML("child", block.id)}</div></div>` : ""}
      ${canDuplicate ? `<button class="btn" type="button" id="duplicateBlock">${icon("copy")}Duplicate</button>` : ""}
      ${canDelete ? `<button class="btn danger" type="button" id="deleteBlock">${icon("trash-2")}Delete</button>` : `<p class="muted">Columns are controlled from the parent Columns block count.</p>`}`;
    $("#blockSettings").onsubmit = (event) => {
      event.preventDefault();
      applyCurrentSettings();
      draw();
      drawSettings();
    };
    $("#duplicateBlock")?.addEventListener("click", () => {
      const location = findPageBlockLocation(blocks, selectedID);
      if (!location) return;
      const duplicate = clonePageBlock(block);
      location.items.splice(location.index + 1, 0, duplicate);
      selectedID = duplicate.id;
      draw();
      drawSettings();
    });
    $("#deleteBlock")?.addEventListener("click", () => {
      const location = findPageBlockLocation(blocks, selectedID);
      if (!location) return;
      location.items.splice(location.index, 1);
      selectedID = blocks[0]?.id || "";
      draw();
      drawSettings();
    });
    document.querySelectorAll("[data-settings-add-child]").forEach((btn) => btn.addEventListener("click", () => {
      const target = findPageBlock(blocks, btn.dataset.settingsAddTarget);
      if (!target || target.type !== "column") return;
      const child = createPageBlock(btn.dataset.settingsAddChild);
      target.children = target.children || [];
      target.children.push(child);
      selectedID = child.id;
      draw();
      drawSettings();
    }));
    bindRichEditors($("#blockSettings"));
    bindPageRichEditors($("#blockSettings"));
    bindBuilderColorPickers($("#blockSettings"));
    bindPageBuilderShortcodes($("#blockSettings"));
    icons();
  }
  function bindPageSettingsOnly() {
    $("#blockSettings").onsubmit = (event) => {
      event.preventDefault();
      applyCurrentSettings();
      setFormStatus($("#blockSettings"), "Page title updated");
    };
  }
  document.querySelectorAll("[data-add-block]").forEach((btn) => btn.addEventListener("click", () => {
    const type = btn.dataset.addBlock;
    const block = createPageBlock(type);
    blocks.push(block);
    selectedID = block.id;
    draw();
    drawSettings();
  }));
  $("#savePage").addEventListener("click", async () => {
    applyCurrentSettings();
    await api(`/api/admin/pages/${slug}`, { method: "PUT", body: JSON.stringify({ title: page.title, page_width: page.page_width || "840px", blocks }) });
    setStatus("Draft saved");
  });
  $("#publishPage").addEventListener("click", async () => {
    applyCurrentSettings();
    await api(`/api/admin/pages/${slug}`, { method: "PUT", body: JSON.stringify({ title: page.title, page_width: page.page_width || "840px", blocks }) });
    await api(`/api/admin/pages/${slug}/publish`, { method: "POST" });
    setStatus("Published");
  });
  draw();
  drawSettings();
}

function pageSettingsHTML(page, plans = []) {
  return `<div class="field"><label>Page title</label><input name="page_title" value="${esc(page.title || "")}" required></div>
    <div class="field"><label>Page width</label><input name="page_width" value="${esc(page.page_width || "840px")}" placeholder="840px, 90%, 100vw"><small class="muted">Accepts px, %, or vw. Examples: 840px, 90%, 100vw.</small></div>
    ${pageBuilderShortcodesHTML(plans)}`;
}

function pageBlockTypeLabel(type) {
  return String(type || "block").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const PAGE_ROOT_BLOCK_TYPES = ["columns", "hero", "section_heading", "text", "heading", "rich_text", "html", "image", "video", "feature_grid", "button", "cta", "divider", "spacer"];
const PAGE_CHILD_BLOCK_TYPES = ["text", "heading", "rich_text", "html", "image", "video", "button", "columns", "divider", "spacer"];

function pageBuilderPaletteHTML(mode = "root", targetID = "") {
  const types = mode === "child" ? PAGE_CHILD_BLOCK_TYPES : PAGE_ROOT_BLOCK_TYPES;
  return types.map((type) => {
    if (mode === "child") return `<button class="btn compact" type="button" data-settings-add-target="${esc(targetID)}" data-settings-add-child="${esc(type)}">${icon("plus")}${pageBlockTypeLabel(type)}</button>`;
    return `<button class="btn" type="button" data-add-block="${esc(type)}">${icon("plus")}${pageBlockTypeLabel(type)}</button>`;
  }).join("");
}

function createPageBlock(type) {
  const block = { id: crypto.randomUUID(), type, props: defaultProps(type), children: [] };
  if (type === "columns") normalizeColumnsBlock(block);
  return block;
}

function createPageColumnBlock() {
  return { id: crypto.randomUUID(), type: "column", props: { flex_direction: "column", gap: 12, custom_css: "" }, children: [] };
}

function clonePageBlock(block) {
  const clone = JSON.parse(JSON.stringify(block));
  refreshPageBlockIDs(clone);
  return clone;
}

function refreshPageBlockIDs(block) {
  block.id = crypto.randomUUID();
  (block.children || []).forEach(refreshPageBlockIDs);
}

function normalizePageBuilderBlocks(items = []) {
  return (items || []).filter(Boolean).map(normalizePageBlock);
}

function normalizePageBlock(block) {
  block.id = block.id || crypto.randomUUID();
  block.props = normalizePageBlockProps(block.type, block.props || {});
  block.children = normalizePageBuilderBlocks(block.children || []);
  if (block.type === "columns") normalizeColumnsBlock(block);
  return block;
}

function normalizePageBlockProps(type, props = {}) {
  const next = { ...props };
  if (type === "columns") {
    next.columns = Math.max(1, Math.min(4, Number(next.columns || 2)));
    next.gap = Math.max(0, Math.min(80, Number(next.gap || 18)));
    next.direction = ["row", "row-reverse", "column", "column-reverse"].includes(next.direction) ? next.direction : "row";
  }
  if (type === "column") {
    next.flex_direction = ["column", "row", "row-reverse", "column-reverse"].includes(next.flex_direction) ? next.flex_direction : "column";
    next.gap = Math.max(0, Math.min(80, Number(next.gap || 12)));
    next.border_style = ["none", "solid", "dashed", "dotted", "double"].includes(next.border_style) ? next.border_style : "none";
    next.border_width = Math.max(0, Math.min(24, Number(next.border_width || 0)));
    if (next.border_style !== "none" && next.border_width <= 0) next.border_width = 1;
    next.border_radius = Math.max(0, Math.min(80, Number(next.border_radius || 0)));
    next.border_color = safeBuilderHexColor(next.border_color);
    next.background_color = safeBuilderHexColor(next.background_color);
    next.text_color = safeBuilderHexColor(next.text_color || next.color);
    delete next.color;
  }
  if (type === "spacer") next.height = Math.max(8, Math.min(96, Number(next.height || 24)));
  if (["text", "rich_text", "heading", "button"].includes(type)) {
    next.font_color = safeBuilderHexColor(next.font_color || next.text_color);
    next.font_size = Number(next.font_size || 0) > 0 ? Math.max(8, Math.min(120, Number(next.font_size || 0))) : "";
    next.font_family = safeBuilderFontFamily(next.font_family);
    next.letter_spacing = Number(next.letter_spacing || next.font_spacing || 0) !== 0 ? Math.max(-2, Math.min(12, Number(next.letter_spacing || next.font_spacing || 0))) : "";
    next.line_height = Number(next.line_height || 0) > 0 ? Math.max(0.8, Math.min(3, Number(next.line_height || 0))) : "";
    next.text_align = safeBuilderTextAlign(next.text_align);
    delete next.font_spacing;
    delete next.text_color;
  }
  return next;
}

function normalizeColumnsBlock(block) {
  const count = Math.max(1, Math.min(4, Number(block.props?.columns || block.children?.length || 2)));
  block.props = { ...block.props, columns: count };
  const columns = (block.children || []).filter((child) => child.type === "column").map(normalizePageBlock);
  while (columns.length < count) columns.push(createPageColumnBlock());
  block.children = columns.slice(0, count);
  return block;
}

function findPageBlock(items = [], id = "") {
  for (const block of items || []) {
    if (block.id === id) return block;
    const found = findPageBlock(block.children || [], id);
    if (found) return found;
  }
  return null;
}

function findPageBlockLocation(items = [], id = "") {
  for (let index = 0; index < (items || []).length; index += 1) {
    const block = items[index];
    if (block.id === id) return { items, index, block };
    const found = findPageBlockLocation(block.children || [], id);
    if (found) return found;
  }
  return null;
}

function pageBuilderBlockHTML(block, selectedID = "", addMenuID = "") {
  const selected = block.id === selectedID;
  if (block.type === "columns") {
    normalizeColumnsBlock(block);
    const props = block.props || {};
    return `<article class="builder-block visual-builder-block builder-columns-block ${selected ? "selected" : ""}" data-select-builder-block="${esc(block.id)}">
      <div class="builder-block-toolbar"><strong>${esc(pageBlockTypeLabel(block.type))}</strong><span>${esc(props.columns)} columns - ${esc(props.direction || "row")}</span></div>
      <div class="builder-preview-columns" style="--builder-columns:${esc(props.columns || 2)};gap:${esc(props.gap || 18)}px;flex-direction:${esc(props.direction || "row")};">
        ${(block.children || []).map((column) => pageBuilderColumnHTML(column, selectedID, addMenuID)).join("")}
      </div>
    </article>`;
  }
  return `<article class="builder-block visual-builder-block ${selected ? "selected" : ""}" data-select-builder-block="${esc(block.id)}">
    <div class="builder-block-toolbar"><strong>${esc(pageBlockTypeLabel(block.type))}</strong><span>${icon("grip-vertical")}</span></div>
    ${pageBuilderPreviewBlockHTML(block)}
  </article>`;
}

function pageBuilderColumnHTML(column, selectedID = "", addMenuID = "") {
  const props = column.props || {};
  const selected = column.id === selectedID;
  const children = column.children || [];
  const columnStyle = pageBuilderColumnStyleCSS(props);
  return `<div class="builder-preview-column builder-block ${selected ? "selected" : ""}" data-select-builder-block="${esc(column.id)}" style="${esc(columnStyle)}">
    <div class="builder-block-toolbar"><strong>Column</strong><span>${esc(props.flex_direction || "column")}</span></div>
    <div class="builder-column-children" style="gap:${esc(props.gap || 12)}px;flex-direction:${esc(props.flex_direction || "column")};">
      ${children.length ? children.map((child) => pageBuilderBlockHTML(child, selectedID, addMenuID)).join("") : `<div class="builder-column-empty">Empty column</div>`}
    </div>
    <button class="btn compact builder-add-component" type="button" data-toggle-add-child="${esc(column.id)}">${icon("plus")}Add component</button>
    ${addMenuID === column.id ? `<div class="builder-add-menu">${PAGE_CHILD_BLOCK_TYPES.map((type) => `<button class="btn compact" type="button" data-add-child-target="${esc(column.id)}" data-add-child-block="${esc(type)}">${icon("plus")}${pageBlockTypeLabel(type)}</button>`).join("")}</div>` : ""}
  </div>`;
}

function pageBuilderPreviewBlockHTML(block) {
  const props = block.props || {};
  const typography = pageBuilderTypographyCSS(props);
  const buttonTypography = pageBuilderTypographyCSS(props, { skipAlign: true });
  const buttonAlign = pageBuilderTextAlignCSS(props);
  if (block.type === "hero") return `<section class="builder-preview-hero"><span>${esc(props.eyebrow || "Eyebrow")}</span><h1>${esc(props.heading || "Hero heading")}</h1><p>${esc(props.text || "Hero supporting text")}</p><div class="toolbar"><button class="btn primary compact" type="button">${esc(props.primary_label || "Get started")}</button>${props.secondary_label ? `<button class="btn compact" type="button">${esc(props.secondary_label)}</button>` : ""}</div></section>`;
  if (block.type === "section_heading") return `<div class="section-head builder-preview-section-head"><p class="eyebrow">${esc(props.eyebrow || "Section")}</p><h2>${esc(props.heading || "Section heading")}</h2><p>${esc(props.text || "")}</p></div>`;
  if (block.type === "heading") return `<${props.level || "h2"} style="${esc(typography)}">${esc(props.text || "Heading")}</${props.level || "h2"}>`;
  if (block.type === "text") return `<p style="${esc(typography)}">${esc(props.text || "Text")}</p>`;
  if (block.type === "rich_text") return `<div class="rich-text ${esc(props.class_name || "")}" style="${esc(typography)}">${pageRichSafeHTML(props.text || "Write page copy here.")}</div>`;
  if (block.type === "html") return `<pre class="builder-html-preview">${esc(props.html || "<p>Safe HTML content</p>")}</pre>`;
  if (block.type === "image") return props.url ? `<figure class="builder-preview-image"><img src="${esc(props.url)}" alt="${esc(props.alt || "")}"></figure>` : `<div class="builder-preview-placeholder">Image URL</div>`;
  if (block.type === "video") return `<div class="builder-preview-placeholder">${esc(props.url || "Video URL")}</div>`;
  if (block.type === "feature_grid") return `<div class="feature-grid builder-preview-features">${[1, 2, 3].map((i) => `<article class="feature-card"><h3>${esc(props[`title_${i}`] || `Feature ${i}`)}</h3><p>${esc(props[`text_${i}`] || "Feature description")}</p></article>`).join("")}</div>`;
  if (block.type === "button") return `<p style="${esc(buttonAlign)}"><a class="btn primary" href="${esc(props.url || "#")}" style="${esc(buttonTypography)}">${esc(props.label || "Button")}</a></p>`;
  if (block.type === "cta") return `<section class="closing-cta builder-preview-cta"><h2>${esc(props.heading || "Ready to start?")}</h2><p>${esc(props.text || "")}</p><a class="btn primary compact" href="${esc(props.url || "#")}">${esc(props.label || "Get started")}</a></section>`;
  if (block.type === "divider") return `<hr>`;
  if (block.type === "spacer") return `<div class="builder-spacer-preview" style="height:${Math.max(8, Math.min(96, Number(props.height || 24)))}px"></div>`;
  return `<p>${esc(props.text || pageBlockTypeLabel(block.type))}</p>`;
}

function textInput(name, label, value = "", type = "text") {
  const extra = type === "number" ? ` step="any"` : "";
  return `<div class="field"><label>${esc(label)}</label><input type="${esc(type)}" name="${esc(name)}" value="${esc(value || "")}"${extra}></div>`;
}

function textAreaInput(name, label, value = "") {
  return `<div class="field"><label>${esc(label)}</label><textarea name="${esc(name)}">${esc(value || "")}</textarea></div>`;
}

function selectInput(name, label, value, options = []) {
  return `<div class="field"><label>${esc(label)}</label><select name="${esc(name)}">${options.map(([optionValue, optionLabel]) => `<option value="${esc(optionValue)}" ${value === optionValue ? "selected" : ""}>${esc(optionLabel)}</option>`).join("")}</select></div>`;
}

function safeBuilderHexColor(value = "") {
  const color = String(value || "").trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : "";
}

function colorInput(name, label, value = "", fallback = "#0b8f7a") {
  const color = safeBuilderHexColor(value);
  const pickerValue = color || fallback;
  return `<div class="field builder-color-field">
    <label>${esc(label)}</label>
    <div class="builder-color-row">
      <input type="text" name="${esc(name)}" value="${esc(color)}" placeholder="#0b8f7a" data-builder-color-text="${esc(name)}">
      <input type="color" value="${esc(pickerValue)}" data-builder-color-picker="${esc(name)}" title="Pick ${esc(label)}">
      <button class="btn icon quiet" type="button" data-builder-color-clear="${esc(name)}" title="Clear ${esc(label)}">${icon("x")}</button>
    </div>
  </div>`;
}

function bindBuilderColorPickers(root = document) {
  root.querySelectorAll("[data-builder-color-picker]").forEach((picker) => {
    if (picker.dataset.builderColorBound === "1") return;
    picker.dataset.builderColorBound = "1";
    picker.addEventListener("input", () => {
      const input = root.querySelector(`[data-builder-color-text="${selectorEscape(picker.dataset.builderColorPicker)}"]`);
      if (!input) return;
      input.value = picker.value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
  root.querySelectorAll("[data-builder-color-clear]").forEach((btn) => {
    if (btn.dataset.builderColorClearBound === "1") return;
    btn.dataset.builderColorClearBound = "1";
    btn.addEventListener("click", () => {
      const input = root.querySelector(`[data-builder-color-text="${selectorEscape(btn.dataset.builderColorClear)}"]`);
      if (!input) return;
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
}

function customCSSField(props = {}) {
  return `<div class="field"><label>Custom CSS</label><textarea name="custom_css" placeholder="margin-top: 20px; padding: 24px;">${esc(props.custom_css || "")}</textarea><small class="muted">Inline CSS for this component. Unsafe scripts/styles are ignored when published.</small></div>`;
}

function flexDirectionInput(name, label, value = "column") {
  return selectInput(name, label, value, [["column", "Column"], ["row", "Row"], ["row-reverse", "Row reverse"], ["column-reverse", "Column reverse"]]);
}

function pageBuilderColumnStyleCSS(props = {}) {
  const rules = [];
  const borderStyle = ["none", "solid", "dashed", "dotted", "double"].includes(props.border_style) ? props.border_style : "none";
  const borderWidth = Math.max(0, Math.min(24, Number(props.border_width || 0)));
  const borderColor = safeBuilderHexColor(props.border_color);
  const radius = Math.max(0, Math.min(80, Number(props.border_radius || 0)));
  const background = safeBuilderHexColor(props.background_color);
  const textColor = safeBuilderHexColor(props.text_color || props.color);
  if (borderStyle !== "none" && borderWidth > 0) {
    rules.push(`border-style:${borderStyle}`);
    rules.push(`border-width:${borderWidth}px`);
    rules.push(`border-color:${borderColor || "var(--border-color)"}`);
  }
  if (radius > 0) rules.push(`border-radius:${radius}px`);
  if (background) rules.push(`background-color:${background}`);
  if (textColor) rules.push(`color:${textColor}`);
  return rules.length ? `${rules.join(";")};` : "";
}

function safeBuilderFontFamily(value = "") {
  const allowed = [
    "",
    "inherit",
    "Inter, system-ui, sans-serif",
    "Arial, sans-serif",
    "Verdana, sans-serif",
    "Georgia, serif",
    "'Times New Roman', serif",
    "'Courier New', monospace",
    "Poppins, sans-serif",
    "Montserrat, sans-serif",
  ];
  return allowed.includes(String(value || "")) ? String(value || "") : "";
}

function safeBuilderTextAlign(value = "") {
  return ["", "left", "center", "right", "justify"].includes(String(value || "")) ? String(value || "") : "";
}

function pageBuilderTypographyCSS(props = {}, options = {}) {
  const rules = [];
  const color = safeBuilderHexColor(props.font_color || props.text_color);
  const size = Number(props.font_size || 0);
  const family = safeBuilderFontFamily(props.font_family);
  const spacing = Number(props.letter_spacing || props.font_spacing || 0);
  const lineHeight = Number(props.line_height || 0);
  const align = safeBuilderTextAlign(props.text_align);
  if (color) rules.push(`color:${color}`);
  if (Number.isFinite(size) && size > 0) rules.push(`font-size:${Math.max(8, Math.min(120, Math.round(size)))}px`);
  if (family && family !== "inherit") rules.push(`font-family:${family}`);
  if (Number.isFinite(spacing) && spacing !== 0) rules.push(`letter-spacing:${Math.max(-2, Math.min(12, spacing))}px`);
  if (Number.isFinite(lineHeight) && lineHeight > 0) rules.push(`line-height:${Math.max(0.8, Math.min(3, lineHeight))}`);
  if (!options.skipAlign && align) rules.push(`text-align:${align}`);
  return rules.length ? `${rules.join(";")};` : "";
}

function pageBuilderTextAlignCSS(props = {}) {
  const align = safeBuilderTextAlign(props.text_align);
  return align ? `text-align:${align};` : "";
}

function columnStyleFields(props = {}) {
  return `<div class="builder-field-group">
    <strong>Column style</strong>
    ${selectInput("border_style", "Border", props.border_style || "none", [["none", "No border"], ["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"], ["double", "Double"]])}
    <div class="grid-2">
      ${textInput("border_width", "Border width", props.border_width ?? 1, "number")}
      ${textInput("border_radius", "Radius", props.border_radius || 0, "number")}
    </div>
    ${colorInput("border_color", "Border color", props.border_color || "", "#0b8f7a")}
    ${colorInput("background_color", "Background color", props.background_color || "", "#f7f8f4")}
    ${colorInput("text_color", "Text color", props.text_color || props.color || "", "#101613")}
  </div>`;
}

function typographyStyleFields(props = {}) {
  return `<div class="builder-field-group">
    <strong>Typography</strong>
    ${colorInput("font_color", "Font color", props.font_color || props.text_color || "", "#101613")}
    <div class="grid-2">
      ${textInput("font_size", "Font size", props.font_size || "", "number")}
      ${textInput("line_height", "Line height", props.line_height || "", "number")}
    </div>
    <div class="grid-2">
      ${textInput("letter_spacing", "Font spacing", props.letter_spacing || props.font_spacing || "", "number")}
      ${selectInput("text_align", "Text alignment", props.text_align || "", [["", "Default"], ["left", "Left"], ["center", "Center"], ["right", "Right"], ["justify", "Justify"]])}
    </div>
    ${selectInput("font_family", "Font family", props.font_family || "", [
      ["", "Default"],
      ["inherit", "Inherit"],
      ["Inter, system-ui, sans-serif", "Inter / System"],
      ["Arial, sans-serif", "Arial"],
      ["Verdana, sans-serif", "Verdana"],
      ["Georgia, serif", "Georgia"],
      ["'Times New Roman', serif", "Times New Roman"],
      ["'Courier New', monospace", "Courier New"],
      ["Poppins, sans-serif", "Poppins"],
      ["Montserrat, sans-serif", "Montserrat"],
    ])}
  </div>`;
}

function pageBlockSettingsFields(block) {
  const props = block.props || {};
  const custom = customCSSField(props);
  const typography = typographyStyleFields(props);
  if (block.type === "columns") return `
    ${selectInput("columns", "Column count", String(props.columns || 2), [["1", "1 column"], ["2", "2 columns"], ["3", "3 columns"], ["4", "4 columns"]])}
    ${flexDirectionInput("direction", "Layout direction", props.direction || "row")}
    ${textInput("gap", "Column gap", props.gap || 18, "number")}
    ${custom}`;
  if (block.type === "column") return `${flexDirectionInput("flex_direction", "Column flex style", props.flex_direction || "column")}${textInput("gap", "Item gap", props.gap || 12, "number")}${columnStyleFields(props)}${custom}`;
  if (block.type === "hero") return `
    ${textInput("eyebrow", "Eyebrow", props.eyebrow)}
    ${textInput("heading", "Heading", props.heading)}
    ${textAreaInput("text", "Supporting text", props.text)}
    <div class="grid-2">${textInput("primary_label", "Primary button", props.primary_label)}${textInput("primary_url", "Primary URL", props.primary_url)}</div>
    <div class="grid-2">${textInput("secondary_label", "Secondary button", props.secondary_label)}${textInput("secondary_url", "Secondary URL", props.secondary_url)}</div>
    ${custom}`;
  if (block.type === "section_heading") return `${textInput("eyebrow", "Eyebrow", props.eyebrow)}${textInput("heading", "Heading", props.heading)}${textAreaInput("text", "Text", props.text)}${custom}`;
  if (block.type === "heading") return `${textInput("text", "Heading text", props.text)}${selectInput("level", "Level", props.level || "h2", [["h1", "H1"], ["h2", "H2"], ["h3", "H3"], ["h4", "H4"]])}${typography}${custom}`;
  if (block.type === "text") return `${textAreaInput("text", "Text", props.text)}${typography}${custom}`;
  if (block.type === "rich_text") return `<div class="field"><label>WYSIWYG text</label>${pageRichEditorHTML("text", props.text || "", "Write formatted page content")}</div>${textInput("class_name", "Custom class", props.class_name || "")}${typography}${custom}`;
  if (block.type === "html") return `${textAreaInput("html", "Safe HTML", props.html)}${custom}`;
  if (block.type === "image") return `${textInput("url", "Image URL", props.url)}${textInput("alt", "Alt text", props.alt)}${custom}`;
  if (block.type === "video") return `${textInput("url", "YouTube or Vimeo URL", props.url)}${custom}`;
  if (block.type === "feature_grid") return `${[1, 2, 3].map((i) => `<div class="builder-field-group"><strong>Feature ${i}</strong>${textInput(`title_${i}`, "Title", props[`title_${i}`])}${textAreaInput(`text_${i}`, "Text", props[`text_${i}`])}</div>`).join("")}${custom}`;
  if (block.type === "button") return `${textInput("label", "Button label", props.label)}${textInput("url", "Button URL", props.url)}${typography}${custom}`;
  if (block.type === "cta") return `${textInput("heading", "Heading", props.heading)}${textAreaInput("text", "Text", props.text)}${textInput("label", "Button label", props.label)}${textInput("url", "Button URL", props.url)}${custom}`;
  if (block.type === "spacer") return `${textInput("height", "Height", props.height || 24, "number")}${custom}`;
  return `${custom}<p class="muted">This block has no other settings.</p>`;
}

function defaultProps(type) {
  if (type === "columns") return { columns: 2, direction: "row", gap: 18, custom_css: "" };
  if (type === "hero") return { eyebrow: "Visual page builder", heading: "Build your public page", text: "Add sections, edit copy, then publish when it feels right.", primary_label: "Get started", primary_url: "/register", secondary_label: "View pricing", secondary_url: "/pricing" };
  if (type === "section_heading") return { eyebrow: "Section", heading: "A clear section heading", text: "Use this to introduce a group of content." };
  if (type === "heading") return { text: "Heading", level: "h2" };
  if (type === "text") return { text: "Simple text paragraph." };
  if (type === "rich_text") return { text: "<p>Write formatted content with [[site_name]] shortcodes.</p>", class_name: "" };
  if (type === "html") return { html: "<p>Add safe custom HTML here.</p>" };
  if (type === "image") return { url: "/static/img/product-preview.png", alt: "Preview" };
  if (type === "feature_grid") return { title_1: "Plan", text_1: "Organize the work.", title_2: "Collaborate", text_2: "Keep people aligned.", title_3: "Deliver", text_3: "Ship with a clear record." };
  if (type === "button") return { label: "Learn more", url: "/" };
  if (type === "cta") return { heading: "Ready to start?", text: "Invite your team and keep the work moving.", label: "Get started", url: "/register" };
  if (type === "spacer") return { height: 24 };
  if (type === "video") return { url: "" };
  return {};
}

async function renderIntegrations() {
  if (state.me?.role !== "users_admin") {
    shell("Integrations", `
      <section class="panel">
        <h1>Team-admin access required</h1>
        <p class="muted">External integrations are managed by a team's admin account. Owner admins can manage platform plans and settings from the Admin area.</p>
        <p><a class="btn primary" href="/dashboard">${icon("layout-dashboard")}Dashboard</a></p>
      </section>`);
    return;
  }
  const integrations = (await api("/api/integrations")).integrations || [];
  shell("Integrations", `
    <div class="page-title"><div><h1>Integrations</h1><p class="muted">One-time import and export jobs.</p></div></div>
    <div class="grid-2">
      <section class="panel"><h2>Connected</h2><div class="task-list">${integrations.map((row) => `<article class="task-row"><div><h3>${esc(row.provider)}</h3><span class="muted">${esc(row.auth_type)}</span></div><span class="pill">${esc(row.status)}</span><button class="btn" data-import="${row.provider}">${icon("download")}Import</button></article>`).join("") || `<p class="muted">No providers connected.</p>`}</div></section>
      <section class="panel"><h2>Connect</h2><div class="toolbar">${["bugherd", "asana", "clickup", "monday"].map((p) => `<button class="btn primary" data-connect="${p}">${icon("plug")}${p}</button>`).join("")}</div><p class="status-line"></p></section>
    </div>`);
  document.querySelectorAll("[data-connect]").forEach((btn) => btn.addEventListener("click", async () => {
    try {
      const apiKey = btn.dataset.connect === "bugherd" ? prompt("BugHerd API key") : "";
      await api(`/api/integrations/${btn.dataset.connect}/connect`, { method: "POST", body: JSON.stringify({ api_key: apiKey }) });
      renderIntegrations();
    } catch (error) {
      setStatus(error.message, true);
    }
  }));
  document.querySelectorAll("[data-import]").forEach((btn) => btn.addEventListener("click", async () => {
    try {
      const list = await getFirstList();
      const projects = (await api(`/api/integrations/${btn.dataset.import}/projects`)).projects;
      const job = await api(`/api/import/${btn.dataset.import}`, { method: "POST", body: JSON.stringify({ external_project_id: projects[0].id, target_list_id: list.id, field_mapping: {} }) });
      alert(`Imported ${job.job.imported_count} tasks`);
    } catch (error) {
      alert(error.message);
    }
  }));
}

function performancePeriodLabel(period) {
  return { daily: "Today", weekly: "This week", monthly: "This month", yearly: "This year" }[period] || "This week";
}

function performanceMetricCard(label, value, helper = "") {
  return `<article class="metric performance-metric">
    <span>${esc(label)}</span>
    <strong>${esc(value)}</strong>
    ${helper ? `<small>${esc(helper)}</small>` : ""}
  </article>`;
}

function performanceWidth(value, max) {
  if (!max) return 0;
  return Math.max(4, Math.round((Number(value || 0) / max) * 100));
}

function performanceMemberRow(member, maxScore) {
  const displayName = member.name || member.username || member.email || "Team member";
  const roleText = staffRoleLabel(member.staff_role) || roleLabel(member.role || "");
  const scoreWidth = performanceWidth(member.score, maxScore);
  const completedWidth = performanceWidth(member.completed_tasks, Math.max(1, member.assigned_tasks, member.completed_tasks));
  const openWidth = performanceWidth(member.open_tasks, Math.max(1, member.assigned_tasks, member.open_tasks));
  const overdueWidth = performanceWidth(member.overdue_tasks, Math.max(1, member.assigned_tasks, member.overdue_tasks));
  return `<article class="performance-row">
    <div class="performance-person">
      ${userChip(member)}
      <div>
        <strong>${esc(displayName)}</strong>
        <span>${member.username ? "@" + esc(member.username) + " - " : ""}${esc(roleText || "Team member")}</span>
      </div>
    </div>
    <div class="performance-chart">
      <div class="performance-score-line">
        <span style="width:${scoreWidth}%"></span>
      </div>
      <div class="performance-bars" aria-label="Task performance">
        <span class="done" style="width:${completedWidth}%"></span>
        <span class="open" style="width:${openWidth}%"></span>
        <span class="late" style="width:${overdueWidth}%"></span>
      </div>
    </div>
    <div class="performance-stats">
      <span><strong>${esc(member.completed_tasks || 0)}</strong> done</span>
      <span><strong>${esc(member.open_tasks || 0)}</strong> open</span>
      <span><strong>${esc(member.overdue_tasks || 0)}</strong> late</span>
      <span><strong>${esc(member.comments || 0)}</strong> comments</span>
      <span><strong>${esc(minutesLabel(member.time_minutes || 0))}</strong> tracked</span>
    </div>
  </article>`;
}

async function renderTeamPerformance() {
  const params = new URLSearchParams(window.location.search);
  const period = ["daily", "weekly", "monthly", "yearly"].includes(params.get("period")) ? params.get("period") : "weekly";
  const data = await api(`/api/team/performance?period=${encodeURIComponent(period)}`);
  const members = data.members || [];
  const summary = data.summary || {};
  const maxScore = Math.max(1, ...members.map((member) => Number(member.score || 0)));
  const periodButtons = ["daily", "weekly", "monthly", "yearly"].map((item) => `<a class="btn compact ${item === period ? "primary" : ""}" href="/team/performance?period=${item}">${esc(item[0].toUpperCase() + item.slice(1))}</a>`).join("");
  shell("Team Performance", `
    <div class="page-title">
      <div>
        <h1>Team Performance</h1>
        <p class="muted">${esc(performancePeriodLabel(period))} - ${esc(fmtDate(data.from))} to ${esc(fmtDate(data.to))}</p>
      </div>
      <div class="toolbar performance-periods">${periodButtons}</div>
    </div>
    <section class="metrics performance-summary">
      ${performanceMetricCard("Members", summary.members || 0)}
      ${performanceMetricCard("Completed", summary.completed_tasks || 0, "Tasks finished")}
      ${performanceMetricCard("Open", summary.open_tasks || 0, "Still active")}
      ${performanceMetricCard("Time tracked", minutesLabel(summary.time_minutes || 0))}
    </section>
    <section class="panel performance-panel">
      <div class="panel-head">
        <div>
          <h2>Member chart</h2>
          <p class="muted">Bars combine completed tasks, current open work, late tasks, comments, and tracked time.</p>
        </div>
        <div class="performance-legend">
          <span><i class="done"></i>Done</span>
          <span><i class="open"></i>Open</span>
          <span><i class="late"></i>Late</span>
        </div>
      </div>
      <div class="performance-list">
        ${members.map((member) => performanceMemberRow(member, maxScore)).join("") || `<p class="muted">No team members found yet.</p>`}
      </div>
    </section>`);
}

function reportPeriodOptions() {
  return [
    ["day", "Day"],
    ["week", "Week"],
    ["month", "Month"],
    ["year", "Year"],
    ["all", "All time"],
    ["custom", "Custom dates"],
  ].map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
}

function reportClientOptions(clients = []) {
  return `<option value="">All project folders</option>${clients.map((client) => `<option value="${esc(client.id)}">${esc(client.name || "Untitled folder")}</option>`).join("")}`;
}

function reportWebsiteOptions(websites = [], selectedClientID = "") {
  return `<option value="">All domains</option>${websites
    .filter((site) => !selectedClientID || site.client_id === selectedClientID)
    .map((site) => `<option value="${esc(site.id)}">${esc(site.name || site.url || "Untitled domain")}</option>`)
    .join("")}`;
}

function reportOptionCheckbox(name, label, checked = true) {
  return `<label class="report-option"><input type="checkbox" name="${esc(name)}" value="1" ${checked ? "checked" : ""}> <span>${esc(label)}</span></label>`;
}

function taskReportExportURL(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  return taskReportPDFURL(data);
}

function taskReportPreviewHTML(data = {}) {
  const note = String(data.note || "").trim();
  const noteHTML = note ? `<div class="report-preview-note"><strong>Report note</strong><p>${esc(note)}</p></div>` : "";
  if (!data.has_visible_data) {
    return `<div class="report-preview-empty">Select at least one report section to preview.</div>${noteHTML}`;
  }
  const summary = data.summary ? `<div class="report-preview-summary">
    <span><strong>${data.summary.completed_in_period ?? 0}</strong> completed</span>
    <span><strong>${data.summary.total_tasks ?? 0}</strong> tasks</span>
    <span><strong>${data.summary.open ?? 0}</strong> open</span>
    <span><strong>${data.summary.overdue ?? 0}</strong> overdue</span>
    ${data.options?.time ? `<span><strong>${esc(data.summary.tracked_time || "0h")}</strong> tracked</span>` : ""}
  </div>` : "";
  const completions = (data.completed_events || []).map((item) => `<article class="report-preview-row">
    <div>
      <strong>${esc(item.title || "Untitled task")}</strong>
      <span>${esc(item.project || "Project")} / ${esc(item.domain || "Domain")} · ${esc(item.completed_at || "")}</span>
      ${item.detail ? `<p>${esc(item.detail)}</p>` : ""}
    </div>
    <span class="pill">${esc(item.recurring ? "recurring" : "complete")}</span>
  </article>`).join("");
  const tasks = (data.tasks || []).map(taskReportPreviewTaskHTML).join("");
  return `<div class="report-preview-head">
      <div><strong>Live preview</strong><span>${esc(data.scope || "")} · ${esc(data.date_filter || "")}</span></div>
      <span class="pill">${data.task_count || 0} tasks</span>
    </div>
    ${summary}
    ${completions ? `<div class="report-preview-section"><h3>Completed in this period</h3><div class="report-preview-list">${completions}</div>${data.more_completions ? `<p class="muted">+${data.more_completions} more completed events in the PDF.</p>` : ""}</div>` : ""}
    ${tasks ? `<div class="report-preview-section"><h3>Tasks</h3><div class="report-preview-list">${tasks}</div>${data.more_tasks ? `<p class="muted">+${data.more_tasks} more tasks in the PDF.</p>` : ""}</div>` : ""}
    ${!completions && !tasks ? `<div class="report-preview-empty">No matching task data for this filter.</div>` : ""}
    ${noteHTML}`;
}

function taskReportPreviewTaskHTML(task = {}) {
  const checklist = task.checklist || {};
  const checklistItems = (checklist.items || []).map((item) => `<li class="${item.done ? "done" : ""}"><span>${item.done ? "[x]" : "[ ]"}</span>${esc(item.text || "")}</li>`).join("");
  return `<article class="report-preview-row">
    <div>
      <strong>${esc(task.title || "Untitled task")}</strong>
      <span>${esc(task.project || "Project")} / ${esc(task.domain || "Domain")} · ${esc(task.status || "")}${task.due_date ? ` · Due ${esc(task.due_date)}` : ""}${task.tracked_time ? ` · ${esc(task.tracked_time)}` : ""}</span>
      ${task.assignees ? `<p>Assignees: ${esc(task.assignees)}</p>` : ""}
      ${task.content ? `<p>${esc(task.content)}</p>` : ""}
      ${checklist.total ? `<div class="report-checklist-preview"><b>Checklist ${checklist.done || 0}/${checklist.total || 0}</b><ul>${checklistItems}${checklist.more_items ? `<li>+${checklist.more_items} more</li>` : ""}</ul></div>` : ""}
    </div>
    <span class="pill">${esc(task.type || "task")}</span>
  </article>`;
}

function bindTaskReportExportForm(websites = []) {
  const form = $("#taskPdfExportForm");
  const link = $("#taskPdfExportLink");
  const clientSelect = $("#taskReportClient");
  const websiteSelect = $("#taskReportWebsite");
  const fromInput = $("#taskReportFrom");
  const toInput = $("#taskReportTo");
  const periodSelect = $("#taskReportPeriod");
  const preview = $("#taskReportPreview");
  if (!form || !link || !clientSelect || !websiteSelect || !fromInput || !toInput || !periodSelect) return;
  let previewTimer = null;
  let previewRun = 0;
  let previewAbort = null;
  const refreshDomains = () => {
    const previous = websiteSelect.value;
    websiteSelect.innerHTML = reportWebsiteOptions(websites, clientSelect.value);
    if ([...websiteSelect.options].some((option) => option.value === previous)) websiteSelect.value = previous;
  };
  const refreshCustomDates = () => {
    const isCustom = periodSelect.value === "custom";
    fromInput.disabled = !isCustom;
    toInput.disabled = !isCustom;
    fromInput.closest(".field")?.classList.toggle("is-disabled", !isCustom);
    toInput.closest(".field")?.classList.toggle("is-disabled", !isCustom);
  };
  const refreshLink = () => {
    refreshCustomDates();
    link.href = taskReportExportURL(form);
    refreshPreview();
  };
  const refreshPreview = () => {
    if (!preview) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const run = ++previewRun;
      if (previewAbort) previewAbort.abort();
      previewAbort = new AbortController();
      preview.innerHTML = `<div class="report-preview-empty">Loading preview...</div>`;
      try {
        const data = Object.fromEntries(new FormData(form).entries());
        const result = await api(taskReportPreviewURL(data), { signal: previewAbort.signal });
        if (run !== previewRun) return;
        preview.innerHTML = taskReportPreviewHTML(result);
      } catch (error) {
        if (error.name === "AbortError") return;
        if (run !== previewRun) return;
        preview.innerHTML = `<div class="report-preview-empty danger">${esc(error.message || "Could not load preview")}</div>`;
      }
    }, 250);
  };
  refreshDomains();
  refreshLink();
  form.addEventListener("input", refreshLink);
  form.addEventListener("change", () => {
    refreshDomains();
    refreshLink();
  });
  link.addEventListener("click", async (event) => {
    event.preventDefault();
    if (form.elements.scope.value === "domain" && !form.elements.website_id.value) {
      setFormStatus(form, "Select a domain for domain export.", true);
      return;
    }
    const stopLoading = setButtonLoading(link, true, "Exporting...");
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      await downloadAuthenticatedFile(taskReportPDFURL(data, { includeToken: false }), "task-report.pdf");
      setFormStatus(form, "PDF download started.");
    } catch (error) {
      setFormStatus(form, error.message || "Could not export PDF", true);
    } finally {
      stopLoading();
    }
  });
}

async function renderReports() {
  const list = await getFirstList().catch(() => null);
  const data = await api("/api/reports/time");
  data.entries = data.entries || [];
  const clients = state.clientProjects || [];
  const websites = state.clientWebsites || [];
  shell("Time Reports", `
    <div class="page-title"><div><h1>Reports</h1><p class="muted">${Math.round((data.total_minutes || 0) / 60 * 10) / 10} hours tracked.</p></div><a class="btn" href="/api/reports/time/export?token=${state.access}">${icon("download")}CSV</a></div>
    <section class="panel report-export-panel">
      <div class="panel-head">
        <div>
          <h2>Project task PDF</h2>
          <p class="muted">Export tasks and completed work you can access, filtered by assignment, project folder, domain, and time period.</p>
        </div>
        <a class="btn primary" id="taskPdfExportLink" href="#" target="_blank" rel="noopener">${icon("file-down")}Export PDF</a>
      </div>
      <form id="taskPdfExportForm" class="form-grid">
        <input type="hidden" name="customize" value="1">
        <div class="grid-3">
          <div class="field"><label>Scope</label><select name="scope"><option value="assigned">Assigned to me</option><option value="all">All tasks in projects</option><option value="domain">Specific domain</option></select></div>
          <div class="field"><label>Project folder</label><select name="client_id" id="taskReportClient">${reportClientOptions(clients)}</select></div>
          <div class="field"><label>Domain</label><select name="website_id" id="taskReportWebsite">${reportWebsiteOptions(websites)}</select></div>
        </div>
        <div class="grid-3">
          <div class="field"><label>Time filter</label><select name="period" id="taskReportPeriod">${reportPeriodOptions()}</select></div>
          <div class="field"><label>Date basis</label><select name="date_field"><option value="created_at">Created date</option><option value="due_date">Due date</option><option value="updated_at">Updated date</option></select></div>
          <div class="field"><label>Format</label><input value="PDF report" readonly></div>
        </div>
        <div class="grid-2">
          <div class="field"><label>From</label><input type="date" name="from" id="taskReportFrom"></div>
          <div class="field"><label>To</label><input type="date" name="to" id="taskReportTo"></div>
        </div>
        <div class="report-option-block">
          <h3>Data to show</h3>
          <div class="report-option-grid">
            ${reportOptionCheckbox("include_summary", "Summary")}
            ${reportOptionCheckbox("include_completions", "Completed work")}
            ${reportOptionCheckbox("include_tasks", "Task list")}
            ${reportOptionCheckbox("include_content", "Task content")}
            ${reportOptionCheckbox("include_checklist", "Checklists")}
            ${reportOptionCheckbox("include_assignees", "Assignees")}
            ${reportOptionCheckbox("include_due_dates", "Due dates")}
            ${reportOptionCheckbox("include_time", "Tracked time")}
          </div>
        </div>
        <div class="field report-note-field">
          <label>Report note</label>
          <textarea name="note" maxlength="2000" placeholder="Optional note shown at the bottom of the PDF report"></textarea>
        </div>
        <p class="status-line"></p>
      </form>
      <div id="taskReportPreview" class="report-preview"><div class="report-preview-empty">Loading preview...</div></div>
    </section>
    <div class="grid-2">
      <section class="panel"><h2>Entries</h2><div class="task-list">${data.entries.map((e) => `<article class="task-row"><div><h3>${e.duration_minutes} minutes</h3><span class="muted">${fmtDate(e.start_time)} · ${esc(e.note || "")}</span></div><span class="pill">${e.is_manual ? "manual" : "timer"}</span><span class="pill">${e.billable ? "billable" : "non-billable"}</span></article>`).join("") || `<p class="muted">No time entries yet.</p>`}</div></section>
      <section class="panel"><h2>Manual entry</h2><form id="manualTimeForm" class="form-grid"><input type="hidden" name="task_id" value="${esc(list?.id || "")}"><div class="field"><label>Date</label><input type="date" name="date"></div><div class="field"><label>Minutes</label><input type="number" name="duration_minutes" min="1" value="30"></div><div class="field"><label>Note</label><textarea name="note"></textarea></div><button class="btn primary">${icon("plus")}Log time</button><p class="status-line"></p></form></section>
    </div>`);
  bindTaskReportExportForm(websites);
  $("#manualTimeForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const form = Object.fromEntries(new FormData(event.currentTarget).entries());
      if (!form.task_id) throw new Error("No task list available");
      form.duration_minutes = Number(form.duration_minutes);
      await api("/api/time-entries", { method: "POST", body: JSON.stringify(form) });
      renderReports();
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

function chatTitle(chat, usersByID = {}) {
  if (!chat) return "Chat";
  if (chat.type === "support") return "Chat for help";
  if (String(chat.title || "").trim()) return String(chat.title).trim();
  const names = (chat.participant_ids || [])
    .filter((id) => id !== state.me?.id)
    .map((id) => usersByID[id]?.name || usersByID[id]?.username || "")
    .filter(Boolean);
  if (names.length) return names.slice(0, 3).join(", ");
  if (chat.type === "direct") return "Direct chat";
  return "Team chat";
}

function isChatAdmin() {
  return state.me?.role === "owner_adm" || state.me?.role === "users_admin";
}

function canDeleteChat(chat) {
  if (!chat) return false;
  const participants = chat.participant_ids || [];
  return isChatAdmin() || chat.created_by === state.me?.id || (!chat.created_by && participants.includes(state.me?.id));
}

function chatStatusLabel(chat, selected) {
  if (chat?.deleted_at) return "deleted";
  if (chat?.status === "ended") return "ended";
  return selected ? "open" : "chat";
}

function chatStatusClass(chat) {
  if (chat?.deleted_at || chat?.status === "ended") return "danger";
  return "";
}

function typedConfirm(message) {
  const answer = prompt(`${message}\n\nType confirm to continue.`);
  return (answer || "").trim().toLowerCase() === "confirm";
}

function chatActionsHTML(chat) {
  if (!chat) return "";
  if (chat.deleted_at && isChatAdmin()) {
    return `<div class="chat-management-actions">
      <button class="btn compact" type="button" data-restore-chat="${esc(chat.id)}">${icon("rotate-ccw")}Restore</button>
      <button class="btn compact danger" type="button" data-remove-chat="${esc(chat.id)}">${icon("trash-2")}Remove forever</button>
    </div>`;
  }
  if (!chat.deleted_at && canDeleteChat(chat)) {
    return `<div class="chat-management-actions">
      <button class="btn compact danger" type="button" data-delete-chat="${esc(chat.id)}">${icon("trash-2")}Delete</button>
    </div>`;
  }
  return "";
}

function chatConversationRow(chat, selected, usersByID) {
  const statusClass = chatStatusClass(chat);
  return `<article class="task-row chat-conversation-row ${chat.deleted_at ? "is-deleted" : ""}">
    <a class="chat-conversation-link" href="/chat?id=${esc(chat.id)}">
      <div>
        <h3>${esc(chatTitle(chat, usersByID))}</h3>
        <span class="muted">${esc((chat.participant_ids || []).length)} participants${chat.deleted_at ? " - admin only" : ""}</span>
      </div>
      <span class="pill ${statusClass}">${esc(chatStatusLabel(chat, selected))}</span>
    </a>
    ${chatActionsHTML(chat)}
  </article>`;
}

function bindChatManagementActions(refresh = renderChat) {
  document.querySelectorAll("[data-delete-chat]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!typedConfirm("Delete this chat room? Members will no longer see it, but admins can restore it.")) return;
    try {
      await api(`/api/chats/${btn.dataset.deleteChat}`, { method: "DELETE" });
      await refresh();
    } catch (error) {
      setStatus(error.message, true);
    }
  }));
  document.querySelectorAll("[data-restore-chat]").forEach((btn) => btn.addEventListener("click", async () => {
    try {
      await api(`/api/chats/${btn.dataset.restoreChat}/restore`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
    } catch (error) {
      setStatus(error.message, true);
    }
  }));
  document.querySelectorAll("[data-remove-chat]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!typedConfirm("Remove this chat room forever? This will delete the room and its messages.")) return;
    try {
      await api(`/api/chats/${btn.dataset.removeChat}/permanent`, { method: "DELETE" });
      await refresh();
    } catch (error) {
      setStatus(error.message, true);
    }
  }));
}

function startChatDialogHTML(users) {
  const members = (users || []).filter((user) => user.id !== state.me?.id);
  return `<dialog id="startChatDialog" class="modal">
    <form id="startChatForm" class="form-grid" method="dialog">
      <div class="modal-head"><h2>Start chat</h2><button class="btn icon quiet" type="button" data-close-dialog title="Close">${icon("x")}</button></div>
      <div class="field"><label>Chat title</label><input name="title" maxlength="80" placeholder="Website launch, SEO team, client updates"></div>
      <div class="member-picker">
        ${members.length ? members.map((user) => `<label class="member-choice">
          <input type="checkbox" name="participant_ids" value="${esc(user.id)}">
          ${userChip(user)}
          <span><strong>${esc(user.name || user.username || user.email)}</strong><small>@${esc(user.username || "member")}${user.staff_role ? " - " + esc(staffRoleLabel(user.staff_role)) : ""}</small></span>
        </label>`).join("") : `<p class="muted">No members available for chat yet.</p>`}
      </div>
      <div class="toolbar"><button class="btn primary" type="submit">${icon("message-square-plus")}Start chat</button><button class="btn" type="button" data-close-dialog>Cancel</button></div>
      <p class="status-line"></p>
    </form>
  </dialog>`;
}

function chatComposerHTML(id, context, enabled, placeholder) {
  return `<form id="${id}" class="chat-composer" data-chat-context="${esc(context)}">
    <div class="reply-preview" data-reply-preview hidden></div>
    <div class="attachment-preview" data-attachment-preview hidden></div>
    <div class="chat-input-row">
      <button class="btn icon quiet" type="button" data-chat-emoji="${esc(context)}" ${enabled ? "" : "disabled"} title="Add emoji">${icon("smile")}</button>
      <button class="btn icon quiet" type="button" data-chat-attach="${esc(context)}" ${enabled ? "" : "disabled"} title="Attach file">${icon("paperclip")}</button>
      <input type="file" data-chat-file="${esc(context)}" hidden>
      <input name="content" data-mentionable ${enabled ? "" : "disabled"} placeholder="${esc(placeholder)}">
      <button class="btn primary" ${enabled ? "" : "disabled"}>${icon("send")}Send</button>
    </div>
  </form>`;
}

function chatReplyState(context) {
  return context === "support" ? state.supportReply : state.chatReply;
}

function setChatReply(context, reply) {
  if (context === "support") state.supportReply = reply;
  else state.chatReply = reply;
  const root = context === "support" ? $("#helpChatWidget") : document;
  const preview = root?.querySelector(`[data-chat-context="${context}"] [data-reply-preview]`);
  if (!preview) return;
  if (!reply) {
    preview.hidden = true;
    preview.innerHTML = "";
    return;
  }
  preview.hidden = false;
  preview.innerHTML = `<span>${icon("reply")}Replying to: ${esc(reply.text)}</span><button class="btn icon quiet" type="button" data-clear-reply="${esc(context)}" title="Cancel reply">${icon("x")}</button>`;
  preview.querySelector("[data-clear-reply]")?.addEventListener("click", () => setChatReply(context, null));
  icons();
}

function chatMessageHTML(message, usersByID = {}, context = "page") {
  const mine = message.sender_id === state.me?.id;
  const author = usersByID[message.sender_id] || {};
  const authorName = mine ? "You" : (author.name || author.username || "Someone");
  return `<div class="message ${mine ? "mine" : ""}" data-message-id="${esc(message.id)}">
    <div class="message-head"><strong>${esc(authorName)}</strong><time>${inboxTime(message.sent_at)}</time></div>
    ${message.reply_text ? `<blockquote>${chatText(message.reply_text)}</blockquote>` : ""}
    ${message.content ? `<p>${chatText(message.content)}</p>` : ""}
    ${message.attachment_url ? `<a class="attachment-link" href="${esc(message.attachment_url)}" target="_blank" rel="noopener noreferrer">${icon("paperclip")}${esc(message.attachment_name || "Attachment")}</a>` : ""}
    <button class="message-reply-btn" type="button" data-quote-message="${esc(message.id)}" data-quote-context="${esc(context)}" data-reply-text="${esc((message.content || message.attachment_name || "Attachment").slice(0, 160))}">${icon("reply")}Reply</button>
  </div>`;
}

function bindChatReplyButtons(context) {
  const root = context === "support" ? $("#helpChatWidget") : document;
  root?.querySelectorAll(`[data-quote-context="${context}"]`).forEach((btn) => {
    if (btn.dataset.replyBound) return;
    btn.dataset.replyBound = "true";
    btn.addEventListener("click", () => setChatReply(context, { id: btn.dataset.quoteMessage, text: btn.dataset.replyText || "Message" }));
  });
}

function bindRichChatComposer(formID, context) {
  const form = document.getElementById(formID);
  if (!form) return;
  const input = form.elements.content;
  form.querySelector(`[data-chat-emoji="${context}"]`)?.addEventListener("click", (event) => openEmojiPicker(event.currentTarget, input));
  form.querySelector(`[data-chat-attach="${context}"]`)?.addEventListener("click", () => form.querySelector(`[data-chat-file="${context}"]`)?.click());
  form.querySelector(`[data-chat-file="${context}"]`)?.addEventListener("change", async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      const body = new FormData();
      body.append("file", file);
      const data = await api("/api/uploads", { method: "POST", body });
      form.dataset.attachmentUrl = data.url;
      form.dataset.attachmentName = file.name;
      const preview = form.querySelector("[data-attachment-preview]");
      preview.hidden = false;
      preview.innerHTML = `<span>${icon("paperclip")}${esc(file.name)}</span><button class="btn icon quiet" type="button" data-clear-attachment title="Remove attachment">${icon("x")}</button>`;
      preview.querySelector("[data-clear-attachment]")?.addEventListener("click", () => clearChatAttachment(form));
      icons();
    } catch (error) {
      setStatus(error.message, true);
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const socket = context === "support" ? state.supportSocket : state.chatSocket;
    const content = input.value.trim();
    const attachmentURL = form.dataset.attachmentUrl || "";
    if (!socket || socket.readyState !== WebSocket.OPEN || (!content && !attachmentURL)) return;
    const reply = chatReplyState(context);
    socket.send(JSON.stringify({
      content,
      reply_to_id: reply?.id || "",
      reply_text: reply?.text || "",
      attachment_url: attachmentURL,
      attachment_name: form.dataset.attachmentName || "",
    }));
    input.value = "";
    setChatReply(context, null);
    clearChatAttachment(form);
  });
}

function clearChatAttachment(form) {
  delete form.dataset.attachmentUrl;
  delete form.dataset.attachmentName;
  const preview = form.querySelector("[data-attachment-preview]");
  if (preview) {
    preview.hidden = true;
    preview.innerHTML = "";
  }
  const file = form.querySelector("input[type='file']");
  if (file) file.value = "";
}

function openEmojiPicker(button, input) {
  let picker = $("#emojiPicker");
  if (picker) picker.remove();
  picker = document.createElement("div");
  picker.id = "emojiPicker";
  picker.className = "emoji-picker";
  const emojis = ["\u{1F600}", "\u{1F602}", "\u{1F60A}", "\u{1F60D}", "\u{1F44D}", "\u{1F64F}", "\u{1F525}", "\u{2705}", "\u{1F389}", "\u{1F4A1}", "\u{1F440}", "\u{2764}\u{FE0F}"];
  picker.innerHTML = emojis.map((emoji) => `<button type="button">${emoji}</button>`).join("");
  document.body.appendChild(picker);
  const rect = button.getBoundingClientRect();
  const pickerWidth = picker.offsetWidth || 236;
  const pickerHeight = picker.offsetHeight || 88;
  const showBelow = rect.top < pickerHeight + 16;
  picker.classList.toggle("below", showBelow);
  picker.style.left = `${Math.min(window.innerWidth - pickerWidth - 8, Math.max(8, rect.left))}px`;
  picker.style.top = `${showBelow ? rect.bottom + 8 : rect.top - 8}px`;
  picker.querySelectorAll("button").forEach((emojiBtn) => emojiBtn.addEventListener("click", () => {
    const emoji = emojiBtn.textContent || "";
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.value = `${input.value.slice(0, start)}${emoji}${input.value.slice(end)}`;
    const nextPosition = start + emoji.length;
    input.setSelectionRange(nextPosition, nextPosition);
    try {
      input.focus({ preventScroll: true });
    } catch {
      input.focus();
    }
    picker.remove();
  }));
  setTimeout(() => document.addEventListener("click", function close(event) {
    if (!picker.contains(event.target) && event.target !== button) {
      picker.remove();
      document.removeEventListener("click", close);
    }
  }), 0);
}

async function renderChat() {
  const chats = (await api("/api/chats")).chats || [];
  const requestedChatID = new URLSearchParams(location.search).get("id") || "";
  const selectedChat = requestedChatID ? chats.find((chat) => chat.id === requestedChatID) || null : null;
  const selected = selectedChat?.id || "";
  const messages = selected ? ((await api(`/api/chats/${selected}/messages`)).messages || []) : [];
  const mentionUsers = await loadMentionUsers().catch(() => []);
  const usersByID = Object.fromEntries([...mentionUsers, state.me].filter(Boolean).map((user) => [user.id, user]));
  const chatCanWrite = Boolean(selected && selectedChat?.status !== "ended" && !selectedChat?.deleted_at);
  const selectedStatus = selectedChat ? (selectedChat.deleted_at ? "Deleted room - admins can restore or remove it forever" : selectedChat.status === "ended" ? "Conversation ended" : "Conversation open") : "Choose a conversation";
  shell("Chat", `
    <div class="page-title"><div><h1>Chat</h1><p class="muted">Team conversations and direct messages.</p></div><div class="toolbar"><button class="btn primary" id="startChatBtn">${icon("message-square-plus")}Start chat</button></div></div>
    <section class="panel chat-conversation-panel"><h2>Conversations</h2><div class="task-list">${chats.map((chat) => chatConversationRow(chat, chat.id === selected, usersByID)).join("") || `<p class="muted">No chats yet.</p>`}</div></section>
    ${selectedChat ? `<dialog id="chatRoomDialog" class="modal chat-room-dialog">
      <section class="chat-window chat-room-window">
        <div class="chat-window-head">
          <div><h2>${esc(chatTitle(selectedChat, usersByID))}</h2><span class="muted">${esc(selectedStatus)}</span></div>
          <div class="chat-window-actions">
            ${chatActionsHTML(selectedChat)}
            ${chatCanWrite ? `<button class="btn danger compact" id="endChatBtn" type="button">${icon("phone-off")}End chat</button>` : ""}
            <button class="btn icon quiet" type="button" data-close-dialog="chatRoomDialog" title="Close">${icon("x")}</button>
          </div>
        </div>
        <div id="messages" class="messages">${messages.map((m) => chatMessageHTML(m, usersByID, "page")).join("")}</div>
        ${chatComposerHTML("chatForm", "page", chatCanWrite, "Message @username")}
      </section>
    </dialog>` : ""}
    ${startChatDialogHTML(mentionUsers)}`);
  bindChatManagementActions(renderChat);
  $("#startChatBtn")?.addEventListener("click", () => $("#startChatDialog")?.showModal());
  bindDialogCloseButtons(app);
  const chatRoomDialog = $("#chatRoomDialog");
  if (chatRoomDialog) {
    chatRoomDialog.addEventListener("close", () => {
      if (state.chatSocket) {
        state.chatSocket.close();
        state.chatSocket = null;
      }
      if (new URLSearchParams(location.search).has("id")) {
        history.replaceState(null, "", "/chat");
        renderChat();
      }
    }, { once: true });
    chatRoomDialog.showModal();
    $("#messages").scrollTop = $("#messages").scrollHeight;
  }
  $("#startChatForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const participantIDs = Array.from(form.querySelectorAll("input[name='participant_ids']:checked")).map((input) => input.value);
    const title = String(new FormData(form).get("title") || "").trim();
    if (!participantIDs.length) {
      setFormStatus(form, "Choose at least one member.", true);
      return;
    }
    if (participantIDs.length > 1 && !title) {
      setFormStatus(form, "Add a chat title for group chats.", true);
      return;
    }
    try {
      const data = await api("/api/chats", { method: "POST", body: JSON.stringify({ type: "direct", title, participant_ids: participantIDs }) });
      location.href = "/chat?id=" + data.chat.id;
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  $("#endChatBtn")?.addEventListener("click", async () => {
    if (!selected || !confirm("End this chat?")) return;
    await api(`/api/chats/${selected}/end`, { method: "POST", body: JSON.stringify({}) });
    await renderChat();
  });
  if (chatCanWrite) {
    openChatSocket(selected, usersByID);
  } else if (state.chatSocket) {
    state.chatSocket.close();
    state.chatSocket = null;
  }
  if (selectedChat) {
    bindRichChatComposer("chatForm", "page");
    bindChatReplyButtons("page");
  }
}

function openChatSocket(chatID, usersByID = {}, context = "page") {
  if (state.chatSocket) state.chatSocket.close();
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  state.chatSocket = new WebSocket(`${protocol}://${location.host}/ws/chat?chat_id=${chatID}&token=${encodeURIComponent(state.access)}`);
  const messagesSelector = context === "notification" ? "#notificationMessages" : "#messages";
  state.chatSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.message) {
      const messages = $(messagesSelector);
      messages?.insertAdjacentHTML("beforeend", chatMessageHTML(data.message, usersByID, context));
      if (messages) messages.scrollTop = messages.scrollHeight;
      bindChatReplyButtons(context);
      icons();
    }
    if (["chat_ended", "chat_deleted", "chat_restored", "chat_removed"].includes(data.type)) {
      if (context === "notification") openNotificationChatDialog(chatID);
      else renderChat();
    }
    if (data.type === "error") {
      setStatus(data.error, true);
    }
  };
}

async function openHelpChatWidget() {
  let widget = $("#helpChatWidget");
  if (widget) {
    widget.remove();
    if (state.supportSocket) state.supportSocket.close();
  }
  widget = document.createElement("section");
  widget.id = "helpChatWidget";
  widget.className = "help-chat-widget";
  widget.innerHTML = `<div class="help-chat-head"><div><strong>Chat for help</strong><span class="muted">Connecting...</span></div><button class="btn icon quiet" type="button" data-close-help-chat>${icon("x")}</button></div>`;
  document.body.appendChild(widget);
  icons();
  try {
    const chatData = await api("/api/chats");
    let chat = (chatData.chats || []).find((item) => item.type === "support" && item.status !== "ended" && !item.deleted_at);
    if (!chat) {
      chat = (await api("/api/chats", { method: "POST", body: JSON.stringify({ type: "support" }) })).chat;
    }
    const messages = ((await api(`/api/chats/${chat.id}/messages`)).messages || []);
    const users = await loadMentionUsers().catch(() => []);
    const usersByID = Object.fromEntries([...users, state.me].filter(Boolean).map((user) => [user.id, user]));
    widget.innerHTML = `
      <div class="help-chat-head">
        <div><strong>Chat for help</strong><span class="muted">${chat.status === "ended" ? "Chat ended" : "Support conversation"}</span></div>
        <button class="btn icon quiet" type="button" data-close-help-chat title="Close">${icon("x")}</button>
      </div>
      <div id="helpMessages" class="messages help-messages">${messages.map((message) => chatMessageHTML(message, usersByID, "support")).join("")}</div>
      <div class="help-chat-actions">
        ${chat.status !== "ended" ? `<button class="btn compact danger" type="button" id="endHelpChatBtn">${icon("phone-off")}End chat</button>` : `<span class="pill danger">ended</span>`}
      </div>
      ${chatComposerHTML("helpChatForm", "support", chat.status !== "ended" && !chat.deleted_at, "Type a message")}`;
    widget.querySelector("[data-close-help-chat]")?.addEventListener("click", () => {
      widget.remove();
      if (state.supportSocket) state.supportSocket.close();
    });
    $("#endHelpChatBtn")?.addEventListener("click", async () => {
      if (!confirm("End this help chat?")) return;
      await api(`/api/chats/${chat.id}/end`, { method: "POST", body: JSON.stringify({}) });
      if (state.supportSocket) state.supportSocket.close();
      await openHelpChatWidget();
    });
    if (chat.status !== "ended" && !chat.deleted_at) openSupportChatSocket(chat.id, usersByID);
    bindRichChatComposer("helpChatForm", "support");
    bindChatReplyButtons("support");
    bindMentionSuggestions(widget);
    widget.querySelector(".messages").scrollTop = widget.querySelector(".messages").scrollHeight;
    icons();
  } catch (error) {
    widget.innerHTML = `<div class="help-chat-head"><div><strong>Chat for help</strong><span class="muted">${esc(error.message)}</span></div><button class="btn icon quiet" type="button" data-close-help-chat>${icon("x")}</button></div>`;
    widget.querySelector("[data-close-help-chat]")?.addEventListener("click", () => widget.remove());
    icons();
  }
}

function openSupportChatSocket(chatID, usersByID = {}) {
  if (state.supportSocket) state.supportSocket.close();
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  state.supportSocket = new WebSocket(`${protocol}://${location.host}/ws/chat?chat_id=${chatID}&token=${encodeURIComponent(state.access)}`);
  state.supportSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    const box = $("#helpMessages");
    if (data.message && box) {
      box.insertAdjacentHTML("beforeend", chatMessageHTML(data.message, usersByID, "support"));
      box.scrollTop = box.scrollHeight;
      bindChatReplyButtons("support");
      icons();
    }
    if (["chat_ended", "chat_deleted", "chat_restored", "chat_removed"].includes(data.type)) {
      openHelpChatWidget();
    }
    if (data.type === "error") {
      setStatus(data.error, true);
    }
  };
}

async function refreshTimerWidget() {
  clearInterval(state.timerTick);
  const widget = $("#timerWidget");
  if (!widget || !state.access) return;
  const data = await api("/api/time-entries/active").catch(() => ({ entry: null }));
  if (!data.entry) {
    widget.classList.remove("active");
    widget.innerHTML = "";
    return;
  }
  state.activeTimer = data.entry;
  function draw() {
    const seconds = Math.floor((Date.now() - new Date(data.entry.start_time).getTime()) / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    widget.classList.add("active");
    widget.innerHTML = `<strong>${esc(data.task?.title || "Timer")}</strong><span class="pill">${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}</span><button class="btn danger" id="stopTimerBtn">${icon("square")}Stop</button>`;
    $("#stopTimerBtn").onclick = async () => {
      await api(`/api/time-entries/${data.entry.id}/stop`, { method: "POST" });
      refreshTimerWidget();
    };
    icons();
  }
  draw();
  state.timerTick = setInterval(draw, 1000);
}

function renderRouteError(error) {
  if (String(error.message).includes("invalid token") || String(error.message).includes("missing bearer")) {
    logout();
    return;
  }
  app.innerHTML = `<div class="auth-wrap"><section class="auth-box"><h1>Something needs attention</h1><p class="muted">${esc(error.message)}</p><p><a class="btn primary" href="/dashboard">Retry</a></p></section></div>`;
}

async function route(options = {}) {
  if (options.closeTaskPanel !== false) closeClientTaskPanel();
  const routeToken = beginRouteTransition(options);
  try {
    if (path() === "/login") {
      stopNotificationPolling();
      stopLivePolling();
      if (state.access) {
        try {
          await loadMe();
          window.location.replace("/dashboard");
          return;
        } catch {
          clearStoredTokens();
          state.access = "";
          state.refresh = "";
          state.me = null;
        }
      }
      return renderAuth("login");
    }
    if (path() === "/register") {
      stopNotificationPolling();
      stopLivePolling();
      return renderAuth("register");
    }
    if (!state.access) {
      stopNotificationPolling();
      stopLivePolling();
      window.location.href = "/login";
      return;
    }
    await loadMe();
    startNotificationPolling();
    startLivePolling();
    const matchClientWebsite = path().match(/^\/projects\/([^/]+)\/sites\/([^/]+)/);
    const matchClientProject = path().match(/^\/projects\/([^/]+)$/);
    const matchAnnotate = path().match(/^\/websites\/([^/]+)\/annotate/);
    const matchPageEdit = path().match(/^\/admin\/pages\/([^/]+)\/edit/);
    if (path() === "/dashboard") return await renderDashboard();
    if (path() === "/team") {
      if (await guardPaidFeaturePage("staff management")) await renderTeam();
      return;
    }
    if (path() === "/tasks") {
      if (await guardPaidFeaturePage("tasks")) await renderTasks();
      return;
    }
    if (path() === "/projects") {
      if (await guardPaidFeaturePage("projects, folders, and domains")) await renderClientProjects();
      return;
    }
    if (matchClientWebsite) {
      if (await guardPaidFeaturePage("domains and annotations")) await renderClientWebsite(matchClientWebsite[1], matchClientWebsite[2]);
      return;
    }
    if (matchClientProject) {
      if (await guardPaidFeaturePage("client folders and domains")) await renderClientProject(matchClientProject[1]);
      return;
    }
    if (path().startsWith("/spaces/")) {
      if (await guardPaidFeaturePage("tasks")) await renderTasks();
      return;
    }
    if (path() === "/websites") {
      if (await guardPaidFeaturePage("website feedback")) await renderWebsites();
      return;
    }
    if (matchAnnotate) {
      if (await guardPaidFeaturePage("annotations")) await renderAnnotate(matchAnnotate[1]);
      return;
    }
    if (path() === "/chat") return await renderChat();
    if (path() === "/settings/company") return await renderCompanySettings();
    if (path() === "/settings/billing") return await renderBilling();
    if (path() === "/team/integrations") return await renderIntegrations();
    if (path() === "/team/performance") {
      if (await guardPaidFeaturePage("team performance")) await renderTeamPerformance();
      return;
    }
    if (path() === "/reports/time") {
      if (await guardPaidFeaturePage("time reports")) await renderReports();
      return;
    }
    if (path() === "/admin" || path() === "/admin/users") return await renderAdmin();
    if (path() === "/admin/settings") return await renderSettings();
    if (path() === "/admin/plans") return await renderPlansAdmin();
    if (path() === "/admin/pages") return await renderPages();
    if (matchPageEdit) return await renderPageEditor(matchPageEdit[1]);
    return await renderDashboard();
  } catch (error) {
    renderRouteError(error);
  } finally {
    finishRouteTransition(routeToken);
  }
}

bindAppNavigation();
route().catch(renderRouteError);
