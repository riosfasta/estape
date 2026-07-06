function readStoredObject(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const state = {
  access: localStorage.getItem("pinflow_access") || "",
  refresh: localStorage.getItem("pinflow_refresh") || "",
  me: null,
  team: null,
  personalTeam: null,
  companyAccess: null,
  unreadCommentCount: 0,
  activeTimer: null,
  timerTick: null,
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
  projectSidebarOpen: readStoredObject("pinflow_project_sidebar_open"),
  clientTaskReply: null,
  clientTaskCommentEdit: null,
};

const app = document.getElementById("app");
const path = () => window.location.pathname;
const $ = (selector) => document.querySelector(selector);

function icon(name) {
  return `<i data-lucide="${name}"></i>`;
}

function icons() {
  if (window.lucide) lucide.createIcons();
}

window.addEventListener("load", icons);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function mentionText(value) {
  return esc(value).replace(/(^|[\s(])@([a-zA-Z0-9_]{3,24})/g, '$1<span class="mention">@$2</span>');
}

function chatText(value) {
  return mentionText(value).replace(/(https?:\/\/[^\s<]+)/g, (url) => `<a class="text-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`);
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
  return STAFF_ROLES
    .map((role) => `<option value="${esc(role.value)}" ${selected === role.value ? "selected" : ""}>${esc(role.label)}</option>`)
    .join("");
}

function staffRoleLabel(value) {
  if (value === "marketing it") return "Marketing / IT";
  if (value === "client admin") return "Client Admin";
  return STAFF_ROLES.find((role) => role.value === value)?.label || value || "";
}

function accountRoleLabel(user = state.me) {
  if (user?.role === "owner_adm") return "Owner admin";
  if (user?.role === "client_admin") return "Client Admin";
  return "User admin";
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

async function loadMentionUsers() {
  if (state.mentionUsers) return state.mentionUsers;
  const data = await api("/api/users/mentions").catch(() => ({ users: [] }));
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

function fmtDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString();
}

function fmtDayMonthYear(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function badgeCount(value) {
  const count = Number(value) || 0;
  return count > 99 ? "99+" : String(count);
}

function resizeProfilePhotoFile(file, maxSize = 500) {
  const supportedSmallTypes = ["image/jpeg", "image/png", "image/gif"];
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith("image/")) {
      reject(new Error("Profile photo must be an image"));
      return;
    }
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) {
        URL.revokeObjectURL(url);
        reject(new Error("Profile photo has invalid dimensions"));
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
          reject(new Error("Could not resize profile photo"));
          return;
        }
        resolve(new File([blob], `${base}-500.${ext}`, { type, lastModified: Date.now() }));
      }, type, 0.86);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Profile photo must be a valid image"));
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
  if (!res.ok) throw new Error(body.error || "Request failed");
  return body;
}

function storeTokens(access, refresh) {
  state.access = access;
  state.refresh = refresh;
  localStorage.setItem("pinflow_access", access);
  localStorage.setItem("pinflow_refresh", refresh);
}

function logout() {
  localStorage.removeItem("pinflow_access");
  localStorage.removeItem("pinflow_refresh");
  state.access = "";
  state.refresh = "";
  window.location.href = "/login";
}

async function loadMe() {
  const previousTeamID = state.team?.id || "";
  const data = await api("/api/users/me");
  state.me = data.user;
  state.team = data.team;
  state.personalTeam = data.personal_team || null;
  state.companyAccess = data.company_access || null;
  state.unreadCommentCount = Number(data.unread_comment_count || 0);
  const clientData = await api("/api/client-projects").catch(() => ({ clients: [], websites: [] }));
  state.clientProjects = clientData.clients || [];
  state.clientWebsites = clientData.websites || [];
  if ((state.team?.id || "") !== previousTeamID) state.mentionUsers = null;
  const preference = state.me.theme_preference || "system";
  localStorage.setItem("pinflow_theme", preference);
  applyTheme(preference);
}

function applyTheme(preference) {
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = preference === "system" ? (prefersDark ? "dark" : "light") : preference;
}

