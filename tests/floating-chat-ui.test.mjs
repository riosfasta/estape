import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../web/static/js/app.js", import.meta.url), "utf8");
const widgetCode = source.slice(source.indexOf("function closeFloatingChat()"), source.indexOf("async function refreshTimerWidget()"));

function setup() {
  const mounted = new Map(), requests = [];
  class Element {
    children = new Map(); dataset = {}; attributes = {}; innerHTML = ""; value = ""; isConnected = false;
    querySelector(key) { if (!this.children.has(key)) this.children.set(key, new Element()); return this.children.get(key); }
    querySelectorAll() { return []; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(type, handler) { this[type] = handler; }
    focus() {} remove() { this.isConnected = false; mounted.delete(this.id); }
    insertAdjacentHTML(_where, value) { this.innerHTML += value; }
  }
  class Socket {
    sent = []; closed = false;
    send(value) { this.sent.push(value); }
    close() { this.closed = true; }
  }
  const context = vm.createContext({
    state: { me: { id: "customer", role: "users_admin" }, access: "test-token" },
    document: { createElement: () => new Element(), body: { appendChild: node => { mounted.set(node.id, node); node.isConnected = true; } } },
    $: key => { const [id, ...rest] = key.split(" "); const node = mounted.get(id.slice(1)); return rest.length ? node?.querySelector(rest.join(" ")) : node; },
    path: () => "/projects", icon: () => "<svg></svg>", icons() {}, esc: value => String(value ?? ""),
    loadMentionUsers: async () => [], chatTitle: chat => chat.title || "Chat", chatMessageHTML: message => `<p>${message.content}</p>`,
    chatComposerHTML: () => '<form id="helpChatForm"></form>', bindRichChatComposer() {}, bindChatReplyButtons() {}, bindMentionSuggestions() {},
    WebSocket: Socket, location: { protocol: "https:", host: "example.test" },
    api: async (url, options) => {
      requests.push({ url, options });
      if (url === "/api/chats" && !options) return { chats: [{ id: "another-customer-chat", type: "support", created_by: "someone-else", participant_ids: ["someone-else", "customer"], status: "open" }] };
      if (url === "/api/chats" && options?.method === "POST") return { chat: { id: "own-support", type: "support", created_by: "customer", participant_ids: ["customer", "owner"], status: "open" } };
      if (url.endsWith("/messages")) return { messages: [] };
      throw new Error("Unexpected API request " + url);
    },
  });
  vm.runInContext(widgetCode, context);
  return { context, mounted, requests };
}

test("support opens silently with a greeting and waits only after a saved message", async () => {
  const { context, mounted, requests } = setup();
  context.syncFloatingChatLauncher();
  assert.ok(mounted.has("floatingChatLauncher"));
  await context.openHelpChatWidget();
  const panel = mounted.get("helpChatWidget"), socket = context.state.supportSocket;
  assert.match(panel.innerHTML, /Welcome to Bugmega support/);
  assert.equal(panel.dataset.chatId, "own-support", "must not reuse another customer's support conversation");
  assert.equal(socket.sent.length, 0, "greeting must not send a chat message");
  assert.equal(panel.querySelector("[data-support-wait]").hidden, true);
  assert.ok(!requests.some(request => request.url.includes("another-customer-chat/messages")));
  socket.onmessage({ data: JSON.stringify({ message: { sender_id: "customer", content: "Please help" } }) });
  assert.equal(panel.querySelector("[data-support-wait]").hidden, false);
  socket.onmessage({ data: JSON.stringify({ message: { sender_id: "owner", content: "How can I help?" } }) });
  assert.equal(panel.querySelector("[data-support-wait]").hidden, true);
  context.closeFloatingChat();
  assert.equal(socket.closed, true);
  assert.equal(mounted.has("helpChatWidget"), false);
});

test("floating conversation list offers admin support and stays unavailable when signed out", async () => {
  const { context, mounted, requests } = setup();
  await context.openFloatingChatList();
  assert.match(mounted.get("helpChatWidget").innerHTML, /Chat with admin/);
  assert.match(mounted.get("helpChatWidget").innerHTML, /Start a new chat/);
  assert.ok(!requests.some(request => request.options?.method === "POST"));
  context.state.access = "";
  context.syncFloatingChatLauncher();
  assert.equal(mounted.has("helpChatWidget"), false);
  assert.equal(mounted.has("floatingChatLauncher"), false);
});

test("regular chats open in the bubble without support greetings or waiting notices", async () => {
  const { context, mounted } = setup();
  await context.openHelpChatWidget({ id: "direct", type: "direct", title: "Teammate", participant_ids: ["customer", "teammate"], status: "open" });
  const panel = mounted.get("helpChatWidget");
  assert.ok(!panel.innerHTML.includes("Welcome to Bugmega support"));
  context.state.supportSocket.onmessage({ data: JSON.stringify({ message: { sender_id: "customer", content: "Hello" } }) });
  assert.equal(panel.querySelector("[data-support-wait]").hidden, true);
});
