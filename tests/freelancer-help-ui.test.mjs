import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../web/static/js/marketplace.js", import.meta.url), "utf8");
const { createMarketplace } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

class Element {
  children = new Map(); value = ""; innerHTML = ""; dataset = {}; attributes = {};
  classList = { toggle: (name, value) => { this.attributes[name] = value; } };
  get elements() { return this.fields ||= Object.fromEntries(["skill", "country", "availability", "rating", "finished_jobs", "source", "title", "description", "skills", "publish_consent", "price", "message"].map(name => [name, new Element()])); }
  querySelector(key) { if (!this.children.has(key)) this.children.set(key, new Element()); return this.children.get(key); }
  querySelectorAll(key) {
    if (key === "[data-fh-view]") return ["grid", "list"].map(view => { const element = this.querySelector(view); element.dataset.fhView = view; return element; });
    if (key === "[data-fh-invite]") { const element = this.querySelector("invite"); element.dataset.fhInvite = "freelancer"; return [element]; }
    return [];
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener() {} showModal() {} close() {} remove() {} append() {} focus() {} scrollIntoView() {}
  reportValidity() { return true; }
}

test("FH supports filters, list/grid, safe profiles and retrying a task offer without duplicating its job", async () => {
  const originalFormData = globalThis.FormData;
  let dialog, failInvitation = true;
  const requests = [];
  globalThis.document = { querySelector: () => null, createElement: () => new Element(), body: { append: element => { dialog = element; } } };
  globalThis.localStorage = { getItem: () => "list", setItem() {} };
  globalThis.DOMParser = class { parseFromString(text) { return { body: { textContent: text.replace(/<[^>]*>/g, "") } }; } };
  globalThis.FormData = class { constructor(form) { this.form = form; } *[Symbol.iterator]() { for (const key of ["skill", "country", "availability", "rating", "finished_jobs"]) yield [key, this.form.elements[key].value]; } };
  try {
    const market = createMarketplace({ esc: escape, state: { me: { id: "owner" } }, api: async (url, options) => {
      requests.push({ url, options });
      if (url.includes("/freelancers?")) return { freelancers: [{ id: "freelancer", name: "<script>bad</script>", title: "Developer", bio: "Builds websites", skills: ["PHP"], country: "ID", available: true, finished_jobs: 5, rating: 4.5, rating_count: 5 }, { id: "owner" }], page: 1, has_more: false };
      if (url.endsWith("/skills")) return { skills: ["PHP"] };
      if (url.endsWith("/me")) return { jobs: [] };
      if (url.endsWith("/jobs")) return { job: { id: "new-job", title: "Build a page", budget: 10000, owner_id: "owner", status: "open" } };
      if (url.endsWith("/proposals")) { if (failInvitation) { failInvitation = false; throw new Error("Temporary failure"); } return { ok: true }; }
      throw new Error("Unexpected request: " + url);
    } });
    await market.openFreelancerHelp({ websiteName: "Example website", tasks: [{ id: "task-1", title: "Build a page", content: "<p>Build a responsive page with a contact form.</p>" }] });
    assert.match(dialog.innerHTML, /Find Freelancer Help/);
    assert.match(dialog.innerHTML, /Completed-job rating/);
    assert.equal(dialog.querySelector("[data-fh-results]").attributes["fh-list"], true);
    assert.ok(!dialog.querySelector("[data-fh-results]").innerHTML.includes("<script>"));
    dialog.querySelector("grid").onclick();
    assert.equal(dialog.querySelector("[data-fh-results]").attributes["fh-list"], false);
    const filters = dialog.querySelector("[data-fh-filters]");
    filters.elements.skill.value = "PHP"; filters.elements.finished_jobs.value = "5"; filters.elements.availability.value = "available";
    filters.onsubmit({ preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(requests.some(r => r.url.includes("finished_jobs=5") && r.url.includes("availability=available")));
    dialog.querySelector("invite").onclick();
    const form = dialog.querySelector("[data-fh-send]");
    form.elements.source.value = "task:task-1"; form.elements.source.onchange();
    form.elements.price.value = "100"; form.elements.publish_consent.checked = true;
    await form.onsubmit({ preventDefault() {} });
    assert.equal(form.elements.source.value, "job:new-job");
    await form.onsubmit({ preventDefault() {} });
    assert.equal(requests.filter(r => r.url === "/api/marketplace/jobs").length, 1);
    assert.equal(requests.filter(r => r.url.endsWith("/proposals")).length, 2);
    const published = JSON.parse(requests.find(r => r.url === "/api/marketplace/jobs").options.body);
    assert.equal(published.source_task_id, "task-1");
    assert.equal(published.description, "Build a responsive page with a contact form.");
    assert.match(dialog.querySelector("[data-fh-offer]").innerHTML, /Track offer & hire/);
  } finally { globalThis.FormData = originalFormData; }
});
