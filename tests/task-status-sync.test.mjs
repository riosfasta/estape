import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../web/static/js/app.js", import.meta.url), "utf8");

function createMockElement(tag, attrs = {}) {
  const children = [];
  const classList = new Set((attrs.class || "").split(/\s+/).filter(Boolean));
  const styleMap = new Map();
  const dataset = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("data-")) {
      const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      dataset[camel] = String(v);
    }
  }

  const el = {
    tagName: tag.toUpperCase(),
    id: attrs.id || "",
    name: attrs.name || "",
    type: attrs.type || "",
    dataset,
    get className() {
      return Array.from(classList).join(" ");
    },
    set className(val) {
      classList.clear();
      (val || "").split(/\s+/).filter(Boolean).forEach((c) => classList.add(c));
    },
    classList: {
      contains: (c) => classList.has(c),
      add: (c) => classList.add(c),
      remove: (c) => classList.delete(c),
      toggle: (c, force) => {
        if (force === undefined) {
          if (classList.has(c)) classList.delete(c);
          else classList.add(c);
        } else if (force) classList.add(c);
        else classList.delete(c);
      }
    },
    style: {
      setProperty: (k, v) => styleMap.set(k, v),
      getPropertyValue: (k) => styleMap.get(k) || "",
    },
    value: attrs.value || "",
    textContent: attrs.textContent || "",
    children,
    parentElement: null,
    listeners: {},
    addEventListener(event, handler) {
      this.listeners[event] = this.listeners[event] || [];
      this.listeners[event].push(handler);
    },
    dispatchEvent(event) {
      const list = this.listeners[event.type || event] || [];
      list.forEach((h) => h({ currentTarget: this, target: this }));
    },
    get firstElementChild() { return children[0] || null; },
    get lastElementChild() { return children[children.length - 1] || null; },
    appendChild(child) {
      if (child.parentElement) {
        const idx = child.parentElement.children.indexOf(child);
        if (idx !== -1) child.parentElement.children.splice(idx, 1);
      }
      children.push(child);
      child.parentElement = el;
      return child;
    },
    insertBefore(newChild, refChild) {
      if (newChild.parentElement) {
        const idx = newChild.parentElement.children.indexOf(newChild);
        if (idx !== -1) newChild.parentElement.children.splice(idx, 1);
      }
      const refIdx = children.indexOf(refChild);
      if (refIdx === -1) children.push(newChild);
      else children.splice(refIdx, 0, newChild);
      newChild.parentElement = el;
      return newChild;
    },
    remove() {
      if (el.parentElement) {
        const idx = el.parentElement.children.indexOf(el);
        if (idx !== -1) el.parentElement.children.splice(idx, 1);
        el.parentElement = null;
      }
    },
    closest(selector) {
      let cur = el;
      while (cur) {
        if (matches(cur, selector)) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    querySelector(selector) {
      return querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      return querySelectorAll(selector);
    }
  };

  function matches(node, selector) {
    if (!node || !node.tagName) return false;
    let s = selector.trim();
    const tagMatch = s.match(/^[a-zA-Z0-9]+/);
    if (tagMatch) {
      if (node.tagName.toLowerCase() !== tagMatch[0].toLowerCase()) return false;
      s = s.slice(tagMatch[0].length);
    }
    const classMatches = s.match(/\.([a-zA-Z0-9_-]+)/g);
    if (classMatches) {
      for (const cm of classMatches) {
        if (!node.classList.contains(cm.slice(1))) return false;
      }
    }
    const idMatch = s.match(/#([a-zA-Z0-9_-]+)/);
    if (idMatch && node.id !== idMatch[1]) return false;
    const dataMatches = s.matchAll(/\[([a-zA-Z0-9_-]+)(?:=['"]?([^'"\]]*)['"]?)?\]/g);
    for (const dm of dataMatches) {
      const attr = dm[1];
      const val = dm[2];
      if (attr.startsWith("data-")) {
        const camel = attr.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        if (node.dataset[camel] === undefined) return false;
        if (val !== undefined && node.dataset[camel] !== val) return false;
      } else {
        if (node[attr] === undefined) return false;
        if (val !== undefined && String(node[attr]) !== val) return false;
      }
    }
    return true;
  }

  function querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/);
    let candidates = [el];
    for (const part of parts) {
      const nextCandidates = [];
      for (const parent of candidates) {
        function traverse(node) {
          for (const child of node.children) {
            if (matches(child, part)) nextCandidates.push(child);
            traverse(child);
          }
        }
        traverse(parent);
      }
      candidates = nextCandidates;
    }
    return candidates;
  }

  return el;
}