function renderAuth(mode) {
  const isRegister = mode === "register";
  const inviteToken = new URLSearchParams(location.search).get("invite") || "";
  app.innerHTML = `
    <div class="auth-wrap">
      <section class="auth-box">
        <a class="brand" href="/"><span class="brand-mark">P</span>PinFlow</a>
        <h1>${isRegister ? (inviteToken ? "Create invited account" : "Create workspace") : "Welcome back"}</h1>
        <form id="authForm" class="form-grid">
          ${isRegister ? `<div class="field"><label>Name</label><input name="name" required></div>` : ""}
          ${isRegister ? `<div class="field"><label>Username</label><input name="username" required pattern="[a-zA-Z0-9_]{3,24}" placeholder="jane_writer"></div>` : ""}
          ${isRegister && !inviteToken ? `<div class="field"><label>Company name</label><input name="company_name" required placeholder="Acme Inc"></div>` : ""}
          ${isRegister && inviteToken ? `<input type="hidden" name="invite_token" value="${esc(inviteToken)}"><p class="muted">This account will join the company that invited you.</p>` : ""}
          <div class="field"><label>Email</label><input type="email" name="email" required></div>
          <div class="field"><label>Password</label><input type="password" name="password" required minlength="8"></div>
          ${!isRegister ? `<div class="field two-factor-field" hidden><label>Authenticator code</label><input id="twoFactorCode" name="two_factor_code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></div>` : ""}
          <button class="btn primary" type="submit">${icon(isRegister ? "user-plus" : "log-in")}${isRegister ? "Create account" : "Login"}</button>
          <p class="status-line"></p>
        </form>
        <p class="muted">${isRegister ? `Already have an account? <a class="text-link" href="/login">Login</a>` : `New team? <a class="text-link" href="/register">Create a workspace</a>`}</p>
      </section>
    </div>`;
  icons();
  $("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (isRegister && form.company_name) form.workspace_name = form.company_name;
    try {
      const data = await api(isRegister ? "/api/auth/register" : "/api/auth/login", { method: "POST", body: JSON.stringify(form) });
      if (data.two_factor_required) {
        $(".two-factor-field")?.removeAttribute("hidden");
        $("#twoFactorCode")?.focus();
        setStatus("Enter your authenticator code");
        return;
      }
      storeTokens(data.access_token, data.refresh_token);
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

function saveProjectSidebarState() {
  localStorage.setItem("pinflow_project_sidebar_open", JSON.stringify(state.projectSidebarOpen || {}));
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
  return state.me?.role === "users_admin" && [state.me?.team_id, state.personalTeam?.id].filter(Boolean).includes(client.team_id);
}

function sidebarProjectsHTML() {
  const sitesByClient = (state.clientWebsites || []).reduce((acc, site) => {
    (acc[site.client_id] ||= []).push(site);
    return acc;
  }, {});
  const rows = (state.clientProjects || []).map((client) => {
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
  return rows || workspaceChild("/projects", "Add client folder", "folder-plus");
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

function shell(title, html) {
  const displayTeam = state.personalTeam || (state.me?.role === "users_member" ? null : state.team);
  const userDisplayName = state.me?.name || state.me?.username || state.me?.email || "User";
  const workspaceName = displayTeam?.name || (state.me?.role === "owner_adm" ? "Owner Admin" : `${userDisplayName}'s Company`);
  const workspaceLogo = userChip();
  app.innerHTML = `
    <div class="workspace-shell clickup-shell">
      <aside class="workspace-nav" aria-label="Workspace">
        <div class="workspace-switcher">
          ${workspaceLogo}
          <div>
            <strong>${esc(workspaceName)}</strong>
            <span>${esc(userDisplayName)}</span>
          </div>
          <a class="btn icon quiet" href="/tasks" title="Create task">${icon("plus")}</a>
        </div>
        <nav class="workspace-menu">
          <p class="nav-kicker">Home</p>
          ${workspaceLink("/dashboard", "Inbox", "inbox", badgeCount(state.unreadCommentCount))}
          ${workspaceLink("/chat", "Chat", "messages-square")}
          ${workspaceLink("/team", "Team", "users")}
          <div class="nav-group">
            <span class="nav-item muted-item">${icon("user-round")}<span>My Tasks</span></span>
            ${workspaceChild("/tasks", "Assigned to me", "user-check")}
            ${workspaceChild("/tasks?view=calendar", "Today & Upcoming", "calendar-days", "4")}
          </div>
          <p class="nav-kicker">Projects</p>
          ${sidebarProjectsHTML()}
          <p class="nav-kicker">Tools</p>
          ${workspaceChild("/projects", "All projects", "folder-open")}
          ${workspaceChild("/tasks", "Task workspace", "circle-check-big")}
          ${workspaceChild("/websites", "Website feedback", "messages-square")}
          ${workspaceChild("/reports/time", "Time reports", "timer")}
          ${state.me?.role === "users_admin" ? workspaceChild("/team/integrations", "Integrations", "plug") : ""}
          ${state.me?.role === "owner_adm" ? `
            <p class="nav-kicker">Owner</p>
            ${workspaceLink("/admin", "Manage users", "users")}
            ${workspaceChild("/admin/plans", "Pricing plans", "badge-dollar-sign")}
            ${workspaceChild("/admin/pages", "Pages", "file-pen")}
            ${workspaceChild("/admin/settings", "Settings", "settings")}
          ` : ""}
        </nav>
        <a class="mention-pill" href="/settings/company">${icon("settings")}Settings</a>
      </aside>
      <main class="main-area">
        <header class="topbar command-topbar">
          <label class="command-bar" for="commandSearch">
            ${icon("search")}
            <input id="commandSearch" autocomplete="off" placeholder="Search Ctrl K">
          </label>
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
  $("#logoutBtn").addEventListener("click", logout);
  $("#helpChatBtn")?.addEventListener("click", () => {
    closeProfileMenu();
    openHelpChatWidget();
  });
  $("#themeSelect").value = state.me?.theme_preference || "system";
  $("#themeSelect").addEventListener("change", async (event) => {
    const theme = event.target.value;
    localStorage.setItem("pinflow_theme", theme);
    applyTheme(theme);
    await api("/api/users/me/preferences", { method: "PATCH", body: JSON.stringify({ theme }) });
  });
  bindMentionSuggestions(app);
  bindDialogCloseButtons(app);
  bindSidebarProjectControls();
  $("#commandSearch")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const query = event.currentTarget.value.trim();
    if (query) window.location.href = `/tasks?search=${encodeURIComponent(query)}`;
  });
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
  shell("Inbox", `
    <div class="inbox-page">
      <div class="inbox-head">
        <div>
          <h1>Inbox</h1>
          <p class="muted">${esc(state.team?.name || "PinFlow")} task comments</p>
        </div>
        <span class="pill ${state.unreadCommentCount ? "warn" : ""}">${esc(badgeCount(state.unreadCommentCount))} unread</span>
      </div>
      ${invitationCards(invitations)}
      ${notificationCards(notifications)}
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
      ${inboxSection("Comments", inboxCommentRows(inboxComments))}
    </div>`);
  document.querySelectorAll("[data-invite-action]").forEach((btn) => btn.addEventListener("click", async () => {
    try {
      await api(`/api/invitations/${btn.dataset.inviteId}/${btn.dataset.inviteAction}`, { method: "POST", body: JSON.stringify({}) });
      await loadMe();
      await renderDashboard();
    } catch (error) {
      setStatus(error.message, true);
    }
  }));
  document.querySelectorAll("[data-inbox-mention-filter]").forEach((btn) => btn.addEventListener("click", () => {
    setInboxFilters(btn.dataset.inboxMentionFilter, $("#inboxProjectFilter")?.value || "");
  }));
  $("#inboxProjectFilter")?.addEventListener("change", (event) => {
    setInboxFilters(mentionFilter, event.currentTarget.value);
  });
  bindInboxCommentRows();
}

function invitationCards(invitations) {
  if (!invitations.length) return "";
  return `<section class="invite-strip">${invitations.map((invite) => `
    <article class="invite-card">
      <div>
        <strong>${icon("mail-check")} Team invitation</strong>
        <span class="muted">Join as ${esc(staffRoleLabel(invite.staff_role))} with @${esc(invite.username || "username")}</span>
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
      <div><h3>${esc(invite.email)}</h3><span class="muted">@${esc(invite.username || "pending")} · ${esc(staffRoleLabel(invite.staff_role))}</span></div>
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

function notificationCards(notifications) {
  if (!notifications.length) return "";
  return `<section class="invite-strip">${notifications.slice(0, 4).map((note) => `
    <article class="invite-card notice-card">
      <div>
        <strong>${icon("bell")} ${esc(note.type.replaceAll("_", " "))}</strong>
        <span class="muted">${mentionText(note.content)}</span>
      </div>
    </article>`).join("")}</section>`;
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
  const badge = document.querySelector('.workspace-menu a[href="/dashboard"] .unread-badge');
  if (badge) badge.textContent = badgeCount(state.unreadCommentCount);
}

function inboxCommentRows(comments) {
  if (!comments.length) {
    return `
      <article class="inbox-row empty-row">
        <span class="inbox-row-icon">${icon("message-square")}</span>
        <div class="inbox-row-title"><strong>No comments found</strong><span>Try a different mention or project filter.</span></div>
        <span></span>
        <div class="inbox-row-message"><strong>Clear</strong><span>No matching task comments.</span></div>
        <span></span><span></span><span class="mini-count">0</span><time>Now</time>
      </article>`;
  }
  return comments.map((item) => `
    <button class="inbox-row comment-inbox-row ${item.read ? "is-quiet" : "is-unread"}" type="button" data-open-task-comment="${esc(item.task_id)}" data-comment-id="${esc(item.id)}">
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
      <span class="mini-count">${item.read ? "" : "new"}</span>
      <time>${inboxTime(item.created_at)}</time>
    </button>`).join("");
}

function bindInboxCommentRows() {
  document.querySelectorAll("[data-open-task-comment]").forEach((row) => row.addEventListener("click", async () => {
    const taskID = row.dataset.openTaskComment;
    const commentID = row.dataset.commentId;
    try {
      const readData = await api(`/api/tasks/${taskID}/comments/${commentID}/read`, { method: "POST", body: JSON.stringify({}) });
      if (readData.unread_count !== undefined) updateInboxBadge(readData.unread_count);
      row.classList.remove("is-unread");
      row.classList.add("is-quiet");
      const marker = row.querySelector(".mini-count");
      if (marker) marker.textContent = "";
      const data = await api(`/api/tasks/${taskID}`);
      showTaskDetailDialog(data, commentID);
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
  return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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
      <span class="pill">${esc(staffRoleLabel(member.staff_role) || member.role)}</span>
      <span class="pill ${isSuspended || hasLeft ? "danger" : ""}">${esc(statusText)}</span>
      ${canManageMember ? `
        <details class="row-menu">
          <summary class="btn icon quiet" title="Manage staff">${icon("more-horizontal")}</summary>
          <div class="row-menu-list">
            <button type="button" data-edit-member="${member.id}">${icon("pencil")}Edit</button>
            <button type="button" class="${isSuspended ? "" : "danger-text"}" data-member-status="${member.id}" data-next-status="${isSuspended ? "active" : "suspended"}">${icon(isSuspended ? "rotate-ccw" : "ban")}${isSuspended ? "Reactivate" : "Suspend / Block"}</button>
            <button type="button" class="danger-text" data-delete-member="${member.id}">${icon("trash-2")}Delete</button>
          </div>
        </details>` : ""}
    </article>`;
  }).join("");
}

