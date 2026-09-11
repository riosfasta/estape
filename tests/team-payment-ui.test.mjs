import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const appSource = await readFile(new URL("../web/static/js/app.js", import.meta.url), "utf8");
const marketSource = await readFile(new URL("../web/static/js/marketplace.js", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../web/static/css/styles.css", import.meta.url), "utf8");

test("staffInvitationFields includes rate type options and rate amount input", () => {
  const code = appSource.slice(appSource.indexOf("function staffInvitationFields()"), appSource.indexOf("function splitStaffInvitationRecipients"));
  const ctx = vm.createContext({
    esc: v => v,
  });
  vm.runInContext(code, ctx);
  const html = ctx.staffInvitationFields();
  assert.match(html, /name="rate_type"/);
  assert.match(html, /value="hourly">Hourly<\/option>/);
  assert.match(html, /value="daily">Daily<\/option>/);
  assert.match(html, /value="weekly">Weekly<\/option>/);
  assert.match(html, /value="monthly">Monthly<\/option>/);
  assert.match(html, /value="fixed">Fixed price<\/option>/);
  assert.match(html, /name="rate_amount"/);
});

test("bindStaffInvitationForm sends rate_type and rate_amount", async () => {
  const code = appSource.slice(appSource.indexOf("function staffInvitationFields()"), appSource.indexOf("async function renderTeam()"));
  const sent = [];
  const button = { disabled: false }, list = { innerHTML: "" }, search = { addEventListener() {} };
  const form = {
    isConnected: true,
    elements: {
      recipient: { value: "freelancer@example.com" },
      rate_type: { value: "hourly" },
      rate_amount: { value: "45.50" },
    },
    querySelector: selector => selector === '[type="submit"]' ? button : selector === '[data-invitation-access-list]' ? list : search,
    addEventListener(type, handler) { this[type] = handler; },
    closest: () => null,
  };
  const ctx = vm.createContext({
    esc: v => v,
    splitStaffInvitationRecipients: v => [v],
    FormData: class {
      getAll() { return []; }
      get(name) { return form.elements[name]?.value || ""; }
    },
    setFormStatus: () => {},
    api: async (url, options) => {
      if (!options) return { clients: [], websites: [] };
      sent.push(JSON.parse(options.body));
      return {};
    },
  });
  vm.runInContext(code, ctx);
  await ctx.bindStaffInvitationForm(form, "team123");
  await form.submit({ preventDefault() {} });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].recipient, "freelancer@example.com");
  assert.equal(sent[0].rate_type, "hourly");
  assert.equal(sent[0].rate_amount, 45.50);
});

test("taskPricingBadgeHTML renders correct badges for hourly, fixed, and pending status", () => {
  const code = appSource.slice(appSource.indexOf("function taskPricingBadgeHTML"), appSource.indexOf("function taskPricingFieldsHTML"));
  const ctx = vm.createContext({
    esc: v => v,
    icon: name => `[icon:${name}]`,
  });
  vm.runInContext(code, ctx);

  // Hourly task with max hours limit
  const hourlyBadge = ctx.taskPricingBadgeHTML({
    billing_type: "hourly",
    hourly_rate: 35,
    max_hours: 10,
  });
  assert.match(hourlyBadge, /\$35\.00\/hr/);
  assert.match(hourlyBadge, /max 10h/);

  // Fixed price task
  const fixedBadge = ctx.taskPricingBadgeHTML({
    billing_type: "fixed",
    price: 150,
  });
  assert.match(fixedBadge, /\$150\.00/);

  // Pending payment status
  const pendingBadge = ctx.taskPricingBadgeHTML({
    price: 150,
    payment_status: "pending",
  });
  assert.match(pendingBadge, /Payment Pending \(7-day hold\)/);

  // Paid payment status
  const paidBadge = ctx.taskPricingBadgeHTML({
    price: 150,
    payment_status: "paid",
  });
  assert.match(paidBadge, /Payment: paid/);
});

