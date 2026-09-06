import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../web/static/js/marketplace.js", import.meta.url), "utf8");
const { createMarketplace } = await import("data:text/javascript;base64," + Buffer.from(source + "\n//# sourceURL=marketplace.js").toString("base64"));

class Element {
  children = new Map(); dataset = {}; isConnected = true; disabled = false; innerHTML = "";
  querySelector(key) { if (!this.children.has(key)) this.children.set(key, new Element()); return this.children.get(key); }
  querySelectorAll(key) {
    if (key === "[data-hourly-start]") { const button = this.querySelector("start"); button.dataset.hourlyStart = "task"; return [button]; }
    return [];
  }
  addEventListener(type, handler) { this[type] = handler; }
  showModal() {} close() {} remove() { this.isConnected = false; }
}

test("shared hourly workspace starts and stops the protected task timer and displays its costs", async () => {
  let dialog, running = false;
  const open = new Element(), requests = [];
  globalThis.document = { querySelector: () => null, querySelectorAll: key => key === "[data-work-open]" ? [open] : [], createElement: () => new Element(), body: { append: element => { dialog = element; } } };
  globalThis.DOMParser = class { parseFromString(value) { return { body: { textContent: value } }; } };
  const market = createMarketplace({ state: { me: { id: "freelancer" } }, shell() {}, icons() {}, esc: value => String(value ?? "").replaceAll("<", "&lt;"), api: async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/skills")) return { skills: [] };
    if (url.endsWith("/me")) return { profile: { connects: 100 } };
    if (url.endsWith("/timer/start")) { running = true; return {}; }
    if (url.endsWith("/timer/stop")) { running = false; return {}; }
    const hourly = { billing_type: "hourly", hourly_rate: 2500, max_seconds: 14400, max_cost: 10000, seconds: 3600, cost: 2500, remaining_seconds: 10800, can_track: true, can_stop: running, running, task_id: running ? "task" : "" };
    if (url.endsWith("/work")) return { hourly, can_update: true, budget: 10000, agreed_price: 10000, team: [], tasks: [{ task_id: "task", title: "Build page", content: "Private scope", status: "todo", statuses: ["todo", "done"] }] };
    if (url.endsWith("/job")) return { hourly, can_view_scope: true, proposals: [], job: { id: "job", title: "Hourly project", owner_id: "boss", freelancer_id: "freelancer", billing_type: "hourly", status: "hired", budget: 10000, price: 10000, hourly_rate: 2500, max_seconds: 14400 } };
    throw new Error("Unexpected request: " + url);
  } });
  try {
    await market.render("/marketplace/jobs/job");
    await open.click();
    assert.match(dialog.innerHTML, /Start billable timer/);
    assert.match(dialog.querySelector("[data-hourly-clock]").textContent, /1.00 hours recorded = \$25.00/);
    await dialog.querySelector("start").onclick();
    assert.equal(running, true);
    const start = requests.find(request => request.url.endsWith("/timer/start"));
    assert.deepEqual(JSON.parse(start.options.body), { task_id: "task" });
    await dialog.querySelector("[data-hourly-stop]").onclick();
    assert.equal(running, false);
    assert.ok(requests.some(request => request.url.endsWith("/timer/stop")));
  } finally { dialog?.querySelector("[data-work-close]").onclick?.(); }
});
