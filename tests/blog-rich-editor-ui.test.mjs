import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../web/static/js/app.js", import.meta.url), "utf8");

test("safeRichTextImageURL validates image URLs properly", () => {
  const code = source.slice(
    source.indexOf("function safeRichTextImageURL("),
    source.indexOf("function pageRichEditorHTML(")
  );
  const ctx = vm.createContext({
    URL: globalThis.URL,
    window: { location: { origin: "http://localhost:8080" } },
  });
  vm.runInContext(code, ctx);

  assert.equal(ctx.safeRichTextImageURL("/uploads/test.png"), "/uploads/test.png");
  assert.equal(ctx.safeRichTextImageURL("/images/avatar.jpg"), "/images/avatar.jpg");
  assert.equal(ctx.safeRichTextImageURL("https://example.com/pic.webp"), "https://example.com/pic.webp");
  assert.equal(ctx.safeRichTextImageURL("http://example.com/pic.webp"), "http://example.com/pic.webp");

  // Rejects unsafe schemes and characters
  assert.equal(ctx.safeRichTextImageURL("javascript:alert(1)"), "");
  assert.equal(ctx.safeRichTextImageURL("data:image/svg+xml,..."), "");
  assert.equal(ctx.safeRichTextImageURL(""), "");
  assert.equal(ctx.safeRichTextImageURL(`https://example.com/"onerror="alert(1)`), "");
});

test("pageRichEditorHTML outputs image button, mode tabs, and html editor", () => {
  const code = source.slice(
    source.indexOf("function safeRichTextImageURL("),
    source.indexOf("function bindRichEditors(")
  );
  const ctx = vm.createContext({
    esc: (v) => String(v ?? ""),
    icon: (name) => `<icon:${name}>`,
    pageRichSafeHTML: (v) => String(v ?? ""),
  });
  vm.runInContext(code, ctx);

  const html = ctx.pageRichEditorHTML("content", "<p>Hello</p>", "Placeholder");

  assert.match(html, /data-page-rich-wrap/);
  assert.match(html, /data-rich-image/);
  assert.match(html, /<icon:image>/);
  assert.match(html, /data-rich-mode="visual"/);
  assert.match(html, /data-rich-mode="html"/);
  assert.match(html, /<icon:eye>/);
  assert.match(html, /<icon:code>/);
  assert.match(html, /data-page-rich-editor="content"/);
  assert.match(html, /data-page-rich-html="content"/);
  assert.match(html, /name="content"/);
});

test("pageRichSafeHTML allows safe img tags and removes unsafe ones", () => {
  // Mock a minimal DOM template environment
  class MockNode {
    constructor(type, name = "") {
      this.nodeType = type;
      this.tagName = name.toUpperCase();
      this.childNodes = [];
      this.attributes = new Map();
      this.textContent = "";
    }
    getAttribute(attr) {
      return this.attributes.get(attr) || "";
    }
    setAttribute(attr, val) {
      this.attributes.set(attr, String(val));
    }
    removeAttribute(attr) {
      this.attributes.delete(attr);
    }
    replaceWith(newNode) {
      if (this.parent) {
        const idx = this.parent.childNodes.indexOf(this);
        if (idx !== -1) this.parent.childNodes[idx] = newNode;
      }
    }
    remove() {
      if (this.parent) {
        const idx = this.parent.childNodes.indexOf(this);
        if (idx !== -1) this.parent.childNodes.splice(idx, 1);
      }
    }
  }

  const code = source.slice(
    source.indexOf("function safeRichTextImageURL("),
    source.indexOf("function recurrenceControlsHTML(")
  );

  const ctx = vm.createContext({
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    URL: globalThis.URL,
    window: { location: { origin: "http://localhost:8080" } },
    document: {
      createElement: (tag) => {
        if (tag === "template") {
          return {
            content: { childNodes: [] },
            set innerHTML(val) {
              const nodes = [];
              if (val.includes("<img")) {
                const img = new MockNode(1, "IMG");
                img.parent = this.content;
                if (val.includes('src="/uploads/photo.png"')) img.setAttribute("src", "/uploads/photo.png");
                if (val.includes('src="javascript:alert(1)"')) img.setAttribute("src", "javascript:alert(1)");
                if (val.includes('alt="Cover"')) img.setAttribute("alt", "Cover");
                nodes.push(img);
              }
              if (val.includes("<script>")) {
                const sc = new MockNode(1, "SCRIPT");
                sc.parent = this.content;
                sc.textContent = "alert(1)";
                nodes.push(sc);
              }
              this.content.childNodes = nodes;
            },
            get innerHTML() {
              return this.content.childNodes.map((n) => {
                if (n.tagName === "IMG") {
                  const attrs = Array.from(n.attributes.entries()).map(([k, v]) => `${k}="${v}"`).join(" ");
                  return `<img ${attrs}>`;
                }
                return n.textContent || "";
              }).join("");
            },
          };
        }
        return new MockNode(1, tag);
      },
      createTextNode: (text) => {
        const node = new MockNode(3);
        node.textContent = text;
        return node;
      },
    },
  });

  vm.runInContext(code, ctx);

  const safeResult = ctx.pageRichSafeHTML('<img src="/uploads/photo.png" alt="Cover">');
  assert.match(safeResult, /src="\/uploads\/photo\.png"/);
  assert.match(safeResult, /alt="Cover"/);
  assert.match(safeResult, /loading="lazy"/);

  const unsafeResult = ctx.pageRichSafeHTML('<img src="javascript:alert(1)">');
  assert.equal(unsafeResult.includes("javascript:"), false);

  const scriptResult = ctx.pageRichSafeHTML('<script>alert(1)</script>');
  assert.equal(scriptResult.includes("<script>"), false);
});