test("taskPricingFieldsHTML renders pricing inputs and toggle options", () => {
  const code = appSource.slice(appSource.indexOf("function taskPricingFieldsHTML"), appSource.indexOf("function taskDueInfo"));
  const ctx = vm.createContext({
    esc: v => v,
  });
  vm.runInContext(code, ctx);

  const html = ctx.taskPricingFieldsHTML({
    billing_type: "hourly",
    hourly_rate: 40,
    max_hours: 8,
  });
  assert.match(html, /name="billing_type"/);
  assert.match(html, /name="price"/);
  assert.match(html, /name="hourly_rate"/);
  assert.match(html, /name="max_hours"/);
  assert.match(html, /Freelancer timer will be capped at this maximum hours limit/);
});

test("marketplace wallet transfer form includes email OTP verification", () => {
  assert.match(marketSource, /id="marketTransfer"/);
  assert.match(marketSource, /name="otp_code"/);
  assert.match(marketSource, /id="marketTransferSendOTP"/);
  assert.match(marketSource, /\/api\/marketplace\/otp/);
  assert.match(marketSource, /otp_code:\s*v\.otp_code/);
});

test("marketplace offer pre-fills task pricing and timer from selected task", () => {
  assert.match(marketSource, /task\.billing_type === "hourly"/);
  assert.match(marketSource, /fields\.hourly_rate\.value = Number\(task\.hourly_rate\)\.toFixed\(2\)/);
  assert.match(marketSource, /fields\.max_hours\.value = task\.max_hours/);
  assert.match(marketSource, /data-scope-price="\$\{esc\(task\.id\)\}" value="\$\{task\.price \? Number\(task\.price\)\.toFixed\(2\) : ""\}"/);
});

test("user-facing notices inform users that refunds and withdrawals are processed manually by platform owner", () => {
  // In Team refund dialog
  assert.match(appSource, /Manual Processing by Platform Owner:/);
  assert.match(appSource, /Refund requests are reviewed and sent manually by the platform owner/);

  // In Marketplace wallet
  assert.match(marketSource, /Manual Processing by Platform Owner:/);
  assert.match(marketSource, /All withdrawal and refund requests are reviewed and processed manually by the platform owner/);
  assert.match(marketSource, /Pending Owner Settlement/);
  assert.match(marketSource, /Your request will be reviewed and processed manually by the platform owner/);
});

test("platform owner navigation and settlements management UI are registered and configured", () => {
  // Sidebar owner menu link
  assert.match(appSource, /\/admin\/settlements/);
  assert.match(appSource, /Settlements & Refunds/);

  // Router handles /admin/settlements
  assert.match(appSource, /"\/admin\/settlements"/);

  // Marketplace routes /admin/settlements to settlementsAdmin()
  assert.match(marketSource, /if \(path === "\/admin\/settlements"\) return settlementsAdmin\(\);/);

  // settlementsAdmin function exists and renders tabs, copy button, and settlement actions
  assert.match(marketSource, /async function settlementsAdmin\(\)/);
  assert.match(marketSource, /data-settlement-filter="requested"/);
  assert.match(marketSource, /data-settlement-filter="paid"/);
  assert.match(marketSource, /data-settlement-filter="rejected"/);
  assert.match(marketSource, /data-copy-ref=/);
  assert.match(marketSource, /name="reference"/);
  assert.match(marketSource, /data-reject-transfer=/);
});

