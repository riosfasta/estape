import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../web/static/js/app.js", import.meta.url), "utf8");
const code = source.slice(source.indexOf("function staffInvitationFields()"), source.indexOf("async function renderTeam()"));

test("bulk staff invitations deduplicate recipients and retain only failures for retry", async () => {
  const sent = [], statuses = [];
  const button = { disabled: false }, list = { innerHTML: "" }, search = { addEventListener() {} };
  const form = {
    isConnected: true,
    elements: { recipient: { value: "A@example.com, a@example.com, fail@example.com, @sam" } },
    querySelector: selector => selector === '[type="submit"]' ? button : selector === '[data-invitation-access-list]' ? list : search,
    addEventListener(type, handler) { this[type] = handler; },
    closest: () => null,
  };
  const ctx = vm.createContext({
    esc: value => value,
    FormData: class { getAll(name) { return name === "website_ids" ? ["domain"] : []; } },
    setFormStatus: (_form, text) => statuses.push(text),
    api: async (url, options) => {
      if (!options) return { clients: [{ id: "folder", team_id: "team", name: "Selected company" }, { id: "other", team_id: "other-team", name: "Private company" }], websites: [{ id: "domain", team_id: "team", client_id: "folder", name: "Website" }] };
      assert.equal(url, "/api/teams/team/invitations");
      const body = JSON.parse(options.body);
      sent.push(body);
      if (body.recipient === "fail@example.com") throw new Error("Already invited");
      return {};
    },
  });
  vm.runInContext(code, ctx);
  await ctx.bindStaffInvitationForm(form, "team");
  assert.match(list.innerHTML, /Selected company/);
  assert.doesNotMatch(list.innerHTML, /Private company/);
  await form.submit({ preventDefault() {} });
  assert.deepEqual(sent.map(item => item.recipient), ["a@example.com", "fail@example.com", "@sam"]);
  for (const item of sent) {
    assert.deepEqual(item.client_ids, []);
    assert.deepEqual(item.website_ids, ["domain"]);
  }
  assert.equal(form.elements.recipient.value, "fail@example.com");
  assert.match(statuses.at(-1), /2 invitations sent.*fail@example.com: Already invited/);
  assert.equal(button.disabled, false);
});

test("recipient parsing handles commas and newlines without duplicate sends", () => {
  const ctx = vm.createContext({});
  vm.runInContext(code, ctx);
  assert.deepEqual(Array.from(ctx.splitStaffInvitationRecipients(" one@example.com,\n@sam, ,ONE@example.com ")), ["one@example.com", "@sam"]);
});
