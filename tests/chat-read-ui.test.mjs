import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../web/static/js/app.js", import.meta.url), "utf8");
const code = source.slice(source.indexOf("async function markVisibleChatRead("), source.indexOf("function startChatReadTracking("));

test("read acknowledgements happen only for the visible conversation and are not repeated", async () => {
  const requests = [], rows = [{ dataset: { messageId: "message-1" } }, { dataset: { messageId: "message-2" } }];
  const root = { dataset: {}, isConnected: true, offsetParent: {}, querySelectorAll: () => rows };
  const badge = { textContent: "3", hidden: false, setAttribute() {} };
  const document = { visibilityState: "hidden", querySelectorAll: () => [badge] };
  const ctx = vm.createContext({ document, api: async (url, req) => { requests.push({ url, body: JSON.parse(req.body) }); return { read: 2 }; } });
  vm.runInContext(code, ctx);
  await ctx.markVisibleChatRead("chat-a", root);
  assert.equal(requests.length, 0);
  document.visibilityState = "visible";
  await ctx.markVisibleChatRead("chat-a", root);
  assert.deepEqual(requests, [{ url: "/api/chats/chat-a/read", body: { message_ids: ["message-1", "message-2"] } }]);
  assert.equal(badge.textContent, 1); // A newer message not loaded in this window remains unread.
  await ctx.markVisibleChatRead("chat-a", root);
  assert.equal(requests.length, 1);
  rows.push({ dataset: { messageId: "message-3" } });
  root.offsetParent = null;
  await ctx.markVisibleChatRead("chat-a", root);
  assert.equal(requests.length, 1);
});

test("failed read acknowledgements remain eligible for retry", async () => {
  const row = { dataset: { messageId: "message" } };
  const root = { dataset: {}, isConnected: true, offsetParent: {}, querySelectorAll: () => [row] };
  const ctx = vm.createContext({ document: { visibilityState: "visible" }, api: async () => { throw new Error("Offline"); } });
  vm.runInContext(code, ctx);
  await ctx.markVisibleChatRead("chat", root);
  assert.equal(row.dataset.readAcknowledged, undefined);
  assert.equal(root.dataset.markingRead, undefined);
});
