import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../web/static/js/app.js", import.meta.url), "utf8");

test("delete warning dialog contains the exact 15-day recovery warning text", () => {
  const expectedWarning = "are you sure want to delete this projects and all of domain inside, your folder will keep for 15 days, ask help to recover your deleted folders?";
  
  // Verify on the main /projects warning dialog
  assert.ok(
    source.includes(`id="deleteProjectWarningDialog"`),
    "deleteProjectWarningDialog must exist in app.js"
  );
  assert.ok(
    source.includes(expectedWarning),
    `app.js must contain exact warning string: "${expectedWarning}"`
  );
  
  // Verify on the folder detail /projects/:id warning dialog
  assert.ok(
    source.includes(`id="deleteClientFolderDialog"`),
    "deleteClientFolderDialog must exist in app.js"
  );
});

test("projects page has edit, delete, and menu action icons", () => {
  // Direct icon buttons
  assert.ok(
    source.includes(`data-edit-project=`) && source.includes(`icon("pencil")`),
    "Edit project icon button must exist"
  );
  assert.ok(
    source.includes(`data-delete-project=`) && source.includes(`icon("trash-2")`),
    "Delete project icon button must exist"
  );
  // Context dropdown row menu
  assert.ok(
    source.includes(`details class="row-menu project-card-menu"`),
    "Project card dropdown menu must exist"
  );
  assert.ok(
    source.includes(`summary class="btn icon quiet" title="Project menu"`),
    "Project menu trigger icon button must exist"
  );
});

test("platform owner deleted projects page is registered in sidebar and router", () => {
  // Sidebar navigation link
  assert.ok(
    source.includes(`workspaceChild("/admin/deleted-projects", "Deleted Projects", "archive-restore")`),
    "Owner sidebar must link to /admin/deleted-projects"
  );
  // Router route match
  assert.ok(
    source.includes(`path() === "/admin/deleted-projects"`),
    "Client router must route /admin/deleted-projects"
  );
  assert.ok(
    source.includes(`renderAdminDeletedProjects()`),
    "Router must invoke renderAdminDeletedProjects()"
  );
});

test("deleted projects administration page enforces 35-day retention and owner actions", () => {
  assert.ok(
    source.includes(`35-Day Platform Owner Retention Policy`),
    "Deleted projects page must display the 35-day retention notice"
  );
  assert.ok(
    source.includes(`/api/admin/deleted-projects`),
    "Must fetch deleted projects from /api/admin/deleted-projects"
  );
  assert.ok(
    source.includes(`/restore`),
    "Must have restore API endpoint integration"
  );
  assert.ok(
    source.includes(`/permanent`),
    "Must have permanent delete API endpoint integration"
  );
});
