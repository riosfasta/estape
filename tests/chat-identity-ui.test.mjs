import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../web/static/js/app.js", import.meta.url), "utf8");
const code = source.slice(source.indexOf("function chatAvatarHTML("), source.indexOf("function bindChatReplyButtons("));
const ctx = vm.createContext({ state: { me: { id: "me", name: "My Name", avatar_url: "/self.png" } }, esc: value => String(value ?? "").replaceAll('"', '&quot;').replaceAll('<', '&lt;'), inboxTime: () => "now", chatText: value => value, icon: () => "" });
vm.runInContext(code, ctx);

test("owner messages show Bug Mega and a photo without needing the mention list", () => {
  for (const context of ["page", "support"]) {
    const html = ctx.chatMessageHTML({ id: "1", sender_id: "owner", sender: { name: "Owner name", role: "owner_adm", avatar_url: "/owner.webp" }, content: "Hello" }, {}, context);
    assert.match(html, /Bug Mega/);
    assert.match(html, /src="\/owner.webp"/);
    assert.doesNotMatch(html, /Someone|Owner name/);
  }
});

test("user messages use current profile photos and fall back to the account avatar", () => {
  const self = ctx.chatMessageHTML({ id: "2", sender_id: "me" });
  assert.match(self, />You</);
  assert.match(self, /src="\/self.png"/);
  const profile = ctx.chatMessageHTML({ id: "3", sender_id: "me", sender: { name: "My Profile", avatar_url: "/profile.webp" } });
  assert.match(profile, /src="\/profile.webp"/);
  assert.doesNotMatch(profile, /src="\/self.png"/);
});

test("missing or invalid photos have an initials fallback", () => {
  const html = ctx.chatAvatarHTML({ avatar_url: "javascript:bad()" }, "Bug Mega");
  assert.match(html, />BM</);
  assert.doesNotMatch(html, /<img/);
});
