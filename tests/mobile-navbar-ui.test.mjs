import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const homeTemplate = await readFile(new URL("../web/templates/home.gohtml", import.meta.url), "utf8");
const legalTemplate = await readFile(new URL("../web/templates/legal.gohtml", import.meta.url), "utf8");
const privacyTemplate = await readFile(new URL("../web/templates/marketplace_privacy.gohtml", import.meta.url), "utf8");
const stylesCSS = await readFile(new URL("../web/static/css/styles.css", import.meta.url), "utf8");

test("home.gohtml renders mobile-friendly public navbar with toggle and collapsible menu", () => {
  assert.match(homeTemplate, /<header class="public-nav">/);
  assert.match(homeTemplate, /<div class="public-nav-bar">/);
  assert.match(homeTemplate, /<button class="public-nav-toggle"[^>]*aria-label="Toggle navigation menu"[^>]*aria-expanded="false"[^>]*aria-controls="publicNavMenu"/);
  assert.match(homeTemplate, /<span class="hamburger-bar"><\/span>/);
  assert.match(homeTemplate, /<div class="public-nav-menu" id="publicNavMenu">/);
  assert.match(homeTemplate, /class="nav-actions"/);
  assert.match(homeTemplate, /\.public-nav-toggle/);
  assert.match(homeTemplate, /nav\.classList\.toggle\(['"]is-open['"]/);
});

test("legal.gohtml renders mobile-friendly public navbar with toggle and collapsible menu", () => {
  assert.match(legalTemplate, /<header class="public-nav">/);
  assert.match(legalTemplate, /<div class="public-nav-bar">/);
  assert.match(legalTemplate, /<button class="public-nav-toggle"/);
  assert.match(legalTemplate, /<div class="public-nav-menu" id="publicNavMenu">/);
  assert.match(legalTemplate, /class="nav-actions"/);
  assert.match(legalTemplate, /\.public-nav-toggle/);
});

test("marketplace_privacy.gohtml renders mobile-friendly public navbar with toggle and menu", () => {
  assert.match(privacyTemplate, /<header class="public-nav">/);
  assert.match(privacyTemplate, /<div class="public-nav-bar">/);
  assert.match(privacyTemplate, /<button class="public-nav-toggle"/);
  assert.match(privacyTemplate, /<div class="public-nav-menu" id="publicNavMenu">/);
});

test("styles.css defines desktop and mobile responsive navbar rules", () => {
  // Desktop
  assert.match(stylesCSS, /\.public-nav-toggle\s*\{\s*display:\s*none;\s*\}/);
  assert.match(stylesCSS, /\.public-nav-menu/);

  // Mobile
  assert.match(stylesCSS, /@media\s*\(max-width:\s*(?:860|980)px\)/);
  assert.match(stylesCSS, /\.public-nav-bar\s*\{[^}]*justify-content:\s*space-between/);
  assert.match(stylesCSS, /\.public-nav-toggle\s*\{[^}]*display:\s*inline-flex/);
  assert.match(stylesCSS, /\.public-nav\.is-open\s+\.public-nav-menu\s*\{\s*display:\s*flex;/);
  assert.match(stylesCSS, /\.public-nav-menu\s+\.nav-actions\s+\.btn\s*\{[^}]*width:\s*100%/);

  // Ensure old hide rule without menu is gone
  assert.doesNotMatch(stylesCSS, /\.public-nav\s+nav\s*\{\s*display:\s*none;\s*\}/);
});
