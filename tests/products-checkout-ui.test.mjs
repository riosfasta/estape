import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../web/static/js/app.js", import.meta.url), "utf8");

test("renderPurchaseCartAccountSection renders account creation inputs for guest", () => {
  const accountSectionCode = source.slice(
    source.indexOf("function renderPurchaseCartAccountSection("),
    source.indexOf("function setPurchaseCartStatus(")
  );

  let innerHTML = "";
  const mount = {
    set innerHTML(val) { innerHTML = val; },
    get innerHTML() { return innerHTML; }
  };
  const button = { textContent: "" };

  const context = {
    state: { access: "", me: null },
    esc: s => s,
    $: (sel) => {
      if (sel === "#purchaseCartAccountSection") return mount;
      if (sel === "#purchaseCartCheckout") return button;
      return null;
    }
  };

  vm.createContext(context);
  vm.runInContext(accountSectionCode, context);
  context.renderPurchaseCartAccountSection();

  assert.match(innerHTML, /Create your account to continue/);
  assert.match(innerHTML, /cartRegisterName/);
  assert.match(innerHTML, /cartRegisterEmail/);
  assert.match(innerHTML, /cartRegisterPassword/);
  assert.match(innerHTML, /cartRegisterCompany/);
  assert.equal(button.textContent, "Create account & Continue to payment");
});

test("renderPurchaseCartAccountSection renders user info when logged in", () => {
  const accountSectionCode = source.slice(
    source.indexOf("function renderPurchaseCartAccountSection("),
    source.indexOf("function setPurchaseCartStatus(")
  );

  let innerHTML = "";
  const mount = {
    set innerHTML(val) { innerHTML = val; },
    get innerHTML() { return innerHTML; }
  };
  const button = { textContent: "" };

  const context = {
    state: {
      access: "jwt-token",
      me: { name: "Alice Developer", email: "alice@example.com" }
    },
    esc: s => s,
    $: (sel) => {
      if (sel === "#purchaseCartAccountSection") return mount;
      if (sel === "#purchaseCartCheckout") return button;
      return null;
    }
  };

  vm.createContext(context);
  vm.runInContext(accountSectionCode, context);
  context.renderPurchaseCartAccountSection();

  assert.match(innerHTML, /Alice Developer/);
  assert.match(innerHTML, /alice@example\.com/);
  assert.ok(!innerHTML.includes("cartRegisterPassword"));
  assert.equal(button.textContent, "Continue to payment");
});

test("checkoutPurchaseCart routes to checkout-register for guests", async () => {
  const checkoutCode = source.slice(
    source.indexOf("async function checkoutPurchaseCart("),
    source.indexOf("function activeWorkspaceMembership(")
  );

  const requests = [];
  let checkoutOpened = null;
  let statusMsg = "";

  const context = {
    state: {
      access: "",
      me: null,
      purchaseCart: {
        plan_id: "plan-123",
        billing_period: "monthly",
        quantity: 1,
        plans: [{ id: "plan-123", name: "Team" }]
      }
    },
    storeTokens: () => {},
    loadMe: async () => {},
    openEmbeddedCheckout: async (opts) => { checkoutOpened = opts; },
    setPurchaseCartStatus: (msg) => { statusMsg = msg; },
    api: async (url, opts) => {
      requests.push({ url, body: JSON.parse(opts.body) });
      return {
        access_token: "new-access",
        refresh_token: "new-refresh",
        user: { name: "Bob", email: "bob@example.com" },
        subscription: { id: "sub-123" },
        checkout: { external_id: "order-456", url: "https://paypal.test" },
        amount: 900
      };
    },
    $: (sel) => {
      if (sel === "#purchaseCartCheckout") return { textContent: "", disabled: false };
      if (sel === "#purchaseCartDialog") return { close: () => {} };
      if (sel === "#cartRegisterName") return { value: "Bob Founder" };
      if (sel === "#cartRegisterEmail") return { value: "bob@example.com" };
      if (sel === "#cartRegisterPassword") return { value: "strongpass123" };
      if (sel === "#cartRegisterCompany") return { value: "Bob Studio" };
      return null;
    }
  };

  vm.createContext(context);
  vm.runInContext(checkoutCode, context);
  await context.checkoutPurchaseCart();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/subscriptions/checkout-register");
  assert.equal(requests[0].body.name, "Bob Founder");
  assert.equal(requests[0].body.email, "bob@example.com");
  assert.equal(requests[0].body.plan_id, "plan-123");
  assert.equal(context.state.access, "new-access");
  assert.ok(checkoutOpened);
  assert.equal(checkoutOpened.orderID, "order-456");
});

test("checkoutPurchaseCart routes to purchase endpoint for logged in users", async () => {
  const checkoutCode = source.slice(
    source.indexOf("async function checkoutPurchaseCart("),
    source.indexOf("function activeWorkspaceMembership(")
  );

  const requests = [];
  let checkoutOpened = null;

  const context = {
    state: {
      access: "valid-token",
      me: { id: "user-1", name: "Logged User", email: "logged@example.com" },
      personalTeam: { id: "team-1" },
      purchaseCart: {
        plan_id: "plan-team",
        billing_period: "yearly",
        quantity: 2,
        plans: [{ id: "plan-team", name: "Team" }]
      }
    },
    activeWorkspaceTeamID: () => "team-1",
    storeTokens: () => {},
    loadMe: async () => {},
    openEmbeddedCheckout: async (opts) => { checkoutOpened = opts; },
    setPurchaseCartStatus: () => {},
    api: async (url, opts) => {
      requests.push({ url, body: JSON.parse(opts.body) });
      return {
        subscription: { id: "sub-999" },
        checkout: { external_id: "paypal-ord-1", url: "https://paypal.test" },
        amount: 18000
      };
    },
    $: (sel) => {
      if (sel === "#purchaseCartCheckout") return { textContent: "", disabled: false };
      if (sel === "#purchaseCartDialog") return { close: () => {} };
      return null;
    }
  };

  vm.createContext(context);
  vm.runInContext(checkoutCode, context);
  await context.checkoutPurchaseCart();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/subscriptions/purchase");
  assert.equal(requests[0].body.plan_id, "plan-team");
  assert.equal(requests[0].body.billing_period, "yearly");
  assert.equal(requests[0].body.quantity, 2);
  assert.ok(checkoutOpened);
  assert.equal(checkoutOpened.orderID, "paypal-ord-1");
});
