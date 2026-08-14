package handlers

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const widgetScriptBody = `(function () {
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
  var siteKey = script.getAttribute("data-project") || script.getAttribute("data-site") || script.getAttribute("data-key") || scriptURL.searchParams.get("key") || "";
  if (!siteKey) {
    console.warn("BugMega widget: missing data-project key.");
    return;
  }

  var html2canvasPromise = null;
  var state = {
    selecting: false,
    point: null,
    screenshot: "",
    captureError: ""
  };

  function addStyles() {
    if (document.getElementById("bugmega-widget-styles")) return;
    var style = document.createElement("style");
    style.id = "bugmega-widget-styles";
    style.textContent =
      ".bugmega-widget *{box-sizing:border-box;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
      ".bugmega-widget{position:fixed;right:22px;bottom:22px;z-index:2147483000;color:#10201c}" +
      ".bugmega-feedback-button{border:0;border-radius:999px;background:#08a88a;color:#fff;padding:12px 16px;font-weight:800;font-size:14px;box-shadow:0 16px 44px rgba(0,0,0,.22);cursor:pointer}" +
      ".bugmega-panel{position:fixed;right:22px;bottom:78px;width:min(380px,calc(100vw - 32px));max-height:calc(100vh - 110px);overflow:auto;background:#fff;border:1px solid rgba(0,0,0,.14);border-radius:12px;box-shadow:0 22px 70px rgba(0,0,0,.28);padding:16px;display:none}" +
      ".bugmega-panel.active{display:block}" +
      ".bugmega-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}" +
      ".bugmega-head strong{font-size:17px;color:#10201c}" +
      ".bugmega-close{border:0;background:transparent;font-size:24px;line-height:1;cursor:pointer;color:#5d6b66}" +
      ".bugmega-field{display:block;margin:10px 0}.bugmega-field span{display:block;font-size:12px;font-weight:800;color:#52635d;margin-bottom:5px}" +
      ".bugmega-field input,.bugmega-field textarea{width:100%;border:1px solid #cdd9d5;border-radius:8px;padding:9px 10px;font-size:14px;color:#10201c;background:#fff}" +
      ".bugmega-field textarea{min-height:92px;resize:vertical}" +
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

  function render() {
    addStyles();
    var root = document.createElement("div");
    root.className = "bugmega-widget";
    root.innerHTML =
      '<button class="bugmega-feedback-button" type="button" id="bugmegaStart">Website feedback</button>' +
      '<div class="bugmega-pin" id="bugmegaPin">1</div>' +
      '<div class="bugmega-select-banner" id="bugmegaSelectBanner">Click the exact area you want to report</div>' +
      '<section class="bugmega-panel" id="bugmegaPanel" aria-live="polite">' +
        '<div class="bugmega-head"><strong>Send feedback</strong><button class="bugmega-close" type="button" id="bugmegaClose" aria-label="Close">×</button></div>' +
        '<p class="bugmega-muted">Click a spot on the page, then add a short title and details.</p>' +
        '<img class="bugmega-preview" id="bugmegaPreview" alt="Captured section preview">' +
        '<label class="bugmega-field"><span>Title</span><input id="bugmegaTitle" maxlength="80" placeholder="What needs attention?"></label>' +
        '<label class="bugmega-field"><span>Details</span><textarea id="bugmegaComment" placeholder="Describe the issue"></textarea></label>' +
        '<label class="bugmega-field"><span>Your name, optional</span><input id="bugmegaName" autocomplete="name"></label>' +
        '<label class="bugmega-field"><span>Your email, optional</span><input id="bugmegaEmail" type="email" autocomplete="email"></label>' +
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

  async function submitFeedback() {
    if (!state.point) {
      startSelecting();
      return;
    }
    var button = document.getElementById("bugmegaSubmit");
    var title = document.getElementById("bugmegaTitle").value.trim();
    var comment = document.getElementById("bugmegaComment").value.trim();
    var reporterName = document.getElementById("bugmegaName").value.trim();
    var reporterEmail = document.getElementById("bugmegaEmail").value.trim();
    button.disabled = true;
    button.textContent = "Sending...";
    setStatus("Sending feedback...");
    try {
      var response = await fetch(apiBase + "/api/widget/annotations", {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          site_key: siteKey,
          url: window.location.href,
          title: title,
          comment: comment,
          reporter_name: reporterName,
          reporter_email: reporterEmail,
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();`

