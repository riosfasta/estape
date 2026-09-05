import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../web/static/js/marketplace.js", import.meta.url), "utf8");
const { createMarketplace } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

// Rendering tests run without a browser or external dependencies. API integration
// and access control are exercised separately by the Go lifecycle suite.
const userID = "000000000000000000000001";
const jobID = "000000000000000000000002";
const profile = {
  id: userID, name: '<script>alert("x")</script>', title: "PHP developer", bio: "I build useful websites and deliver quality work.",
  location: "Jakarta", country: "ID", skills: ["PHP", "Custom skill"], photo: "", identity_status: "pending",
  public: false, connects: 100, rating_count: 0, finished_jobs: 0, published_jobs: 0, active_jobs: 0, available: true,
};
const job = { id: jobID, owner_id: userID, title: "Build a website", description: "Create a responsive website with reusable components.", budget: 10000, skills: ["PHP"], status: "open", owner_name: "Employer" };
const fixtures = {
  "/api/marketplace/skills": { skills: ["PHP", "Golang"] },
  "/api/marketplace/me": { profile, jobs: [job], proposals: [], connects_reset_at: "2026-09-07T00:00:00Z" },
  "/api/marketplace/freelancers": { freelancers: [profile], page: 1, has_more: false },
  [`/api/marketplace/freelancers/${userID}`]: { profile, reviews: [] },
  "/api/marketplace/jobs": { jobs: [job], page: 1, has_more: false },
  [`/api/marketplace/jobs/${jobID}`]: { job, proposals: [] },
  "/api/marketplace/wallet": { wallet: {}, transfers: [], earnings: [] },
  "/api/marketplace/admin": { commission: 500, profiles: [], transfers: [] },
};

async function render(path, authenticated = true, overrides = {}) {
  globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
  globalThis.location = { search: "", pathname: path };
  let html = "";
  const requests = [];
  const app = { set innerHTML(value) { html = value; } };
  const market = createMarketplace({
    api: async url => { requests.push(url); const key = url.split("?")[0]; assert.ok(key in fixtures, `Unexpected API request ${url}`); return overrides[key] || fixtures[key]; },
    state: { me: authenticated ? { id: userID } : null },
    shell: (_title, content) => { html = content; }, app,
    esc: v => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
    icons: () => {}, uploadResizedImage: () => { throw new Error("Unexpected upload"); },
  });
  await market.render(path);
  assert.ok(!html.includes('<script>alert("x")</script>'), "unescaped profile HTML");
  assert.ok(!html.includes("NaN"), "invalid numeric display");
  return { html, requests };
}

test("all marketplace screens render populated and empty states", async () => {
  for (const [path, heading] of [
    ["/dashboard", "Build your next opportunity"], ["/freelancers", "Find the right person"],
    [`/freelancers/${userID}`, "FREELANCER PROFILE"], ["/find-jobs", "Your next project"],
    ["/marketplace/jobs", "My jobs &amp; offers"], [`/marketplace/jobs/${jobID}`, "Build a website"],
    ["/wallet", "Wallet &amp; payments"], ["/admin/marketplace", "Marketplace administration"],
  ]) {
    const { html } = await render(path); assert.ok(html.includes(heading), `Missing heading on ${path}`);
  }
});

test("anonymous directory, profile and job search need no private API", async () => {
  for (const path of ["/freelancers", `/freelancers/${userID}`, "/find-jobs"]) {
    const { html, requests } = await render(path, false);
    assert.ok(html.includes("Join for free"));
    assert.ok(!requests.includes("/api/marketplace/me"));
    assert.ok(!html.includes("marketProfile"));
  }
});

test("new profile consent is unchecked and financial terms are visible", async () => {
  const { html } = await render("/dashboard");
  assert.match(html, /name="consent"\s*>/);
  assert.match(html, /name="public"\s*>/);
  assert.ok(html.includes("marketplace/privacy"));
  assert.ok(html.includes("100 Connects"));
  assert.ok(html.includes("95%"));
});

test("strangers do not see job delivery controls or private work", async () => {
  const strangerJob = { ...job, owner_id: "someone-else", freelancer_id: "another-person", status: "submitted", delivery: "PRIVATE_DELIVERY_SECRET" };
  const { html } = await render(`/marketplace/jobs/${jobID}`, true, { [`/api/marketplace/jobs/${jobID}`]: { job: strangerJob, proposals: [] } });
  assert.ok(!html.includes("PRIVATE_DELIVERY_SECRET"));
  assert.ok(!html.includes('id="marketApprove"'));
  assert.ok(!html.includes('id="marketDeliver"'));
});
