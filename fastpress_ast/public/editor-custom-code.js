/**
 * FastPress Web Config & Custom Code Manager
 * Global Site Identity (Favicon, Logo, Brand Name & Tagline)
 * + Multi-Scope Code Injector (<head>, <body> Start, Custom CSS, <body> End)
 */
(() => {
  if (window.FastPressCustomCode) return;

  const STYLES = `
    .fp-cc-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(5, 7, 12, 0.85);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      z-index: 999999;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
      box-sizing: border-box;
      animation: fpCcFadeIn 0.18s ease;
    }
    .fp-cc-backdrop.open {
      display: flex;
    }
    @keyframes fpCcFadeIn {
      from { opacity: 0; transform: scale(0.985); }
      to { opacity: 1; transform: scale(1); }
    }
    .fp-cc-card {
      width: 100%;
      max-width: 920px;
      max-height: 94vh;
      background: #0f131c;
      border: 1px solid #232b3b;
      border-radius: 14px;
      box-shadow: 0 25px 60px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.06);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      color: #e5e7eb;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .fp-cc-header {
      padding: 16px 22px;
      background: #141924;
      border-bottom: 1px solid #232b3b;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .fp-cc-title-wrap {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .fp-cc-icon-badge {
      width: 36px;
      height: 36px;
      border-radius: 9px;
      background: rgba(56, 189, 248, 0.12);
      border: 1px solid rgba(56, 189, 248, 0.3);
      color: #38bdf8;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-size: 1.1rem;
    }
    .fp-cc-icon-badge.page-mode {
      background: rgba(168, 85, 247, 0.12);
      border-color: rgba(168, 85, 247, 0.3);
      color: #a855f7;
    }
    .fp-cc-title {
      margin: 0;
      font-size: 1rem;
      font-weight: 700;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .fp-cc-pill {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 2px 8px;
      border-radius: 4px;
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .fp-cc-pill.page-pill {
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
      border-color: rgba(56, 189, 248, 0.35);
      text-transform: none;
      letter-spacing: normal;
    }
    .fp-cc-pill.post-pill {
      background: rgba(245, 158, 11, 0.15);
      color: #f59e0b;
      border-color: rgba(245, 158, 11, 0.35);
      text-transform: none;
      letter-spacing: normal;
    }
    .fp-cc-close-btn {
      background: transparent;
      border: none;
      color: #9ca3af;
      font-size: 1.4rem;
      line-height: 1;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 6px;
      transition: all 0.15s ease;
    }
    .fp-cc-close-btn:hover {
      background: #1f2737;
      color: #ffffff;
    }

    /* Tabs */
    .fp-cc-tabs {
      display: flex;
      background: #0d1017;
      border-bottom: 1px solid #232b3b;
      padding: 0 16px;
      gap: 4px;
      flex-shrink: 0;
      overflow-x: auto;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .fp-cc-tabs::-webkit-scrollbar {
      display: none;
    }
    .fp-cc-tab-btn {
      background: transparent;
      border: none;
      color: #9ca3af;
      font-size: 0.8rem;
      font-weight: 600;
      padding: 12px 14px;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      white-space: nowrap;
      transition: all 0.15s ease;
      flex-shrink: 0;
    }
    .fp-cc-tab-btn:hover {
      color: #d1d5db;
    }
    .fp-cc-tab-btn.active {
      color: #38bdf8;
      border-bottom-color: #38bdf8;
      background: rgba(56, 189, 248, 0.05);
    }
    .fp-cc-tab-btn.highlight.active {
      color: #ff5e3a;
      border-bottom-color: #ff5e3a;
      background: rgba(255, 94, 58, 0.06);
    }

    /* Panes */
    .fp-cc-body {
      flex: 1;
      overflow-y: auto;
      padding: 20px 22px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      background: #0d1017;
    }
    .fp-cc-pane {
      display: none;
      flex-direction: column;
      gap: 12px;
    }
    .fp-cc-pane.active {
      display: flex;
    }
    .fp-cc-desc-box {
      background: #141924;
      border: 1px solid #202736;
      border-radius: 8px;
      padding: 12px 16px;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .fp-cc-desc-text {
      font-size: 0.77rem;
      color: #9ca3af;
      line-height: 1.5;
    }
    .fp-cc-desc-text strong {
      color: #f3f4f6;
    }
    .fp-cc-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 6px;
    }
    .fp-cc-chip {
      font-size: 0.65rem;
      font-weight: 600;
      background: #1f2738;
      color: #cbd5e1;
      padding: 1px 6px;
      border-radius: 3px;
      border: 1px solid rgba(255,255,255,0.06);
    }
    .fp-cc-chip.gtm-highlight {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border-color: rgba(245, 158, 11, 0.35);
    }
    .fp-cc-editor-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .fp-cc-editor-label {
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #9ca3af;
    }
    .fp-cc-editor-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .fp-cc-btn-sm {
      background: #161c28;
      border: 1px solid #273142;
      color: #9ca3af;
      font-size: 0.7rem;
      padding: 4px 10px;
      border-radius: 5px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.12s ease;
    }
    .fp-cc-btn-sm:hover {
      background: #232d3f;
      color: #fff;
    }
    .fp-cc-btn-sm.primary {
      background: rgba(56, 189, 248, 0.12);
      border-color: rgba(56, 189, 248, 0.35);
      color: #38bdf8;
    }
    .fp-cc-btn-sm.primary:hover {
      background: rgba(56, 189, 248, 0.22);
      color: #7dd3fc;
    }
    .fp-cc-btn-sm.accent {
      background: rgba(255, 94, 58, 0.15);
      border-color: rgba(255, 94, 58, 0.35);
      color: #ff7755;
    }
    .fp-cc-btn-sm.accent:hover {
      background: rgba(255, 94, 58, 0.25);
      color: #ffffff;
    }

    /* Textarea Code Area */
    .fp-cc-textarea {
      width: 100%;
      min-height: 280px;
      max-height: 500px;
      background: #080a0f;
      border: 1px solid #242c3c;
      border-radius: 8px;
      color: #e2e8f0;
      font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 0.82rem;
      line-height: 1.6;
      padding: 12px 14px;
      box-sizing: border-box;
      outline: none;
      resize: vertical;
      tab-size: 2;
      white-space: pre;
      overflow-wrap: normal;
      overflow-x: auto;
      transition: border-color 0.15s ease;
    }
    .fp-cc-textarea:focus {
      border-color: #38bdf8;
      box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.25);
    }

    /* WEB CONFIG SPECIFIC STYLES */
    .fp-wc-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    @media (max-width: 768px) {
      .fp-wc-grid {
        grid-template-columns: 1fr;
      }
    }
    .fp-wc-card {
      background: #141824;
      border: 1px solid #232b3d;
      border-radius: 10px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .fp-wc-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding-bottom: 10px;
      border-bottom: 1px solid #1f2738;
    }
    .fp-wc-card-title {
      font-size: 0.84rem;
      font-weight: 700;
      color: #f3f4f6;
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .fp-wc-card-badge {
      font-size: 0.62rem;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      background: #1e2638;
      color: #94a3b8;
    }
    .fp-wc-preview-box {
      border-radius: 8px;
      background: #090c13;
      border: 1px solid #1f2638;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      align-items: center;
      justify-content: center;
      min-height: 110px;
      position: relative;
    }
    /* Checkerboard for transparent image preview */
    .fp-wc-checker {
      background-image: 
        linear-gradient(45deg, #161b26 25%, transparent 25%), 
        linear-gradient(-45deg, #161b26 25%, transparent 25%), 
        linear-gradient(45deg, transparent 75%, #161b26 75%), 
        linear-gradient(-45deg, transparent 75%, #161b26 75%);
      background-size: 16px 16px;
      background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
      background-color: #0b0e14;
    }

    /* Tab simulation mockup for Favicon */
    .fp-wc-browser-tab-mock {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #1e2433;
      border: 1px solid #2d374d;
      border-radius: 7px 7px 0 0;
      padding: 6px 12px;
      max-width: 260px;
      width: 100%;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .fp-wc-tab-icon {
      width: 18px;
      height: 18px;
      object-fit: contain;
      flex-shrink: 0;
      border-radius: 3px;
    }
    .fp-wc-tab-title {
      font-size: 0.72rem;
      color: #e2e8f0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
    }
    .fp-wc-tab-close {
      color: #64748b;
      font-size: 0.75rem;
      cursor: default;
    }

    /* Navbar simulation mockup for Logo */
    .fp-wc-navbar-mock {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      padding: 8px 14px;
      background: rgba(21, 24, 30, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
    }
    .fp-wc-logo-preview-img {
      max-height: 38px;
      max-width: 160px;
      object-fit: contain;
      display: block;
    }
    .fp-wc-fallback-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    /* Inputs and controls inside card */
    .fp-wc-control-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .fp-wc-input-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .fp-wc-text-input {
      flex: 1;
      background: #090c13;
      border: 1px solid #242c3d;
      border-radius: 6px;
      color: #f3f4f6;
      font-size: 0.78rem;
      padding: 7px 10px;
      outline: none;
      transition: border-color 0.15s;
    }
    .fp-wc-text-input:focus {
      border-color: #38bdf8;
    }
    .fp-wc-btn-action {
      background: #1c2333;
      border: 1px solid #2d384d;
      color: #cbd5e1;
      font-size: 0.74rem;
      font-weight: 600;
      padding: 7px 12px;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
      transition: all 0.15s;
    }
    .fp-wc-btn-action:hover {
      background: #273248;
      color: #fff;
    }
    .fp-wc-btn-action.upload {
      background: #ff5e3a;
      border-color: #ff5e3a;
      color: #fff;
    }
    .fp-wc-btn-action.upload:hover {
      background: #e04826;
    }
    .fp-wc-field-desc {
      font-size: 0.7rem;
      color: #94a3b8;
      line-height: 1.4;
    }

    /* Media Library Mini Picker */
    .fp-wc-media-picker-panel {
      display: none;
      background: #0a0d14;
      border: 1px solid #242c3d;
      border-radius: 8px;
      padding: 12px;
      margin-top: 6px;
      flex-direction: column;
      gap: 10px;
      max-height: 220px;
    }
    .fp-wc-media-picker-panel.open {
      display: flex;
    }
    .fp-wc-media-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
      gap: 8px;
      overflow-y: auto;
      max-height: 150px;
      padding: 2px;
    }
    .fp-wc-media-thumb {
      width: 100%;
      height: 60px;
      object-fit: cover;
      border-radius: 4px;
      border: 2px solid transparent;
      cursor: pointer;
      background: #141924;
      transition: all 0.15s;
    }
    .fp-wc-media-thumb:hover {
      border-color: #38bdf8;
      transform: scale(1.04);
    }

    /* Footer */
    .fp-cc-footer {
      padding: 14px 22px;
      background: #141924;
      border-top: 1px solid #232b3b;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .fp-cc-footer-note {
      font-size: 0.74rem;
      color: #9ca3af;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .fp-cc-dot-live {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 6px rgba(16, 185, 129, 0.7);
    }
    .fp-cc-footer-buttons {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .fp-cc-btn-cancel {
      background: #1c2331;
      border: 1px solid #2a3547;
      color: #d1d5db;
      font-size: 0.8rem;
      font-weight: 600;
      padding: 7px 15px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .fp-cc-btn-cancel:hover {
      background: #283347;
      color: #fff;
    }
    .fp-cc-btn-save {
      background: #ff5e3a;
      border: none;
      color: #ffffff;
      font-size: 0.8rem;
      font-weight: 700;
      padding: 8px 20px;
      border-radius: 6px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(255, 94, 58, 0.35);
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
    }
    .fp-cc-btn-save:hover {
      background: #e04826;
    }
    .fp-cc-btn-save:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    /* THEMES SPECIFIC STYLES */
    .fp-themes-status-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #141924;
      border: 1px solid #232b3d;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 16px;
    }
    .fp-themes-status-left {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.88rem;
      color: #94a3b8;
    }
    .fp-themes-pulse {
      width: 9px;
      height: 9px;
      background: #22c55e;
      border-radius: 50%;
      box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.25);
    }
    .fp-active-theme-name {
      color: #f3f4f6;
      font-weight: 700;
      text-transform: capitalize;
    }
    .fp-themes-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 18px;
    }
    .fp-theme-card {
      background: #141824;
      border: 1px solid #232b3d;
      border-radius: 10px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transition: all 0.2s ease;
      position: relative;
    }
    .fp-theme-card:hover {
      border-color: #3b4863;
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.25);
    }
    .fp-theme-card.is-active {
      border-color: #22c55e;
      box-shadow: 0 0 0 1px #22c55e, 0 8px 24px rgba(34, 197, 94, 0.15);
    }
    .fp-theme-thumb-wrap {
      width: 100%;
      height: 160px;
      background: #090c13;
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      border-bottom: 1px solid #1f2738;
    }
    .fp-theme-thumb-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top center;
      transition: transform 0.3s ease;
    }
    .fp-theme-card:hover .fp-theme-thumb-img {
      transform: scale(1.04);
    }
    .fp-theme-active-tag {
      position: absolute;
      top: 10px;
      right: 10px;
      background: #22c55e;
      color: #ffffff;
      font-size: 0.68rem;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      z-index: 2;
    }
    .fp-theme-body {
      padding: 16px;
      display: flex;
      flex-direction: column;
      flex: 1;
      gap: 10px;
    }
    .fp-theme-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .fp-theme-name {
      font-size: 1rem;
      font-weight: 700;
      color: #f3f4f6;
    }
    .fp-theme-version {
      font-size: 0.68rem;
      color: #64748b;
      background: #1b2130;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .fp-theme-desc {
      font-size: 0.8rem;
      color: #94a3b8;
      line-height: 1.5;
      margin: 0;
      flex: 1;
    }
    .fp-theme-meta-row {
      display: flex;
      align-items: center;
      gap: 14px;
      font-size: 0.74rem;
      color: #64748b;
      padding: 8px 0;
      border-top: 1px solid #1a2233;
      border-bottom: 1px solid #1a2233;
    }
    .fp-theme-meta-item {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .fp-theme-accent-swatch {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      display: inline-block;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }
    .fp-theme-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
    }
    .fp-theme-btn-preview {
      flex: 1;
      background: #1e2638;
      border: 1px solid #2d384e;
      color: #f3f4f6;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      text-align: center;
      text-decoration: none;
      transition: all 0.18s ease;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .fp-theme-btn-preview:hover {
      background: #28334b;
      color: #ffffff;
      border-color: #3b4863;
    }
    .fp-theme-btn-activate {
      flex: 1;
      background: #2563eb;
      border: 1px solid #3b82f6;
      color: #ffffff;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.18s ease;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .fp-theme-btn-activate:hover {
      background: #1d4ed8;
    }
    .fp-theme-btn-activate.is-current {
      background: #15803d;
      border-color: #22c55e;
      cursor: default;
      opacity: 0.95;
    }
  `;

  let modalEl = null;
  let activeTab = 'web-config'; // 'web-config' | 'head' | 'body-start' | 'css' | 'body-end'

  let currentConfig = {
    scope: 'global', // 'global' | 'page' | 'post'
    slug: '',
    title: '',
    targetType: 'page',
    onSave: null,
  };

  let cachedMediaList = null;

  function injectStyles() {
    if (document.getElementById('fastpress-custom-code-styles')) return;
    const styleEl = document.createElement('style');
    styleEl.id = 'fastpress-custom-code-styles';
    styleEl.textContent = STYLES;
    document.head.appendChild(styleEl);
  }

  function showToast(msg, isError = false) {
    let toast = document.getElementById('toastNotify') || document.getElementById('builderToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toastNotify';
      toast.style.cssText = `
        position: fixed; bottom: 24px; right: 24px; z-index: 9999999;
        background: ${isError ? '#ef4444' : '#10b981'}; color: #fff;
        padding: 9px 16px; border-radius: 6px; font-size: 0.82rem; font-weight: 600;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5); display: flex; align-items: center; gap: 8px;
      `;
      document.body.appendChild(toast);
    }
    toast.style.background = isError ? '#ef4444' : '#10b981';
    toast.textContent = msg;
    toast.style.display = 'flex';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.style.display = 'none';
    }, 3200);
  }

  function renderModalHTML() {
    return `
      <div class="fp-cc-card">
        <!-- Header -->
        <div class="fp-cc-header">
          <div class="fp-cc-title-wrap">
            <div class="fp-cc-icon-badge" id="fpCcIconBadge">⚙️</div>
            <div>
              <h3 class="fp-cc-title">
                <span id="fpCcTitleText">Web Config &amp; Global Scripts</span>
                <span class="fp-cc-pill" id="fpCcScopePill">All Pages &amp; Posts</span>
              </h3>
            </div>
          </div>
          <button type="button" class="fp-cc-close-btn" id="btnFpCcClose" title="Close dialog">&times;</button>
        </div>

        <!-- Tabs Navigation -->
        <div class="fp-cc-tabs">
          <button type="button" class="fp-cc-tab-btn highlight active" data-tab="web-config" id="btnFpCcTabWebConfig">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <span>Web Config</span>
          </button>
          <button type="button" class="fp-cc-tab-btn" data-tab="themes" id="btnFpCcTabThemes">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg>
            <span>Themes</span>
          </button>
          <button type="button" class="fp-cc-tab-btn" data-tab="head" id="btnFpCcTabHead">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
            <span>&lt;head&gt; Scripts</span>
          </button>
          <button type="button" class="fp-cc-tab-btn" data-tab="body-start" id="btnFpCcTabBodyStart">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3l14 9-14 9V3z"></path></svg>
            <span>&lt;body&gt; Start</span>
          </button>
          <button type="button" class="fp-cc-tab-btn" data-tab="css" id="btnFpCcTabCss">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l9 4.5V18L12 22 3 18V6.5L12 2z"></path></svg>
            <span id="fpCcTabCssTitle">Custom CSS</span>
          </button>
          <button type="button" class="fp-cc-tab-btn" data-tab="body-end" id="btnFpCcTabBodyEnd">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="9" y1="9" x2="15" y2="15"></line></svg>
            <span>&lt;body&gt; End</span>
          </button>
        </div>

        <!-- Body / Panes -->
        <div class="fp-cc-body">
          
          <!-- TAB 0: WEB CONFIG (FAVICON, LOGO & SITE IDENTITY) -->
          <div class="fp-cc-pane active" id="fpCcPaneWebConfig">
            <div class="fp-cc-desc-box">
              <div class="fp-cc-desc-text">
                <div><strong>Global Website Identity &amp; Branding Assets</strong></div>
                <div>Upload your site's favicon and primary web logo. The logo configured here is automatically retrieved and rendered in the <strong>Navbar Builder</strong> and headers across your entire site.</div>
              </div>
            </div>

            <!-- Two-column grid for Favicon and Logo -->
            <div class="fp-wc-grid">
              
              <!-- CARD 1: FAVICON -->
              <div class="fp-wc-card">
                <div class="fp-wc-card-header">
                  <div class="fp-wc-card-title">
                    <span>🌐</span>
                    <span>Website Favicon</span>
                  </div>
                  <span class="fp-wc-card-badge">Browser Tab Icon</span>
                </div>

                <!-- Live Browser Tab Preview -->
                <div class="fp-wc-preview-box fp-wc-checker">
                  <div class="fp-wc-browser-tab-mock" title="Live simulation of how your favicon appears in browser tabs">
                    <img id="fpWcFaviconPreviewImg" src="/favicon.svg" alt="Favicon" class="fp-wc-tab-icon" onerror="this.src='/favicon.svg'" />
                    <span class="fp-wc-tab-title" id="fpWcTabTitleMock">Better SaaS - Modern Platform</span>
                    <span class="fp-wc-tab-close">✕</span>
                  </div>
                  <div style="font-size: 0.65rem; color: #94a3b8; display: flex; align-items: center; gap: 8px;">
                    <span>Live Tab Preview</span>
                    <span style="opacity: 0.4;">•</span>
                    <span id="fpWcFaviconDimBadge">.ico, .svg, .png</span>
                  </div>
                </div>

                <!-- Favicon Controls -->
                <div class="fp-wc-control-group">
                  <div class="fp-wc-input-row">
                    <input type="text" class="fp-wc-text-input" id="fpWcInputFavicon" placeholder="/favicon.svg or image URL" value="/favicon.svg" />
                    <input type="file" id="fpWcFileFavicon" accept=".ico,.svg,.png,.webp,.jpg,.jpeg" style="display: none;" />
                    <button type="button" class="fp-wc-btn-action upload" id="btnFpWcUploadFavicon" title="Upload .ico or .png file from your computer">
                      ⬆️ Upload
                    </button>
                    <button type="button" class="fp-wc-btn-action" id="btnFpWcMediaFavicon" title="Choose from existing media library">
                      🖼️ Media
                    </button>
                    <button type="button" class="fp-wc-btn-action" id="btnFpWcResetFavicon" title="Reset to default FastPress SVG favicon">
                      ↺ Reset
                    </button>
                  </div>
                  <div class="fp-wc-field-desc">
                    Recommended: <code>.ico</code>, <code>.svg</code>, or <code>32x32 .png</code>. Stored in <code>/public/uploads/</code> or <code>/public/</code>.
                  </div>

                  <!-- Inline Media Library Picker for Favicon -->
                  <div class="fp-wc-media-picker-panel" id="fpWcMediaPickerFavicon">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <span style="font-size: 0.72rem; font-weight: 700; color: #e2e8f0;">Select from Media Library</span>
                      <button type="button" class="fp-cc-btn-sm" id="btnCloseMediaPickerFavicon">Close</button>
                    </div>
                    <div class="fp-wc-media-grid" id="fpWcGridFavicon">
                      <!-- Dynamically loaded thumbs -->
                    </div>
                  </div>
                </div>
              </div>

              <!-- CARD 2: WEB LOGO -->
              <div class="fp-wc-card">
                <div class="fp-wc-card-header">
                  <div class="fp-wc-card-title">
                    <span>🏷️</span>
                    <span>Website Primary Logo</span>
                  </div>
                  <span class="fp-wc-card-badge" style="background: rgba(255, 94, 58, 0.15); color: #ff7755;">Used in Navbar Builder</span>
                </div>

                <!-- Live Header Navbar Simulation -->
                <div class="fp-wc-preview-box fp-wc-checker">
                  <div class="fp-wc-navbar-mock" id="fpWcNavbarMock">
                    <div id="fpWcLogoDisplayWrap">
                      <img id="fpWcLogoPreviewImg" src="" alt="Web Logo" class="fp-wc-logo-preview-img" style="display: none;" />
                      <div id="fpWcFallbackLogoBadge" class="fp-wc-fallback-badge">
                        <span style="background: #ff5e3a; width: 28px; height: 28px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.85rem; color: #fff;">B</span>
                        <div>
                          <div style="font-size: 0.8rem; font-weight: 700; color: #fff;" id="fpWcFallbackBrandText">Better SaaS</div>
                          <div style="font-size: 0.65rem; color: #94a3b8;" id="fpWcFallbackTaglineText">Modern Platform</div>
                        </div>
                      </div>
                    </div>
                    <div style="font-size: 0.7rem; color: #94a3b8; display: flex; gap: 10px;">
                      <span>Home</span>
                      <span>Solutions</span>
                      <span style="color: #ff5e3a; font-weight: 700;">Navbar Live</span>
                    </div>
                  </div>
                  <div style="font-size: 0.65rem; color: #94a3b8; display: flex; align-items: center; gap: 8px;">
                    <span>Navbar Preview</span>
                    <span style="opacity: 0.4;">•</span>
                    <span id="fpWcLogoStatusBadge">Inherited automatically by Navbar Builder</span>
                  </div>
                </div>

                <!-- Logo Controls -->
                <div class="fp-wc-control-group">
                  <div class="fp-wc-input-row">
                    <input type="text" class="fp-wc-text-input" id="fpWcInputLogo" placeholder="Pick or enter logo image URL..." value="" />
                    <input type="file" id="fpWcFileLogo" accept=".png,.svg,.webp,.jpg,.jpeg,.gif" style="display: none;" />
                    <button type="button" class="fp-wc-btn-action upload" id="btnFpWcUploadLogo" title="Upload PNG/SVG logo from your computer">
                      ⬆️ Upload
                    </button>
                    <button type="button" class="fp-wc-btn-action" id="btnFpWcMediaLogo" title="Choose from existing media library">
                      🖼️ Media
                    </button>
                    <button type="button" class="fp-wc-btn-action" id="btnFpWcClearLogo" title="Clear image to use text badge fallback">
                      ✕ Clear
                    </button>
                  </div>
                  <div class="fp-wc-field-desc">
                    Recommended: Transparent <code>PNG</code>, <code>SVG</code>, or <code>WebP</code>. Max 200KB.
                  </div>

                  <!-- Inline Media Library Picker for Logo -->
                  <div class="fp-wc-media-picker-panel" id="fpWcMediaPickerLogo">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <span style="font-size: 0.72rem; font-weight: 700; color: #e2e8f0;">Select from Media Library</span>
                      <button type="button" class="fp-cc-btn-sm" id="btnCloseMediaPickerLogo">Close</button>
                    </div>
                    <div class="fp-wc-media-grid" id="fpWcGridLogo">
                      <!-- Dynamically loaded thumbs -->
                    </div>
                  </div>
                </div>
              </div>

            </div>

            <!-- CARD 3: BRAND NAME & TAGLINE -->
            <div class="fp-wc-card">
              <div class="fp-wc-card-header">
                <div class="fp-wc-card-title">
                  <span>🏢</span>
                  <span>Brand Name &amp; Tagline</span>
                </div>
                <span class="fp-wc-card-badge">Site Identity</span>
              </div>
              <div class="fp-wc-grid">
                <div>
                  <label style="font-size: 0.72rem; font-weight: 700; color: #9ca3af; display: block; margin-bottom: 5px;">Brand / Company Name</label>
                  <input type="text" class="fp-wc-text-input" id="fpWcInputBrandName" value="Better SaaS" placeholder="e.g. Better SaaS" />
                </div>
                <div>
                  <label style="font-size: 0.72rem; font-weight: 700; color: #9ca3af; display: block; margin-bottom: 5px;">Tagline / Subtitle</label>
                  <input type="text" class="fp-wc-text-input" id="fpWcInputTagline" value="Modern Platform" placeholder="e.g. Modern Platform" />
                </div>
              </div>
              <div class="fp-wc-field-desc">
                These values are used as default fallbacks in the Navbar Builder, SEO meta title, and footer copyright notices.
              </div>
            </div>

          </div>

          <!-- TAB 1: Head Scripts & Analytics -->
          <div class="fp-cc-pane" id="fpCcPaneHead">
            <div class="fp-cc-desc-box">
              <div class="fp-cc-desc-text" id="fpCcDescHead">
                <div><strong>Injected into &lt;head&gt;...&lt;/head&gt;</strong> on every live page, blog post, and archive.</div>
                <div>Paste tracking codes, analytics tags, conversion pixels, verification tags, or external CDN links below:</div>
                <div class="fp-cc-chips">
                  <span class="fp-cc-chip gtm-highlight">Google Tag Manager (&lt;script&gt;)</span>
                  <span class="fp-cc-chip">Google Analytics (gtag.js)</span>
                  <span class="fp-cc-chip">Meta / Facebook Pixel</span>
                  <span class="fp-cc-chip">Site Verification Meta</span>
                  <span class="fp-cc-chip">&lt;script&gt; / &lt;link&gt;</span>
                </div>
              </div>
            </div>

            <div class="fp-cc-editor-toolbar">
              <span class="fp-cc-editor-label">&lt;head&gt; Scripts Code</span>
              <div class="fp-cc-editor-actions">
                <button type="button" class="fp-cc-btn-sm primary" id="btnFpCcSampleGtmHead">Insert GTM (&lt;head&gt;)</button>
                <button type="button" class="fp-cc-btn-sm" id="btnFpCcSampleGa">Insert GA4 Sample</button>
                <button type="button" class="fp-cc-btn-sm" id="btnFpCcClearHead">Clear</button>
              </div>
            </div>

            <textarea id="fpCcInputHead" class="fp-cc-textarea" placeholder="<!-- Paste your <head> tracking codes here -->&#10;<!-- Google Tag Manager -->&#10;<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':&#10;new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],&#10;j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=&#10;'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);&#10;})(window,document,'script','dataLayer','GTM-XXXXXXX');</script>&#10;<!-- End Google Tag Manager -->" spellcheck="false"></textarea>
          </div>

          <!-- TAB 2: Body Start Code (GTM noscript) -->
          <div class="fp-cc-pane" id="fpCcPaneBodyStart">
            <div class="fp-cc-desc-box">
              <div class="fp-cc-desc-text" id="fpCcDescBodyStart">
                <div><strong>Injected immediately after opening &lt;body&gt;</strong> on every live page and blog post.</div>
                <div>Required by <strong>Google Tag Manager</strong> for the non-JavaScript fallback iframe snippet, or accessibility skip links:</div>
                <div class="fp-cc-chips">
                  <span class="fp-cc-chip gtm-highlight">Google Tag Manager (&lt;noscript&gt; iframe)</span>
                  <span class="fp-cc-chip">Accessibility Skip Links</span>
                  <span class="fp-cc-chip">Body Start Hooks</span>
                </div>
              </div>
            </div>

            <div class="fp-cc-editor-toolbar">
              <span class="fp-cc-editor-label">&lt;body&gt; Start Code</span>
              <div class="fp-cc-editor-actions">
                <button type="button" class="fp-cc-btn-sm primary" id="btnFpCcSampleGtmBody">Insert GTM (&lt;body&gt; noscript)</button>
                <button type="button" class="fp-cc-btn-sm" id="btnFpCcClearBodyStart">Clear</button>
              </div>
            </div>

            <textarea id="fpCcInputBodyStart" class="fp-cc-textarea" placeholder="<!-- Paste code placed immediately after the opening <body> tag here -->&#10;<!-- Google Tag Manager (noscript) -->&#10;<noscript><iframe src=&quot;https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX&quot;&#10;height=&quot;0&quot; width=&quot;0&quot; style=&quot;display:none;visibility:hidden&quot;></iframe></noscript>&#10;<!-- End Google Tag Manager (noscript) -->" spellcheck="false"></textarea>
          </div>

          <!-- TAB 3: Custom CSS -->
          <div class="fp-cc-pane" id="fpCcPaneCss">
            <div class="fp-cc-desc-box">
              <div class="fp-cc-desc-text" id="fpCcDescCss">
                <div><strong>Global Site-Wide Stylesheet</strong> applied across all pages and blog posts.</div>
                <div>Write your CSS rules directly (without &lt;style&gt; tags). Automatically wrapped into &lt;style is:global&gt; in &lt;head&gt;.</div>
                <div class="fp-cc-chips">
                  <span class="fp-cc-chip">CSS Variables</span>
                  <span class="fp-cc-chip">Typography Tweaks</span>
                  <span class="fp-cc-chip">Component Overrides</span>
                  <span class="fp-cc-chip">Dark Mode Styles</span>
                </div>
              </div>
            </div>

            <div class="fp-cc-editor-toolbar">
              <span class="fp-cc-editor-label" id="fpCcLabelCss">Custom CSS Rules</span>
              <div class="fp-cc-editor-actions">
                <button type="button" class="fp-cc-btn-sm" id="btnFpCcClearCss">Clear</button>
              </div>
            </div>

            <textarea id="fpCcInputCss" class="fp-cc-textarea" placeholder="/* Custom CSS rules (without <style> tags) */&#10;body {&#10;  /* Custom styles */&#10;}&#10;&#10;.custom-highlight {&#10;  color: #ff5e3a;&#10;}" spellcheck="false"></textarea>
          </div>

          <!-- TAB 4: Body End Scripts -->
          <div class="fp-cc-pane" id="fpCcPaneBodyEnd">
            <div class="fp-cc-desc-box">
              <div class="fp-cc-desc-text" id="fpCcDescBodyEnd">
                <div><strong>Injected immediately before &lt;/body&gt;</strong> on every live page and blog post.</div>
                <div>Ideal for live chat widgets, non-blocking footer scripts, or third-party embeds:</div>
                <div class="fp-cc-chips">
                  <span class="fp-cc-chip">Chat Widgets (Crisp, Intercom, Tidio)</span>
                  <span class="fp-cc-chip">Non-blocking Footer Tracking</span>
                  <span class="fp-cc-chip">Custom Modal Wrappers</span>
                </div>
              </div>
            </div>

            <div class="fp-cc-editor-toolbar">
              <span class="fp-cc-editor-label">Footer / &lt;body&gt; End Code</span>
              <div class="fp-cc-editor-actions">
                <button type="button" class="fp-cc-btn-sm" id="btnFpCcSampleChat">Insert Chat Widget Sample</button>
                <button type="button" class="fp-cc-btn-sm" id="btnFpCcClearBodyEnd">Clear</button>
              </div>
            </div>

            <textarea id="fpCcInputBodyEnd" class="fp-cc-textarea" placeholder="<!-- Paste scripts placed right before </body> here -->&#10;<script>&#10;  // Footer or chat widget script&#10;</script>" spellcheck="false"></textarea>
          </div>

          <!-- TAB 5: Themes (Switch & Preview) -->
          <div class="fp-cc-pane" id="fpCcPaneThemes">
            <div class="fp-cc-desc-box">
              <div class="fp-cc-desc-text">
                <div><strong>Theme System &amp; Design Framework</strong></div>
                <div>Select the active theme for your storefront or preview alternative themes with existing products, articles, and pages without affecting published content.</div>
              </div>
            </div>

            <div class="fp-themes-status-banner">
              <div class="fp-themes-status-left">
                <span class="fp-themes-pulse"></span>
                <span>Active Website Theme:</span>
                <strong id="fpActiveThemeLabel" class="fp-active-theme-name">Loading...</strong>
              </div>
              <div class="fp-themes-status-right">
                <button type="button" class="fp-cc-btn-sm" id="btnFpReloadThemes">↻ Refresh Themes</button>
              </div>
            </div>

            <!-- Themes Grid -->
            <div class="fp-themes-grid" id="fpThemesGrid">
              <div class="fp-themes-loading" style="padding: 30px; text-align: center; color: #94a3b8; grid-column: 1 / -1;">
                Loading available themes...
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="fp-cc-footer">
          <div class="fp-cc-footer-note" id="fpCcFooterNote">
            <span class="fp-cc-dot-live"></span>
            <span id="fpCcFooterNoteText">Changes take effect immediately across all live pages &amp; navigation headers.</span>
          </div>
          <div class="fp-cc-footer-buttons">
            <button type="button" class="fp-cc-btn-cancel" id="btnFpCcCancel">Cancel</button>
            <button type="button" class="fp-cc-btn-save" id="btnFpCcSave">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span>Save Web Config &amp; Code</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function createModalDOM() {
    if (document.getElementById('modalFastPressCustomCode')) {
      modalEl = document.getElementById('modalFastPressCustomCode');
    } else {
      modalEl = document.createElement('div');
      modalEl.id = 'modalFastPressCustomCode';
      modalEl.className = 'fp-cc-backdrop';
      modalEl.innerHTML = renderModalHTML();
      document.body.appendChild(modalEl);
      bindModalEvents();
    }
  }

  function updateModalUI() {
    const titleEl = document.getElementById('fpCcTitleText');
    const pillEl = document.getElementById('fpCcScopePill');
    const noteEl = document.getElementById('fpCcFooterNoteText');
    const badgeEl = document.getElementById('fpCcIconBadge');
    const tabWebConfig = document.getElementById('btnFpCcTabWebConfig');
    const tabThemes = document.getElementById('btnFpCcTabThemes');
    const tabCssTitle = document.getElementById('fpCcTabCssTitle');
    const descHead = document.getElementById('fpCcDescHead');
    const descBodyStart = document.getElementById('fpCcDescBodyStart');
    const descCss = document.getElementById('fpCcDescCss');
    const descBodyEnd = document.getElementById('fpCcDescBodyEnd');

    const isGlobal = currentConfig.scope === 'global';
    const isPost = currentConfig.scope === 'post';
    const isProduct = currentConfig.scope === 'product';
    const targetTitle = currentConfig.title || currentConfig.slug || (isGlobal ? 'Site' : 'Active Page');
    const displaySlug = currentConfig.slug === 'home' || currentConfig.slug === '' ? '/' : `/${currentConfig.slug}`;

    if (isGlobal) {
      if (titleEl) titleEl.textContent = 'Web Config & Global Scripts';
      if (pillEl) {
        pillEl.className = 'fp-cc-pill';
        pillEl.textContent = 'All Pages & Headers';
      }
      if (noteEl) noteEl.textContent = 'Changes take effect immediately across all live pages & navigation headers.';
      if (badgeEl) {
        badgeEl.className = 'fp-cc-icon-badge';
        badgeEl.textContent = '⚙️';
      }
      if (tabWebConfig) tabWebConfig.style.display = 'inline-flex';
      if (tabThemes) tabThemes.style.display = 'inline-flex';
      if (tabCssTitle) tabCssTitle.textContent = 'Custom CSS';

      if (descHead) {
        descHead.innerHTML = `
          <div><strong>Injected into &lt;head&gt;...&lt;/head&gt;</strong> on every live page, blog post, and archive.</div>
          <div>Paste tracking codes, analytics tags, verification meta tags, or external CDN links below:</div>
          <div class="fp-cc-chips">
            <span class="fp-cc-chip gtm-highlight">Google Tag Manager (&lt;script&gt;)</span>
            <span class="fp-cc-chip">Google Analytics (gtag.js)</span>
            <span class="fp-cc-chip">Meta / Facebook Pixel</span>
            <span class="fp-cc-chip">Site Verification Meta</span>
            <span class="fp-cc-chip">&lt;script&gt; / &lt;link&gt;</span>
          </div>
        `;
      }
      if (descBodyStart) {
        descBodyStart.innerHTML = `
          <div><strong>Injected immediately after opening &lt;body&gt;</strong> on every live page and blog post.</div>
          <div>Required by <strong>Google Tag Manager</strong> for the non-JavaScript fallback iframe snippet, or accessibility skip links:</div>
          <div class="fp-cc-chips">
            <span class="fp-cc-chip gtm-highlight">Google Tag Manager (&lt;noscript&gt; iframe)</span>
            <span class="fp-cc-chip">Accessibility Skip Links</span>
            <span class="fp-cc-chip">Body Start Hooks</span>
          </div>
        `;
      }
      if (descCss) {
        descCss.innerHTML = `
          <div><strong>Global Site-Wide Stylesheet</strong> applied across all pages and blog posts.</div>
          <div>Write your CSS rules directly (without &lt;style&gt; tags). Automatically wrapped into &lt;style is:global&gt; in &lt;head&gt;.</div>
          <div class="fp-cc-chips">
            <span class="fp-cc-chip">CSS Variables</span>
            <span class="fp-cc-chip">Typography Tweaks</span>
            <span class="fp-cc-chip">Component Overrides</span>
            <span class="fp-cc-chip">Dark Mode Styles</span>
          </div>
        `;
      }
      if (descBodyEnd) {
        descBodyEnd.innerHTML = `
          <div><strong>Injected immediately before &lt;/body&gt;</strong> on every live page and blog post.</div>
          <div>Ideal for live chat widgets, non-blocking footer scripts, or third-party embeds:</div>
          <div class="fp-cc-chips">
            <span class="fp-cc-chip">Chat Widgets (Crisp, Intercom, Tidio)</span>
            <span class="fp-cc-chip">Non-blocking Footer Tracking</span>
            <span class="fp-cc-chip">Custom Modal Wrappers</span>
          </div>
        `;
      }
    } else {
      // Scoped: Page, Post or Product
      const typeLabel = isPost ? 'Post' : isProduct ? 'Product' : 'Page';
      const pathBadge = isPost ? `/blog/${currentConfig.slug}` : isProduct ? `/products/${currentConfig.slug}` : displaySlug;

      if (titleEl) titleEl.textContent = `${typeLabel} Custom Code & Scripts`;
      if (pillEl) {
        pillEl.className = `fp-cc-pill ${isPost ? 'post-pill' : 'page-pill'}`;
        pillEl.textContent = `${typeLabel}: ${pathBadge}`;
      }
      if (noteEl) noteEl.textContent = `Saved code will only be injected on "${targetTitle}" (${pathBadge}).`;
      if (badgeEl) {
        badgeEl.className = 'fp-cc-icon-badge page-mode';
        badgeEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`;
      }
      if (tabWebConfig) tabWebConfig.style.display = 'none';
      if (tabThemes) tabThemes.style.display = 'none';
      if (tabCssTitle) tabCssTitle.textContent = `${typeLabel} Custom CSS`;

      if (descHead) {
        descHead.innerHTML = `
          <div><strong>Injected into &lt;head&gt;...&lt;/head&gt;</strong> on <strong>"${targetTitle}"</strong> (<code>${pathBadge}</code>) only.</div>
          <div>Ideal for page-specific tracking, custom conversion events, or specific verification tags:</div>
          <div class="fp-cc-chips">
            <span class="fp-cc-chip">Conversion Tracking Event</span>
            <span class="fp-cc-chip">Campaign Tag</span>
            <span class="fp-cc-chip">Page Meta Tag</span>
          </div>
        `;
      }
      if (descBodyStart) {
        descBodyStart.innerHTML = `
          <div><strong>Injected immediately after opening &lt;body&gt;</strong> on <strong>"${targetTitle}"</strong> (<code>${pathBadge}</code>) only.</div>
          <div>Ideal for page-specific noscript fallbacks, accessibility hooks, or page-specific banners:</div>
          <div class="fp-cc-chips">
            <span class="fp-cc-chip gtm-highlight">Page &lt;noscript&gt; Snippet</span>
            <span class="fp-cc-chip">Page Start Hook</span>
          </div>
        `;
      }
      if (descCss) {
        descCss.innerHTML = `
          <div><strong>Page-Specific CSS Stylesheet</strong> applied strictly to <strong>"${targetTitle}"</strong> (<code>${pathBadge}</code>).</div>
          <div>Write CSS rules directly (without &lt;style&gt; tags). Automatically wrapped into &lt;style is:global&gt; on this page only.</div>
          <div class="fp-cc-chips">
            <span class="fp-cc-chip">Page Layout Tweaks</span>
            <span class="fp-cc-chip">Section Color Overrides</span>
            <span class="fp-cc-chip">Element Styles</span>
          </div>
        `;
      }
      if (descBodyEnd) {
        descBodyEnd.innerHTML = `
          <div><strong>Injected immediately before &lt;/body&gt;</strong> on <strong>"${targetTitle}"</strong> (<code>${pathBadge}</code>) only.</div>
          <div>Ideal for page-specific interactive widgets, custom forms, or checkout scripts:</div>
          <div class="fp-cc-chips">
            <span class="fp-cc-chip">Page Interactive Script</span>
            <span class="fp-cc-chip">Lead Form Trigger</span>
          </div>
        `;
      }
    }
  }

  function switchTab(tab) {
    activeTab = tab;
    document.getElementById('btnFpCcTabWebConfig')?.classList.toggle('active', tab === 'web-config');
    document.getElementById('btnFpCcTabThemes')?.classList.toggle('active', tab === 'themes');
    document.getElementById('btnFpCcTabHead')?.classList.toggle('active', tab === 'head');
    document.getElementById('btnFpCcTabBodyStart')?.classList.toggle('active', tab === 'body-start');
    document.getElementById('btnFpCcTabCss')?.classList.toggle('active', tab === 'css');
    document.getElementById('btnFpCcTabBodyEnd')?.classList.toggle('active', tab === 'body-end');

    document.getElementById('fpCcPaneWebConfig')?.classList.toggle('active', tab === 'web-config');
    document.getElementById('fpCcPaneThemes')?.classList.toggle('active', tab === 'themes');
    document.getElementById('fpCcPaneHead')?.classList.toggle('active', tab === 'head');
    document.getElementById('fpCcPaneBodyStart')?.classList.toggle('active', tab === 'body-start');
    document.getElementById('fpCcPaneCss')?.classList.toggle('active', tab === 'css');
    document.getElementById('fpCcPaneBodyEnd')?.classList.toggle('active', tab === 'body-end');

    if (tab === 'themes') {
      loadThemes();
    }
  }

  function updateWebConfigPreviews() {
    const faviconUrl = (document.getElementById('fpWcInputFavicon')?.value || '').trim() || '/favicon.svg';
    const logoUrl = (document.getElementById('fpWcInputLogo')?.value || '').trim();
    const brandName = (document.getElementById('fpWcInputBrandName')?.value || '').trim() || 'Better SaaS';
    const tagline = (document.getElementById('fpWcInputTagline')?.value || '').trim() || 'Modern Platform';

    // Update Favicon Preview
    const favImg = document.getElementById('fpWcFaviconPreviewImg');
    if (favImg) {
      favImg.src = faviconUrl;
    }
    const tabTitleMock = document.getElementById('fpWcTabTitleMock');
    if (tabTitleMock) {
      tabTitleMock.textContent = `${brandName} - ${tagline}`;
    }

    // Update Logo Preview
    const logoImg = document.getElementById('fpWcLogoPreviewImg');
    const fallbackBadge = document.getElementById('fpWcFallbackLogoBadge');
    const fallbackBrand = document.getElementById('fpWcFallbackBrandText');
    const fallbackTagline = document.getElementById('fpWcFallbackTaglineText');
    const statusBadge = document.getElementById('fpWcLogoStatusBadge');

    if (fallbackBrand) fallbackBrand.textContent = brandName;
    if (fallbackTagline) fallbackTagline.textContent = tagline;

    if (logoUrl) {
      if (logoImg) {
        logoImg.src = logoUrl;
        logoImg.style.display = 'block';
      }
      if (fallbackBadge) fallbackBadge.style.display = 'none';
      if (statusBadge) statusBadge.textContent = 'Active (Custom Logo Image)';
    } else {
      if (logoImg) {
        logoImg.style.display = 'none';
        logoImg.src = '';
      }
      if (fallbackBadge) fallbackBadge.style.display = 'inline-flex';
      if (statusBadge) statusBadge.textContent = 'Using Text Badge Fallback';
    }
  }

  function enableTabIndent(textarea) {
    if (!textarea) return;
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;
        textarea.value = val.substring(0, start) + '  ' + val.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveCustomCode();
      }
    });
  }

  async function uploadFileViaApi(file, targetType) {
    if (!file) return;

    // Check size limit: 200KB
    const MAX_SIZE = 200 * 1024;
    if (file.size > MAX_SIZE) {
      alert(`Selected file (${Math.round(file.size / 1024)} KB) exceeds the 200 KB limit. Please optimize or compress the file first.`);
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      showToast('Uploading ' + file.name + '...');
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.success && data.file) {
        showToast('✓ ' + (targetType === 'favicon' ? 'Favicon' : 'Logo') + ' uploaded successfully!');
        if (targetType === 'favicon') {
          const inp = document.getElementById('fpWcInputFavicon');
          if (inp) {
            inp.value = data.file.url;
            updateWebConfigPreviews();
          }
        } else if (targetType === 'logo') {
          const inp = document.getElementById('fpWcInputLogo');
          if (inp) {
            inp.value = data.file.url;
            updateWebConfigPreviews();
          }
        }
        cachedMediaList = null; // Refresh media cache
      } else {
        alert(data.error || 'Failed to upload file');
      }
    } catch (err) {
      alert('Upload error: ' + err.message);
    }
  }

  async function loadMediaLibraryFor(targetType) {
    const gridId = targetType === 'favicon' ? 'fpWcGridFavicon' : 'fpWcGridLogo';
    const panelId = targetType === 'favicon' ? 'fpWcMediaPickerFavicon' : 'fpWcMediaPickerLogo';
    const grid = document.getElementById(gridId);
    const panel = document.getElementById(panelId);
    if (!grid || !panel) return;

    panel.classList.toggle('open');
    if (!panel.classList.contains('open')) return;

    grid.innerHTML = '<div style="font-size: 0.72rem; color: #94a3b8; padding: 10px;">Loading images...</div>';

    try {
      if (!cachedMediaList) {
        const res = await fetch('/api/upload');
        const json = await res.json();
        cachedMediaList = json.media || [];
      }

      if (!cachedMediaList || cachedMediaList.length === 0) {
        grid.innerHTML = '<div style="font-size: 0.72rem; color: #94a3b8; padding: 10px;">No uploaded images found yet. Upload one above!</div>';
        return;
      }

      grid.innerHTML = '';
      cachedMediaList.forEach(m => {
        const img = document.createElement('img');
        img.src = m.url;
        img.className = 'fp-wc-media-thumb';
        img.title = `${m.fileName} (${m.size})`;
        img.addEventListener('click', () => {
          if (targetType === 'favicon') {
            const inp = document.getElementById('fpWcInputFavicon');
            if (inp) inp.value = m.url;
          } else {
            const inp = document.getElementById('fpWcInputLogo');
            if (inp) inp.value = m.url;
          }
          updateWebConfigPreviews();
          panel.classList.remove('open');
          showToast('✓ Selected: ' + m.fileName);
        });
        grid.appendChild(img);
      });
    } catch (err) {
      grid.innerHTML = `<div style="font-size: 0.72rem; color: #ef4444; padding: 10px;">Failed to load media: ${err.message}</div>`;
    }
  }

  /* ============================================================
   * THEMES LOGIC: Load, Render & Switch
   * ============================================================ */
  let cachedThemesData = null;

  async function loadThemes() {
    const grid = document.getElementById('fpThemesGrid');
    const label = document.getElementById('fpActiveThemeLabel');
    if (!grid) return;

    grid.innerHTML = `
      <div class="fp-themes-loading" style="padding: 24px; text-align: center; color: #94a3b8; grid-column: 1 / -1;">
        Loading available themes...
      </div>
    `;

    try {
      const res = await fetch('/api/themes');
      const data = await res.json();
      if (data && data.themes) {
        cachedThemesData = data;
        if (label) {
          const act = data.activeTheme || 'default';
          label.textContent = act.charAt(0).toUpperCase() + act.slice(1);
        }
        renderThemeCards(data.themes, data.activeTheme);
      }
    } catch (err) {
      console.error('Failed to load themes:', err);
      grid.innerHTML = `<div style="padding: 24px; text-align: center; color: #ef4444; grid-column: 1 / -1;">Failed to load themes: ${err.message}</div>`;
    }
  }

  function renderThemeCards(themes, activeTheme) {
    const grid = document.getElementById('fpThemesGrid');
    if (!grid) return;

    if (!themes || themes.length === 0) {
      grid.innerHTML = `<div style="padding: 24px; text-align: center; color: #94a3b8; grid-column: 1 / -1;">No themes found in src/themes directory.</div>`;
      return;
    }

    grid.innerHTML = themes.map((t) => {
      const isActive = t.id === activeTheme;
      const previewImg = t.manifest?.previewImage || (t.id === 'furnisite' ? '/themes/furnisite-preview.jpg' : '/themes/default-preview.svg');
      const accent = t.manifest?.accentColor || (t.id === 'furnisite' ? '#18181b' : '#ff5e3a');
      const headingFont = t.manifest?.fontHeading || 'Sans-serif';
      const desc = t.manifest?.description || 'A complete design theme for your storefront.';
      const name = t.manifest?.name || (t.id.charAt(0).toUpperCase() + t.id.slice(1));
      const version = t.manifest?.version || '1.0.0';

      return `
        <div class="fp-theme-card ${isActive ? 'is-active' : ''}" data-theme-card="${t.id}">
          <div class="fp-theme-thumb-wrap">
            <img src="${previewImg}" alt="${name} Theme Preview" class="fp-theme-thumb-img" onerror="this.src='/themes/default-preview.svg'" />
            ${isActive ? '<span class="fp-theme-active-tag">✓ Active Theme</span>' : ''}
          </div>
          <div class="fp-theme-body">
            <div class="fp-theme-title-row">
              <span class="fp-theme-name">${name}</span>
              <span class="fp-theme-version">v${version}</span>
            </div>
            <p class="fp-theme-desc">${desc}</p>
            <div class="fp-theme-meta-row">
              <div class="fp-theme-meta-item">
                <span class="fp-theme-accent-swatch" style="background-color: ${accent};"></span>
                <span>${accent}</span>
              </div>
              <div class="fp-theme-meta-item">
                <span>Font: <strong>${headingFont}</strong></span>
              </div>
            </div>
            <div class="fp-theme-actions">
              <a href="/preview/${t.id}" target="_blank" class="fp-theme-btn-preview" title="Preview ${name} with live products & articles">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                Preview
              </a>
              <button type="button" class="fp-theme-btn-activate ${isActive ? 'is-current' : ''}" data-theme-activate="${t.id}" ${isActive ? 'disabled' : ''}>
                ${isActive ? '✓ Active' : 'Activate Theme'}
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Bind click events on activate buttons
    grid.querySelectorAll('[data-theme-activate]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const themeId = e.currentTarget.getAttribute('data-theme-activate');
        if (!themeId) return;
        await activateTheme(themeId);
      });
    });
  }

  async function activateTheme(themeId) {
    const label = document.getElementById('fpActiveThemeLabel');
    try {
      showToast(`Activating theme "${themeId}"...`);
      const res = await fetch('/api/themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeTheme: themeId }),
      });
      const data = await res.json();
      if (data.success) {
        if (label) label.textContent = themeId.charAt(0).toUpperCase() + themeId.slice(1);
        showToast(`✓ Theme switched to "${themeId}" successfully! Live everywhere.`);
        await loadThemes();
      } else {
        alert(data.error || 'Failed to switch theme.');
      }
    } catch (err) {
      alert('Error switching theme: ' + err.message);
    }
  }

  function bindModalEvents() {
    // Close modal
    document.getElementById('btnFpCcClose')?.addEventListener('click', closeCustomCode);
    document.getElementById('btnFpCcCancel')?.addEventListener('click', closeCustomCode);
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) closeCustomCode();
    });

    // Escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalEl?.classList.contains('open')) {
        closeCustomCode();
      }
    });

    // Tab buttons
    document.getElementById('btnFpCcTabWebConfig')?.addEventListener('click', () => switchTab('web-config'));
    document.getElementById('btnFpCcTabThemes')?.addEventListener('click', () => switchTab('themes'));
    document.getElementById('btnFpCcTabHead')?.addEventListener('click', () => switchTab('head'));
    document.getElementById('btnFpCcTabBodyStart')?.addEventListener('click', () => switchTab('body-start'));
    document.getElementById('btnFpCcTabCss')?.addEventListener('click', () => switchTab('css'));
    document.getElementById('btnFpCcTabBodyEnd')?.addEventListener('click', () => switchTab('body-end'));
    document.getElementById('btnFpReloadThemes')?.addEventListener('click', () => loadThemes());

    // Enable tab indentation
    enableTabIndent(document.getElementById('fpCcInputHead'));
    enableTabIndent(document.getElementById('fpCcInputBodyStart'));
    enableTabIndent(document.getElementById('fpCcInputCss'));
    enableTabIndent(document.getElementById('fpCcInputBodyEnd'));

    // WEB CONFIG: Favicon Controls
    const inpFavicon = document.getElementById('fpWcInputFavicon');
    const fileFavicon = document.getElementById('fpWcFileFavicon');
    const btnUploadFavicon = document.getElementById('btnFpWcUploadFavicon');
    const btnMediaFavicon = document.getElementById('btnFpWcMediaFavicon');
    const btnResetFavicon = document.getElementById('btnFpWcResetFavicon');
    const btnCloseMediaFav = document.getElementById('btnCloseMediaPickerFavicon');

    inpFavicon?.addEventListener('input', updateWebConfigPreviews);
    btnUploadFavicon?.addEventListener('click', () => fileFavicon?.click());
    fileFavicon?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        uploadFileViaApi(e.target.files[0], 'favicon');
        e.target.value = '';
      }
    });
    btnMediaFavicon?.addEventListener('click', () => loadMediaLibraryFor('favicon'));
    btnCloseMediaFav?.addEventListener('click', () => {
      document.getElementById('fpWcMediaPickerFavicon')?.classList.remove('open');
    });
    btnResetFavicon?.addEventListener('click', () => {
      if (inpFavicon) {
        inpFavicon.value = '/favicon.svg';
        updateWebConfigPreviews();
        showToast('Reset to default favicon');
      }
    });

    // WEB CONFIG: Logo Controls
    const inpLogo = document.getElementById('fpWcInputLogo');
    const fileLogo = document.getElementById('fpWcFileLogo');
    const btnUploadLogo = document.getElementById('btnFpWcUploadLogo');
    const btnMediaLogo = document.getElementById('btnFpWcMediaLogo');
    const btnClearLogo = document.getElementById('btnFpWcClearLogo');
    const btnCloseMediaLogo = document.getElementById('btnCloseMediaPickerLogo');

    inpLogo?.addEventListener('input', updateWebConfigPreviews);
    btnUploadLogo?.addEventListener('click', () => fileLogo?.click());
    fileLogo?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        uploadFileViaApi(e.target.files[0], 'logo');
        e.target.value = '';
      }
    });
    btnMediaLogo?.addEventListener('click', () => loadMediaLibraryFor('logo'));
    btnCloseMediaLogo?.addEventListener('click', () => {
      document.getElementById('fpWcMediaPickerLogo')?.classList.remove('open');
    });
    btnClearLogo?.addEventListener('click', () => {
      if (inpLogo) {
        inpLogo.value = '';
        updateWebConfigPreviews();
        showToast('Cleared custom logo (using text badge)');
      }
    });

    // WEB CONFIG: Brand Name & Tagline Inputs
    document.getElementById('fpWcInputBrandName')?.addEventListener('input', updateWebConfigPreviews);
    document.getElementById('fpWcInputTagline')?.addEventListener('input', updateWebConfigPreviews);

    // Helper buttons - TAB 1: Head
    document.getElementById('btnFpCcSampleGtmHead')?.addEventListener('click', () => {
      const inp = document.getElementById('fpCcInputHead');
      if (inp) {
        const sample = `<!-- Google Tag Manager -->\n<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':\nnew Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],\nj=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=\n'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);\n})(window,document,'script','dataLayer','GTM-XXXXXXX');</script>\n<!-- End Google Tag Manager -->\n`;
        inp.value = (inp.value ? inp.value.trim() + '\n\n' : '') + sample;
        inp.focus();
      }
    });

    document.getElementById('btnFpCcSampleGa')?.addEventListener('click', () => {
      const inp = document.getElementById('fpCcInputHead');
      if (inp) {
        const sample = `<!-- Google tag (gtag.js) -->\n<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>\n<script>\n  window.dataLayer = window.dataLayer || [];\n  function gtag(){dataLayer.push(arguments);}\n  gtag('js', new Date());\n  gtag('config', 'G-XXXXXXXXXX');\n</script>\n`;
        inp.value = (inp.value ? inp.value.trim() + '\n\n' : '') + sample;
        inp.focus();
      }
    });

    document.getElementById('btnFpCcClearHead')?.addEventListener('click', () => {
      const inp = document.getElementById('fpCcInputHead');
      if (inp && confirm('Clear all <head> scripts?')) inp.value = '';
    });

    // Helper buttons - TAB 2: Body Start
    document.getElementById('btnFpCcSampleGtmBody')?.addEventListener('click', () => {
      const inp = document.getElementById('fpCcInputBodyStart');
      if (inp) {
        const sample = `<!-- Google Tag Manager (noscript) -->\n<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX"\nheight="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>\n<!-- End Google Tag Manager (noscript) -->\n`;
        inp.value = (inp.value ? inp.value.trim() + '\n\n' : '') + sample;
        inp.focus();
      }
    });

    document.getElementById('btnFpCcClearBodyStart')?.addEventListener('click', () => {
      const inp = document.getElementById('fpCcInputBodyStart');
      if (inp && confirm('Clear all <body> start scripts?')) inp.value = '';
    });

    // Helper buttons - TAB 3: CSS
    document.getElementById('btnFpCcClearCss')?.addEventListener('click', () => {
      const inp = document.getElementById('fpCcInputCss');
      if (inp && confirm('Clear all custom CSS?')) inp.value = '';
    });

    // Helper buttons - TAB 4: Body End
    document.getElementById('btnFpCcSampleChat')?.addEventListener('click', () => {
      const inp = document.getElementById('fpCcInputBodyEnd');
      if (inp) {
        const sample = `<!-- Live Chat Widget Sample -->\n<script>\n  window.FP_CHAT_CONFIG = { enabled: true, appId: 'better-corp' };\n</script>\n`;
        inp.value = (inp.value ? inp.value.trim() + '\n\n' : '') + sample;
        inp.focus();
      }
    });

    document.getElementById('btnFpCcClearBodyEnd')?.addEventListener('click', () => {
      const inp = document.getElementById('fpCcInputBodyEnd');
      if (inp && confirm('Clear all <body> end scripts?')) inp.value = '';
    });

    // Save
    document.getElementById('btnFpCcSave')?.addEventListener('click', saveCustomCode);
  }

  async function loadCustomCode() {
    const headInp = document.getElementById('fpCcInputHead');
    const bodyStartInp = document.getElementById('fpCcInputBodyStart');
    const cssInp = document.getElementById('fpCcInputCss');
    const bodyEndInp = document.getElementById('fpCcInputBodyEnd');

    // Reset fields first
    if (headInp) headInp.value = '';
    if (bodyStartInp) bodyStartInp.value = '';
    if (cssInp) cssInp.value = '';
    if (bodyEndInp) bodyEndInp.value = '';

    // If global, load Web Config from /api/site-config
    if (currentConfig.scope === 'global') {
      try {
        const resConfig = await fetch('/api/site-config');
        const siteConfig = await resConfig.json();
        if (siteConfig) {
          const inpFavicon = document.getElementById('fpWcInputFavicon');
          const inpLogo = document.getElementById('fpWcInputLogo');
          const inpBrand = document.getElementById('fpWcInputBrandName');
          const inpTagline = document.getElementById('fpWcInputTagline');

          if (inpFavicon) inpFavicon.value = siteConfig.faviconUrl || '/favicon.svg';
          if (inpLogo) inpLogo.value = siteConfig.logoUrl || '';
          if (inpBrand) inpBrand.value = siteConfig.brandName || 'Better SaaS';
          if (inpTagline) inpTagline.value = siteConfig.tagline || 'Modern Platform';

          updateWebConfigPreviews();
        }
      } catch (err) {
        console.warn('[FastPressCustomCode] Error loading site-config:', err);
      }
    }

    try {
      let url = '/api/custom-code';
      if (currentConfig.scope === 'page' || currentConfig.scope === 'post' || currentConfig.scope === 'product') {
        url = `/api/page-custom-code?slug=${encodeURIComponent(currentConfig.slug)}&type=${encodeURIComponent(currentConfig.targetType)}`;
      }

      const res = await fetch(url);
      const json = await res.json();
      if (json.success && json.data) {
        if (headInp) headInp.value = json.data.headScripts || '';
        if (bodyStartInp) bodyStartInp.value = json.data.bodyStartScripts || '';
        if (cssInp) cssInp.value = json.data.customCss || '';
        if (bodyEndInp) bodyEndInp.value = json.data.bodyEndScripts || json.data.bodyScripts || '';
      }
    } catch (err) {
      console.warn('[FastPressCustomCode] Error loading code:', err);
    }
  }

  async function saveCustomCode() {
    const btnSave = document.getElementById('btnFpCcSave');
    const headInp = document.getElementById('fpCcInputHead');
    const bodyStartInp = document.getElementById('fpCcInputBodyStart');
    const cssInp = document.getElementById('fpCcInputCss');
    const bodyEndInp = document.getElementById('fpCcInputBodyEnd');

    const bodyEndVal = bodyEndInp ? bodyEndInp.value : '';

    const payload = {
      headScripts: headInp ? headInp.value : '',
      bodyStartScripts: bodyStartInp ? bodyStartInp.value : '',
      customCss: cssInp ? cssInp.value : '',
      bodyEndScripts: bodyEndVal,
      bodyScripts: bodyEndVal,
    };

    let url = '/api/custom-code';
    if (currentConfig.scope === 'page' || currentConfig.scope === 'post' || currentConfig.scope === 'product') {
      url = '/api/page-custom-code';
      payload.slug = currentConfig.slug;
      payload.type = currentConfig.targetType;
    }

    if (btnSave) {
      btnSave.disabled = true;
      btnSave.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
        <span>Saving...</span>
      `;
    }

    try {
      // 1. If global, save Web Config to /api/site-config first
      let siteConfigSaved = null;
      if (currentConfig.scope === 'global') {
        const inpFavicon = document.getElementById('fpWcInputFavicon');
        const inpLogo = document.getElementById('fpWcInputLogo');
        const inpBrand = document.getElementById('fpWcInputBrandName');
        const inpTagline = document.getElementById('fpWcInputTagline');

        const configPayload = {
          faviconUrl: inpFavicon ? inpFavicon.value.trim() : '/favicon.svg',
          logoUrl: inpLogo ? inpLogo.value.trim() : '',
          brandName: inpBrand ? inpBrand.value.trim() : 'Better SaaS',
          tagline: inpTagline ? inpTagline.value.trim() : 'Modern Platform',
        };

        const resCfg = await fetch('/api/site-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(configPayload),
        });
        const cfgData = await resCfg.json();
        if (cfgData.success) {
          siteConfigSaved = cfgData.config;
          // Notify any listening components (e.g. Header Builder)
          window.dispatchEvent(new CustomEvent('fastpress:siteConfigUpdated', { detail: configPayload }));

          // Update live tab favicon in document
          const linkIcon = document.querySelector("link[rel*='icon']");
          if (linkIcon && configPayload.faviconUrl) {
            linkIcon.href = configPayload.faviconUrl;
          }
        }
      }

      // 2. Save Custom Code Scripts
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        const targetTitle = currentConfig.title || currentConfig.slug;
        const msg = currentConfig.scope === 'global'
          ? '✓ Web Config & Global Scripts saved! Live across all pages & headers.'
          : `✓ Custom code saved for ${currentConfig.scope === 'post' ? 'post' : currentConfig.scope === 'product' ? 'product' : 'page'} "${targetTitle}"!`;

        showToast(msg);
        if (typeof currentConfig.onSave === 'function') {
          currentConfig.onSave({ code: payload, config: siteConfigSaved });
        }
        closeCustomCode();
      } else {
        showToast(data.error || 'Failed to save custom code', true);
      }
    } catch (err) {
      showToast('Error saving: ' + err.message, true);
    } finally {
      if (btnSave) {
        btnSave.disabled = false;
        btnSave.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span>Save Web Config &amp; Code</span>
        `;
      }
    }
  }

  function openCustomCode(options = {}) {
    // Support legacy call with string initialTab
    if (typeof options === 'string') {
      options = { initialTab: options };
    }

    currentConfig = {
      scope: options.scope || 'global',
      slug: options.slug || options.pageSlug || '',
      title: options.title || options.pageTitle || '',
      targetType: options.targetType || (options.scope === 'post' ? 'post' : options.scope === 'product' ? 'product' : 'page'),
      onSave: typeof options.onSave === 'function' ? options.onSave : null,
    };

    injectStyles();
    createModalDOM();
    updateModalUI();

    const defTab = currentConfig.scope === 'global' ? (options.initialTab || 'web-config') : (options.initialTab || 'head');
    switchTab(defTab);
    loadCustomCode();
    modalEl.classList.add('open');
  }

  function closeCustomCode() {
    if (modalEl) modalEl.classList.remove('open');
  }

  function init() {
    injectStyles();
    createModalDOM();

    // Auto-bind click to any trigger element with data-open="custom-code" or data-open="web-config"
    document.querySelectorAll('[data-open="custom-code"], [data-open="web-config"], .btn-open-custom-code, #btnOpenCustomCodeModal').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = el.getAttribute('data-open') === 'themes' ? 'themes' : 'web-config';
        openCustomCode({ scope: 'global', initialTab: tab });
      });
    });

    document.querySelectorAll('[data-open="themes"]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        openCustomCode({ scope: 'global', initialTab: 'themes' });
      });
    });

    // Check URL parameters for direct modal open
    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('openModal') === 'customCode') {
        const tab = urlParams.get('tab') || 'web-config';
        setTimeout(() => {
          openCustomCode({ scope: 'global', initialTab: tab });
        }, 300);
      }
    } catch {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.FastPressCustomCode = {
    open: openCustomCode,
    close: closeCustomCode,
    save: saveCustomCode,
  };
})();
