import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../web/static/js/app.js", import.meta.url), "utf8");

test("task mentions load cached permitted members first", async () => {
  const ctx = vm.createContext({
    state: {
      taskMentionUsers: {
        task123: [
          { id: "u1", name: "Alice Smith", username: "alicesmith" },
          { id: "u2", name: "Bob Jones", username: "bobjones" }
        ]
      },
      mentionUsers: null
    },
    api: async () => { throw new Error("should not call api when cached"); },
    activeWorkspaceTeamID: () => "team1",
    esc: s => s
  });

  const code = source.slice(source.indexOf("async function loadMentionUsers("), source.indexOf("function mentionToken("));
  vm.runInContext(code, ctx);

  const users = await ctx.loadMentionUsers("task123");
  assert.equal(users.length, 2);
  assert.equal(users[0].username, "alicesmith");
  assert.equal(users[1].username, "bobjones");
});

test("task mentions query client-tasks members endpoint and deduplicate", async () => {
  const calls = [];
  const ctx = vm.createContext({
    state: {
      taskMentionUsers: {},
      mentionUsers: null
    },
    api: async (url) => {
      calls.push(url);
      if (url === "/api/client-tasks/task456/members") {
        return {
          users: [
            { id: "u1", name: "Alice", username: "alice" },
            { id: "u1", name: "Alice Duplicate", username: "alice" },
            { id: "u2", name: "No Username User", username: "" },
            { id: "u3", name: "Carol", username: "carol" }
          ]
        };
      }
      return { users: [] };
    },
    activeWorkspaceTeamID: () => "team1",
    esc: s => s
  });

  const code = source.slice(source.indexOf("async function loadMentionUsers("), source.indexOf("function mentionToken("));
  vm.runInContext(code, ctx);

  const users = await ctx.loadMentionUsers("task456");
  assert.equal(calls[0], "/api/client-tasks/task456/members");
  assert.equal(users.length, 2);
  assert.equal(users[0].username, "alice");
  assert.equal(users[1].username, "carol");
  assert.equal(ctx.state.taskMentionUsers["task456"].length, 2);
});

test("mentionBox mounts inside open dialog to ensure visibility in top layer", () => {
  class MockElement {
    constructor(id = "", className = "") {
      this.id = id;
      this.className = className;
      this.parentElement = null;
      this.children = [];
    }
    appendChild(child) {
      if (child.parentElement) {
        child.parentElement.children = child.parentElement.children.filter(c => c !== child);
      }
      child.parentElement = this;
      this.children.push(child);
      return child;
    }
    closest(selector) {
      if (this.isDialog && selector.includes("dialog")) return this;
      if (this.parentElement) return this.parentElement.closest(selector);
      return null;
    }
  }

  const documentMock = {
    body: new MockElement("body"),
    getElementById(id) {
      if (id === "mentionSuggestions") {
        return this.body.children.find(c => c.id === id) || this.dialogMock?.children.find(c => c.id === id) || null;
      }
      return null;
    },
    createElement(tag) {
      return new MockElement("", tag);
    }
  };

  const dialogMock = new MockElement("myDialog");
  dialogMock.isDialog = true;
  documentMock.dialogMock = dialogMock;
  documentMock.body.appendChild(dialogMock);

  const inputInsideDialog = new MockElement("inputInDialog");
  dialogMock.appendChild(inputInsideDialog);

  const inputInBody = new MockElement("inputInBody");
  documentMock.body.appendChild(inputInBody);

  const ctx = vm.createContext({
    document: documentMock,
    state: {}
  });

  const code = source.slice(source.indexOf("function mentionBox("), source.indexOf("function hideMentionSuggestions("));
  vm.runInContext(code, ctx);

  const box1 = ctx.mentionBox(inputInsideDialog);
  assert.equal(box1.parentElement, dialogMock, "box should be appended to dialog when input is inside dialog");

  const box2 = ctx.mentionBox(inputInBody);
  assert.equal(box2.parentElement, documentMock.body, "box should be appended to body when input is outside dialog");
});
