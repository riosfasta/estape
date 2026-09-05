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

test("profile shows crop previews, portfolio links and manual availability", async () => {
  profile.portfolio_photos = ["/uploads/users/example/work.jpg"];
  profile.youtube_urls = ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"];
  profile.availability = "busy";
  try {
    const own = await render("/dashboard");
    assert.match(own.html, /marketPhotoPreview/);
    assert.match(own.html, /marketIdentityPreview/);
    assert.match(own.html, /max 500 KB/);
    assert.match(own.html, /value="busy" selected/);
    assert.match(own.html, /In a running project/);
    const publicView = await render(`/freelancers/${userID}`, false);
    assert.match(publicView.html, /Project portfolio/);
    assert.match(publicView.html, /Watch project video 1 on YouTube/);
    assert.match(publicView.html, /work\.jpg/);
    assert.ok(!publicView.html.includes("marketIdentityPreview"));
  } finally { delete profile.portfolio_photos; delete profile.youtube_urls; delete profile.availability; }
});
const job = { id: jobID, owner_id: userID, title: "Build a website", description: "Create a responsive website with reusable components.", budget: 10000, skills: ["PHP"], status: "open", owner_name: "Employer" };
const fixtures = {
  "/api/marketplace/skills": { skills: ["PHP", "Golang"] },
  "/api/marketplace/me": { profile, jobs: [job], proposals: [], connects_reset_at: "2026-09-07T00:00:00Z" },
  "/api/marketplace/freelancers": { freelancers: [profile], page: 1, has_more: false },
  [`/api/marketplace/freelancers/${userID}`]: { profile, reviews: [] },
  "/api/marketplace/jobs": { jobs: [job], page: 1, has_more: false },
  [`/api/marketplace/jobs/${jobID}`]: { job, proposals: [] },
  "/api/marketplace/wallet": { wallet: {}, transfers: [], earnings: [] },
  "/api/marketplace/admin/connects": { policy: { amount: 100, period: "weekly" }, users: [], grants: [], page: 1, has_more: false },
  "/api/marketplace/admin": { commission: 500, profiles: [], transfers: [] },
  "/api/marketplace/admin/identity": { total: 0, profiles: [] },
};

async function render(path, authenticated = true, overrides = {}, role = "users_admin") {
  globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
  globalThis.location = { search: "", pathname: path, origin: "https://example.test" };
  let html = "";
  const requests = [];
  const app = { set innerHTML(value) { html = value; } };
  const market = createMarketplace({
    api: async url => { requests.push(url); const key = url.split("?")[0]; assert.ok(key in fixtures, `Unexpected API request ${url}`); return overrides[key] || fixtures[key]; },
    state: { me: authenticated ? { id: userID, role } : null },
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
    if (path === `/freelancers/${userID}`) {
      assert.ok(html.includes(`https://example.test/freelancers/${userID}`));
      assert.ok(html.includes('id="marketCopyProfile"'));
      assert.ok(html.includes("without logging in or registering"));
    }
  }
});

test("owner identity queue exposes review controls without loading payment or Connects APIs", async () => {
  const populated = await render("/admin/identity", true, {
    "/api/marketplace/admin/identity": { total: 1, profiles: [{ ...profile, identity_status: "pending", identity_revision: "000000000000000000000003" }] },
  }, "owner_adm");
  assert.match(populated.html, /1 pending ID submissions/);
  assert.match(populated.html, /Review ID · Approve \/ Decline/);
  assert.deepEqual(populated.requests, ["/api/marketplace/admin/identity"]);
  const empty = await render("/admin/identity", true, {
    "/api/marketplace/admin/identity": { total: 0, profiles: [] },
  }, "owner_adm");
  assert.match(empty.html, /No IDs waiting for review/);
  assert.match(empty.html, /Submit ID for review/);
  const restricted = await render("/admin/identity");
  assert.match(restricted.html, /Platform owner access required/);
  assert.deepEqual(restricted.requests, []);
});

test("new profile consent is unchecked and financial terms are visible", async () => {
  const { html } = await render("/dashboard");
  assert.match(html, /name="consent"\s*>/);
  assert.match(html, /name="public"\s*>/);
  assert.ok(html.includes("marketplace/privacy"));
  assert.ok(html.includes("100 Connects"));
  assert.ok(html.includes("95%"));
  assert.ok(!html.includes('id="marketCopyProfile"'), "private draft must not offer an active public link");
  const published = await render("/dashboard", true, {
    "/api/marketplace/me": { ...fixtures["/api/marketplace/me"], profile: { ...profile, public: true } },
  });
  assert.ok(published.html.includes(`https://example.test/freelancers/${userID}`));
  assert.ok(published.html.includes('id="marketCopyProfile"'));
});

test("strangers do not see job delivery controls or private work", async () => {
  const strangerJob = { ...job, owner_id: "someone-else", freelancer_id: "another-person", status: "submitted", delivery: "PRIVATE_DELIVERY_SECRET" };
  const { html } = await render(`/marketplace/jobs/${jobID}`, true, { [`/api/marketplace/jobs/${jobID}`]: { job: strangerJob, proposals: [] } });
  assert.ok(!html.includes("PRIVATE_DELIVERY_SECRET"));
  assert.ok(!html.includes('id="marketApprove"'));
  assert.ok(!html.includes('id="marketDeliver"'));
});

test("configured monthly allowance appears in user notices", async () => {
  for (const path of ["/dashboard", "/find-jobs"]) {
    const { html } = await render(path, true, {
      "/api/marketplace/skills": { skills: ["PHP"], connects_policy: { amount: 250, period: "monthly" } },
    });
    assert.ok(html.includes("250 Connects on the first of each month"));
    assert.ok(!html.includes("100 Connects every Monday"));
  }
});

test("owner can choose monthly resets and select users for manual grants", async () => {
  const { html } = await render("/admin/marketplace", true, {
    "/api/marketplace/admin/connects": {
      policy: { amount: 250, period: "monthly" },
      users: [{ id: userID, name: "Selected user", email: "person@example.test" }],
      grants: [], page: 1, has_more: true,
    },
  });
  assert.match(html, /value="monthly" selected/);
  assert.ok(html.includes(`data-connect-user="${userID}"`));
  assert.ok(html.includes('id="connectsGrant"'));
  assert.ok(html.includes("person@example.test"));
  assert.ok(html.includes("Select this page"));
});