test("syncTaskStatusEverywhere moves card to target column and updates badges and empty placeholders", async () => {
  const doc = createMockElement("document");

  // Create board with 2 columns: todo and in_progress
  const board = createMockElement("div", { class: "client-board" });
  doc.appendChild(board);

  const todoCol = createMockElement("section", { class: "kanban-column", "data-client-status": "todo" });
  const todoHeading = createMockElement("span", { class: "status-badge status-heading", textContent: "To Do" });
  todoHeading.style.setProperty("--status-icon-color", "#8b5cf6");
  todoHeading.style.setProperty("--status-text-color", "#e5e7eb");
  todoCol.appendChild(todoHeading);

  const card = createMockElement("article", { class: "task-card client-task-card", "data-client-task-id": "task1" });
  const cardMeta = createMockElement("div", { class: "client-task-card-meta" });
  const cardBadge = createMockElement("span", { class: "status-badge status-pill", textContent: "To Do" });
  cardMeta.appendChild(cardBadge);
  card.appendChild(cardMeta);

  const cardPicker = createMockElement("div", { class: "status-picker", "data-status-picker": "" });
  const cardTrigger = createMockElement("button", { class: "status-trigger", "data-status-trigger": "" });
  const cardTriggerLabel = createMockElement("span", { "data-status-trigger-label": "", textContent: "To Do" });
  cardTrigger.appendChild(cardTriggerLabel);
  cardPicker.appendChild(cardTrigger);
  const cardInput = createMockElement("input", { type: "hidden", name: "status", value: "todo" });
  cardPicker.appendChild(cardInput);
  card.appendChild(cardPicker);

  todoCol.appendChild(card);
  board.appendChild(todoCol);

  const progressCol = createMockElement("section", { class: "kanban-column", "data-client-status": "in_progress" });
  const progressHeading = createMockElement("span", { class: "status-badge status-heading", textContent: "In Progress" });
  progressHeading.style.setProperty("--status-icon-color", "#3b82f6");
  progressHeading.style.setProperty("--status-text-color", "#dbeafe");
  progressCol.appendChild(progressHeading);
  const progressEmpty = createMockElement("p", { class: "muted", textContent: "No tasks." });
  progressCol.appendChild(progressEmpty);
  board.appendChild(progressCol);

  // Create open task panel
  const panel = createMockElement("dialog", { class: "modal client-task-modal client-task-panel", "data-live-task-id": "task1" });
  panel.id = "clientTaskPanel";
  const quickForm = createMockElement("form", { id: "clientTaskQuickEditForm" });
  const panelPicker = createMockElement("div", { class: "status-picker", "data-status-picker": "" });
  const panelTrigger = createMockElement("button", { class: "status-trigger", "data-status-trigger": "" });
  const panelTriggerLabel = createMockElement("span", { "data-status-trigger-label": "", textContent: "To Do" });
  panelTrigger.appendChild(panelTriggerLabel);
  panelPicker.appendChild(panelTrigger);
  const panelInput = createMockElement("input", { type: "hidden", name: "status", value: "todo" });
  panelPicker.appendChild(panelInput);
  quickForm.appendChild(panelPicker);
  panel.appendChild(quickForm);
  doc.appendChild(panel);

  const ctx = vm.createContext({
    document: {
      querySelector: (sel) => {
        if (sel === "#clientTaskPanel") return panel;
        return doc.querySelector(sel);
      },
      querySelectorAll: (sel) => doc.querySelectorAll(sel),
      createElement: (tag) => createMockElement(tag),
    },
    $: (sel) => (sel === "#clientTaskPanel" ? panel : doc.querySelector(sel)),
    selectorEscape: (s) => s,
    normalizeClientTaskStatusValue: (s) => String(s || "").trim(),
    clientTaskStatusLabel: (s) => (s === "in_progress" ? "In Progress" : "To Do"),
    normalizeStatusColor: (c, fb) => c || fb,
    readableStatusTextColor: (c, fb) => c || fb,
    icon: () => "",
    esc: (s) => s,
    icons: () => {},
  });

  const syncCode = source.slice(source.indexOf("function syncTaskStatusEverywhere("), source.indexOf("function syncTaskDueDateOnBoard("));
  vm.runInContext(syncCode, ctx);

  // Execute sync to "in_progress"
  ctx.syncTaskStatusEverywhere("task1", "in_progress");

  // Verify card moved from todoCol to progressCol
  assert.equal(card.parentElement, progressCol, "card should be in progress column");
  assert.equal(progressCol.children.includes(card), true, "card should be a child of progress column");
  assert.equal(todoCol.children.includes(card), false, "card should no longer be in todo column");

  // Verify progressCol empty placeholder was removed
  const progressMuted = progressCol.querySelectorAll("p.muted");
  assert.equal(progressMuted.length, 0, "No tasks placeholder should be removed from progress column");

  // Verify todoCol now has empty placeholder added
  const todoMuted = todoCol.querySelectorAll("p.muted");
  assert.equal(todoMuted.length, 1, "No tasks placeholder should be added to empty todo column");
  assert.equal(todoMuted[0].textContent, "No tasks.");

  // Verify card status picker and badge updated
  assert.equal(cardInput.value, "in_progress");
  assert.equal(cardTriggerLabel.textContent, "In Progress");
  assert.equal(cardTrigger.style.getPropertyValue("--status-icon-color"), "#3b82f6");

  // Verify modal/panel status picker updated without closing
  assert.equal(panelInput.value, "in_progress");
  assert.equal(panelTriggerLabel.textContent, "In Progress");
  assert.equal(panelTrigger.style.getPropertyValue("--status-icon-color"), "#3b82f6");
});