test("adminUserRowHTML renders fund balances and quick action buttons", () => {
  const code = appSource.slice(appSource.indexOf("function adminUserRowHTML"), appSource.indexOf("function adminStatHTML"));
  const ctx = vm.createContext({
    esc: v => v,
    icon: name => `[icon:${name}]`,
    userChip: () => `[chip]`,
    roleLabel: v => v,
    staffRoleLabel: v => v,
    adminMembershipClass: () => "active",
    adminMembershipLabel: () => "Active",
    adminPaymentMethodsText: () => "PayPal",
    adminUserSearchText: () => "",
    flagEmojiForCountry: () => "",
    authProviderLabel: () => "Email",
    dollars: cents => ((cents || 0) / 100).toFixed(2),
    fmtDate: () => "Jan 1, 2026",
    NIL_OBJECT_ID: "000000000000000000000000",
  });
  vm.runInContext(code, ctx);

  const html = ctx.adminUserRowHTML({
    id: "user123",
    name: "Alice Bob",
    wallet: {
      deposits: 12550, // $125.50
      earnings: 4500,  // $45.00
      reserved: 2000,  // $20.00
      pending: 0,
    },
  });

  // Balance pill in meta and membership section
  assert.match(html, /\[icon:wallet\]&nbsp;\$125\.50/);
  assert.match(html, /Hiring:\s*<strong>\$125\.50<\/strong>/);
  assert.match(html, /\[icon:dollar-sign\]&nbsp;\$45\.00/);
  assert.match(html, /Earned:\s*<strong>\$45\.00<\/strong>/);

  // Top Up and Transactions buttons in actions
  assert.match(html, /data-topup-user="user123"/);
  assert.match(html, /\+ Top Up/);
  assert.match(html, /data-transactions-user="user123"/);
  assert.match(html, /Transactions/);
});

test("adminUserDetailHTML renders Funds & Wallet Overview with 4 balance metrics and action buttons", () => {
  const code = appSource.slice(appSource.indexOf("function adminUserDetailHTML"), appSource.indexOf("async function renderAdmin()"));
  const ctx = vm.createContext({
    esc: v => v,
    icon: name => `[icon:${name}]`,
    userChip: () => `[chip]`,
    roleLabel: v => v,
    staffRoleLabel: v => v,
    adminMembershipLabel: () => "Active",
    adminPaymentMethodsText: () => "Manual",
    authProviderLabel: () => "Google",
    dollars: cents => ((cents || 0) / 100).toFixed(2),
    fmtDate: () => "Jan 1, 2026",
    fmtDateTime: () => "Jan 1, 2026 12:00",
    subscriptionDurationText: () => "1 month",
    flagEmojiForCountry: () => "",
    adminStatHTML: (label, value) => `<div class="stat">${label}: ${value}</div>`,
    adminMiniRows: () => "",
    adminUserProtectedHTML: () => "",
    NIL_OBJECT_ID: "000000000000000000000000",
  });
  vm.runInContext(code, ctx);

  const html = ctx.adminUserDetailHTML({
    user: {
      id: "user456",
      name: "Carol Danvers",
      wallet: {
        deposits: 50000,
        reserved: 10000,
        earnings: 25000,
        pending: 5000,
      },
    },
  });

  assert.match(html, /Funds &amp; Wallet Overview/);
  assert.match(html, /Hiring Balance \(Available\): \$500\.00/);
  assert.match(html, /Reserved \/ Escrow: \$100\.00/);
  assert.match(html, /Freelancer Earnings: \$250\.00/);
  assert.match(html, /Pending Hold: \$50\.00/);
  assert.match(html, /data-topup-user="user456"/);
  assert.match(html, /data-transactions-user="user456"/);
});

test("adminUserDialogsHTML renders userTopupDialog and userTransactionsDialog", () => {
  const code = appSource.slice(appSource.indexOf("function adminUserDialogsHTML"), appSource.indexOf("function updateMembershipPreview"));
  const ctx = vm.createContext({
    esc: v => v,
    icon: name => `[icon:${name}]`,
    staffRoleOptions: () => "",
    planOptionsHTML: () => "",
  });
  vm.runInContext(code, ctx);

  const html = ctx.adminUserDialogsHTML([]);

  // Top Up Dialog
  assert.match(html, /id="userTopupDialog"/);
  assert.match(html, /id="userTopupForm"/);
  assert.match(html, /Manual Fund Top Up/);
  assert.match(html, /name="amount"/);
  assert.match(html, /data-topup-preset="25"/);
  assert.match(html, /data-topup-preset="100"/);
  assert.match(html, /data-topup-preset="500"/);
  assert.match(html, /name="note"/);

  // Transactions Dialog
  assert.match(html, /id="userTransactionsDialog"/);
  assert.match(html, /id="userTransactionsHeader"/);
  assert.match(html, /id="userTransactionsContent"/);
});