async function renderTeam() {
  const teamPageTeam = state.personalTeam || state.team;
  if (!teamPageTeam) return renderDashboard();
  const teamID = teamPageTeam.id;
  const data = await api(`/api/teams/${teamID}`);
  const members = data.members || [];
  const canManageTeam = state.me?.role === "owner_adm" || state.me?.role === "users_admin" || teamPageTeam.owner_admin_id === state.me?.id;
  const invitationData = canManageTeam ? await api(`/api/teams/${teamID}/invitations`).catch(() => ({ invitations: [] })) : { invitations: [] };
  const invitations = invitationData.invitations || [];
  shell("Team", `
    <div class="page-title"><div><h1>Team</h1><p class="muted">${esc(data.team.name)}</p></div></div>
    <div class="grid-2">
      <section class="panel"><h2>Listed Members</h2><div class="task-list">${teamMemberRows(members, canManageTeam)}</div></section>
      <section class="panel">
        <h2>Invite Staff</h2>
        <form id="inviteForm" class="form-grid">
          <div class="field"><label>Email</label><input type="email" name="email" required></div>
          <div class="field"><label>Username</label><input name="username" pattern="[a-zA-Z0-9_]{3,24}" placeholder="alex_dev"></div>
          <div class="field"><label>User role</label><select name="staff_role" required>${staffRoleOptions()}</select></div>
          <button class="btn primary" type="submit">${icon("mail-plus")}Send invitation</button>
          <p class="status-line"></p>
        </form>
        ${canManageTeam ? `<div class="inline-section"><h3>Invitation Status</h3><div class="task-list invite-history">${invitationStatusRows(invitations)}</div></div>` : ""}
      </section>
    </div>
    <dialog id="memberEditDialog" class="modal">
      <form id="memberEditForm" class="form-grid" method="dialog">
        <div class="modal-head"><h2>Edit Staff</h2><button class="btn icon quiet" type="button" data-close-dialog="memberEditDialog" title="Close">${icon("x")}</button></div>
        <input type="hidden" name="id">
        <div class="grid-2">
          <div class="field"><label>Name</label><input name="name" required></div>
          <div class="field"><label>Email</label><input type="email" name="email" required></div>
        </div>
        <div class="grid-2">
          <div class="field"><label>Username</label><input name="username" required pattern="[a-zA-Z0-9_]{3,24}"></div>
          <div class="field"><label>User role</label><select name="staff_role">${staffRoleOptions()}</select></div>
        </div>
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
    form.elements.staff_role.value = member.staff_role === "marketing it" ? "marketing" : (member.staff_role || "internal");
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
          staff_role: form.elements.staff_role.value,
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
  return "Member";
}

function clientWebsiteRows(websites) {
  if (!websites.length) return `<p class="muted">No websites yet.</p>`;
  return websites.map((site) => `<article class="task-row">
    <div><h3>${esc(site.name)}</h3><span class="muted">${esc(site.url || "No URL yet")}</span></div>
    <span class="pill">${icon("globe-2")}website</span>
    <a class="btn compact" href="/projects/${esc(site.client_id)}/sites/${esc(site.id)}">${icon("external-link")}Open</a>
  </article>`).join("");
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

function clientMemberRows(members, canManageMembers) {
  if (!members.length) return `<p class="muted">No members listed yet.</p>`;
  return members.map((entry) => {
    const user = entry.user || {};
    return `<article class="task-row">
      <div><h3>${esc(user.name || user.username || user.email)}</h3><span class="muted">@${esc(user.username || "member")} - ${esc(user.email || "")}</span></div>
      <span class="pill">${esc(clientRoleLabel(entry.client_role))}</span>
      ${canManageMembers && user.id !== state.me?.id ? `<button class="btn compact danger" type="button" data-remove-client-member="${esc(user.id)}">${icon("user-minus")}Remove</button>` : ""}
    </article>`;
  }).join("");
}

function compactClientTaskTitle(value) {
  return Array.from(String(value || "").trim()).slice(0, 80).join("").trim();
}

function canManageClientTaskUI(task, canManageFolder = false) {
  return Boolean(canManageFolder || task?.created_by === state.me?.id);
}

function clientTaskBoardHTML(tasks, tab, members, canManage) {
  const statuses = [
    { value: "todo", label: "To do" },
    { value: "in_progress", label: "In progress" },
    { value: "done", label: "Done" },
  ];
  return `<div class="client-board">
    ${statuses.map((status) => `<section class="kanban-column">
      <h3>${esc(status.label)}</h3>
      ${(tasks || []).filter((task) => (task.status || "todo") === status.value && task.tab_id === tab.id).map((task) => {
        const canManageTask = canManageClientTaskUI(task, canManage);
        return `<article class="task-card client-task-card">
          <button class="client-task-open" type="button" data-open-client-task="${esc(task.id)}">${esc(compactClientTaskTitle(task.title))}</button>
          ${canManageTask ? `<div class="toolbar compact-toolbar">
            <select data-client-task-status="${esc(task.id)}">${statuses.map((item) => `<option value="${item.value}" ${item.value === (task.status || "todo") ? "selected" : ""}>${esc(item.label)}</option>`).join("")}</select>
            <button class="btn compact danger" type="button" data-delete-client-task="${esc(task.id)}">${icon("trash-2")}Delete</button>
          </div>` : ""}
        </article>`;
      }).join("") || `<p class="muted">No tasks.</p>`}
    </section>`).join("")}
  </div>`;
}

function clientTaskUsersByID(members = []) {
  return Object.fromEntries(members.map((entry) => [entry.user?.id, entry.user]).filter(([id]) => id));
}

function clientTaskCommentHTML(comment, usersByID = {}, canManageFolder = false) {
  const author = usersByID[comment.author_id] || {};
  const authorName = author.name || author.username || "Someone";
  const replyText = comment.content || comment.attachment_name || "Attachment";
  const canManageComment = canManageFolder || comment.author_id === state.me?.id;
  return `<article class="client-task-comment" data-client-comment-id="${esc(comment.id)}">
    <div class="message-head"><strong>${esc(authorName)}</strong><time>${inboxTime(comment.created_at)}</time></div>
    ${comment.reply_text ? `<blockquote>${chatText(comment.reply_text)}</blockquote>` : ""}
    ${comment.content ? `<p>${chatText(comment.content)}</p>` : ""}
    ${comment.attachment_url ? `<a class="attachment-link" href="${esc(comment.attachment_url)}" target="_blank" rel="noopener noreferrer">${icon("paperclip")}${esc(comment.attachment_name || "Attachment")}</a>` : ""}
    <div class="client-comment-actions">
      <button class="message-reply-btn" type="button" data-client-comment-reply="${esc(comment.id)}" data-reply-text="${esc(replyText.slice(0, 160))}">${icon("reply")}Reply</button>
      ${canManageComment ? `<button class="message-reply-btn" type="button" data-edit-client-comment="${esc(comment.id)}" data-comment-content="${esc(comment.content || "")}">${icon("pencil")}Edit</button><button class="message-reply-btn danger-text" type="button" data-delete-client-comment="${esc(comment.id)}">${icon("trash-2")}Delete</button>` : ""}
    </div>
  </article>`;
}

function setClientTaskReply(reply) {
  state.clientTaskReply = reply;
  if (reply) state.clientTaskCommentEdit = null;
  const panel = $("#clientTaskPanel");
  const preview = panel?.querySelector("[data-client-task-reply-preview]");
  if (!preview) return;
  if (!reply) {
    preview.hidden = true;
    preview.innerHTML = "";
    return;
  }
  preview.hidden = false;
  preview.innerHTML = `<span>${icon("reply")}Replying to: ${chatText(reply.text)}</span><button class="btn icon quiet" type="button" data-clear-client-task-reply title="Cancel reply">${icon("x")}</button>`;
  preview.querySelector("[data-clear-client-task-reply]")?.addEventListener("click", () => setClientTaskReply(null));
  icons();
}

function setClientTaskCommentEdit(comment) {
  state.clientTaskCommentEdit = comment;
  if (comment) state.clientTaskReply = null;
  const panel = $("#clientTaskPanel");
  const form = panel?.querySelector("#clientTaskCommentForm");
  const textarea = form?.elements.content;
  const preview = panel?.querySelector("[data-client-task-reply-preview]");
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
    setClientTaskCommentEdit(null);
  });
  textarea.focus();
  icons();
}

async function openClientTaskPanel(taskID) {
  const data = await api(`/api/client-tasks/${taskID}`);
  const task = data.task || {};
  const usersByID = clientTaskUsersByID(data.members || []);
  let panel = $("#clientTaskPanel");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "clientTaskPanel";
    panel.className = "client-task-panel";
    document.body.appendChild(panel);
  }
  const assignees = (task.assignee_ids || []).map((id) => usersByID[id]?.name || usersByID[id]?.username || "").filter(Boolean).join(", ");
  const canManageFolder = Boolean(data.can_manage);
  const canManageTask = Boolean(data.can_manage_task || canManageClientTaskUI(task, canManageFolder));
  const statuses = [
    { value: "todo", label: "To do" },
    { value: "in_progress", label: "In progress" },
    { value: "done", label: "Done" },
  ];
  panel.innerHTML = `
    <header class="client-task-panel-head">
      <div><span class="muted">${esc(data.client?.name || "Client")} / ${esc(data.website?.name || "Website")}</span><h2>${esc(compactClientTaskTitle(task.title))}</h2></div>
      <div class="toolbar">
        ${canManageTask ? `<button class="btn compact" type="button" id="editClientTaskBtn">${icon("pencil")}Edit</button><button class="btn compact danger" type="button" id="deleteClientTaskPanelBtn">${icon("trash-2")}Delete</button>` : ""}
        <button class="btn icon quiet" type="button" data-close-client-task title="Close">${icon("x")}</button>
      </div>
    </header>
    <div class="client-task-panel-body">
      <section class="client-task-detail-main">
        <div class="task-detail-meta">
          <span class="pill">${esc(task.status || "todo")}</span>
          <span class="pill">${esc(task.type || "description")}</span>
          ${task.due_date ? `<span class="pill warn">${icon("calendar-days")}${esc(fmtDate(task.due_date))}</span>` : ""}
          ${assignees ? `<span class="pill">${icon("user-check")}${esc(assignees)}</span>` : ""}
        </div>
        <h3>Content</h3>
        <p>${chatText(task.content || "No content yet.")}</p>
        ${task.url ? `<h3>Annotation URL</h3><p><a class="text-link" href="${esc(task.url)}" target="_blank" rel="noopener noreferrer">${esc(task.url)}</a></p>` : ""}
        ${(task.attachments || []).length ? `<h3>Attachments</h3><div class="attachment-list">${task.attachments.map((url) => `<a class="attachment-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon("paperclip")}${esc(url.split("/").pop() || "Attachment")}</a>`).join("")}</div>` : ""}
      </section>
      <aside class="client-task-comments">
        <h3>Comments</h3>
        <div class="client-task-comment-list">${(data.comments || []).map((comment) => clientTaskCommentHTML(comment, usersByID, canManageFolder)).join("") || `<p class="muted">No comments yet.</p>`}</div>
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
      </aside>
    </div>
    <dialog id="editClientTaskDialog" class="modal client-dialog">
      <form id="editClientTaskForm" class="form-grid" method="dialog">
        <div class="modal-head"><h2>Edit task</h2><button class="btn icon quiet" type="button" data-close-dialog="editClientTaskDialog" title="Close">${icon("x")}</button></div>
        <div class="grid-2"><div class="field"><label>Status</label><select name="status">${statuses.map((item) => `<option value="${item.value}" ${item.value === (task.status || "todo") ? "selected" : ""}>${esc(item.label)}</option>`).join("")}</select></div><div class="field"><label>Due date</label><input type="date" name="due_date" value="${esc(String(task.due_date || "").slice(0, 10))}"></div></div>
        <div class="field"><label>Title</label><input name="title" maxlength="80" value="${esc(task.title || "")}" required></div>
        <div class="field"><label>Content</label><textarea name="content" data-mentionable>${esc(task.content || "")}</textarea></div>
        <div class="field"><label>Annotation URL</label><input name="url" value="${esc(task.url || "")}" placeholder="https://example.com/page"></div>
        <div class="field"><label>Assignment</label><select name="assignee_ids" multiple>${(data.members || []).map((entry) => `<option value="${esc(entry.user?.id || "")}" ${(task.assignee_ids || []).includes(entry.user?.id) ? "selected" : ""}>${esc(entry.user?.name || entry.user?.email || "Member")}</option>`).join("")}</select></div>
        <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Save</button><button class="btn" type="button" data-close-dialog="editClientTaskDialog">Cancel</button></div>
        <p class="status-line"></p>
      </form>
    </dialog>`;
  panel.querySelector("[data-close-client-task]")?.addEventListener("click", () => {
    panel.remove();
    state.clientTaskReply = null;
    state.clientTaskCommentEdit = null;
  });
  panel.querySelector("#editClientTaskBtn")?.addEventListener("click", () => panel.querySelector("#editClientTaskDialog")?.showModal());
  panel.querySelector("#deleteClientTaskPanelBtn")?.addEventListener("click", async () => {
    if (!confirm("Delete this task?")) return;
    await api(`/api/client-tasks/${taskID}`, { method: "DELETE" });
    panel.remove();
    route();
  });
  panel.querySelector("#editClientTaskForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    body.title = compactClientTaskTitle(body.title);
    body.content = String(body.content || "").trim();
    body.assignee_ids = Array.from(form.assignee_ids.selectedOptions).map((option) => option.value).filter(Boolean);
    try {
      await api(`/api/client-tasks/${taskID}`, { method: "PATCH", body: JSON.stringify(body) });
      panel.querySelector("#editClientTaskDialog")?.close();
      await openClientTaskPanel(taskID);
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  panel.querySelectorAll("[data-client-comment-reply]").forEach((btn) => btn.addEventListener("click", () => {
    setClientTaskReply({ id: btn.dataset.clientCommentReply, text: btn.dataset.replyText || "Comment" });
    panel.querySelector("textarea[name='content']")?.focus();
  }));
  panel.querySelectorAll("[data-edit-client-comment]").forEach((btn) => btn.addEventListener("click", () => {
    setClientTaskCommentEdit({ id: btn.dataset.editClientComment, content: btn.dataset.commentContent || "" });
  }));
  panel.querySelectorAll("[data-delete-client-comment]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!confirm("Delete this comment?")) return;
    await api(`/api/client-task-comments/${btn.dataset.deleteClientComment}`, { method: "DELETE" });
    await openClientTaskPanel(taskID);
  }));
  const form = panel.querySelector("#clientTaskCommentForm");
  const textarea = form?.elements.content;
  form?.querySelector("[data-client-comment-emoji]")?.addEventListener("click", (event) => openEmojiPicker(event.currentTarget, textarea));
  form?.querySelector("[data-client-comment-attach]")?.addEventListener("click", () => form.elements.attachment.click());
  form?.elements.attachment?.addEventListener("change", () => {
    const file = form.elements.attachment.files?.[0];
    const preview = form.querySelector("[data-client-task-attachment-preview]");
    if (!file || !preview) return;
    preview.hidden = false;
    preview.innerHTML = `<span>${icon("paperclip")}${esc(file.name)}</span><button class="btn icon quiet" type="button" data-clear-client-comment-attachment>${icon("x")}</button>`;
    preview.querySelector("[data-clear-client-comment-attachment]")?.addEventListener("click", () => {
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
        state.clientTaskCommentEdit = null;
        await openClientTaskPanel(taskID);
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
      state.clientTaskReply = null;
      await openClientTaskPanel(taskID);
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  setClientTaskReply(null);
  bindDialogCloseButtons(panel);
  bindMentionSuggestions(panel);
  icons();
}

function clientTabContentHTML(tab, data) {
  const canManage = data.can_manage;
  if (!tab) return `<section class="panel"><p class="muted">Add a tab to this website.</p></section>`;
  if (tab.type === "doc_list") {
    return `<section class="panel">
      <div class="panel-head"><h2>${esc(tab.title)}</h2>${canManage ? `<button class="btn primary compact" id="addWebsiteDocBtn">${icon("plus")}Document</button>` : ""}</div>
      <div class="task-list">${clientDocumentRows(data.documents || [], canManage)}</div>
    </section>`;
  }
  if (tab.type === "task_board") {
    return `<section class="panel">
      <div class="panel-head"><h2>${esc(tab.title)}</h2>${canManage ? `<button class="btn primary compact" id="addClientTaskBtn">${icon("plus")}Add task</button>` : ""}</div>
      ${clientTaskBoardHTML(data.tasks || [], tab, data.members || [], canManage)}
    </section>`;
  }
  return `<section class="panel">
    <div class="panel-head"><h2>${esc(tab.title)}</h2>${canManage ? `<button class="btn compact danger" type="button" data-delete-client-tab="${esc(tab.id)}">${icon("trash-2")}Delete tab</button>` : ""}</div>
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
  const candidateData = canManageMembers ? await api(`/api/teams/${client.team_id}`).catch(() => ({ members: [] })) : { members: [] };
  shell(client.name, `
    <div class="page-title">
      <div><h1>${esc(client.name)}</h1><p class="muted">${esc(client.company_email || "Client folder")}</p></div>
      <div class="toolbar"><a class="btn" href="/projects">${icon("arrow-left")}Projects</a>${canManage ? `<button class="btn primary" id="editClientBtn">${icon("pencil")}Edit client</button>` : ""}</div>
    </div>
    <div class="grid-2">
      <section class="panel"><div class="panel-head"><h2>Client information</h2>${canManage ? `<button class="btn compact" id="addClientDocBtn">${icon("file-plus")}Document</button>` : ""}</div><p>${chatText(client.details || "No client information yet.")}</p><div class="task-list">${clientDocumentRows(data.documents || [], canManage)}</div></section>
      <section class="panel"><div class="panel-head"><h2>Listed members</h2>${canManageMembers ? `<button class="btn compact primary" id="addClientMemberBtn">${icon("user-plus")}Add member</button>` : ""}</div><div class="task-list">${clientMemberRows(data.members || [], canManageMembers)}</div></section>
    </div>
    <section class="panel"><div class="panel-head"><h2>Websites</h2>${canManage ? `<button class="btn primary compact" id="addClientWebsiteBtn">${icon("plus")}Website</button>` : ""}</div><div class="task-list">${clientWebsiteRows(data.websites || [])}</div></section>
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
    <dialog id="clientMemberDialog" class="modal client-dialog">
      <form id="clientMemberForm" class="form-grid" method="dialog">
        <div class="modal-head"><h2>Add member access</h2><button class="btn icon quiet" type="button" data-close-dialog="clientMemberDialog" title="Close">${icon("x")}</button></div>
        <div class="field"><label>Listed member</label><select name="user_id" required>${(candidateData.members || []).map((member) => `<option value="${esc(member.id)}">${esc(member.name || member.email)} - @${esc(member.username || "member")}</option>`).join("")}</select></div>
        <div class="field"><label>Client folder role</label><select name="role"><option value="member">Member</option><option value="client_admin">Client Admin</option></select></div>
        <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Add</button><button class="btn" type="button" data-close-dialog="clientMemberDialog">Cancel</button></div>
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
    ${clientDocumentDialogHTML("clientDocumentDialog", "Add client document")}`);
  $("#editClientBtn")?.addEventListener("click", () => $("#editClientDialog")?.showModal());
  $("#addClientMemberBtn")?.addEventListener("click", () => $("#clientMemberDialog")?.showModal());
  $("#addClientWebsiteBtn")?.addEventListener("click", () => $("#clientWebsiteDialog")?.showModal());
  $("#addClientDocBtn")?.addEventListener("click", () => $("#clientDocumentDialog")?.showModal());
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
  $("#clientMemberForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api(`/api/client-projects/${clientID}/members`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
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
  bindDialogCloseButtons();
  bindMentionSuggestions(app);
  icons();
}

async function renderClientWebsite(clientID, websiteID) {
  const data = await api(`/api/client-websites/${websiteID}`);
  const website = data.website;
  const canManage = Boolean(data.can_manage);
  const selectedTabID = new URLSearchParams(location.search).get("tab") || data.tabs?.[0]?.id || "";
  const selectedTab = (data.tabs || []).find((tab) => tab.id === selectedTabID) || data.tabs?.[0] || null;
  shell(website.name, `
    <div class="page-title">
      <div><h1>${esc(website.name)}</h1><p class="muted">${esc(data.client?.name || "Client")} ${website.url ? " - " + esc(website.url) : ""}</p></div>
      <div class="toolbar"><a class="btn" href="/projects/${esc(clientID)}">${icon("arrow-left")}Client folder</a>${canManage ? `<button class="btn" id="editWebsiteBtn">${icon("pencil")}Edit website</button>${selectedTab ? `<button class="btn" id="editClientTabBtn">${icon("file-pen")}Edit tab</button><button class="btn danger" type="button" data-delete-client-tab="${esc(selectedTab.id)}">${icon("trash-2")}Delete tab</button>` : ""}<button class="btn primary" id="addClientTabBtn">${icon("plus")}Tab</button>` : ""}</div>
    </div>
    <section class="panel">
      <div class="tabs client-tabs">
        ${(data.tabs || []).map((tab) => `<button class="${selectedTab?.id === tab.id ? "active" : ""}" type="button" data-client-tab-link="${esc(tab.id)}">${esc(tab.title)}</button>`).join("")}
        ${canManage ? `<button type="button" id="addClientTabInline">${icon("plus")}</button>` : ""}
      </div>
    </section>
    ${clientTabContentHTML(selectedTab, data)}
    <dialog id="editWebsiteDialog" class="modal client-dialog">
      <form id="editWebsiteForm" class="form-grid" method="dialog">
        <div class="modal-head"><h2>Edit website</h2><button class="btn icon quiet" type="button" data-close-dialog="editWebsiteDialog" title="Close">${icon("x")}</button></div>
        <div class="field"><label>Website name</label><input name="name" value="${esc(website.name)}" required></div>
        <div class="field"><label>Website URL</label><input name="url" value="${esc(website.url || "")}" placeholder="https://example.com"></div>
        <div class="field"><label>Website details</label><textarea name="details" data-mentionable>${esc(website.details || "")}</textarea></div>
        <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Save</button><button class="btn" type="button" data-close-dialog="editWebsiteDialog">Cancel</button></div>
        <p class="status-line"></p>
      </form>
    </dialog>
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
        <div class="field"><label>Tab title</label><input name="title" value="${esc(selectedTab?.title || "")}" required></div>
        <div class="field"><label>Tab note</label><textarea name="content" data-mentionable>${esc(selectedTab?.content || "")}</textarea></div>
        <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Save</button><button class="btn" type="button" data-close-dialog="editClientTabDialog">Cancel</button></div>
        <p class="status-line"></p>
      </form>
    </dialog>
    ${clientDocumentDialogHTML("websiteDocumentDialog", "Add website document", websiteID)}
    <dialog id="clientTaskDialog" class="modal client-dialog">
      <form id="clientTaskForm" class="form-grid" method="dialog">
        <div class="modal-head"><h2>Add task</h2><button class="btn icon quiet" type="button" data-close-dialog="clientTaskDialog" title="Close">${icon("x")}</button></div>
        <div class="grid-2"><div class="field"><label>Task type</label><select name="type"><option value="description">Task description</option><option value="annotation">Annotation</option></select></div><div class="field"><label>Due date</label><input type="date" name="due_date"></div></div>
        <div class="field"><label>Title</label><input name="title" maxlength="80" required></div>
        <div class="field"><label>Content</label><textarea name="content" data-mentionable></textarea></div>
        <div class="field"><label>Annotation URL</label><input name="url" placeholder="https://example.com/page"></div>
        <div class="field"><label>Assignment</label><select name="assignee_ids" multiple>${(data.members || []).map((entry) => `<option value="${esc(entry.user?.id || "")}">${esc(entry.user?.name || entry.user?.email || "Member")}</option>`).join("")}</select></div>
        <div class="field"><label>Attachments</label><input type="file" name="attachments" multiple></div>
        <div class="toolbar"><button class="btn primary" type="submit">${icon("save")}Create task</button><button class="btn" type="button" data-close-dialog="clientTaskDialog">Cancel</button></div>
        <p class="status-line"></p>
      </form>
    </dialog>`);
  document.querySelectorAll("[data-client-tab-link]").forEach((btn) => btn.addEventListener("click", () => {
    window.location.href = `/projects/${clientID}/sites/${websiteID}?tab=${btn.dataset.clientTabLink}`;
  }));
  $("#editWebsiteBtn")?.addEventListener("click", () => $("#editWebsiteDialog")?.showModal());
  $("#addClientTabBtn")?.addEventListener("click", () => $("#clientTabDialog")?.showModal());
  $("#addClientTabInline")?.addEventListener("click", () => $("#clientTabDialog")?.showModal());
  $("#editClientTabBtn")?.addEventListener("click", () => $("#editClientTabDialog")?.showModal());
  $("#addWebsiteDocBtn")?.addEventListener("click", () => $("#websiteDocumentDialog")?.showModal());
  $("#addClientTaskBtn")?.addEventListener("click", () => $("#clientTaskDialog")?.showModal());
  $("#editWebsiteForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api(`/api/client-websites/${websiteID}`, { method: "PATCH", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      await refreshClientSidebarCache();
      renderClientWebsite(clientID, websiteID);
    } catch (error) {
      setFormStatus(form, error.message, true);
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
    try {
      await api(`/api/client-tabs/${selectedTab.id}`, { method: "PATCH", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
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
    const body = Object.fromEntries(new FormData(form).entries());
    body.title = compactClientTaskTitle(body.title);
    body.content = String(body.content || "").trim();
    body.assignee_ids = Array.from(form.assignee_ids.selectedOptions).map((option) => option.value).filter(Boolean);
    body.attachments = [];
    try {
      for (const file of Array.from(form.attachments.files || [])) {
        body.attachments.push(await upload(file));
      }
      await api(`/api/client-tabs/${selectedTab.id}/tasks`, { method: "POST", body: JSON.stringify(body) });
      renderClientWebsite(clientID, websiteID);
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });
  document.querySelectorAll("[data-client-task-status]").forEach((select) => select.addEventListener("change", async () => {
    await api(`/api/client-tasks/${select.dataset.clientTaskStatus}`, { method: "PATCH", body: JSON.stringify({ status: select.value }) });
    renderClientWebsite(clientID, websiteID);
  }));
  document.querySelectorAll("[data-open-client-task]").forEach((btn) => btn.addEventListener("click", () => openClientTaskPanel(btn.dataset.openClientTask)));
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
  bindDialogCloseButtons();
  bindMentionSuggestions(app);
  icons();
}

async function renderTasks(projectID = "") {
  let list = null;
  let lists = [];
  if (projectID) {
    const data = await api(`/api/projects/${projectID}/lists`);
    lists = data.lists || [];
    list = lists[0];
  } else {
    list = await getFirstList();
    lists = list ? [list] : [];
  }
  const tasks = list ? ((await api(`/api/tasks?list_id=${list.id}`)).tasks || []) : [];
  const view = new URLSearchParams(location.search).get("view") || "list";
  shell("Tasks", `
    <div class="page-title"><div><h1>${esc(list?.name || "Tasks")}</h1><p class="muted">${esc(list?.statuses?.join(" / ") || "")}</p></div></div>
    <div class="toolbar">
      <div class="tabs">
        ${["list", "board", "calendar"].map((v) => `<button class="${view === v ? "active" : ""}" data-view="${v}">${v}</button>`).join("")}
      </div>
      <button class="btn primary" id="newTaskBtn">${icon("plus")}Task</button>
    </div>
    <section id="taskSurface">${renderTaskView(view, tasks, list)}</section>
    <dialog id="taskDialog" class="modal">
      <form id="taskForm" class="form-grid" method="dialog">
        <div class="modal-head"><h2>New task</h2><button class="btn icon quiet" type="button" data-close-dialog="taskDialog" title="Close">${icon("x")}</button></div>
        <div class="field"><label>Title</label><input name="title" required></div>
        <div class="field"><label>Description</label><textarea name="description" data-mentionable placeholder="Use @username to mention a teammate"></textarea></div>
        <div class="grid-2">
          <div class="field"><label>Status</label><select name="status">${(list?.statuses || ["To Do", "In Progress", "Done"]).map((s) => `<option>${esc(s)}</option>`).join("")}</select></div>
          <div class="field"><label>Priority</label><select name="priority"><option>Normal</option><option>High</option><option>Urgent</option><option>Low</option></select></div>
        </div>
        <div class="field"><label>Due date</label><input type="date" name="due_date"></div>
        <button class="btn primary" type="submit">${icon("save")}Create</button>
        <p class="status-line"></p>
      </form>
    </dialog>`);
  document.querySelectorAll("[data-view]").forEach((btn) => btn.addEventListener("click", () => {
    history.replaceState(null, "", location.pathname + "?view=" + btn.dataset.view);
    renderTasks(projectID);
  }));
  $("#newTaskBtn")?.addEventListener("click", () => $("#taskDialog").showModal());
  bindDialogCloseButtons();
  $("#taskForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const form = Object.fromEntries(new FormData(event.currentTarget).entries());
      await api("/api/tasks", { method: "POST", body: JSON.stringify({ ...form, list_id: list.id, assignee_ids: [state.me.id] }) });
      $("#taskDialog").close();
      renderTasks(projectID);
    } catch (error) {
      setStatus(error.message, true);
    }
  });
  bindTaskActions();
  bindTaskComments();
  bindBoardDrag(list);
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
  shell(site.name, `
    <div class="annotate-layout">
      <section class="annotation-stage" id="annotationStage">
        ${site.embed_mode === "screenshot" && site.screenshot_url ? `<img src="${esc(site.screenshot_url)}" alt="${esc(site.name)} screenshot">` : `<iframe src="${esc(site.url)}" title="${esc(site.name)}"></iframe>`}
        <div class="click-catcher" id="clickCatcher"></div>
        <div class="pin-layer">${bugs.map((bug, i) => `<button class="pin" style="left:${bug.pin_x}%;top:${bug.pin_y}%;" title="${esc(bug.description)}">${i + 1}</button>`).join("")}</div>
      </section>
      <aside class="bug-side">
        <h2>Pin feedback</h2>
        <form id="bugForm" class="form-grid">
          <input type="hidden" name="pin_x">
          <input type="hidden" name="pin_y">
          <div class="field"><label>Coordinates</label><input id="coordLabel" disabled></div>
          <div class="field"><label>Description</label><textarea name="description" required data-mentionable placeholder="Use @username to mention a teammate"></textarea></div>
          <div class="field"><label>Severity</label><select name="severity"><option>Normal</option><option>High</option><option>Urgent</option><option>Low</option></select></div>
          <button class="btn primary" type="submit">${icon("map-pin")}Save pin</button>
          <p class="status-line"></p>
        </form>
        <hr>
        <div class="task-list">${bugs.map((bug) => `<article class="task-row"><div><h3>${mentionText(bug.description)}</h3><span class="muted">${bug.pin_x.toFixed(1)}%, ${bug.pin_y.toFixed(1)}%</span></div><span class="pill">${esc(bug.status)}</span><button class="btn" data-convert-bug="${bug.id}">${icon("git-pull-request")}Task</button></article>`).join("")}</div>
      </aside>
    </div>`);
  const stage = $("#annotationStage");
  $("#clickCatcher").addEventListener("click", (event) => {
    const rect = stage.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    $("[name=pin_x]").value = x.toFixed(2);
    $("[name=pin_y]").value = y.toFixed(2);
    $("#coordLabel").value = `${x.toFixed(1)}%, ${y.toFixed(1)}%`;
  });
  $("#bugForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const form = Object.fromEntries(new FormData(event.currentTarget).entries());
      if (!form.pin_x) throw new Error("Click the page first");
      await api("/api/bugs", { method: "POST", body: JSON.stringify({ ...form, website_id: id, pin_x: Number(form.pin_x), pin_y: Number(form.pin_y), page_url: site.url }) });
      renderAnnotate(id);
    } catch (error) {
      setStatus(error.message, true);
    }
  });
  document.querySelectorAll("[data-convert-bug]").forEach((btn) => btn.addEventListener("click", async () => {
    await api(`/api/bugs/${btn.dataset.convertBug}/convert-to-task`, { method: "POST", body: JSON.stringify({}) });
    renderAnnotate(id);
  }));
}

async function renderBilling() {
  const plans = (await api("/api/subscriptions/plans")).plans || [];
  const invoices = state.team ? ((await api(`/api/subscriptions/${state.team.id}/invoices`)).invoices || []) : [];
  shell("Billing", `
    <div class="page-title"><div><h1>Billing</h1><p class="muted">Plans, trial state, approvals, and receipts.</p></div></div>
    <div class="pricing-grid">${plans.map((plan) => `<article class="${plan.featured ? "featured" : ""}"><h3>${esc(plan.name)}</h3><p>${plan.pricing_model === "per_seat" ? money(plan.price_per_seat) + "/seat" : money(plan.price)}</p><span>${plan.seat_limit} seats · ${plan.project_limit} projects · ${plan.trial_days} trial days</span><p><button class="btn primary" data-buy="${plan.id}" data-provider="stripe">${icon("credit-card")}Stripe</button> <button class="btn" data-buy="${plan.id}" data-provider="paypal">PayPal</button></p></article>`).join("")}</div>
    <section class="panel" style="margin-top:18px"><h2>Invoices</h2><div class="task-list">${invoices.map((invoice) => `<article class="task-row"><div><h3>${money(invoice.amount)} ${esc(invoice.currency).toUpperCase()}</h3><span class="muted">${fmtDate(invoice.issued_at)}</span></div><span class="pill">${esc(invoice.status)}</span><a class="btn" href="${esc(invoice.external_invoice_url)}">Receipt</a></article>`).join("") || `<p class="muted">No invoices yet.</p>`}</div></section>`);
  document.querySelectorAll("[data-buy]").forEach((btn) => btn.addEventListener("click", async () => {
    try {
      const data = await api("/api/subscriptions/purchase", { method: "POST", body: JSON.stringify({ plan_id: btn.dataset.buy, provider: btn.dataset.provider }) });
      alert(`Checkout created: ${data.checkout.external_id}`);
      renderBilling();
    } catch (error) {
      alert(error.message);
    }
  }));
}

async function renderAdmin() {
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

async function renderPlansAdmin() {
  const plans = (await api("/api/admin/plans")).plans || [];
  shell("Plan Pricing", `
    <div class="page-title"><div><h1>Plans</h1><p class="muted">Owner-only pricing and limit controls. Amounts are entered in USD.</p></div></div>
    <div class="grid-3">
      ${plans.map((plan) => `
        <section class="panel">
          <form class="form-grid plan-form" data-plan-id="${plan.id}">
            <div>
              <h2>${esc(plan.name)}</h2>
              <span class="pill">${plan.pricing_model === "per_seat" ? "per seat" : "flat"}</span>
              ${plan.featured ? `<span class="pill warn">featured</span>` : ""}
            </div>
            <div class="field"><label>Name</label><input name="name" value="${esc(plan.name)}" required></div>
            <div class="field"><label>Description</label><textarea name="description">${esc(plan.description || "")}</textarea></div>
            <div class="field"><label>Pricing model</label><select name="pricing_model"><option value="flat" ${plan.pricing_model === "flat" ? "selected" : ""}>Flat</option><option value="per_seat" ${plan.pricing_model === "per_seat" ? "selected" : ""}>Per seat</option></select></div>
            <div class="grid-2">
              <div class="field"><label>Flat price USD</label><input type="number" min="0" step="0.01" name="price_dollars" value="${dollars(plan.price)}"></div>
              <div class="field"><label>Per-seat price USD</label><input type="number" min="0" step="0.01" name="price_per_seat_dollars" value="${dollars(plan.price_per_seat)}"></div>
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
      price_per_seat: cents(data.price_per_seat_dollars),
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

async function renderSettings() {
  const settings = (await api("/api/admin/settings")).settings;
  shell("Settings", `
    <div class="page-title"><div><h1>Site Settings</h1><p class="muted">Platform identity and legal page shortcodes.</p></div></div>
    <section class="panel">
      <form id="settingsForm" class="form-grid">
        ${["site_name", "company_email", "owner_name", "company_address", "logo_url", "support_phone"].map((key) => `<div class="field"><label>${key.replaceAll("_", " ")}</label><input name="${key}" value="${esc(settings[key] || "")}"></div>`).join("")}
        <button class="btn primary" type="submit">${icon("save")}Save</button>
        <p class="status-line"></p>
      </form>
    </section>`);
  $("#settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) });
      setStatus("Saved");
    } catch (error) {
      setStatus(error.message, true);
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
                <span class="muted">Invited as ${esc(staffRoleLabel(invite.staff_role) || "staff")} with @${esc(invite.username || "username")}</span>
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
            <div class="grid-3">
              <div class="field"><label>Email</label><input type="email" name="email" required placeholder="staff@company.com"></div>
              <div class="field"><label>Username</label><input name="username" pattern="[a-zA-Z0-9_]{3,24}" placeholder="alex_dev"></div>
              <div class="field"><label>User role</label><select name="staff_role" required>${staffRoleOptions()}</select></div>
            </div>
            <button class="btn primary" type="submit">${icon("user-plus")}Send invitation</button>
            <p class="status-line"></p>
          </form>
          <div class="task-list invite-history">${invitationStatusRows(invitations)}</div>
        </section>` : ""}
      <section class="panel">
        <h2>Update Password</h2>
        <form id="passwordForm" class="form-grid">
          <div class="grid-2">
            <div class="field"><label>Current password</label><input type="password" name="current_password" required></div>
            <div class="field"><label>New password</label><input type="password" name="new_password" required minlength="8"></div>
          </div>
          <button class="btn primary" type="submit">${icon("key-round")}Update password</button>
          <p class="status-line"></p>
        </form>
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
            <div class="secret-box">
              <span class="muted">Authenticator setup key</span>
              <code id="twoFactorSecretText"></code>
              <div class="field"><label>Authenticator URL</label><input id="twoFactorURI" readonly></div>
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

  $("#passwordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const data = await api("/api/users/me/password", { method: "PATCH", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      if (data.access_token && data.refresh_token) storeTokens(data.access_token, data.refresh_token);
      form.reset();
      setFormStatus(form, "Password updated");
    } catch (error) {
      setFormStatus(form, error.message, true);
    }
  });

  $("#setup2faBtn")?.addEventListener("click", async () => {
    try {
      const data = await api("/api/users/me/2fa/setup", { method: "POST", body: JSON.stringify({}) });
      $("#twoFactorSetup").removeAttribute("hidden");
      $("#twoFactorSecret").value = data.secret;
      $("#twoFactorSecretText").textContent = data.secret;
      $("#twoFactorURI").value = data.otpauth_url;
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  $("#enable2faForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api("/api/users/me/2fa/enable", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
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
  const pages = (await api("/api/admin/pages")).pages;
  shell("Pages", `
    <div class="page-title"><div><h1>Pages</h1><p class="muted">Draft, publish, and rollback legal pages.</p></div></div>
    <div class="grid-2">
      <section class="panel"><h2>Editable pages</h2><div class="task-list">${pages.map((p) => `<article class="task-row"><div><h3>${esc(p.title)}</h3><span class="muted">/${esc(p.slug)}</span></div><span class="pill">${esc(p.status)}</span><a class="btn" href="/admin/pages/${p.slug}/edit">${icon("file-pen")}Edit</a></article>`).join("")}</div></section>
      <section class="panel">
        <h2>New page</h2>
        <form id="pageForm" class="form-grid"><div class="field"><label>Title</label><input name="title" required></div><div class="field"><label>Slug</label><input name="slug" required></div><button class="btn primary">${icon("plus")}Create</button><p class="status-line"></p></form>
      </section>
    </div>`);
  $("#pageForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = await api("/api/admin/pages", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) });
      window.location.href = `/admin/pages/${data.page.slug}/edit`;
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

async function renderPageEditor(slug) {
  const data = await api(`/api/admin/pages/${slug}`);
  let page = data.page;
  let blocks = page.blocks || [];
  shell("Page Builder", `
    <div class="page-title"><div><h1>${esc(page.title)}</h1><p class="muted">/${esc(page.slug)}</p></div><div class="toolbar"><button class="btn primary" id="publishPage">${icon("upload")}Publish</button><button class="btn" id="savePage">${icon("save")}Save draft</button></div></div>
    <div class="builder">
      <aside class="builder-pane"><h2>Palette</h2>${["heading", "rich_text", "image", "button", "divider", "spacer", "video", "team_profiles"].map((type) => `<button class="btn" data-add-block="${type}">${icon("plus")}${type.replace("_", " ")}</button>`).join("<br><br>")}</aside>
      <section class="builder-pane"><h2>Canvas</h2><div id="builderCanvas" class="builder-canvas"></div></section>
      <aside class="builder-pane"><h2>Settings</h2><form id="blockSettings" class="form-grid"><p class="muted">Select a block.</p></form><p class="status-line"></p></aside>
    </div>`);
  let selected = 0;
  function draw() {
    $("#builderCanvas").innerHTML = blocks.map((block, index) => `<article class="builder-block" data-index="${index}"><strong>${esc(block.type)}</strong><p>${esc(block.props?.text || block.props?.url || block.props?.label || "")}</p></article>`).join("");
    document.querySelectorAll(".builder-block").forEach((el) => el.addEventListener("click", () => {
      selected = Number(el.dataset.index);
      drawSettings();
    }));
    if (window.Sortable) {
      Sortable.create($("#builderCanvas"), {
        animation: 150,
        onEnd: (event) => {
          const moved = blocks.splice(event.oldIndex, 1)[0];
          blocks.splice(event.newIndex, 0, moved);
          selected = event.newIndex;
          draw();
          drawSettings();
        },
      });
    }
    icons();
  }
  function drawSettings() {
    const block = blocks[selected];
    if (!block) return;
    const props = block.props || {};
    $("#blockSettings").innerHTML = `
      <div class="field"><label>Type</label><input disabled value="${esc(block.type)}"></div>
      <div class="field"><label>Text</label><textarea name="text">${esc(props.text || props.label || "")}</textarea></div>
      <div class="field"><label>URL</label><input name="url" value="${esc(props.url || "")}"></div>
      <div class="field"><label>Level</label><select name="level"><option ${props.level === "h1" ? "selected" : ""}>h1</option><option ${props.level !== "h1" ? "selected" : ""}>h2</option><option>h3</option></select></div>
      <button class="btn primary" type="submit">${icon("check")}Apply</button>
      <button class="btn danger" type="button" id="deleteBlock">${icon("trash-2")}Delete</button>`;
    $("#blockSettings").onsubmit = (event) => {
      event.preventDefault();
      const form = Object.fromEntries(new FormData(event.currentTarget).entries());
      block.props = { ...block.props, text: form.text, label: form.text, url: form.url, level: form.level };
      draw();
    };
    $("#deleteBlock").onclick = () => {
      blocks.splice(selected, 1);
      selected = Math.max(0, selected - 1);
      draw();
      drawSettings();
    };
    icons();
  }
  document.querySelectorAll("[data-add-block]").forEach((btn) => btn.addEventListener("click", () => {
    const type = btn.dataset.addBlock;
    blocks.push({ id: crypto.randomUUID(), type, props: defaultProps(type), children: [] });
    selected = blocks.length - 1;
    draw();
    drawSettings();
  }));
  $("#savePage").addEventListener("click", async () => {
    await api(`/api/admin/pages/${slug}`, { method: "PUT", body: JSON.stringify({ title: page.title, blocks }) });
    setStatus("Draft saved");
  });
  $("#publishPage").addEventListener("click", async () => {
    await api(`/api/admin/pages/${slug}/publish`, { method: "POST" });
    setStatus("Published");
  });
  draw();
  drawSettings();
}

function defaultProps(type) {
  if (type === "heading") return { text: "Heading", level: "h2" };
  if (type === "rich_text") return { text: "Write formatted content with [[site_name]] shortcodes." };
  if (type === "image") return { url: "/static/img/product-preview.png", alt: "Preview" };
  if (type === "button") return { label: "Learn more", url: "/" };
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

async function renderReports() {
  const list = await getFirstList().catch(() => null);
  const data = await api("/api/reports/time");
  data.entries = data.entries || [];
  shell("Time Reports", `
    <div class="page-title"><div><h1>Time</h1><p class="muted">${Math.round((data.total_minutes || 0) / 60 * 10) / 10} hours tracked.</p></div><a class="btn" href="/api/reports/time/export?token=${state.access}">${icon("download")}CSV</a></div>
    <div class="grid-2">
      <section class="panel"><h2>Entries</h2><div class="task-list">${data.entries.map((e) => `<article class="task-row"><div><h3>${e.duration_minutes} minutes</h3><span class="muted">${fmtDate(e.start_time)} · ${esc(e.note || "")}</span></div><span class="pill">${e.is_manual ? "manual" : "timer"}</span><span class="pill">${e.billable ? "billable" : "non-billable"}</span></article>`).join("") || `<p class="muted">No time entries yet.</p>`}</div></section>
      <section class="panel"><h2>Manual entry</h2><form id="manualTimeForm" class="form-grid"><input type="hidden" name="task_id" value="${esc(list?.id || "")}"><div class="field"><label>Date</label><input type="date" name="date"></div><div class="field"><label>Minutes</label><input type="number" name="duration_minutes" min="1" value="30"></div><div class="field"><label>Note</label><textarea name="note"></textarea></div><button class="btn primary">${icon("plus")}Log time</button><p class="status-line"></p></form></section>
    </div>`);
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
  picker.style.left = `${Math.max(8, rect.left)}px`;
  picker.style.top = `${rect.top - 8}px`;
  picker.querySelectorAll("button").forEach((emojiBtn) => emojiBtn.addEventListener("click", () => {
    input.value += emojiBtn.textContent;
    input.focus();
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
  const selectedChat = chats.find((chat) => chat.id === requestedChatID) || chats[0] || null;
  const selected = selectedChat?.id || "";
  const messages = selected ? ((await api(`/api/chats/${selected}/messages`)).messages || []) : [];
  const mentionUsers = await loadMentionUsers().catch(() => []);
  const usersByID = Object.fromEntries([...mentionUsers, state.me].filter(Boolean).map((user) => [user.id, user]));
  const chatCanWrite = Boolean(selected && selectedChat?.status !== "ended" && !selectedChat?.deleted_at);
  const selectedStatus = selectedChat ? (selectedChat.deleted_at ? "Deleted room - admins can restore or remove it forever" : selectedChat.status === "ended" ? "Conversation ended" : "Conversation open") : "Choose a conversation";
  shell("Chat", `
    <div class="page-title"><div><h1>Chat</h1><p class="muted">Team conversations and direct messages.</p></div><div class="toolbar"><button class="btn primary" id="startChatBtn">${icon("message-square-plus")}Start chat</button></div></div>
    <div class="grid-2 chat-layout">
      <section class="panel"><h2>Conversations</h2><div class="task-list">${chats.map((chat) => chatConversationRow(chat, chat.id === selected, usersByID)).join("") || `<p class="muted">No chats yet.</p>`}</div></section>
      <section class="panel chat-window">
        <div class="chat-window-head">
          <div><h2>${esc(selectedChat ? chatTitle(selectedChat, usersByID) : "Select a chat")}</h2><span class="muted">${esc(selectedStatus)}</span></div>
          <div class="chat-window-actions">
            ${chatActionsHTML(selectedChat)}
            ${chatCanWrite ? `<button class="btn danger compact" id="endChatBtn" type="button">${icon("phone-off")}End chat</button>` : ""}
          </div>
        </div>
        <div id="messages" class="messages">${messages.map((m) => chatMessageHTML(m, usersByID, "page")).join("")}</div>
        ${chatComposerHTML("chatForm", "page", chatCanWrite, "Message @username")}
      </section>
    </div>
    ${startChatDialogHTML(mentionUsers)}`);
  bindChatManagementActions(renderChat);
  $("#startChatBtn")?.addEventListener("click", () => $("#startChatDialog")?.showModal());
  bindDialogCloseButtons($("#startChatDialog") || document);
  $("#startChatForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const participantIDs = Array.from(event.currentTarget.querySelectorAll("input[name='participant_ids']:checked")).map((input) => input.value);
    if (!participantIDs.length) {
      setFormStatus(event.currentTarget, "Choose at least one member.", true);
      return;
    }
    try {
      const data = await api("/api/chats", { method: "POST", body: JSON.stringify({ type: "direct", participant_ids: participantIDs }) });
      location.href = "/chat?id=" + data.chat.id;
    } catch (error) {
      setFormStatus(event.currentTarget, error.message, true);
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
  bindRichChatComposer("chatForm", "page");
  bindChatReplyButtons("page");
}

function openChatSocket(chatID, usersByID = {}) {
  if (state.chatSocket) state.chatSocket.close();
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  state.chatSocket = new WebSocket(`${protocol}://${location.host}/ws/chat?chat_id=${chatID}&token=${encodeURIComponent(state.access)}`);
  state.chatSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.message) {
      $("#messages").insertAdjacentHTML("beforeend", chatMessageHTML(data.message, usersByID, "page"));
      $("#messages").scrollTop = $("#messages").scrollHeight;
      bindChatReplyButtons("page");
      icons();
    }
    if (["chat_ended", "chat_deleted", "chat_restored", "chat_removed"].includes(data.type)) {
      renderChat();
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

async function route() {
  if (path() === "/login") return renderAuth("login");
  if (path() === "/register") return renderAuth("register");
  if (!state.access) {
    window.location.href = "/login";
    return;
  }
  try {
    await loadMe();
    const matchClientWebsite = path().match(/^\/projects\/([^/]+)\/sites\/([^/]+)/);
    const matchClientProject = path().match(/^\/projects\/([^/]+)$/);
    const matchAnnotate = path().match(/^\/websites\/([^/]+)\/annotate/);
    const matchPageEdit = path().match(/^\/admin\/pages\/([^/]+)\/edit/);
    if (path() === "/dashboard") return renderDashboard();
    if (path() === "/team") return renderTeam();
    if (path() === "/tasks") return renderTasks();
    if (path() === "/projects") return renderClientProjects();
    if (matchClientWebsite) return renderClientWebsite(matchClientWebsite[1], matchClientWebsite[2]);
    if (matchClientProject) return renderClientProject(matchClientProject[1]);
    if (path().startsWith("/spaces/")) return renderTasks();
    if (path() === "/websites") return renderWebsites();
    if (matchAnnotate) return renderAnnotate(matchAnnotate[1]);
    if (path() === "/chat") return renderChat();
    if (path() === "/settings/company") return renderCompanySettings();
    if (path() === "/settings/billing") return renderBilling();
    if (path() === "/team/integrations") return renderIntegrations();
    if (path() === "/reports/time") return renderReports();
    if (path() === "/admin") return renderAdmin();
    if (path() === "/admin/settings") return renderSettings();
    if (path() === "/admin/plans") return renderPlansAdmin();
    if (path() === "/admin/pages") return renderPages();
    if (matchPageEdit) return renderPageEditor(matchPageEdit[1]);
    return renderDashboard();
  } catch (error) {
    if (String(error.message).includes("invalid token") || String(error.message).includes("missing bearer")) logout();
    app.innerHTML = `<div class="auth-wrap"><section class="auth-box"><h1>Something needs attention</h1><p class="muted">${esc(error.message)}</p><p><a class="btn primary" href="/dashboard">Retry</a></p></section></div>`;
  }
}

route();
