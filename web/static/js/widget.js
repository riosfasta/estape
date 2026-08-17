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
  var state = {
    selecting: false,
    point: null,
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
      ".bugmega-feedback-button{display:inline-flex;align-items:center;gap:8px;border:0;border-radius:999px;background:#08a88a;color:#fff;padding:9px 15px 9px 10px;font-weight:800;font-size:14px;box-shadow:0 16px 44px rgba(0,0,0,.22);cursor:pointer}" +
      ".bugmega-feedback-button img{width:28px;height:28px;object-fit:contain;display:block}" +
      ".bugmega-panel{position:fixed;right:22px;bottom:78px;width:min(380px,calc(100vw - 32px));max-height:calc(100vh - 110px);overflow:auto;background:#fff;border:1px solid rgba(0,0,0,.14);border-radius:12px;box-shadow:0 22px 70px rgba(0,0,0,.28);padding:16px;display:none}" +
      ".bugmega-panel.active{display:block}" +
      ".bugmega-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}" +
      ".bugmega-head strong{font-size:17px;color:#10201c}" +
      ".bugmega-close{border:0;background:transparent;font-size:24px;line-height:1;cursor:pointer;color:#5d6b66}" +
      ".bugmega-field{display:block;margin:10px 0}.bugmega-field span{display:block;font-size:12px;font-weight:800;color:#52635d;margin-bottom:5px}" +
      ".bugmega-field input,.bugmega-field textarea,.bugmega-field select{width:100%;border:1px solid #cdd9d5;border-radius:8px;padding:9px 10px;font-size:14px;color:#10201c;background:#fff}" +
      ".bugmega-field textarea{min-height:92px;resize:vertical}.bugmega-field select{min-height:74px}" +
      ".bugmega-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px}" +
      ".bugmega-primary{border:0;border-radius:8px;background:#08a88a;color:#fff;padding:10px 14px;font-weight:800;cursor:pointer}" +
      ".bugmega-secondary{border:1px solid #cdd9d5;border-radius:8px;background:#fff;color:#10201c;padding:9px 12px;font-weight:700;cursor:pointer}" +
      ".bugmega-muted{font-size:12px;color:#64736e;line-height:1.4}.bugmega-status{font-size:12px;margin-top:8px;color:#64736e}.bugmega-status.error{color:#c73636}.bugmega-status.success{color:#087c67}" +
      ".bugmega-preview{width:100%;max-height:180px;object-fit:cover;border:1px solid #d8e1dd;border-radius:8px;background:#eef5f2;margin:8px 0;display:none}" +
      ".bugmega-preview.active{display:block}" +
      ".bugmega-pin{position:fixed;z-index:2147482999;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:#ef4444;color:#fff;display:none;align-items:center;justify-content:center;font-size:14px;font-weight:900;box-shadow:0 0 0 4px rgba(239,68,68,.18),0 8px 20px rgba(0,0,0,.24);pointer-events:none}" +
      ".bugmega-pin.active{display:flex}" +
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

  function closestWidget(target) {
    return target && target.closest && target.closest(".bugmega-widget, .bugmega-panel, .bugmega-select-banner");
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

  function render() {
    addStyles();
    var user = state.session.user || {};
    var root = document.createElement("div");
    root.className = "bugmega-widget";
    root.innerHTML =
      '<button class="bugmega-feedback-button" type="button" id="bugmegaStart"><img src="' + esc(iconURL) + '" alt="" aria-hidden="true"><span>Feedback</span></button>' +
      '<div class="bugmega-pin" id="bugmegaPin">1</div>' +
      '<div class="bugmega-select-banner" id="bugmegaSelectBanner">Click the exact area you want to report</div>' +
      '<section class="bugmega-panel" id="bugmegaPanel" aria-live="polite">' +
        '<div class="bugmega-head"><strong>Send feedback</strong><button class="bugmega-close" type="button" id="bugmegaClose" aria-label="Close">x</button></div>' +
        '<p class="bugmega-muted">Signed in as ' + esc(user.name || user.username || user.email || "BugMega user") + '.</p>' +
        '<img class="bugmega-preview" id="bugmegaPreview" alt="Captured section preview">' +
        '<label class="bugmega-field"><span>Title</span><input id="bugmegaTitle" maxlength="80" placeholder="What needs attention?"></label>' +
        '<label class="bugmega-field"><span>Details</span><textarea id="bugmegaComment" placeholder="Describe the issue"></textarea></label>' +
        '<label class="bugmega-field"><span>Assign to</span><select id="bugmegaAssignees" multiple>' + memberOptions() + '</select></label>' +
        '<div class="bugmega-toolbar"><button class="bugmega-primary" type="button" id="bugmegaSubmit">Send feedback</button><button class="bugmega-secondary" type="button" id="bugmegaReselect">Move pin</button></div>' +
        '<div class="bugmega-status" id="bugmegaStatus"></div>' +
      '</section>';
    document.body.appendChild(root);

    document.getElementById("bugmegaStart").addEventListener("click", startSelecting);
    document.getElementById("bugmegaReselect").addEventListener("click", startSelecting);
    document.getElementById("bugmegaClose").addEventListener("click", closePanel);
    document.getElementById("bugmegaSubmit").addEventListener("click", submitFeedback);
    document.addEventListener("click", handleDocumentClick, true);
  }

  function startSelecting(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    state.selecting = true;
    document.body.classList.add("bugmega-selecting");
    document.getElementById("bugmegaSelectBanner").classList.add("active");
    setStatus("Click the page where the issue appears.");
  }

  function closePanel() {
    state.selecting = false;
    document.body.classList.remove("bugmega-selecting");
    document.getElementById("bugmegaSelectBanner").classList.remove("active");
    document.getElementById("bugmegaPanel").classList.remove("active");
  }

  function handleDocumentClick(event) {
    if (!state.selecting) return;
    if (closestWidget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    choosePoint(event);
  }

  function choosePoint(event) {
    state.selecting = false;
    document.body.classList.remove("bugmega-selecting");
    document.getElementById("bugmegaSelectBanner").classList.remove("active");
    var pageWidth = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0, window.innerWidth);
    var pageHeight = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, window.innerHeight);
    state.point = {
      clientX: event.clientX,
      clientY: event.clientY,
      pageX: event.pageX,
      pageY: event.pageY,
      pinX: Math.max(0, Math.min(100, event.pageX / Math.max(1, pageWidth) * 100)),
      pinY: Math.max(0, Math.min(100, event.pageY / Math.max(1, pageHeight) * 100)),
      pageWidth: pageWidth,
      pageHeight: pageHeight
    };
    var pin = document.getElementById("bugmegaPin");
    pin.style.left = event.clientX + "px";
    pin.style.top = event.clientY + "px";
    pin.classList.add("active");
    document.getElementById("bugmegaPanel").classList.add("active");
    setStatus("Capturing the section around the pin...");
    captureSection(state.point).then(function (dataURL) {
      state.screenshot = dataURL || "";
      state.captureError = "";
      setPreview(state.screenshot);
      setStatus(state.screenshot ? "Section captured automatically." : "Pin saved. Screenshot was not available on this page.");
      document.getElementById("bugmegaTitle").focus();
    }).catch(function (error) {
      state.screenshot = "";
      state.captureError = error && error.message ? error.message : "Could not capture this page.";
      setPreview("");
      setStatus("Pin saved. Screenshot was not available on this page.", "error");
      document.getElementById("bugmegaTitle").focus();
    });
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

  async function captureSection(point) {
    var html2canvas = await loadHtml2Canvas();
    var cropWidth = Math.min(760, window.innerWidth);
    var cropHeight = Math.min(560, window.innerHeight);
    var left = clamp(point.clientX - cropWidth / 2, 0, Math.max(0, window.innerWidth - cropWidth));
    var top = clamp(point.clientY - cropHeight / 2, 0, Math.max(0, window.innerHeight - cropHeight));
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
        x: window.scrollX + left,
        y: window.scrollY + top,
        width: cropWidth,
        height: cropHeight,
        windowWidth: Math.max(document.documentElement.scrollWidth, window.innerWidth),
        windowHeight: Math.max(document.documentElement.scrollHeight, window.innerHeight),
        scrollX: -window.scrollX,
        scrollY: -window.scrollY
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

  async function submitFeedback() {
    if (!state.point) {
      startSelecting();
      return;
    }
    var button = document.getElementById("bugmegaSubmit");
    var title = document.getElementById("bugmegaTitle").value.trim();
    var comment = document.getElementById("bugmegaComment").value.trim();
    button.disabled = true;
    button.textContent = "Sending...";
    setStatus("Sending feedback...");
    try {
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
      setStatus("Feedback sent. Thank you.", "success");
      document.getElementById("bugmegaTitle").value = "";
      document.getElementById("bugmegaComment").value = "";
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
      var response = await fetch(apiBase + "/api/widget/session?site_key=" + encodeURIComponent(siteKey), {
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
      render();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
