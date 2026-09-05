import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../web/static/js/checkout.js", import.meta.url), "utf8");
let sequence = 0;

// Exercise SDK callbacks without loading PayPal or contacting any payment service.
async function setup({ eligible = true, failCapture = false, sdkFails = false } = {}) {
  let dialog, callbacks, cardCallbacks, successful = 0;
  const requests = [], rendered = [], scripts = [];
  class Element {
    children = new Map(); dataset = {}; hidden = false; textContent = "";
    classList = { toggle() {} };
    querySelector(selector) {
      if (!this.children.has(selector)) this.children.set(selector, new Element());
      return this.children.get(selector);
    }
    setAttribute() {} addEventListener() {} showModal() {} close() {} remove() {}
    hasAttribute(name) { return Boolean(this[name]); }
  }
  globalThis.location = { origin: "https://bugmega.test" };
  globalThis.window = { bugmegaPayPal: {
    Buttons(options) { callbacks = options; return { render: async () => {}, close() {} }; },
    CardFields(options) {
      cardCallbacks = options;
      const field = () => ({ render: async target => rendered.push(target) });
      return { isEligible: () => eligible, NameField: field, NumberField: field, ExpiryField: field, CVVField: field,
        submit: async () => options.onApprove({ orderID: "order-1" }) };
    },
  } };
  globalThis.document = {
    createElement() { return new Element(); },
    body: { append(element) { dialog = element; } },
    head: { append(script) { scripts.push(script); queueMicrotask(() => sdkFails ? script.onerror() : script.onload()); } },
  };
  const { openEmbeddedCheckout } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64") + `#${sequence++}`);
  await openEmbeddedCheckout({
    api: async (url, options) => {
      requests.push({ url, options });
      if (url === "/api/paypal/config") return { client_id: "public-client-id" };
      if (failCapture) { failCapture = false; throw new Error("Confirmation pending. Retry this checkout."); }
      return { ok: true };
    },
    title: "<img src=x onerror=alert(1)>", description: "Hiring credit", amount: 12500,
    orderID: "order-1", captureURL: "/api/marketplace/topup/transfer-1/capture",
    fallbackURL: "https://www.paypal.com/checkoutnow?token=order-1",
    onSuccess: () => { successful++; },
  });
  return { dialog, callbacks, cardCallbacks, requests, rendered, scripts, success: () => successful };
}

test("embedded cards use server order and capture once, then update the caller", async () => {
  const state = await setup();
  assert.equal(state.callbacks.createOrder(), "order-1");
  assert.equal(state.cardCallbacks.createOrder(), "order-1");
  assert.equal(state.rendered.length, 4);
  assert.equal(state.dialog.querySelector("h2").textContent, "<img src=x onerror=alert(1)>");
  assert.equal(state.dialog.querySelector(".checkout-total").textContent, "$125.00");
  await state.dialog.querySelector(".checkout-pay").onclick();
  await state.callbacks.onApprove({ orderID: "order-1" });
  assert.equal(state.requests.filter(r => r.options?.method === "POST").length, 1);
  assert.equal(state.requests[1].options.body, "{}"); // No card or browser price data.
  state.dialog.querySelector(".checkout-done").onclick();
  assert.equal(state.success(), 1);
});

test("uncertain capture retries the same stored payment and prevents a new order", async () => {
  const state = await setup({ failCapture: true });
  await state.callbacks.onApprove({ orderID: "order-1" });
  assert.equal(state.dialog.querySelector(".checkout-retry").hidden, false);
  assert.throws(() => state.callbacks.createOrder(), /confirm the existing payment/);
  assert.equal(state.success(), 0);
  await state.dialog.querySelector(".checkout-retry").onclick();
  assert.equal(state.requests[1].url, state.requests[2].url);
  assert.equal(state.dialog.querySelector(".checkout-retry").hidden, true);
  state.dialog.querySelector(".checkout-done").onclick();
  assert.equal(state.success(), 1);
});

test("wrong approval order never reaches the capture API", async () => {
  const state = await setup();
  await assert.rejects(state.callbacks.onApprove({ orderID: "another-order" }), /does not match/);
  assert.equal(state.requests.length, 1);
  state.dialog.querySelector(".checkout-close").onclick();
});

test("ineligible card checkout retains PayPal wallet with no card fields", async () => {
  const state = await setup({ eligible: false });
  assert.equal(state.rendered.length, 0);
  assert.match(state.dialog.querySelector(".checkout-status").textContent, /Direct card entry is unavailable/);
  await state.callbacks.onApprove({ orderID: "order-1" });
  state.dialog.querySelector(".checkout-done").onclick();
  assert.equal(state.success(), 1);
});

test("SDK load failure offers the existing PayPal checkout without charging", async () => {
  const state = await setup({ sdkFails: true });
  assert.equal(state.dialog.querySelector(".checkout-fallback").hidden, false);
  assert.equal(state.requests.length, 1);
  assert.match(state.scripts[0].src, /^https:\/\/www.paypal.com\/sdk\/js\?/);
  assert.equal(state.scripts[0].dataset.namespace, "bugmegaPayPal");
  state.dialog.querySelector(".checkout-close").onclick();
  assert.equal(state.success(), 0);
});