func (s *Server) widgetScript(c *gin.Context) {
	c.Header("Content-Type", "application/javascript; charset=utf-8")
	c.Header("Cache-Control", "public, max-age=300")
	c.Header("Access-Control-Allow-Origin", "*")
	c.String(http.StatusOK, widgetScriptBody)
}

func (s *Server) widgetOptions(c *gin.Context) {
	s.setWidgetCORS(c)
	c.Status(http.StatusNoContent)
}

func (s *Server) createWidgetAnnotation(c *gin.Context) {
	s.setWidgetCORS(c)
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<20)
	var req struct {
		SiteKey        string   `json:"site_key"`
		URL            string   `json:"url"`
		Title          string   `json:"title"`
		Comment        string   `json:"comment"`
		ReporterName   string   `json:"reporter_name"`
		ReporterEmail  string   `json:"reporter_email"`
		ScreenshotData string   `json:"screenshot_data"`
		CaptureError   string   `json:"capture_error"`
		PinX           *float64 `json:"pin_x"`
		PinY           *float64 `json:"pin_y"`
		PageWidth      int      `json:"page_width"`
		PageHeight     int      `json:"page_height"`
		ViewportWidth  int      `json:"viewport_width"`
		ViewportHeight int      `json:"viewport_height"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid feedback body"})
		return
	}
	siteKey := strings.TrimSpace(req.SiteKey)
	if siteKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "widget key is required"})
		return
	}
	var site models.ClientWebsite
	if err := s.store.C("client_websites").FindOne(c.Request.Context(), bson.M{"widget_key": siteKey}).Decode(&site); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "website widget was not found"})
		return
	}
	if !widgetOriginAllowed(site.URL, c.GetHeader("Origin")) {
		c.JSON(http.StatusForbidden, gin.H{"error": "this website is not allowed to submit feedback for this domain"})
		return
	}
	if _, _, membership := s.teamMembership(c.Request.Context(), site.TeamID); membership != "active" && membership != "trialing" {
		c.JSON(http.StatusPaymentRequired, gin.H{"error": "membership required", "code": "membership_required"})
		return
	}
	pageURL := strings.TrimSpace(req.URL)
	if pageURL == "" {
		pageURL = strings.TrimSpace(site.URL)
	}
	if !strings.HasPrefix(strings.ToLower(pageURL), "https://") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "annotation URL must start with https://"})
		return
	}
	if req.PinX == nil || req.PinY == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pin position is required"})
		return
	}
	title := normalizeClientTaskTitle(req.Title)
	comment := normalizeClientTaskContent(req.Comment)
	reporter := widgetReporterLine(req.ReporterName, req.ReporterEmail)
	if reporter != "" {
		if comment != "" {
			comment += "\n\n"
		}
		comment += reporter
	}
	if strings.TrimSpace(req.CaptureError) != "" && strings.TrimSpace(req.ScreenshotData) == "" {
		if comment != "" {
			comment += "\n\n"
		}
		comment += "Capture note: " + normalizeClientTaskContent(req.CaptureError)
	}
	if title == "" {
		title = normalizeClientTaskTitle(firstNonEmpty(req.Comment, "Website feedback"))
	}
	if comment == "" {
		comment = "Submitted from the website feedback widget."
	}
	screenshotURL := ""
	if strings.TrimSpace(req.ScreenshotData) != "" {
		url, err := s.saveWidgetScreenshot(site.CreatedBy, req.ScreenshotData)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		screenshotURL = url
	}
	tab, err := s.ensureWidgetTaskBoard(c.Request.Context(), site)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not prepare task board"})
		return
	}
	statuses := normalizeClientTaskStatuses(tab.Statuses)
	status := "todo"
	if len(statuses) > 0 {
		status = statuses[0]
	}
	x := clampFloat(*req.PinX, 0, 100)
	y := clampFloat(*req.PinY, 0, 100)
	pageWidth := normalizeAnnotationPageDimension(req.PageWidth, 320, 8000)
	if pageWidth == 0 {
		pageWidth = normalizeAnnotationPageDimension(req.ViewportWidth, 320, 8000)
	}
	pageHeight := normalizeAnnotationPageDimension(req.PageHeight, 900, 50000)
	if pageHeight == 0 {
		pageHeight = normalizeAnnotationPageDimension(req.ViewportHeight, 900, 50000)
	}
	now := time.Now()
	annotation := models.ClientTaskAnnotation{
		ID:            primitive.NewObjectID(),
		Title:         title,
		URL:           pageURL,
		Comment:       comment,
		ScreenshotURL: screenshotURL,
		PinX:          &x,
		PinY:          &y,
		PageWidth:     pageWidth,
		PageHeight:    pageHeight,
		Attachments:   []string{},
		AssigneeIDs:   []primitive.ObjectID{},
		Status:        status,
		CreatedBy:     site.CreatedBy,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	task := models.ClientTask{
		ID:            primitive.NewObjectID(),
		ClientID:      site.ClientID,
		WebsiteID:     site.ID,
		TabID:         tab.ID,
		TeamID:        site.TeamID,
		Type:          "annotation",
		Title:         title,
		Content:       "",
		URL:           pageURL,
		Comment:       comment,
		ScreenshotURL: screenshotURL,
		PinX:          &x,
		PinY:          &y,
		PageWidth:     pageWidth,
		PageHeight:    pageHeight,
		Annotations:   []models.ClientTaskAnnotation{annotation},
		Attachments:   []string{},
		Checklist:     []models.ChecklistItem{},
		Blocks:        []models.ClientTaskBlock{},
		AssigneeIDs:   []primitive.ObjectID{},
		Status:        status,
		CreatedBy:     site.CreatedBy,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	if _, err := s.store.C("client_tasks").InsertOne(c.Request.Context(), task); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create feedback task"})
		return
	}
	s.recordClientTaskLog(c.Request.Context(), task, site.CreatedBy, "created_task", "received website widget feedback")
	s.notifyUserIDs(c.Request.Context(), s.clientWebsiteLiveRecipients(c.Request.Context(), site), primitive.NilObjectID, "client_task_updated", "New website feedback submitted: "+task.Title, task.ID)
	s.broadcastClientTaskChanged(c.Request.Context(), task, primitive.NilObjectID, "client_task_created")
	c.JSON(http.StatusCreated, gin.H{"task_id": task.ID.Hex(), "annotation_id": annotation.ID.Hex(), "screenshot_url": screenshotURL})
}

func (s *Server) setWidgetCORS(c *gin.Context) {
	origin := strings.TrimSpace(c.GetHeader("Origin"))
	if origin == "" {
		c.Header("Access-Control-Allow-Origin", "*")
	} else {
		c.Header("Access-Control-Allow-Origin", origin)
		c.Header("Vary", "Origin")
	}
	c.Header("Access-Control-Allow-Methods", "POST, OPTIONS")
	c.Header("Access-Control-Allow-Headers", "Content-Type")
	c.Header("Access-Control-Max-Age", "600")
}

func (s *Server) newClientWebsiteWidgetKey(ctx context.Context) (string, error) {
	for i := 0; i < 6; i++ {
		key, err := randomWidgetKey()
		if err != nil {
			return "", err
		}
		count, err := s.store.C("client_websites").CountDocuments(ctx, bson.M{"widget_key": key})
		if err != nil {
			return "", err
		}
		if count == 0 {
			return key, nil
		}
	}
	return "", errors.New("could not create unique widget key")
}

func (s *Server) ensureClientWebsiteWidgetKey(ctx context.Context, site *models.ClientWebsite) (string, error) {
	if site == nil {
		return "", errors.New("website is required")
	}
	if strings.TrimSpace(site.WidgetKey) != "" {
		return site.WidgetKey, nil
	}
	key, err := s.newClientWebsiteWidgetKey(ctx)
	if err != nil {
		return "", err
	}
	_, err = s.store.C("client_websites").UpdateByID(ctx, site.ID, bson.M{"$set": bson.M{"widget_key": key, "updated_at": time.Now()}})
	if err != nil {
		return "", err
	}
	site.WidgetKey = key
	return key, nil
}

func randomWidgetKey() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func widgetOriginAllowed(siteURL string, origin string) bool {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return true
	}
	originURL, err := url.Parse(origin)
	if err != nil {
		return false
	}
	siteURL = normalizeOptionalURL(siteURL)
	parsedSite, err := url.Parse(siteURL)
	if err != nil || strings.TrimSpace(parsedSite.Host) == "" {
		return false
	}
	return normalizedWidgetHost(originURL.Host) == normalizedWidgetHost(parsedSite.Host)
}

func normalizedWidgetHost(host string) string {
	host = strings.ToLower(strings.TrimSpace(host))
	host = strings.TrimPrefix(host, "www.")
	return host
}

func widgetReporterLine(name string, email string) string {
	name = strings.TrimSpace(name)
	email = strings.TrimSpace(email)
	parts := []string{}
	if name != "" {
		parts = append(parts, "Name: "+name)
	}
	if email != "" {
		parts = append(parts, "Email: "+email)
	}
	if len(parts) == 0 {
		return ""
	}
	return "Reporter - " + strings.Join(parts, ", ")
}

func (s *Server) saveWidgetScreenshot(ownerID primitive.ObjectID, dataURL string) (string, error) {
	if ownerID.IsZero() {
		return "", errors.New("website owner is missing")
	}
	raw := strings.TrimSpace(dataURL)
	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(raw, prefix) {
		return "", errors.New("screenshot must be a PNG data URL")
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(strings.TrimPrefix(raw, prefix)))
	if err != nil {
		return "", errors.New("screenshot could not be decoded")
	}
	if len(decoded) == 0 {
		return "", errors.New("screenshot is empty")
	}
	if len(decoded) > 6<<20 {
		return "", errors.New("screenshot is too large")
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(decoded))
	if err != nil || config.Width <= 0 || config.Height <= 0 {
		return "", errors.New("screenshot is not a valid image")
	}
	name := fmt.Sprintf("%d.png", time.Now().UnixNano())
	relativeDir := filepath.Join(userUploadDir(ownerID), "widget")
	path := filepath.Join(s.cfg.UploadDir, relativeDir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return "", errors.New("could not prepare upload directory")
	}
	if err := os.WriteFile(path, decoded, 0644); err != nil {
		return "", errors.New("could not save screenshot")
	}
	return "/uploads/" + filepath.ToSlash(filepath.Join(relativeDir, name)), nil
}

func (s *Server) ensureWidgetTaskBoard(ctx context.Context, site models.ClientWebsite) (models.ClientTab, error) {
	var tab models.ClientTab
	err := s.store.C("client_tabs").FindOne(
		ctx,
		bson.M{"website_id": site.ID, "type": "task_board"},
		options.FindOne().SetSort(bson.D{{Key: "created_at", Value: 1}}),
	).Decode(&tab)
	if err == nil {
		return tab, nil
	}
	if err != mongo.ErrNoDocuments {
		return models.ClientTab{}, err
	}
	now := time.Now()
	tab = defaultClientTaskBoardTab(site, site.CreatedBy, now)
	if _, err := s.store.C("client_tabs").InsertOne(ctx, tab); err != nil {
		return models.ClientTab{}, err
	}
	s.broadcastClientTabChanged(ctx, tab, site.CreatedBy, "client_tab_created")
	return tab, nil
}
