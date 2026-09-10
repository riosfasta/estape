import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../web/static/js/app.js", import.meta.url), "utf8");

test("formatMediaBytes formats file sizes appropriately", () => {
  const code = source.slice(source.indexOf("function formatMediaBytes("), source.indexOf("async function openMediaManagerModal("));
  const ctx = vm.createContext({});
  vm.runInContext(code, ctx);

  assert.equal(ctx.formatMediaBytes(0), "0 B");
  assert.equal(ctx.formatMediaBytes(512), "512 B");
  assert.equal(ctx.formatMediaBytes(1024), "1.0 KB");
  assert.equal(ctx.formatMediaBytes(1024 * 1024 * 2.5), "2.5 MB");
});

test("pageBlockImageSettingsFields outputs media manager trigger button and image inputs", () => {
  const code = source.slice(source.indexOf("function pageBlockImageSettingsFields("), source.indexOf("function bindBuilderImageSettings("));
  const ctx = vm.createContext({
    esc: (v) => String(v ?? ""),
    icon: (name) => `<icon:${name}>`,
    textInput: (name, label, val) => `<input name="${name}" value="${val}">`,
    customCSSField: () => `<textarea name="custom_css"></textarea>`,
  });
  vm.runInContext(code, ctx);

  const html = ctx.pageBlockImageSettingsFields({
    url: "/uploads/example.png",
    alt: "Example alt",
  });

  assert.match(html, /data-open-media-manager/);
  assert.match(html, /Choose or upload image/);
  assert.match(html, /\/uploads\/example\.png/);
  assert.match(html, /name="url"/);
  assert.match(html, /name="alt"/);
});

test("openMediaManagerModal fetches media and handles selection", async () => {
  const code = source.slice(
    source.indexOf("function formatMediaBytes("),
    source.indexOf("async function renderPageEditor(")
  );

  let showModalCalled = false;
  let closeCalled = false;
  const elements = new Map();

  class MockElement {
    constructor(tag) {
      this.tagName = tag;
      this.classList = new Set();
      this.attributes = {};
      this._innerHTML = "";
      this.children = [];
      this.dataset = {};
    }
    set innerHTML(val) {
      this._innerHTML = val;
    }
    get innerHTML() {
      return this._innerHTML;
    }
    setAttribute(k, v) { this.attributes[k] = v; }
    getAttribute(k) { return this.attributes[k]; }
    addEventListener(type, handler) { this[`on_${type}`] = handler; }
    showModal() { showModalCalled = true; }
    close() { closeCalled = true; }
    remove() {}
    querySelector(selector) {
      const el = new MockElement("div");
      if (selector.includes("[data-tab='library']")) el.dataset.tab = "library";
      if (selector.includes("[data-tab='upload']")) el.dataset.tab = "upload";
      return el;
    }
    querySelectorAll() {
      return [];
    }
  }

  let selectedResult = null;
  const ctx = vm.createContext({
    document: {
      querySelector: () => null,
      createElement: (tag) => new MockElement(tag),
      body: { appendChild: () => {} },
    },
    api: async (url) => {
      if (url === "/api/admin/media") {
        return {
          media: [
            { url: "/uploads/photo1.jpg", name: "photo1.jpg", size: 50000, updated_at: "2026-09-11T00:00:00Z" },
            { url: "/uploads/banner.png", name: "banner.png", size: 120000, updated_at: "2026-09-11T01:00:00Z" }
          ]
        };
      }
      throw new Error("unexpected api: " + url);
    },
    esc: (v) => String(v ?? ""),
    icon: (name) => `<icon:${name}>`,
    icons: () => {},
    fmtDate: (v) => String(v),
    upload: async () => "/uploads/new.png",
  });

  vm.runInContext(code, ctx);

  await ctx.openMediaManagerModal({
    currentUrl: "/uploads/photo1.jpg",
    onSelect: (url) => { selectedResult = url; },
  });

  assert.equal(showModalCalled, true);
});
