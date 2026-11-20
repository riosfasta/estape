import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../web/static/js/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../web/static/css/styles.css", import.meta.url), "utf8");

test("Add task dialog contains multiple attachment upload zone, drop prompt, and add-more bar", () => {
  assert.ok(source.includes('id="clientTaskDialog"'), "clientTaskDialog exists");
  assert.ok(source.includes('id="clientTaskForm"'), "clientTaskForm exists");
  assert.ok(
    source.includes('taskAttachmentUploadFieldHTML("attachments", "Attachments")'),
    "clientTaskForm uses taskAttachmentUploadFieldHTML"
  );
  assert.ok(source.includes('data-attachment-dropzone'), "attachment dropzone exists");
  assert.ok(source.includes('data-add-more-attachments'), "add more attachments button exists");
  assert.ok(source.includes('data-attachment-count-label'), "attachment count label exists");
});

test("contentBlockEditorHTML includes Attachment button in task body toolbar", () => {
  assert.ok(
    source.includes('data-add-attachment-btn'),
    "attachment button exists in task body toolbar"
  );
  assert.ok(
    source.includes('editor.querySelector("[data-add-attachment-btn]")?.addEventListener("click"'),
    "add attachment button is wired to trigger the file input and scroll into view"
  );
});

test("clientTaskForm submit uploads all accumulated attachments", () => {
  assert.ok(
    source.includes('const taskFiles = attInput?._attachedFiles?.length ? attInput._attachedFiles : Array.from(attInput?.files || []);'),
    "reads accumulated attachments from _attachedFiles or files"
  );
  assert.ok(source.includes('body.attachments.push(await upload(file));'), "each file is uploaded");
});

test("bindAttachmentsPreview supports multiple files accumulation and dropzone", () => {
  assert.ok(source.includes("function bindAttachmentsPreview(input, container)"), "bindAttachmentsPreview function is defined");
  assert.ok(source.includes("input._attachedFiles = fileList;"), "maintains persistent accumulated file list");
  assert.ok(source.includes("addMoreBtn?.addEventListener"), "add more button triggers input.click()");
  assert.ok(source.includes('dropzone.addEventListener("drop"'), "dropzone handles drag and drop of multiple files");
});

test("styles.css defines attachment-upload-zone, chip-list, and add-more styling", () => {
  assert.ok(css.includes(".attachment-upload-zone"), "attachment-upload-zone style is defined");
  assert.ok(css.includes(".attachment-chip-list"), "attachment-chip-list style is defined");
  assert.ok(css.includes(".attachment-add-more-bar"), "attachment-add-more-bar style is defined");
});

test("Task board cards render attachment pill when task has attachments", () => {
  assert.ok(source.includes('title="${task.attachments.length} attachment(s)"'), "task card displays attachment count pill");
});

test("Task severity option includes Normal (default), High, and Urgent with badge and picker helpers", () => {
  assert.ok(source.includes("function taskSeverity("), "taskSeverity helper exists");
  assert.ok(source.includes("function taskSeverityBadgeHTML("), "taskSeverityBadgeHTML exists");
  assert.ok(source.includes("function severityPickerHTML("), "severityPickerHTML exists");
  assert.ok(source.includes('value="normal"'), "normal value exists");
  assert.ok(source.includes('value="high"'), "high value exists");
  assert.ok(source.includes('value="urgent"'), "urgent value exists");
  assert.ok(source.includes('${severityPickerHTML("normal")}'), "defaults to normal in task form");
});

test("styles.css defines severity badge colors: normal green, high yellow, urgent red", () => {
  assert.ok(css.includes(".severity-badge.normal"), "normal green badge style is defined");
  assert.ok(css.includes(".severity-badge.high"), "high yellow badge style is defined");
  assert.ok(css.includes(".severity-badge.urgent"), "urgent red badge style is defined");
  assert.ok(css.includes(".severity-picker"), "severity picker style is defined");
  assert.ok(css.includes("#10b981"), "green color defined for normal");
  assert.ok(css.includes("#f59e0b"), "yellow color defined for high");
  assert.ok(css.includes("#ef4444"), "red color defined for urgent");
});

test("time tracker popup close button is styled white", () => {
  assert.ok(source.includes('data-close-task-timer-modal title="Close" style="color:#ffffff;'), "close button has white inline color");
  assert.ok(source.includes('cu-timer-close-btn'), "close button has cu-timer-close-btn class");
  assert.ok(css.includes(".time-tracker-dialog [data-close-task-timer-modal]") && css.includes("color: #ffffff !important"), "css styles close button white");
  assert.ok(css.includes("stroke: #ffffff !important"), "css styles close icon stroke white");
});

test("clientTaskAnnotationItems falls back to task comment or content when annotation comment is empty", () => {
  assert.ok(source.includes('comment: item.comment || task.comment || task.content || ""'), "fallback to task comment exists in clientTaskAnnotationItems");
});

test("clientAnnotationTaskDetailHTML displays details when task.comment or task.content is present under the title", () => {
  assert.ok(source.includes('(task.comment || task.content) ? `'), "details conditional exists");
  assert.ok(source.includes('class="feedback-task-details"'), "details container uses feedback-task-details");
  assert.ok(source.includes('feedback-details-content'), "details content rendered");
});

test("annotation sidebar separates task card and comments card with professional styling", () => {
  assert.ok(source.includes('feedback-task-card'), "renders feedback-task-card");
  assert.ok(source.includes('feedback-comments-card'), "renders feedback-comments-card");
  assert.ok(source.includes('feedback-badge'), "renders feedback-badge");
  assert.ok(source.includes('feedback-page-link-pill'), "renders feedback-page-link-pill");
  assert.ok(css.includes('.feedback-task-card'), "css includes .feedback-task-card styling");
  assert.ok(css.includes('.feedback-comments-card'), "css includes .feedback-comments-card styling");
});