test("bindClientTaskQuickAutosave does not call route and passes updated response to afterSave", async () => {
  let routeCalled = false;
  let savedCalledWith = null;

  const root = createMockElement("div");
  const form = createMockElement("form", { id: "clientTaskQuickEditForm" });
  const statusInput = createMockElement("input", { name: "status", value: "in_progress" });
  form.appendChild(statusInput);
  root.appendChild(form);

  const ctx = vm.createContext({
    api: async (url, opts) => ({ updated: true, task: { id: "task1", status: "in_progress" } }),
    setFormStatus: () => {},
    route: () => { routeCalled = true; },
  });

  const autosaveCode = source.slice(source.indexOf("function bindClientTaskQuickAutosave("), source.indexOf("function bindClientBoardDrag("));
  vm.runInContext(autosaveCode, ctx);

  ctx.bindClientTaskQuickAutosave(root, "task1", async (body, resp) => {
    savedCalledWith = { body, resp };
  });

  // Trigger change event on status input
  statusInput.dispatchEvent({ type: "change" });

  // Wait a tick for the async save to complete
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(routeCalled, false, "route() must NOT be called on quick autosave");
  assert.ok(savedCalledWith, "afterSave should receive body and response");
  assert.equal(savedCalledWith.body.status, "in_progress");
  assert.equal(savedCalledWith.resp.task.status, "in_progress");
});
