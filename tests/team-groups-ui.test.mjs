import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../web/static/js/app.js", import.meta.url), "utf8");
const code = source.slice(source.indexOf("function canGroupTeamMember("), source.indexOf("function staffInvitationFields("));
function context() {
  const ctx = vm.createContext({ esc: value => String(value).replaceAll("<", "&lt;"), icon: () => "", teamMemberRows: members => members.map(member => `<article>${member.id}</article>`).join("") });
  vm.runInContext(code, ctx);
  return ctx;
}

test("group boards put people into named groups or ungrouped and escape group names", () => {
  const ctx = context();
  const html = ctx.teamGroupsHTML({ groups: [{ id: "devs", name: "<Developers>" }], member_groups: { alice: "devs", bob: "deleted" } }, [{ id: "alice" }, { id: "bob" }], true);
  assert.match(html, /&lt;Developers>/);
  assert.doesNotMatch(html, /<Developers>/);
  assert.match(html, /data-drop-team-group=""[\s\S]*<article>bob<\/article>[\s\S]*data-drop-team-group="devs"[\s\S]*<article>alice<\/article>/);
  assert.match(html, /data-new-team-group/);
  assert.doesNotMatch(ctx.teamGroupsHTML({ groups: [] }, [], false), /data-new-team-group/);
});

test("individual access distinguishes group inheritance, direct access and creator access", () => {
  const ctx = context(), member = { id: "alice" };
  const resource = { id: "site", client_id: "folder", member_ids: ["alice"], group_member_ids: ["alice"], group_only_member_ids: ["alice"] };
  let choice = ctx.teamAccessChoice(resource, null, member, true, []);
  assert.equal(choice.checked, false);
  assert.equal(choice.inherited, true);
  choice = ctx.teamAccessChoice({ ...resource, group_only_member_ids: [] }, null, member, true, []);
  assert.equal(choice.checked, true);
  choice = ctx.teamAccessChoice({ id: "other", client_id: "folder" }, null, member, true, ["folder"]);
  assert.equal(choice.checked, false);
  assert.equal(choice.inherited, true);
  choice = ctx.teamAccessChoice({ id: "own", created_by: "alice" }, null, member, false, []);
  assert.equal(choice.checked, true);
  assert.equal(choice.locked, true);
});

test("group moves are available only for active actual staff, not pending staff or company admins", () => {
  const ctx = context(), team = { id: "team", owner_admin_id: "owner", member_ids: ["alice", "owner"] };
  const member = { id: "alice", status: "active", role: "users_member", team_id: "team" };
  assert.equal(ctx.canGroupTeamMember(member, team), true);
  assert.equal(ctx.canGroupTeamMember({ ...member, status: "pending" }, team), false);
  assert.equal(ctx.canGroupTeamMember({ ...member, id: "outsider" }, team), false);
  assert.equal(ctx.canGroupTeamMember({ ...member, id: "owner" }, team), false);
  assert.equal(ctx.canGroupTeamMember({ ...member, role: "users_admin" }, team), false);
});