test("annotation edit form syncs active annotation and includes updated annotations array", () => {
  assert.ok(source.includes("body.annotations = task.annotations.map"), "editClientAnnotationTaskForm maps body.annotations");
});

test("clientAnnotationTaskDetailHTML removes redundant status and assignee by default", () => {
  assert.ok(source.includes("const showStatus = Boolean(options.showStatus);"), "showStatus defaults to false");
  assert.ok(source.includes("const showAssignee = Boolean(options.showAssignee);"), "showAssignee defaults to false");
  assert.ok(source.includes("showAssignee ?"), "assignee is conditional on showAssignee");
});

test("task progress buttons (status, due date, assignee) are styled compact and professional", () => {
  assert.ok(css.includes(".task-detail-meta-form .status-trigger"), "status-trigger compact style defined");
  assert.ok(css.includes(".task-detail-meta-form .due-edit-pill"), "due-edit-pill compact style defined");
  assert.ok(css.includes(".task-detail-meta-form .assignee-trigger"), "assignee-trigger compact style defined");
  assert.ok(css.includes(".task-detail-meta-form .assignee-trigger-icons .user-chip span"), "user-chip avatar span sized down");
});

test("back button in annotation viewer displays clear count of annotations in the list", () => {
  assert.ok(source.includes('id="annotationViewerBackBtn"'), "annotationViewerBackBtn exists");
  assert.ok(source.includes('annotation-count-badge'), "annotation-count-badge is rendered in back button");
  assert.ok(source.includes('${annotationItems.length}'), "annotationItems.length is displayed in back button");
  assert.ok(css.includes(".annotation-back-btn"), "annotation-back-btn css defined");
  assert.ok(css.includes(".annotation-count-badge"), "annotation-count-badge css defined");
});

test("client-task-card removes redundant status badge from meta and styles icons/toolbar tidily", () => {
  assert.ok(!source.includes('${statusBadgeHTML(status, "status-badge status-pill")}'), "redundant status badge removed from task card meta");
  assert.ok(css.includes(".client-task-card-meta .pill"), "client-task-card-meta pill style defined");
  assert.ok(css.includes(".client-task-card .compact-toolbar"), "client-task-card compact-toolbar style defined");
  assert.ok(css.includes(".client-task-card .assignee-avatars .user-chip"), "client-task-card user-chip avatar size defined");
});

test("status menu dropdown is styled smaller, professional, and elevates card stacking context", () => {
  assert.ok(css.includes("width: 190px;"), "status-menu width is compacted");
  assert.ok(/\.status-menu\s*\{[\s\S]*?position:\s*absolute;/.test(css), "status-menu has absolute position overlay");
  assert.ok(css.includes(".annotation-viewer-progress:has(.status-menu:not([hidden]))"), "annotation-viewer-progress elevates z-index on menu open");
  assert.ok(css.includes(".status-option-actions .btn"), "status-option-actions btn styled");
  assert.ok(css.includes(".client-task-card.menu-open"), "menu-open elevates card stacking context");
  assert.ok(source.includes("contrastRatio(color, \"#ffffff\") < 3.2"), "light mode status text contrast check exists");
  assert.ok(source.includes("picker.closest(\".task-card, .client-task-card, .annotation-viewer-progress\")"), "bindStatusPickers manages container menu-open state");
});

test("edit annotation dialog includes severity picker, multiple attachment dropzone, and existing attachment chips", () => {
  assert.ok(source.includes('id="editClientAnnotationTaskForm"'), "editClientAnnotationTaskForm exists");
  assert.ok(source.includes('${severityPickerHTML(task.severity || "normal")}'), "editClientAnnotationTaskForm renders severity picker");
  assert.ok(source.includes('${taskAttachmentUploadFieldHTML("attachments", "Attachments")}'), "editClientAnnotationTaskForm renders attachment upload field");
  assert.ok(source.includes("data-remove-existing-attachment"), "editClientAnnotationTaskForm handles removing existing attachments");
  assert.ok(source.includes("bindAttachmentsPreview(panel.querySelector(\"#editClientAnnotationTaskForm"), "binds attachments preview for editClientAnnotationTaskForm");
});

test("assignee menu dropdown is styled compact and opens inward to prevent sidebar overflow", () => {
  assert.ok(css.includes("width: 220px;"), "assignee-menu width is compacted");
  assert.ok(css.includes(".annotation-viewer-side .assignee-menu"), "annotation-viewer-side assignee-menu position defined");
  assert.ok(css.includes(".assignee-choice .user-chip"), "assignee-choice user-chip avatar size defined");
  assert.ok(source.includes("rect.right > window.innerWidth - 8"), "boundary check exists for assignee dropdown");
});

test("clientAnnotationMediaHTML removes redundant bottom title and keeps captured picture label", () => {
  assert.ok(source.includes('<div class="panel-head compact-panel-head"><div><span class="muted">Captured picture</span></div>'), "removes redundant title from captured picture head");
});

test("annotation iframe and viewport use realistic fallback height, anchor positioning, and dynamic resize observer", () => {
  assert.ok(source.includes("const ANNOTATION_TALL_FALLBACK_HEIGHT = 3600;"), "tall fallback height tuned to 3600px");
  assert.ok(source.includes("loading=\"eager\""), "annotation iframe set to eager loading");
  assert.ok(source.includes("ResizeObserver"), "dynamic ResizeObserver attached for annotation stage");
  assert.ok(/\.annotation-viewport\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*0;[\s\S]*?left:\s*0;/.test(css), "annotation viewport anchors top-left without inset bounding conflicts");
});

