(function () {
  if (window.BugMegaFeedbackWidget) return;
  window.BugMegaFeedbackWidget = true;

  var script = document.currentScript;
  if (!script) {
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      if ((scripts[i].src || "").indexOf("/widget.js") !== -1) {
        script = scripts[i];
        break;
      }
    }
  }
  if (!script) return;

  var scriptURL = new URL(script.src, window.location.href);
  var apiBase = scriptURL.origin;
  var iconURL = apiBase + "/static/img/feedback-bug.png";
  var siteKey = script.getAttribute("data-project") || script.getAttribute("data-site") || script.getAttribute("data-key") || scriptURL.searchParams.get("key") || "";
  if (!siteKey) return;

  var html2canvasPromise = null;
  var launcherDrag = null;
  var launcherWasDragged = false;
  var drawingState = {
    active: false,
    tool: "pencil",
    color: "#ef4444",
    drawing: false,
    startX: 0,
    startY: 0,
    current: null,
    elements: []
  };
  var state = {
    selecting: false,
    point: null,
    draftPin: null,
    pins: [],
    screenshot: "",
    captureError: "",
    session: null
  };

  function addStyles() {
    if (document.getElementById("bugmega-widget-styles")) return;
    var style = document.createElement("style");
    style.id = "bugmega-widget-styles";
    style.textContent =
      ".bugmega-widget *{box-sizing:border-box;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
      ".bugmega-widget{position:fixed;right:22px;bottom:22px;z-index:2147483000;color:#10201c}" +
      ".bugmega-feedback-button{position:relative;width:62px;height:62px;display:inline-flex;align-items:center;justify-content:center;border:1px solid #b8d8cf;border-radius:50%;background:#fff;color:#10201c;padding:12px;font-weight:800;box-shadow:0 16px 44px rgba(0,0,0,.22);cursor:grab;touch-action:none;user-select:none}" +
      ".bugmega-feedback-button:active{cursor:grabbing}" +
      ".bugmega-feedback-button:hover,.bugmega-feedback-button[aria-expanded='true']{border-color:#08a88a;box-shadow:0 16px 44px rgba(0,0,0,.22),0 0 0 3px rgba(8,168,138,.12)}" +
      ".bugmega-feedback-button img{width:32px;height:32px;object-fit:contain;display:block}" +
      ".bugmega-launch-arrow{position:absolute;right:-7px;bottom:4px;width:24px;height:24px;border:1px solid #b8d8cf;border-radius:50%;background:#fff;box-shadow:0 4px 10px rgba(0,0,0,.16)}" +
      ".bugmega-launch-arrow:after{content:'';position:absolute;left:7px;top:6px;width:7px;height:7px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg);transition:transform .18s ease}" +
      ".bugmega-feedback-button[aria-expanded='true'] .bugmega-launch-arrow:after{top:9px;transform:rotate(225deg)}" +
      ".bugmega-menu{position:fixed;right:22px;bottom:86px;width:min(340px,calc(100vw - 32px));max-height:calc(100vh - 118px);overflow:auto;background:#fff;border:1px solid rgba(0,0,0,.14);border-radius:12px;box-shadow:0 22px 70px rgba(0,0,0,.28);padding:14px;display:none}" +
      ".bugmega-menu.active{display:block}" +
      ".bugmega-menu-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}" +
      ".bugmega-menu-head strong{font-size:15px;color:#10201c}.bugmega-menu-count{font-size:11px;color:#64736e}" +
      ".bugmega-annotation-list{display:grid;gap:4px;max-height:224px;overflow-y:auto;margin:0 0 12px;padding-right:3px;scrollbar-gutter:stable}" +
      ".bugmega-annotation-row{width:100%;display:grid;grid-template-columns:26px minmax(0,1fr);align-items:center;gap:8px;border:0;border-radius:7px;background:transparent;padding:6px;text-align:left;color:#10201c;font-size:13px;cursor:pointer}" +
      ".bugmega-annotation-row:hover{background:#eef8f5}.bugmega-annotation-row span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".bugmega-annotation-number{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#ef4444;color:#fff;font-size:11px;font-weight:900;box-shadow:0 0 0 2px rgba(239,68,68,.14)}" +
      ".bugmega-menu-empty{margin:6px 2px 14px;color:#64736e;font-size:13px}" +
      ".bugmega-start-annotation{width:100%;display:flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:7px;background:#08a88a;color:#fff;padding:8px 11px;font-size:13px;font-weight:800;cursor:pointer}" +
      ".bugmega-detail[hidden],.bugmega-list-view[hidden]{display:none}" +
      ".bugmega-detail-back{display:inline-flex;align-items:center;gap:5px;border:0;background:transparent;color:#087c67;padding:2px 0 9px;font-size:13px;font-weight:800;cursor:pointer}" +
      ".bugmega-detail-title{display:grid;grid-template-columns:27px minmax(0,1fr);align-items:center;gap:8px;margin-bottom:10px}.bugmega-detail-title h3{margin:0;font-size:15px;line-height:1.3;color:#10201c}" +
      ".bugmega-detail-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}.bugmega-detail-pill{border-radius:999px;background:#eef5f2;color:#52635d;padding:4px 8px;font-size:11px;font-weight:800}" +
      ".bugmega-detail-comment{margin:0 0 10px;color:#33443e;font-size:13px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}.bugmega-detail-comment.empty{color:#7a8883;font-style:italic}" +
      ".bugmega-detail-image{display:block;width:100%;height:190px;object-fit:cover;border:1px solid #d8e1dd;border-radius:8px;margin:0 0 12px;background:#eef5f2}" +
      ".bugmega-detail-file{display:flex;align-items:center;gap:7px;border:1px solid #d8e1dd;border-radius:8px;color:#087c67;padding:9px 10px;margin:0 0 12px;font-size:13px;font-weight:800;text-decoration:none;overflow-wrap:anywhere}" +
      ".bugmega-detail-actions{display:flex;gap:6px;flex-wrap:wrap}.bugmega-detail-actions button{flex:1;min-width:76px}" +
      ".bugmega-panel{position:fixed;right:22px;bottom:78px;width:min(380px,calc(100vw - 32px));max-height:calc(100vh - 110px);overflow:auto;background:#fff;border:1px solid rgba(0,0,0,.14);border-radius:12px;box-shadow:0 22px 70px rgba(0,0,0,.28);padding:16px;display:none}" +
      ".bugmega-panel.active{display:block}" +
      ".bugmega-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}" +
      ".bugmega-head strong{font-size:15px;color:#10201c}" +
      ".bugmega-close{border:0;background:transparent;font-size:24px;line-height:1;cursor:pointer;color:#5d6b66}" +
      ".bugmega-field{display:block;margin:10px 0}.bugmega-field span{display:block;font-size:12px;font-weight:800;color:#52635d;margin-bottom:5px}" +
      ".bugmega-field input,.bugmega-field textarea,.bugmega-field select{width:100%;border:1px solid #cdd9d5;border-radius:7px;padding:8px 9px;font-size:13px;color:#10201c;background:#fff}" +
      ".bugmega-field input[type='file']{padding:6px;font-size:12px}.bugmega-field input[type='file']::file-selector-button{border:0;border-radius:6px;background:#eef5f2;color:#10201c;padding:7px 9px;margin-right:8px;font-weight:800;cursor:pointer}" +
      ".bugmega-field textarea{min-height:92px;resize:vertical}.bugmega-field select{min-height:74px}" +
      ".bugmega-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px}" +
      ".bugmega-primary{display:inline-flex;align-items:center;justify-content:center;gap:5px;border:0;border-radius:7px;background:#08a88a;color:#fff;padding:8px 10px;font-size:13px;font-weight:800;cursor:pointer}" +
      ".bugmega-secondary{display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px solid #cdd9d5;border-radius:7px;background:#fff;color:#10201c;padding:7px 9px;font-size:13px;font-weight:700;cursor:pointer}" +
      ".bugmega-danger{display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px solid #fecaca;border-radius:7px;background:#fff;color:#b91c1c;padding:7px 9px;font-size:13px;font-weight:800;cursor:pointer}" +
      ".bugmega-button-icon{width:14px;height:14px;display:block;flex:0 0 auto;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}" +
      ".bugmega-muted{font-size:12px;color:#64736e;line-height:1.4}.bugmega-status{font-size:12px;margin-top:8px;color:#64736e}.bugmega-status.error{color:#c73636}.bugmega-status.success{color:#087c67}" +
      ".bugmega-preview{width:100%;max-height:180px;object-fit:cover;border:1px solid #d8e1dd;border-radius:8px;background:#eef5f2;margin:8px 0;display:none}" +
      ".bugmega-preview.active{display:block}" +
      ".bugmega-markup{border:1px solid #d8e1dd;border-radius:8px;background:#f8fbfa;padding:9px;margin:10px 0}" +
      ".bugmega-markup-label{display:block;font-size:12px;font-weight:800;color:#52635d;margin-bottom:7px}" +
      ".bugmega-markup-tools{display:flex;align-items:center;gap:5px;flex-wrap:wrap}" +
      ".bugmega-tool-button{display:inline-flex;align-items:center;justify-content:center;gap:4px;border:1px solid #cdd9d5;border-radius:6px;background:#fff;color:#33443e;padding:6px 7px;font-size:12px;font-weight:700;cursor:pointer}" +
      ".bugmega-tool-button.active{border-color:#08a88a;background:#e9f8f4;color:#087c67}" +
      ".bugmega-color{width:30px!important;height:30px;padding:2px!important;border-radius:6px!important;cursor:pointer}" +
      ".bugmega-capture-button{width:100%;margin-top:7px}" +
      ".bugmega-pin-layer{position:absolute;left:0;top:0;z-index:2147482999;pointer-events:none}" +
      ".bugmega-pin{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border:0;padding:0;border-radius:50%;background:#ef4444;color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:900;box-shadow:0 0 0 4px rgba(239,68,68,.18),0 8px 20px rgba(0,0,0,.24);pointer-events:auto;cursor:pointer}" +
      ".bugmega-pin:hover,.bugmega-pin:focus-visible{transform:scale(1.12);outline:2px solid #fff;outline-offset:2px}" +
      ".bugmega-pin.draft{background:#f97316;pointer-events:none}" +
      ".bugmega-drawing-layer{position:absolute;left:0;top:0;z-index:2147482998;pointer-events:none;overflow:visible}" +
      ".bugmega-drawing-layer.active{pointer-events:auto;cursor:crosshair;touch-action:none}" +
      ".bugmega-select-banner{position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:2147483001;background:#10201c;color:#fff;border-radius:999px;padding:10px 14px;font-size:13px;font-weight:800;box-shadow:0 14px 38px rgba(0,0,0,.24);display:none}" +
      ".bugmega-select-banner.active{display:block}" +
      "body.bugmega-selecting,body.bugmega-selecting *{cursor:crosshair!important}";
    document.head.appendChild(style);
  }

  function esc(value) {
    return String(value || "").replace(/[&<>"']/g, function (char) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[char];
    });
  }

  function widgetIcon(name) {
    var paths = {
      back: '<path d="M19 12H5m6 6-6-6 6-6"/>',
      pin: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2"/>',
      edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
      trash: '<path d="M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15M10 10v7m4-7v7"/>',
      save: '<path d="M20 21H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h13l4 4v13a1 1 0 0 1-1 1Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
      close: '<path d="m6 6 12 12M18 6 6 18"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      pencil: '<path d="m4 20 4-1 11-11a2.1 2.1 0 0 0-3-3L5 16Z"/><path d="m14 7 3 3"/>',
      circle: '<circle cx="12" cy="12" r="8"/>',
      rectangle: '<rect x="3" y="5" width="18" height="14" rx="1"/>',
      undo: '<path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 6 6"/>',
      camera: '<path d="M14.5 5 13 3h-2L9.5 5H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z"/><circle cx="12" cy="13" r="4"/>'
    };
    return '<svg class="bugmega-button-icon" viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || "") + '</svg>';
  }

  function closestWidget(target) {
    return target && target.closest && target.closest(".bugmega-widget, .bugmega-panel, .bugmega-select-banner, .bugmega-pin-layer");
  }

  function setStatus(text, type) {
    var status = document.getElementById("bugmegaStatus");
    if (!status) return;
    status.className = "bugmega-status" + (type ? " " + type : "");
    status.textContent = text || "";
  }

  function setPreview(dataURL) {
    var preview = document.getElementById("bugmegaPreview");
    if (!preview) return;
    if (!dataURL) {
      preview.classList.remove("active");
      preview.removeAttribute("src");
      return;
    }
    preview.src = dataURL;
    preview.classList.add("active");
  }

  function memberOptions() {
    var members = state.session && Array.isArray(state.session.members) ? state.session.members : [];
    if (!members.length) return '<option value="">No members available</option>';
    return members.map(function (member) {
      return '<option value="' + esc(member.id) + '">' + esc(member.name || member.username || member.email || "Member") + '</option>';
    }).join("");
  }

  function renderAnnotationList() {
    var list = document.getElementById("bugmegaAnnotationList");
    var count = document.getElementById("bugmegaAnnotationCount");
    if (count) count.textContent = state.pins.length + (state.pins.length === 1 ? " annotation" : " annotations");
    if (!list) return;
    if (!state.pins.length) {
      list.innerHTML = '<p class="bugmega-menu-empty">No annotations on this page yet.</p>';
      return;
    }
    list.innerHTML = state.pins.map(function (pin, index) {
      return '<button class="bugmega-annotation-row" type="button" data-bugmega-pin-index="' + index + '"><span class="bugmega-annotation-number">' + esc(index + 1) + '</span><span>' + esc(pin.title || "Annotation " + (index + 1)) + '</span></button>';
    }).join("");
    Array.prototype.forEach.call(list.querySelectorAll("[data-bugmega-pin-index]"), function (button) {
      button.addEventListener("click", function () {
        showAnnotationDetail(Number(button.getAttribute("data-bugmega-pin-index")));
      });
    });
  }

  function annotationStatusLabel(value) {
    var label = String(value || "Open").replace(/[_-]+/g, " ");
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function annotationDateLabel(value) {
    if (!value) return "";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  function annotationScreenshotURL(value) {
    var raw = String(value || "").trim();
    if (!raw) return "";
    try {
      var parsed = new URL(raw, apiBase);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
    } catch (error) {
      return "";
    }
  }

  function annotationAttachmentHTML(pin) {
    var attachment = Array.isArray(pin.attachments) ? pin.attachments[0] : "";
    var attachmentURL = annotationScreenshotURL(attachment);
    if (!attachmentURL) return "";
    var path = attachmentURL.split("?")[0];
    if (/\.(png|jpe?g|gif|webp)$/i.test(path)) {
      return '<a href="' + esc(attachmentURL) + '" target="_blank" rel="noopener noreferrer"><img class="bugmega-detail-image" src="' + esc(attachmentURL) + '" alt="Annotation attachment"></a>';
    }
    return '<a class="bugmega-detail-file" href="' + esc(attachmentURL) + '" target="_blank" rel="noopener noreferrer">&#128206; Open attachment</a>';
  }

  function showAnnotationList() {
    var listView = document.getElementById("bugmegaListView");
    var detailView = document.getElementById("bugmegaDetailView");
    if (listView) listView.hidden = false;
    if (detailView) {
      detailView.hidden = true;
      detailView.innerHTML = "";
    }
    positionSurface(document.getElementById("bugmegaMenu"));
  }

  function showAnnotationDetail(index) {
    var pin = state.pins[index];
    var listView = document.getElementById("bugmegaListView");
    var detailView = document.getElementById("bugmegaDetailView");
    if (!pin || !listView || !detailView) return;
    var screenshotURL = annotationScreenshotURL(pin.screenshotURL);
    var dateLabel = annotationDateLabel(pin.createdAt);
    listView.hidden = true;
    detailView.hidden = false;
    detailView.innerHTML =
      '<button class="bugmega-detail-back" type="button" id="bugmegaDetailBack">' + widgetIcon("back") + 'Back to annotations</button>' +
      '<div class="bugmega-detail-title"><span class="bugmega-annotation-number">' + esc(index + 1) + '</span><h3>' + esc(pin.title || "Annotation " + (index + 1)) + '</h3></div>' +
      '<div class="bugmega-detail-meta"><span class="bugmega-detail-pill">' + esc(annotationStatusLabel(pin.status)) + '</span>' + (dateLabel ? '<span class="bugmega-detail-pill">' + esc(dateLabel) + '</span>' : '') + '</div>' +
      '<p class="bugmega-detail-comment' + (pin.comment ? '' : ' empty') + '">' + esc(pin.comment || "No details provided.") + '</p>' +
      (screenshotURL ? '<img class="bugmega-detail-image" src="' + esc(screenshotURL) + '" alt="Screenshot for ' + esc(pin.title || "annotation") + '">' : '') +
      annotationAttachmentHTML(pin) +
      '<div class="bugmega-detail-actions"><button class="bugmega-secondary" type="button" id="bugmegaGoToPin">' + widgetIcon("pin") + 'Go to pin</button><button class="bugmega-secondary" type="button" id="bugmegaEditAnnotation">' + widgetIcon("edit") + 'Edit</button><button class="bugmega-danger" type="button" id="bugmegaDeleteAnnotation">' + widgetIcon("trash") + 'Delete</button></div>' +
      '<p class="bugmega-status" id="bugmegaDetailStatus"></p>';
    document.getElementById("bugmegaDetailBack").addEventListener("click", showAnnotationList);
    document.getElementById("bugmegaGoToPin").addEventListener("click", function () { focusAnnotation(index); });
    document.getElementById("bugmegaEditAnnotation").addEventListener("click", function () { showAnnotationEdit(index); });
    document.getElementById("bugmegaDeleteAnnotation").addEventListener("click", function (event) { deleteAnnotation(index, event.currentTarget); });
    var screenshot = detailView.querySelector(".bugmega-detail-image");
    if (screenshot) {
      screenshot.addEventListener("load", function () { positionSurface(document.getElementById("bugmegaMenu")); }, { once: true });
      screenshot.addEventListener("error", function () { positionSurface(document.getElementById("bugmegaMenu")); }, { once: true });
    }
    positionSurface(document.getElementById("bugmegaMenu"));
  }

  function annotationRequest(annotationID, method, values) {
    return fetch(apiBase + "/api/widget/annotations/" + encodeURIComponent(annotationID), {
      method: method,
      mode: "cors",
      credentials: "include",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(Object.assign({ site_key: siteKey, url: window.location.href }, values || {}))
    }).then(async function (response) {
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || "Could not update annotation.");
      return data;
    });
  }

  function showAnnotationEdit(index) {
    var pin = state.pins[index];
    var detailView = document.getElementById("bugmegaDetailView");
    if (!pin || !detailView) return;
    detailView.innerHTML =
      '<button class="bugmega-detail-back" type="button" id="bugmegaEditBack">' + widgetIcon("back") + 'Cancel</button>' +
      '<div class="bugmega-detail-title"><span class="bugmega-annotation-number">' + esc(index + 1) + '</span><h3>Edit annotation</h3></div>' +
      '<form id="bugmegaEditForm">' +
        '<label class="bugmega-field"><span>Title</span><input name="title" maxlength="80" required value="' + esc(pin.title || "") + '"></label>' +
        '<label class="bugmega-field"><span>Details</span><textarea name="comment">' + esc(pin.comment || "") + '</textarea></label>' +
        '<div class="bugmega-detail-actions"><button class="bugmega-primary" type="submit">' + widgetIcon("save") + 'Save</button><button class="bugmega-secondary" type="button" id="bugmegaEditCancel">' + widgetIcon("close") + 'Cancel</button></div>' +
        '<p class="bugmega-status" id="bugmegaEditStatus"></p>' +
      '</form>';
    var cancel = function () { showAnnotationDetail(index); };
    document.getElementById("bugmegaEditBack").addEventListener("click", cancel);
    document.getElementById("bugmegaEditCancel").addEventListener("click", cancel);
    document.getElementById("bugmegaEditForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      var submit = form.querySelector("[type='submit']");
      var status = document.getElementById("bugmegaEditStatus");
      submit.disabled = true;
      if (status) status.textContent = "Saving...";
      try {
        var data = await annotationRequest(pin.id, "PATCH", {
          title: form.elements.title.value.trim(),
          comment: form.elements.comment.value.trim()
        });
        state.pins[index] = normalizePin(Object.assign({}, state.pins[index], data.annotation || {}));
        renderPins();
        renderAnnotationList();
        showAnnotationDetail(index);
      } catch (error) {
        if (status) {
          status.className = "bugmega-status error";
          status.textContent = error.message || "Could not update annotation.";
        }
        submit.disabled = false;
      }
    });
    positionSurface(document.getElementById("bugmegaMenu"));
    detailView.querySelector("input[name='title']")?.focus();
  }

  async function deleteAnnotation(index, button) {
    var pin = state.pins[index];
    if (!pin || !window.confirm("Delete this annotation? This cannot be undone.")) return;
    var status = document.getElementById("bugmegaDetailStatus");
    button.disabled = true;
    if (status) status.textContent = "Deleting...";
    try {
      await annotationRequest(pin.id, "DELETE");
      state.pins.splice(index, 1);
      renderPins();
      renderAnnotationList();
      showAnnotationList();
    } catch (error) {
      button.disabled = false;
      if (status) {
        status.className = "bugmega-status error";
        status.textContent = error.message || "Could not delete annotation.";
      }
    }
  }

  function render() {
    addStyles();
    var user = state.session.user || {};
    var root = document.createElement("div");
    root.className = "bugmega-widget";
    root.innerHTML =
      '<button class="bugmega-feedback-button" type="button" id="bugmegaLauncher" aria-label="Open BugMega annotations" aria-expanded="false"><img src="' + esc(iconURL) + '" alt="BugMega"><span class="bugmega-launch-arrow" aria-hidden="true"></span></button>' +
      '<div class="bugmega-select-banner" id="bugmegaSelectBanner">Click the exact area you want to report</div>' +
      '<section class="bugmega-menu" id="bugmegaMenu" aria-label="Page annotations">' +
        '<div class="bugmega-list-view" id="bugmegaListView">' +
          '<div class="bugmega-menu-head"><strong>Annotations</strong><span class="bugmega-menu-count" id="bugmegaAnnotationCount"></span></div>' +
          '<div class="bugmega-annotation-list" id="bugmegaAnnotationList"></div>' +
          '<button class="bugmega-start-annotation" type="button" id="bugmegaStart">' + widgetIcon("plus") + 'Start annotation</button>' +
        '</div>' +
        '<div class="bugmega-detail" id="bugmegaDetailView" hidden></div>' +
      '</section>' +
      '<section class="bugmega-panel" id="bugmegaPanel" aria-live="polite">' +
        '<div class="bugmega-head"><strong>Send feedback</strong><button class="bugmega-close" type="button" id="bugmegaClose" aria-label="Close">x</button></div>' +
        '<p class="bugmega-muted">Signed in as ' + esc(user.name || user.username || user.email || "BugMega user") + '.</p>' +
        '<div class="bugmega-markup">' +
          '<span class="bugmega-markup-label">Draw on the page</span>' +
          '<div class="bugmega-markup-tools">' +
            '<button class="bugmega-tool-button active" type="button" data-bugmega-draw-tool="pencil">' + widgetIcon("pencil") + 'Pencil</button>' +
            '<button class="bugmega-tool-button" type="button" data-bugmega-draw-tool="circle">' + widgetIcon("circle") + 'Circle</button>' +
            '<button class="bugmega-tool-button" type="button" data-bugmega-draw-tool="rectangle">' + widgetIcon("rectangle") + 'Rectangle</button>' +
            '<input class="bugmega-color" id="bugmegaDrawColor" type="color" value="#ef4444" title="Drawing color" aria-label="Drawing color">' +
            '<button class="bugmega-tool-button" type="button" id="bugmegaDrawUndo">' + widgetIcon("undo") + 'Undo</button>' +
            '<button class="bugmega-tool-button" type="button" id="bugmegaDrawClear">' + widgetIcon("trash") + 'Clear</button>' +
          '</div>' +
          '<button class="bugmega-primary bugmega-capture-button" type="button" id="bugmegaCapture">' + widgetIcon("camera") + 'Capture screenshot</button>' +
        '</div>' +
        '<img class="bugmega-preview" id="bugmegaPreview" alt="Captured section preview">' +
        '<label class="bugmega-field"><span>Title</span><input id="bugmegaTitle" maxlength="80" placeholder="What needs attention?"></label>' +
        '<label class="bugmega-field"><span>Details</span><textarea id="bugmegaComment" placeholder="Describe the issue"></textarea></label>' +
        '<label class="bugmega-field"><span>Attachment (optional, max 1 MB)</span><input id="bugmegaAttachment" type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.zip"></label>' +
        '<label class="bugmega-field"><span>Assign to</span><select id="bugmegaAssignees" multiple>' + memberOptions() + '</select></label>' +
        '<div class="bugmega-toolbar"><button class="bugmega-primary" type="button" id="bugmegaSubmit">Send feedback</button><button class="bugmega-secondary" type="button" id="bugmegaReselect">Move pin</button></div>' +
        '<div class="bugmega-status" id="bugmegaStatus"></div>' +
      '</section>';
    document.body.appendChild(root);
    restoreLauncherPosition();
    var pinLayer = document.createElement("div");
    pinLayer.className = "bugmega-pin-layer";
    pinLayer.id = "bugmegaPinLayer";
    document.body.appendChild(pinLayer);
    var drawingLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    drawingLayer.setAttribute("class", "bugmega-drawing-layer");
    drawingLayer.setAttribute("id", "bugmegaDrawingLayer");
    document.body.appendChild(drawingLayer);
    syncDrawingLayerSize();
    bindDrawingLayer(drawingLayer);
    renderPins();
    renderAnnotationList();

    document.getElementById("bugmegaLauncher").addEventListener("click", toggleMenu);
    bindLauncherDrag();
    document.getElementById("bugmegaStart").addEventListener("click", startSelecting);
    document.getElementById("bugmegaReselect").addEventListener("click", startSelecting);
    document.getElementById("bugmegaClose").addEventListener("click", closePanel);
    document.getElementById("bugmegaSubmit").addEventListener("click", submitFeedback);
    document.getElementById("bugmegaAttachment").addEventListener("change", validateAttachmentSelection);
    document.getElementById("bugmegaCapture").addEventListener("click", captureMarkupScreenshot);
    document.getElementById("bugmegaDrawColor").addEventListener("input", function (event) { drawingState.color = event.currentTarget.value || "#ef4444"; });
    document.getElementById("bugmegaDrawUndo").addEventListener("click", undoDrawing);
    document.getElementById("bugmegaDrawClear").addEventListener("click", clearDrawings);
    document.querySelectorAll("[data-bugmega-draw-tool]").forEach(function (button) {
      button.addEventListener("click", function () { setDrawingTool(button.getAttribute("data-bugmega-draw-tool")); });
    });
    document.addEventListener("click", handleDocumentClick, true);
    window.addEventListener("resize", function () {
      constrainLauncherPosition();
      positionOpenSurfaces();
      syncDrawingLayerSize();
      renderPins();
    });
    window.addEventListener("load", renderPins);
  }

  function launcherPositionKey() {
    return "bugmega-widget-position:" + siteKey;
  }

  function setLauncherPosition(left, top) {
    var root = document.querySelector(".bugmega-widget");
    if (!root) return;
    var width = root.offsetWidth || 62;
    var height = root.offsetHeight || 62;
    root.style.right = "auto";
    root.style.bottom = "auto";
    root.style.left = clamp(left, 8, Math.max(8, window.innerWidth - width - 8)) + "px";
    root.style.top = clamp(top, 8, Math.max(8, window.innerHeight - height - 8)) + "px";
  }

  function saveLauncherPosition() {
    var root = document.querySelector(".bugmega-widget");
    if (!root) return;
    var rect = root.getBoundingClientRect();
    try {
      localStorage.setItem(launcherPositionKey(), JSON.stringify({ left: rect.left, top: rect.top }));
    } catch (error) {}
  }

  function restoreLauncherPosition() {
    try {
      var saved = JSON.parse(localStorage.getItem(launcherPositionKey()) || "null");
      if (saved && Number.isFinite(Number(saved.left)) && Number.isFinite(Number(saved.top))) {
        setLauncherPosition(Number(saved.left), Number(saved.top));
      }
    } catch (error) {}
  }

  function constrainLauncherPosition() {
    var root = document.querySelector(".bugmega-widget");
    if (!root || !root.style.left) return;
    var rect = root.getBoundingClientRect();
    setLauncherPosition(rect.left, rect.top);
  }

  function positionSurface(surface) {
    var launcher = document.getElementById("bugmegaLauncher");
    if (!surface || !launcher || !surface.classList.contains("active")) return;
    var launcherRect = launcher.getBoundingClientRect();
    var padding = 12;
    var gap = 10;
    surface.style.maxHeight = Math.max(120, window.innerHeight - padding * 2) + "px";
    var width = surface.offsetWidth;
    var height = surface.offsetHeight;
    var left = clamp(launcherRect.left + launcherRect.width / 2 - width / 2, padding, Math.max(padding, window.innerWidth - width - padding));
    var roomAbove = Math.max(0, launcherRect.top - padding - gap);
    var roomBelow = Math.max(0, window.innerHeight - launcherRect.bottom - padding - gap);
    var openAbove = height <= roomAbove || (height > roomBelow && roomAbove > roomBelow);
    var availableHeight = openAbove ? roomAbove : roomBelow;
    surface.style.maxHeight = Math.max(120, availableHeight) + "px";
    height = surface.offsetHeight;
    var top = openAbove ? launcherRect.top - height - gap : launcherRect.bottom + gap;
    surface.style.right = "auto";
    surface.style.bottom = "auto";
    surface.style.left = left + "px";
    surface.style.top = clamp(top, padding, Math.max(padding, window.innerHeight - height - padding)) + "px";
  }

  function positionOpenSurfaces() {
    positionSurface(document.getElementById("bugmegaMenu"));
    positionSurface(document.getElementById("bugmegaPanel"));
  }

  function bindLauncherDrag() {
    var launcher = document.getElementById("bugmegaLauncher");
    var root = document.querySelector(".bugmega-widget");
    if (!launcher || !root) return;
    launcher.addEventListener("pointerdown", function (event) {
      if (event.button !== undefined && event.button !== 0) return;
      var rect = root.getBoundingClientRect();
      launcherDrag = {
        pointerID: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
        moved: false
      };
      launcherWasDragged = false;
      launcher.setPointerCapture?.(event.pointerId);
    });
    launcher.addEventListener("pointermove", function (event) {
      if (!launcherDrag || launcherDrag.pointerID !== event.pointerId) return;
      var deltaX = event.clientX - launcherDrag.startX;
      var deltaY = event.clientY - launcherDrag.startY;
      if (!launcherDrag.moved && Math.hypot(deltaX, deltaY) < 4) return;
      launcherDrag.moved = true;
      launcherWasDragged = true;
      event.preventDefault();
      setLauncherPosition(launcherDrag.left + deltaX, launcherDrag.top + deltaY);
      positionOpenSurfaces();
    });
    launcher.addEventListener("pointerup", function (event) {
      if (!launcherDrag || launcherDrag.pointerID !== event.pointerId) return;
      if (launcherDrag.moved) {
        saveLauncherPosition();
        setTimeout(function () { launcherWasDragged = false; }, 250);
      }
      launcherDrag = null;
    });
    launcher.addEventListener("pointercancel", function () {
      launcherDrag = null;
      launcherWasDragged = false;
    });
  }

  function setMenuOpen(open) {
    var menu = document.getElementById("bugmegaMenu");
    var launcher = document.getElementById("bugmegaLauncher");
    if (menu) menu.classList.toggle("active", Boolean(open));
    if (launcher) launcher.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) positionSurface(menu);
  }

  function toggleMenu(event) {
    if (launcherWasDragged) {
      launcherWasDragged = false;
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    var menu = document.getElementById("bugmegaMenu");
    var open = !menu || !menu.classList.contains("active");
    if (open) closePanel();
    renderAnnotationList();
    if (open) showAnnotationList();
    setMenuOpen(open);
  }

  function focusAnnotation(index) {
    var pin = state.pins[index];
    if (!pin) return;
    var normalized = normalizePin(pin);
    var dimensions = pageDimensions();
    var top = normalized.pinY / 100 * dimensions.height - window.innerHeight / 2;
    setMenuOpen(false);
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  function openAnnotationFromPin(index) {
    if (!state.pins[index]) return;
    closePanel();
    renderAnnotationList();
    setMenuOpen(true);
    showAnnotationDetail(index);
    positionSurface(document.getElementById("bugmegaMenu"));
  }

  function syncDrawingLayerSize() {
    var layer = document.getElementById("bugmegaDrawingLayer");
    if (!layer) return;
    var dimensions = pageDimensions();
    layer.setAttribute("width", String(dimensions.width));
    layer.setAttribute("height", String(dimensions.height));
    layer.setAttribute("viewBox", "0 0 " + dimensions.width + " " + dimensions.height);
  }

  function setDrawingActive(active) {
    drawingState.active = Boolean(active);
    var layer = document.getElementById("bugmegaDrawingLayer");
    if (layer) layer.classList.toggle("active", drawingState.active);
  }

  function setDrawingTool(tool) {
    if (!["pencil", "circle", "rectangle"].includes(tool)) return;
    drawingState.tool = tool;
    document.querySelectorAll("[data-bugmega-draw-tool]").forEach(function (button) {
      button.classList.toggle("active", button.getAttribute("data-bugmega-draw-tool") === tool);
    });
    setDrawingActive(true);
    setStatus("Draw on the page, then capture now or send feedback to capture automatically.");
  }

  function invalidateMarkupCapture() {
    state.screenshot = "";
    state.captureError = "";
    setPreview("");
    setStatus("Drawing changed. Capture now or send feedback to capture automatically.");
  }

  function drawingElement(name) {
    return document.createElementNS("http://www.w3.org/2000/svg", name);
  }

  function bindDrawingLayer(layer) {
    layer.addEventListener("pointerdown", function (event) {
      if (!drawingState.active || !state.point || (event.button !== undefined && event.button !== 0)) return;
      event.preventDefault();
      event.stopPropagation();
      syncDrawingLayerSize();
      drawingState.drawing = true;
      drawingState.startX = event.pageX;
      drawingState.startY = event.pageY;
      drawingState.moved = false;
      var shape;
      if (drawingState.tool === "pencil") {
        shape = drawingElement("path");
        shape.setAttribute("d", "M " + event.pageX + " " + event.pageY);
        shape.setAttribute("fill", "none");
        shape.setAttribute("stroke-linecap", "round");
        shape.setAttribute("stroke-linejoin", "round");
      } else if (drawingState.tool === "circle") {
        shape = drawingElement("circle");
        shape.setAttribute("cx", String(event.pageX));
        shape.setAttribute("cy", String(event.pageY));
        shape.setAttribute("r", "0");
        shape.setAttribute("fill", "none");
      } else {
        shape = drawingElement("rect");
        shape.setAttribute("x", String(event.pageX));
        shape.setAttribute("y", String(event.pageY));
        shape.setAttribute("width", "0");
        shape.setAttribute("height", "0");
        shape.setAttribute("fill", "none");
      }
      shape.setAttribute("stroke", drawingState.color);
      shape.setAttribute("stroke-width", "3");
      shape.setAttribute("vector-effect", "non-scaling-stroke");
      layer.appendChild(shape);
      drawingState.current = shape;
      layer.setPointerCapture?.(event.pointerId);
      invalidateMarkupCapture();
    });
    layer.addEventListener("pointermove", function (event) {
      if (!drawingState.drawing || !drawingState.current) return;
      event.preventDefault();
      var deltaX = event.pageX - drawingState.startX;
      var deltaY = event.pageY - drawingState.startY;
      if (Math.abs(deltaX) + Math.abs(deltaY) > 2) drawingState.moved = true;
      if (drawingState.tool === "pencil") {
        drawingState.current.setAttribute("d", drawingState.current.getAttribute("d") + " L " + event.pageX + " " + event.pageY);
      } else if (drawingState.tool === "circle") {
        drawingState.current.setAttribute("r", String(Math.hypot(deltaX, deltaY)));
      } else {
        drawingState.current.setAttribute("x", String(Math.min(drawingState.startX, event.pageX)));
        drawingState.current.setAttribute("y", String(Math.min(drawingState.startY, event.pageY)));
        drawingState.current.setAttribute("width", String(Math.abs(deltaX)));
        drawingState.current.setAttribute("height", String(Math.abs(deltaY)));
      }
    });
    var finishDrawing = function () {
      if (!drawingState.drawing) return;
      if (drawingState.current) {
        if (drawingState.moved) drawingState.elements.push(drawingState.current);
        else drawingState.current.remove();
      }
      drawingState.drawing = false;
      drawingState.current = null;
    };
    layer.addEventListener("pointerup", finishDrawing);
    layer.addEventListener("pointercancel", finishDrawing);
  }

  function undoDrawing() {
    var shape = drawingState.elements.pop();
    if (shape) shape.remove();
    setDrawingActive(true);
    invalidateMarkupCapture();
  }

  function clearDrawings() {
    resetDrawings();
    setDrawingActive(true);
    invalidateMarkupCapture();
  }

  function resetDrawings() {
    var layer = document.getElementById("bugmegaDrawingLayer");
    if (layer) layer.replaceChildren();
    drawingState.drawing = false;
    drawingState.current = null;
    drawingState.elements = [];
    setDrawingActive(false);
  }

  async function captureMarkupScreenshot(event, options) {
    options = options || {};
    var button = event && event.currentTarget ? event.currentTarget : document.getElementById("bugmegaCapture");
    if (!state.point) {
      setStatus("Place an annotation pin first.", "error");
      if (options.throwOnError) throw new Error("Place an annotation pin first.");
      return false;
    }
    if (button) {
      button.disabled = true;
      button.innerHTML = widgetIcon("camera") + "Capturing...";
    }
    setDrawingActive(false);
    setStatus(options.automatic ? "Capturing the screenshot before sending..." : "Capturing the marked section...");
    try {
      state.screenshot = await captureSection(state.point);
      state.captureError = "";
      setPreview(state.screenshot);
      setStatus("Screenshot captured with your markup.", "success");
      requestAnimationFrame(function () { positionSurface(document.getElementById("bugmegaPanel")); });
      return true;
    } catch (error) {
      state.screenshot = "";
      state.captureError = error && error.message ? error.message : "Could not capture this page.";
      setPreview("");
      setDrawingActive(true);
      setStatus("Screenshot was not available. You can adjust the markup and try again.", "error");
      if (options.throwOnError) throw new Error(state.captureError);
      return false;
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = widgetIcon("camera") + "Capture screenshot";
      }
    }
  }

  function pageDimensions() {
    return {
      width: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0, window.innerWidth),
      height: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, window.innerHeight)
    };
  }

  function normalizePin(raw) {
    raw = raw || {};
    var dimensions = pageDimensions();
    var pinX = Number(raw.pin_x != null ? raw.pin_x : raw.pinX);
    var pinY = Number(raw.pin_y != null ? raw.pin_y : raw.pinY);
    if (!Number.isFinite(pinX) && Number.isFinite(Number(raw.pageX))) pinX = Number(raw.pageX) / Math.max(1, dimensions.width) * 100;
    if (!Number.isFinite(pinY) && Number.isFinite(Number(raw.pageY))) pinY = Number(raw.pageY) / Math.max(1, dimensions.height) * 100;
    return {
      id: raw.id || raw.annotation_id || "",
      title: raw.title || "Annotation pin",
      comment: raw.comment || "",
      status: raw.status || "",
      screenshotURL: raw.screenshot_url || raw.screenshotURL || "",
      attachments: Array.isArray(raw.attachments) ? raw.attachments.filter(Boolean) : (raw.attachment_url ? [raw.attachment_url] : []),
      createdAt: raw.created_at || raw.createdAt || "",
      pinX: Math.max(0, Math.min(100, Number.isFinite(pinX) ? pinX : 0)),
      pinY: Math.max(0, Math.min(100, Number.isFinite(pinY) ? pinY : 0)),
      draft: Boolean(raw.draft)
    };
  }

  function renderPins() {
    var layer = document.getElementById("bugmegaPinLayer");
    if (!layer) return;
    var dimensions = pageDimensions();
    var pins = state.pins.slice();
    if (state.draftPin) pins.push(state.draftPin);
    layer.innerHTML = pins.map(function (pin, index) {
      var normalized = normalizePin(pin);
      var left = normalized.pinX / 100 * dimensions.width;
      var top = normalized.pinY / 100 * dimensions.height;
      var attrs = normalized.draft ? '' : ' data-bugmega-page-pin="' + index + '" aria-label="Open annotation ' + esc(index + 1) + ': ' + esc(normalized.title) + '"';
      return '<button class="bugmega-pin' + (normalized.draft ? ' draft' : '') + '" type="button" style="left:' + left + 'px;top:' + top + 'px" title="' + esc(normalized.title) + '"' + attrs + '>' + esc(index + 1) + '</button>';
    }).join("");
    Array.prototype.forEach.call(layer.querySelectorAll("[data-bugmega-page-pin]"), function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        openAnnotationFromPin(Number(button.getAttribute("data-bugmega-page-pin")));
      });
    });
  }

  function startSelecting(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    state.point = null;
    state.draftPin = null;
    state.screenshot = "";
    state.captureError = "";
    setPreview("");
    resetDrawings();
    setMenuOpen(false);
    document.getElementById("bugmegaPanel").classList.remove("active");
    renderPins();
    state.selecting = true;
    document.body.classList.add("bugmega-selecting");
    document.getElementById("bugmegaSelectBanner").classList.add("active");
    setStatus("Click the page where the issue appears.");
  }

  function closePanel() {
    state.selecting = false;
    state.point = null;
    state.draftPin = null;
    state.screenshot = "";
    state.captureError = "";
    setPreview("");
    resetDrawings();
    document.body.classList.remove("bugmega-selecting");
    document.getElementById("bugmegaSelectBanner").classList.remove("active");
    document.getElementById("bugmegaPanel").classList.remove("active");
    setMenuOpen(false);
    renderPins();
  }

  function handleDocumentClick(event) {
    if (!state.selecting) {
      var menu = document.getElementById("bugmegaMenu");
      if (menu && menu.classList.contains("active") && !closestWidget(event.target)) setMenuOpen(false);
      return;
    }
    if (closestWidget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    choosePoint(event);
  }

  function choosePoint(event) {
    state.selecting = false;
    document.body.classList.remove("bugmega-selecting");
    document.getElementById("bugmegaSelectBanner").classList.remove("active");
    var dimensions = pageDimensions();
    state.point = {
      clientX: event.clientX,
      clientY: event.clientY,
      pageX: event.pageX,
      pageY: event.pageY,
      pinX: Math.max(0, Math.min(100, event.pageX / Math.max(1, dimensions.width) * 100)),
      pinY: Math.max(0, Math.min(100, event.pageY / Math.max(1, dimensions.height) * 100)),
      pageWidth: dimensions.width,
      pageHeight: dimensions.height,
      title: "New annotation",
      draft: true
    };
    state.draftPin = state.point;
    renderPins();
    document.getElementById("bugmegaPanel").classList.add("active");
    positionSurface(document.getElementById("bugmegaPanel"));
    setDrawingTool("pencil");
    setStatus("Draw on the page, then capture now or send feedback to capture automatically.");
  }

  function loadHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (html2canvasPromise) return html2canvasPromise;
    html2canvasPromise = new Promise(function (resolve, reject) {
      var loader = document.createElement("script");
      loader.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
      loader.async = true;
      loader.crossOrigin = "anonymous";
      loader.onload = function () {
        if (window.html2canvas) resolve(window.html2canvas);
        else reject(new Error("Capture helper did not load."));
      };
      loader.onerror = function () {
        reject(new Error("Capture helper did not load."));
      };
      document.head.appendChild(loader);
    });
    return html2canvasPromise;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  async function waitForCaptureContent(left, top, width, height) {
    window.dispatchEvent(new Event("scroll"));
    await new Promise(function (resolve) {
      requestAnimationFrame(function () { requestAnimationFrame(resolve); });
    });
    var visibleImages = Array.prototype.filter.call(document.images || [], function (img) {
      var rect = img.getBoundingClientRect();
      return rect.right > left && rect.left < left + width && rect.bottom > top && rect.top < top + height;
    });
    await Promise.all(visibleImages.map(function (img) {
      if (img.complete) return Promise.resolve();
      return new Promise(function (resolve) {
        var timeout = setTimeout(resolve, 1500);
        var done = function () {
          clearTimeout(timeout);
          resolve();
        };
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      });
    }));
  }

  async function captureSection(point) {
    var html2canvas = await loadHtml2Canvas();
    var cropWidth = Math.min(760, window.innerWidth);
    var cropHeight = Math.min(560, window.innerHeight);
    var dimensions = pageDimensions();
    var documentLeft = clamp(point.pageX - cropWidth / 2, 0, Math.max(0, dimensions.width - cropWidth));
    var documentTop = clamp(point.pageY - cropHeight / 2, 0, Math.max(0, dimensions.height - cropHeight));
    await waitForCaptureContent(documentLeft - window.scrollX, documentTop - window.scrollY, cropWidth, cropHeight);
    var scrollX = window.scrollX;
    var scrollY = window.scrollY;
    var root = document.querySelector(".bugmega-widget");
    var previousVisibility = root ? root.style.visibility : "";
    if (root) root.style.visibility = "hidden";
    await new Promise(function (resolve) { requestAnimationFrame(resolve); });
    try {
      var canvas = await html2canvas(document.documentElement, {
        backgroundColor: getComputedStyle(document.body || document.documentElement).backgroundColor || "#ffffff",
        useCORS: true,
        allowTaint: false,
        logging: false,
        scale: Math.min(2, window.devicePixelRatio || 1),
        x: documentLeft,
        y: documentTop,
        width: cropWidth,
        height: cropHeight,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        scrollX: scrollX,
        scrollY: scrollY
      });
      return canvas.toDataURL("image/png", 0.92);
    } finally {
      if (root) root.style.visibility = previousVisibility;
    }
  }

  function selectedAssignees() {
    var select = document.getElementById("bugmegaAssignees");
    if (!select) return [];
    return Array.prototype.slice.call(select.selectedOptions || []).map(function (option) {
      return option.value;
    }).filter(Boolean);
  }

  function validateAttachmentSelection(event) {
    var input = event.currentTarget;
    var file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      input.value = "";
      setStatus("Attachment must be 1 MB or smaller.", "error");
      return;
    }
    setStatus(file.name + " is ready to attach.");
  }

  function readAttachmentData(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("Could not read the attachment.")); };
      reader.readAsDataURL(file);
    });
  }

  async function submitFeedback() {
    if (!state.point) {
      startSelecting();
      return;
    }
    var button = document.getElementById("bugmegaSubmit");
    var title = document.getElementById("bugmegaTitle").value.trim();
    var comment = document.getElementById("bugmegaComment").value.trim();
    var attachmentInput = document.getElementById("bugmegaAttachment");
    var attachment = attachmentInput && attachmentInput.files ? attachmentInput.files[0] : null;
    button.disabled = true;
    button.textContent = state.screenshot ? "Sending..." : "Capturing...";
    setStatus(state.screenshot ? "Sending feedback..." : "Capturing the screenshot before sending...");
    try {
      if (attachment && attachment.size > 1024 * 1024) throw new Error("Attachment must be 1 MB or smaller.");
      if (!state.screenshot) {
        await captureMarkupScreenshot(null, { automatic: true, throwOnError: true });
        button.textContent = "Sending...";
        setStatus("Sending feedback...");
      }
      var attachmentData = attachment ? await readAttachmentData(attachment) : "";
      var response = await fetch(apiBase + "/api/widget/annotations", {
        method: "POST",
        mode: "cors",
        credentials: "include",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          site_key: siteKey,
          url: window.location.href,
          title: title,
          comment: comment,
          assignee_ids: selectedAssignees(),
          screenshot_data: state.screenshot || "",
          attachment_name: attachment ? attachment.name : "",
          attachment_data: attachmentData,
          capture_error: state.captureError || "",
          pin_x: state.point.pinX,
          pin_y: state.point.pinY,
          page_width: state.point.pageWidth,
          page_height: state.point.pageHeight,
          viewport_width: window.innerWidth,
          viewport_height: window.innerHeight
        })
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || "Could not send feedback.");
      if (state.draftPin) {
        state.pins.push({
          id: data.annotation_id || "",
          title: title || comment || "Website feedback",
          comment: comment,
          status: data.status || "todo",
          screenshotURL: data.screenshot_url || "",
          attachments: data.attachment_url ? [data.attachment_url] : [],
          createdAt: data.created_at || new Date().toISOString(),
          pinX: state.draftPin.pinX,
          pinY: state.draftPin.pinY
        });
      }
      state.point = null;
      state.draftPin = null;
      resetDrawings();
      renderPins();
      renderAnnotationList();
      setStatus("Feedback sent. Thank you.", "success");
      document.getElementById("bugmegaTitle").value = "";
      document.getElementById("bugmegaComment").value = "";
      if (attachmentInput) attachmentInput.value = "";
      setTimeout(closePanel, 1200);
    } catch (error) {
      setStatus(error && error.message ? error.message : "Could not send feedback.", "error");
    } finally {
      button.disabled = false;
      button.textContent = "Send feedback";
    }
  }

  async function loadSession() {
    try {
      var response = await fetch(apiBase + "/api/widget/session?site_key=" + encodeURIComponent(siteKey) + "&url=" + encodeURIComponent(window.location.href), {
        method: "GET",
        mode: "cors",
        credentials: "include"
      });
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  function start() {
    loadSession().then(function (session) {
      if (!session || !session.user) return;
      state.session = session;
      state.pins = Array.isArray(session.pins) ? session.pins.map(normalizePin) : [];
      render();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