test("shell renders #topbarTimer before command search bar in topbar header", () => {
  // Shell HTML template contains #topbarTimer before .command-search-wrap
  assert.match(appSource, /id="topbarTimer"\s+class="topbar-timer"\s+hidden/);
  assert.match(appSource, /data-topbar-timer-time/);
  assert.match(appSource, /data-topbar-timer-task/);
  assert.match(appSource, /id="topbarStopTimerBtn"/);

  const topbarTimerIndex = appSource.indexOf('id="topbarTimer"');
  const searchWrapIndex = appSource.indexOf('class="command-search-wrap"');
  assert.ok(topbarTimerIndex > 0, "topbarTimer exists in appSource");
  assert.ok(searchWrapIndex > topbarTimerIndex, "topbarTimer is placed before command-search-wrap");
});

test("styles.css defines styling for topbar-timer, pulse-dot, and stop button", () => {
  assert.match(stylesSource, /\.topbar-timer\s*\{/);
  assert.match(stylesSource, /\.topbar-timer\[hidden\]\s*\{/);
  assert.match(stylesSource, /\.topbar-timer\s+\.pulse-dot\s*\{/);
  assert.match(stylesSource, /\.topbar-timer-time\s*\{/);
  assert.match(stylesSource, /\.topbar-timer-stop\s*\{/);
});

test("syncActiveTimerUI updates #topbarTimer when active timer is running and hides when stopped", () => {
  const code = appSource.slice(appSource.indexOf("function activeDurationLabel"), appSource.indexOf("async function toggleTaskTimerOptimistic"));
  const topbarTimerEl = {
    hidden: true,
    classList: {
      contains: name => false,
      add: name => {},
      remove: name => {},
    },
    querySelector: selector => {
      if (selector === "[data-topbar-timer-time]") return { textContent: "" };
      if (selector === "[data-topbar-timer-task]") return { textContent: "", title: "", hidden: true };
      if (selector === "#topbarStopTimerBtn") return { onclick: null };
      if (selector === "[data-open-active-timer-modal]") return { dataset: {}, addEventListener: () => {} };
      return null;
    },
  };

  const state = {
    activeTimer: {
      task_id: "task999",
      start_time: new Date(Date.now() - 45000).toISOString(),
      task: { id: "task999", title: "Refactor backend" },
    },
  };

  const ctx = vm.createContext({
    state,
    esc: v => v,
    icon: name => `[icon:${name}]`,
    icons: () => {},
    $: selector => {
      if (selector === "#topbarTimer") return topbarTimerEl;
      if (selector === "#timerWidget") return null;
      return null;
    },
    document: {
      querySelectorAll: () => [],
      querySelector: () => null,
    },
    setInterval: () => 123,
    clearInterval: () => {},
    toggleTaskTimerOptimistic: () => {},
    openTaskTimerModal: () => {},
  });
  vm.runInContext(code, ctx);

  // 1. Run syncActiveTimerUI with active timer
  ctx.syncActiveTimerUI();
  assert.equal(topbarTimerEl.hidden, false, "topbarTimer should be visible when timer is active");

  // 2. Run syncActiveTimerUI with no active timer
  state.activeTimer = null;
  ctx.syncActiveTimerUI();
  assert.equal(topbarTimerEl.hidden, true, "topbarTimer should be hidden when timer is null");
});



