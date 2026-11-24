/**
 * ============================================================================
 * FastPress Unified File Manager & Media Library Modal
 * Features:
 *  - Tabbed Layout: "Media Library" tab & "Upload Files" tab (block drop files)
 *  - Customizable Views: Grid View vs List View with persistent user preference
 *  - Real-Time Search: Instant image filename search filter with count badge & clear button
 *  - Drag & Drop Dropzone: Prominent upload block with progress indicator
 *  - Image Details Inspector: Preview, dimensions/size, date, copy URL, and delete action
 *  - GrapesJS Integration: Overrides `open-assets` for canvas double-click & Style Manager
 * ============================================================================
 */

(function () {
  'use strict';

  // Prevent multiple initializations
  if (window.FastPressFileManager) return;

  // Icons
  const ICONS = {
    grid: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`,
    list: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>`,
    search: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`,
    upload: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`,
    library: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`,
    refresh: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`,
    check: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    copy: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
    trash: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`
  };

  const STYLES = `
    /* FastPress File Manager Styles */
    .fp-fm-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: 99999;
      display: none;
      align-items: center;
      justify-content: center;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }
    .fp-fm-backdrop.open {
      display: flex;
      opacity: 1;
      pointer-events: auto;
    }
    .fp-fm-card {
      width: 94vw;
      max-width: 980px;
      height: 85vh;
      max-height: 760px;
      background: #10131a;
      border: 1px solid #282f3d;
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.05);
      overflow: hidden;
      animation: fpModalScaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes fpModalScaleIn {
      from { transform: scale(0.96); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    /* Header */
    .fp-fm-header {
      padding: 12px 18px;
      background: #141822;
      border-bottom: 1px solid #232a36;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .fp-fm-title-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .fp-fm-title {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 700;
      color: #f3f4f6;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .fp-fm-badge {
      font-size: 0.7rem;
      background: #1f2633;
      color: #9ca3af;
      padding: 2px 8px;
      border-radius: 4px;
      border: 1px solid #2d3748;
      font-family: monospace;
    }
    .fp-fm-close-btn {
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
    .fp-fm-close-btn:hover {
      color: #fff;
      background: #232a36;
    }

    /* Tabs Bar */
    .fp-fm-tabs {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 16px;
      background: #12151d;
      border-bottom: 1px solid #232a36;
      flex-shrink: 0;
    }
    .fp-fm-tab-btn {
      background: transparent;
      border: none;
      color: #9ca3af;
      font-size: 0.8rem;
      font-weight: 600;
      padding: 10px 14px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      position: relative;
      transition: color 0.15s ease;
    }
    .fp-fm-tab-btn:hover {
      color: #e5e7eb;
    }
    .fp-fm-tab-btn.active {
      color: #ff5e3a;
    }
    .fp-fm-tab-btn.active::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 2px;
      background: #ff5e3a;
    }

    /* Panes */
    .fp-fm-pane {
      display: none;
      flex: 1;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
    }
    .fp-fm-pane.active {
      display: flex;
    }

    /* TAB 2: Upload Files Pane (The Drop Block) */
    .fp-fm-upload-pane {
      flex: 1;
      padding: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0d0f14;
      overflow-y: auto;
    }
    .fp-fm-dropzone-box {
      width: 100%;
      max-width: 620px;
      border: 2px dashed #2f3847;
      border-radius: 12px;
      background: #131720;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 28px 20px;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s ease;
      position: relative;
      box-sizing: border-box;
    }
    .fp-fm-dropzone-box:hover, .fp-fm-dropzone-box.dragover {
      border-color: #ff5e3a;
      background: rgba(255, 94, 58, 0.04);
      box-shadow: 0 0 20px rgba(255, 94, 58, 0.15);
      transform: translateY(-2px);
    }
    .fp-fm-drop-icon {
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background: rgba(255, 94, 58, 0.1);
      color: #ff5e3a;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 12px;
    }
    .fp-fm-drop-title {
      font-size: 1rem;
      font-weight: 700;
      color: #ffffff;
      margin: 0 0 4px 0;
    }
    .fp-fm-drop-subtitle {
      font-size: 0.78rem;
      color: #9ca3af;
      margin: 0 0 14px 0;
    }
    .fp-fm-btn-select-files {
      background: #ff5e3a;
      color: #fff;
      border: none;
      padding: 8px 18px;
      font-size: 0.82rem;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s ease;
      box-shadow: 0 4px 12px rgba(255, 94, 58, 0.3);
    }
    .fp-fm-btn-select-files:hover {
      background: #e04826;
    }
    .fp-fm-drop-notes {
      margin-top: 14px;
      font-size: 0.72rem;
      color: #6b7280;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .fp-fm-drop-notes strong {
      color: #9ca3af;
    }
    .fp-fm-upload-progress {
      margin-top: 14px;
      display: none;
      align-items: center;
      gap: 8px;
      background: #1c222e;
      padding: 8px 16px;
      border-radius: 20px;
      border: 1px solid #2d3748;
      font-size: 0.78rem;
      color: #ff5e3a;
    }

    /* TAB 1: Media Library Pane */
    .fp-fm-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 16px;
      background: #131722;
      border-bottom: 1px solid #232a36;
      flex-shrink: 0;
    }
    .fp-fm-search-wrap {
      position: relative;
      flex: 1;
      max-width: 320px;
    }
    .fp-fm-search-icon {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      color: #6b7280;
      pointer-events: none;
    }
    .fp-fm-search-input {
      width: 100%;
      padding: 6px 28px 6px 30px;
      background: #0d1017;
      border: 1px solid #262e3d;
      border-radius: 6px;
      color: #ffffff;
      font-size: 0.8rem;
      outline: none;
      transition: border-color 0.15s;
    }
    .fp-fm-search-input:focus {
      border-color: #ff5e3a;
      box-shadow: 0 0 0 1px rgba(255, 94, 58, 0.25);
    }
    .fp-fm-search-clear {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: #9ca3af;
      cursor: pointer;
      font-size: 1rem;
      line-height: 1;
      padding: 0;
    }
    .fp-fm-search-clear:hover {
      color: #fff;
    }
    .fp-fm-count-badge {
      font-size: 0.75rem;
      color: #9ca3af;
      white-space: nowrap;
    }

    /* Usage Filter Pills */
    .fp-fm-filter-pills {
      display: inline-flex;
      background: #0d1017;
      border: 1px solid #232a36;
      border-radius: 6px;
      padding: 2px;
      gap: 2px;
    }
    .fp-fm-filter-pill {
      background: transparent;
      border: none;
      color: #9ca3af;
      font-size: 0.72rem;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
      user-select: none;
    }
    .fp-fm-filter-pill:hover {
      color: #fff;
    }
    .fp-fm-filter-pill.active {
      background: #232a36;
      color: #fff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    .fp-fm-filter-pill[data-status="used"].active {
      background: rgba(16, 185, 129, 0.2);
      color: #10b981;
    }
    .fp-fm-filter-pill[data-status="unused"].active {
      background: rgba(245, 158, 11, 0.2);
      color: #f59e0b;
    }

    /* Grid Usage Tag */
    .fp-fm-grid-usage-tag {
      position: absolute;
      top: 6px;
      left: 6px;
      font-size: 0.62rem;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      box-shadow: 0 2px 5px rgba(0,0,0,0.5);
      z-index: 1;
      pointer-events: none;
    }
    .fp-fm-grid-usage-tag.used {
      background: rgba(16, 185, 129, 0.9);
      color: #ffffff;
    }
    .fp-fm-grid-usage-tag.unused {
      background: rgba(26, 32, 44, 0.9);
      color: #f59e0b;
      border: 1px solid rgba(245, 158, 11, 0.5);
    }

    /* List View Usage Tag */
    .fp-fm-list-usage-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.68rem;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 4px;
      white-space: nowrap;
    }
    .fp-fm-list-usage-tag.used {
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .fp-fm-list-usage-tag.unused {
      background: rgba(245, 158, 11, 0.12);
      color: #f59e0b;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    /* Inspector Usage Tracking Section */
    .fp-fm-usage-section {
      background: #161b26;
      border: 1px solid #232a36;
      border-radius: 6px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .fp-fm-usage-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .fp-fm-usage-heading {
      font-size: 0.68rem;
      font-weight: 700;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .fp-fm-usage-pill {
      font-size: 0.65rem;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 3px;
    }
    .fp-fm-usage-pill.used {
      background: rgba(16, 185, 129, 0.18);
      color: #10b981;
    }
    .fp-fm-usage-pill.unused {
      background: rgba(245, 158, 11, 0.18);
      color: #f59e0b;
    }
    .fp-fm-usage-items-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 130px;
      overflow-y: auto;
    }
    .fp-fm-usage-item-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 5px 8px;
      background: #0e121a;
      border: 1px solid #202735;
      border-radius: 5px;
      text-decoration: none;
      color: #d1d5db;
      font-size: 0.72rem;
      transition: all 0.15s ease;
    }
    .fp-fm-usage-item-row:hover {
      background: #1a2230;
      border-color: #ff5e3a;
      color: #ffffff;
    }
    .fp-fm-usage-type-badge {
      font-size: 0.6rem;
      font-weight: 700;
      text-transform: uppercase;
      background: #232b3b;
      color: #9ca3af;
      padding: 1px 5px;
      border-radius: 3px;
      flex-shrink: 0;
    }
    .fp-fm-usage-item-title {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #f3f4f6;
    }
    .fp-fm-usage-item-icon {
      color: #6b7280;
      font-size: 0.75rem;
      flex-shrink: 0;
    }
    .fp-fm-usage-empty-box {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      background: rgba(245, 158, 11, 0.06);
      border: 1px dashed rgba(245, 158, 11, 0.3);
      border-radius: 5px;
      font-size: 0.7rem;
      color: #f59e0b;
      line-height: 1.3;
    }

    .fp-fm-toolbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .fp-fm-view-switcher {
      display: inline-flex;
      background: #0d1017;
      border: 1px solid #262e3d;
      border-radius: 6px;
      padding: 2px;
    }
    .fp-fm-view-btn {
      background: transparent;
      border: none;
      color: #6b7280;
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }
    .fp-fm-view-btn:hover {
      color: #d1d5db;
    }
    .fp-fm-view-btn.active {
      background: #232a36;
      color: #ff5e3a;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    .fp-fm-btn-quick-upload {
      background: #1f2633;
      border: 1px solid #2d3748;
      color: #e5e7eb;
      padding: 5px 10px;
      font-size: 0.76rem;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.15s;
    }
    .fp-fm-btn-quick-upload:hover {
      background: #2a3445;
      color: #fff;
      border-color: #4b5563;
    }
    .fp-fm-btn-refresh {
      background: #1f2633;
      border: 1px solid #2d3748;
      color: #9ca3af;
      padding: 5px 8px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }
    .fp-fm-btn-refresh:hover {
      color: #fff;
      background: #2a3445;
    }

    /* Content Layout */
    .fp-fm-content-layout {
      display: flex;
      flex: 1;
      overflow: hidden;
      min-height: 0;
    }
    .fp-fm-browser-wrap {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 14px;
      background: #0d0f14;
      display: flex;
      flex-direction: column;
    }

    /* View: Grid Mode */
    .fp-fm-browser-wrap.view-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: 12px;
      align-content: start;
    }
    .fp-fm-grid-card {
      position: relative;
      background: #141822;
      border: 2px solid #232a36;
      border-radius: 8px;
      overflow: hidden;
      cursor: pointer;
      transition: all 0.15s ease;
      display: flex;
      flex-direction: column;
      user-select: none;
    }
    .fp-fm-grid-card:hover {
      border-color: #3b4657;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }
    .fp-fm-grid-card.selected {
      border-color: #ff5e3a;
      box-shadow: 0 0 0 1px #ff5e3a;
    }
    .fp-fm-grid-thumb {
      width: 100%;
      height: 100px;
      object-fit: cover;
      background: #090a0f;
      display: block;
    }
    .fp-fm-grid-info {
      padding: 6px 8px;
      background: #161b26;
      display: flex;
      flex-direction: column;
      gap: 2px;
      overflow: hidden;
    }
    .fp-fm-grid-name {
      font-size: 0.72rem;
      font-weight: 600;
      color: #e5e7eb;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: block;
    }
    .fp-fm-grid-meta {
      font-size: 0.65rem;
      color: #9ca3af;
    }
    .fp-fm-grid-check {
      display: none;
      position: absolute;
      top: 6px;
      right: 6px;
      width: 20px;
      height: 20px;
      background: #ff5e3a;
      color: #fff;
      border-radius: 50%;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
    }
    .fp-fm-grid-card.selected .fp-fm-grid-check {
      display: flex;
    }

    /* View: List Mode (Crisp CSS Grid Table) */
    .fp-fm-browser-wrap.view-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      overflow-x: auto;
    }
    .fp-fm-list-header {
      display: grid;
      grid-template-columns: 46px minmax(110px, 1fr) 65px 110px 115px 95px;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      background: #151a24;
      border-radius: 6px;
      border: 1px solid #232a36;
      font-size: 0.68rem;
      font-weight: 700;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .fp-fm-list-row {
      display: grid;
      grid-template-columns: 46px minmax(110px, 1fr) 65px 110px 115px 95px;
      align-items: center;
      gap: 10px;
      padding: 6px 12px;
      background: #131720;
      border: 1px solid #222936;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.12s ease;
      user-select: none;
    }
    .fp-fm-list-row:hover {
      background: #191f2c;
      border-color: #3b4657;
    }
    .fp-fm-list-row.selected {
      background: rgba(255, 94, 58, 0.08);
      border-color: #ff5e3a;
    }
    .fp-fm-col-thumb {
      display: flex;
      align-items: center;
    }
    .fp-fm-list-img {
      width: 32px;
      height: 32px;
      border-radius: 4px;
      object-fit: cover;
      background: #090a0f;
      border: 1px solid #262e3d;
    }
    .fp-fm-col-name {
      min-width: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .fp-fm-list-filename {
      font-size: 0.76rem;
      font-weight: 600;
      color: #f3f4f6;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: block;
    }
    .fp-fm-col-size {
      font-size: 0.72rem;
      color: #9ca3af;
      white-space: nowrap;
    }
    .fp-fm-col-date {
      font-size: 0.7rem;
      color: #9ca3af;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .fp-fm-col-usage {
      display: flex;
      align-items: center;
      min-width: 0;
    }
    .fp-fm-col-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 4px;
    }
    .fp-fm-btn-action {
      background: #1f2633;
      border: 1px solid #2d3748;
      color: #d1d5db;
      font-size: 0.7rem;
      padding: 3px 6px;
      border-radius: 4px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      transition: all 0.12s;
    }
    .fp-fm-btn-action:hover {
      background: #2a3445;
      color: #fff;
    }
    .fp-fm-btn-action.select-btn {
      background: rgba(255, 94, 58, 0.15);
      border-color: rgba(255, 94, 58, 0.4);
      color: #ff5e3a;
      font-weight: 600;
    }
    .fp-fm-btn-action.select-btn:hover {
      background: #ff5e3a;
      color: #fff;
    }
    .fp-fm-btn-action.delete-btn:hover {
      background: #ef4444;
      border-color: #ef4444;
      color: #fff;
    }

    /* Inspector Sidebar */
    .fp-fm-sidebar {
      width: 270px;
      background: #12161f;
      border-left: 1px solid #232a36;
      padding: 14px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      flex-shrink: 0;
    }
    .fp-fm-sidebar-empty {
      text-align: center;
      color: #6b7280;
      font-size: 0.78rem;
      margin-top: 40px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .fp-fm-sidebar-content {
      display: none;
      flex-direction: column;
      gap: 12px;
    }
    .fp-fm-detail-img {
      width: 100%;
      height: 150px;
      object-fit: contain;
      background: #090a0f;
      border-radius: 8px;
      border: 1px solid #232a36;
    }
    .fp-fm-detail-name {
      font-size: 0.82rem;
      font-weight: 700;
      color: #fff;
      word-break: break-all;
    }
    .fp-fm-meta-box {
      background: #161b26;
      border: 1px solid #232a36;
      border-radius: 6px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .fp-fm-meta-row {
      display: flex;
      justify-content: space-between;
      font-size: 0.72rem;
      color: #9ca3af;
    }
    .fp-fm-meta-row strong {
      color: #e5e7eb;
    }
    .fp-fm-url-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .fp-fm-url-label {
      font-size: 0.68rem;
      text-transform: uppercase;
      font-weight: 700;
      color: #9ca3af;
    }
    .fp-fm-url-row {
      display: flex;
      gap: 4px;
    }
    .fp-fm-url-input {
      flex: 1;
      background: #090a0f;
      border: 1px solid #232a36;
      border-radius: 4px;
      color: #d1d5db;
      font-size: 0.72rem;
      padding: 4px 6px;
      outline: none;
    }
    .fp-fm-btn-copy {
      background: #1f2633;
      border: 1px solid #2d3748;
      color: #e5e7eb;
      font-size: 0.72rem;
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
    }
    .fp-fm-btn-copy:hover {
      background: #2a3445;
      color: #fff;
    }
    .fp-fm-btn-delete-full {
      width: 100%;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #ef4444;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 7px 10px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.15s;
    }
    .fp-fm-btn-delete-full:hover {
      background: #ef4444;
      color: #fff;
    }

    /* Empty state */
    .fp-fm-empty {
      grid-column: 1 / -1;
      text-align: center;
      padding: 50px 20px;
      color: #6b7280;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }
    .fp-fm-empty p {
      margin: 0;
      font-size: 0.85rem;
      color: #9ca3af;
    }

    /* Footer */
    .fp-fm-footer {
      padding: 12px 18px;
      background: #141822;
      border-top: 1px solid #232a36;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      flex-shrink: 0;
    }
    .fp-fm-btn-cancel {
      background: #1f2633;
      border: 1px solid #2d3748;
      color: #d1d5db;
      font-size: 0.8rem;
      padding: 7px 14px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .fp-fm-btn-cancel:hover {
      background: #2a3445;
      color: #fff;
    }
    .fp-fm-btn-insert {
      background: #ff5e3a;
      border: none;
      color: #fff;
      font-size: 0.8rem;
      font-weight: 600;
      padding: 7px 18px;
      border-radius: 6px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(255, 94, 58, 0.3);
      transition: all 0.15s;
      opacity: 0.5;
    }
    .fp-fm-btn-insert:not(:disabled) {
      opacity: 1;
    }
    .fp-fm-btn-insert:not(:disabled):hover {
      background: #e04826;
    }
  `;

  // Inject Styles Once
  function injectStyles() {
    if (document.getElementById('fastpress-file-manager-styles')) return;
    const styleEl = document.createElement('style');
    styleEl.id = 'fastpress-file-manager-styles';
    styleEl.textContent = STYLES;
    document.head.appendChild(styleEl);
  }

  // Toast Notification helper
  function showToast(msg, isError = false) {
    let toast = document.getElementById('toastNotify') || document.querySelector('.builder-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toastNotify';
      toast.style.cssText = `
        position: fixed; bottom: 24px; right: 24px; z-index: 999999;
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

  // Controller State
  let modalEl = null;
  let activeTab = 'library'; // 'library' | 'products' | 'upload'
  let viewMode = localStorage.getItem('fastpress_media_view_mode') || 'grid'; // 'grid' | 'list'
  let activeStatusFilter = 'all'; // 'all' | 'used' | 'unused'
  let allFiles = [];
  let currentFilter = '';
  let selectedFile = null;
  let onSelectCallback = null;
  let targetComponent = null;

  // Products Tab State
  let allProductItems = [];
  let currentProductFilter = '';
  let activeProductCatFilter = 'all';
  let selectedProductItem = null;

  // Build Modal DOM
  function createModalDOM() {
    if (document.getElementById('modalFileManager')) {
      modalEl = document.getElementById('modalFileManager');
      // If modal already has the legacy structure, we replace its content with the unified tabs & drop block
      modalEl.className = 'fp-fm-backdrop';
      modalEl.innerHTML = renderModalCardHTML();
    } else {
      modalEl = document.createElement('div');
      modalEl.id = 'modalFileManager';
      modalEl.className = 'fp-fm-backdrop';
      modalEl.innerHTML = renderModalCardHTML();
      document.body.appendChild(modalEl);
    }

    bindEvents();
  }

  function renderModalCardHTML() {
    return `
      <div class="fp-fm-card">
        <!-- Header -->
        <div class="fp-fm-header">
          <div class="fp-fm-title-wrap">
            <h3 class="fp-fm-title">
              ${ICONS.library}
              <span>Media Library & File Manager</span>
            </h3>
            <span class="fp-fm-badge">public/uploads</span>
          </div>
          <button type="button" class="fp-fm-close-btn" id="btnFmClose" title="Close File Manager">&times;</button>
        </div>

        <!-- Tabs Navigation -->
        <div class="fp-fm-tabs">
          <button type="button" class="fp-fm-tab-btn ${activeTab === 'library' ? 'active' : ''}" id="btnFmTabLibrary" data-tab="library">
            ${ICONS.library}
            <span>Media Library</span>
          </button>
          <button type="button" class="fp-fm-tab-btn ${activeTab === 'products' ? 'active' : ''}" id="btnFmTabProducts" data-tab="products">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            <span>Products</span>
          </button>
          <button type="button" class="fp-fm-tab-btn ${activeTab === 'upload' ? 'active' : ''}" id="btnFmTabUpload" data-tab="upload">
            ${ICONS.upload}
            <span>Upload Files</span>
          </button>
        </div>

        <!-- TAB 1: Media Library Pane -->
        <div class="fp-fm-pane ${activeTab === 'library' ? 'active' : ''}" id="fmPaneLibrary">
          <!-- Toolbar -->
          <div class="fp-fm-toolbar">
            <!-- Search Form -->
            <div class="fp-fm-search-wrap">
              <span class="fp-fm-search-icon">${ICONS.search}</span>
              <input type="text" id="fmSearchInput" class="fp-fm-search-input" placeholder="Search image name..." autocomplete="off" />
              <button type="button" id="fmSearchClearBtn" class="fp-fm-search-clear" style="display: none;" title="Clear search">&times;</button>
            </div>

            <!-- Usage Filter Pills -->
            <div class="fp-fm-filter-pills" id="fmFilterPills" role="group" aria-label="Usage Filter">
              <button type="button" class="fp-fm-filter-pill active" data-status="all" id="btnFilterAll">All (<span id="countAll">0</span>)</button>
              <button type="button" class="fp-fm-filter-pill" data-status="used" id="btnFilterUsed">Used (<span id="countUsed">0</span>)</button>
              <button type="button" class="fp-fm-filter-pill" data-status="unused" id="btnFilterUnused">Unused (<span id="countUnused">0</span>)</button>
            </div>

            <span id="fmCountBadge" class="fp-fm-count-badge">0 images</span>

            <!-- Actions: View Switcher (Grid/List), Quick Upload, Refresh -->
            <div class="fp-fm-toolbar-actions">
              <div class="fp-fm-view-switcher" role="group" aria-label="View Mode">
                <button type="button" class="fp-fm-view-btn ${viewMode === 'grid' ? 'active' : ''}" id="btnFmViewGrid" title="Grid View">
                  ${ICONS.grid}
                </button>
                <button type="button" class="fp-fm-view-btn ${viewMode === 'list' ? 'active' : ''}" id="btnFmViewList" title="List View">
                  ${ICONS.list}
                </button>
              </div>

              <button type="button" class="fp-fm-btn-quick-upload" id="btnFmQuickUpload">
                ${ICONS.upload}
                <span>Upload New</span>
              </button>

              <button type="button" class="fp-fm-btn-refresh" id="btnFmRefresh" title="Refresh Images List">
                ${ICONS.refresh}
              </button>
            </div>
          </div>

          <!-- Browser & Details Layout -->
          <div class="fp-fm-content-layout">
            <!-- Left: Items Browser -->
            <div class="fp-fm-browser-wrap view-${viewMode}" id="fmBrowserWrap">
              <!-- Populated dynamically -->
            </div>

            <!-- Right: Details Sidebar -->
            <div class="fp-fm-sidebar" id="fmSidebar">
              <div class="fp-fm-sidebar-empty" id="fmSidebarEmpty">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.35;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                <p>Select an image to preview details & actions.</p>
              </div>

              <div class="fp-fm-sidebar-content" id="fmSidebarContent">
                <img src="" alt="Preview" class="fp-fm-detail-img" id="fmDetailImg" />
                <div class="fp-fm-detail-name" id="fmDetailName">-</div>

                <div class="fp-fm-meta-box">
                  <div class="fp-fm-meta-row">
                    <span>File Size</span>
                    <strong id="fmDetailSize">-</strong>
                  </div>
                  <div class="fp-fm-meta-row">
                    <span>Upload Date</span>
                    <strong id="fmDetailDate">-</strong>
                  </div>
                </div>

                <!-- Page Usage Tracking -->
                <div class="fp-fm-usage-section">
                  <div class="fp-fm-usage-title-row">
                    <span class="fp-fm-usage-heading">Page Usage</span>
                    <span class="fp-fm-usage-pill" id="fmUsagePill">-</span>
                  </div>
                  <div class="fp-fm-usage-items-list" id="fmUsageItemsList">
                    <!-- Dynamic usage items -->
                  </div>
                </div>

                <div class="fp-fm-url-group">
                  <label class="fp-fm-url-label">Image URL</label>
                  <div class="fp-fm-url-row">
                    <input type="text" id="fmDetailUrl" class="fp-fm-url-input" readonly />
                    <button type="button" class="fp-fm-btn-copy" id="btnFmCopyUrl" title="Copy URL">Copy</button>
                  </div>
                </div>

                <div style="margin-top: 6px; padding-top: 10px; border-top: 1px solid #232a36;">
                  <button type="button" class="fp-fm-btn-delete-full" id="btnFmDeleteFile">
                    ${ICONS.trash}
                    <span>Delete File Permanently</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- TAB 2: Products Specific Images Pane -->
        <div class="fp-fm-pane ${activeTab === 'products' ? 'active' : ''}" id="fmPaneProducts">
          <!-- Products Toolbar -->
          <div class="fp-fm-toolbar">
            <div class="fp-fm-search-wrap">
              <span class="fp-fm-search-icon">${ICONS.search}</span>
              <input type="text" id="fmSearchProductsInput" class="fp-fm-search-input" placeholder="Search product name, category, SKU..." autocomplete="off" />
              <button type="button" id="fmSearchProductsClearBtn" class="fp-fm-search-clear" style="display: none;" title="Clear search">&times;</button>
            </div>

            <!-- Product Category Filter Pills -->
            <div class="fp-fm-filter-pills" id="fmProductCategoryPills" role="group" aria-label="Category Filter">
              <button type="button" class="fp-fm-filter-pill active" data-cat="all" id="btnProductFilterAll">All (<span id="countProdAll">0</span>)</button>
              <button type="button" class="fp-fm-filter-pill" data-cat="T-Shirts">Tees</button>
              <button type="button" class="fp-fm-filter-pill" data-cat="Hoodies">Hoodies</button>
              <button type="button" class="fp-fm-filter-pill" data-cat="Jackets">Jackets</button>
              <button type="button" class="fp-fm-filter-pill" data-cat="Pants">Pants</button>
              <button type="button" class="fp-fm-filter-pill" data-cat="Shirts">Shirts</button>
              <button type="button" class="fp-fm-filter-pill" data-cat="Accessories">Accessories</button>
            </div>

            <span id="fmProductCountBadge" class="fp-fm-count-badge">0 product images</span>

            <!-- Actions -->
            <div class="fp-fm-toolbar-actions">
              <button type="button" class="fp-fm-btn-quick-upload" id="btnFmQuickUploadProduct">
                ${ICONS.upload}
                <span>Upload For Products</span>
              </button>
              <button type="button" class="fp-fm-btn-refresh" id="btnFmRefreshProducts" title="Refresh Products List">
                ${ICONS.refresh}
              </button>
            </div>
          </div>

          <!-- Products Content Layout -->
          <div class="fp-fm-content-layout">
            <!-- Left: Product Images Grid -->
            <div class="fp-fm-browser-wrap view-grid" id="fmProductsBrowserWrap">
              <!-- Populated dynamically -->
            </div>

            <!-- Right: Product Inspector Sidebar -->
            <div class="fp-fm-sidebar" id="fmProductSidebar">
              <div class="fp-fm-sidebar-empty" id="fmProductSidebarEmpty">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.35;"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
                <p>Select any product image to preview details, pricing, and live page link.</p>
              </div>

              <div class="fp-fm-sidebar-content" id="fmProductSidebarContent" style="display: none;">
                <img src="" alt="Preview" class="fp-fm-detail-img" id="fmProductDetailImg" />
                <div class="fp-fm-detail-name" id="fmProductDetailName">-</div>

                <div class="fp-fm-meta-box">
                  <div class="fp-fm-meta-row">
                    <span>Category</span>
                    <strong id="fmProductDetailCategory" style="color: #60a5fa;">-</strong>
                  </div>
                  <div class="fp-fm-meta-row">
                    <span>Price</span>
                    <strong id="fmProductDetailPrice" style="color: #34d399;">-</strong>
                  </div>
                  <div class="fp-fm-meta-row">
                    <span>SKU</span>
                    <strong id="fmProductDetailSku">-</strong>
                  </div>
                </div>

                <div class="fp-fm-usage-section">
                  <div class="fp-fm-usage-title-row">
                    <span class="fp-fm-usage-heading">Product Catalog</span>
                    <span class="fp-fm-usage-pill used" id="fmProductDetailStock">In Stock</span>
                  </div>
                  <div class="fp-fm-usage-items-list" id="fmProductDetailLinks">
                    <!-- Populated dynamically -->
                  </div>
                </div>

                <div class="fp-fm-url-group">
                  <label class="fp-fm-url-label">Image URL</label>
                  <div class="fp-fm-url-row">
                    <input type="text" id="fmProductDetailUrl" class="fp-fm-url-input" readonly />
                    <button type="button" class="fp-fm-btn-copy" id="btnFmProductCopyUrl" title="Copy URL">Copy</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- TAB 2: Upload Files Pane (The dedicated Dropzone Block) -->
        <div class="fp-fm-pane ${activeTab === 'upload' ? 'active' : ''}" id="fmPaneUpload">
          <div class="fp-fm-upload-pane">
            <div class="fp-fm-dropzone-box" id="fmDropzoneBox">
              <input type="file" id="fmFileInput" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif" multiple style="display: none;" />
              
              <div class="fp-fm-drop-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
              </div>

              <h4 class="fp-fm-drop-title">Drop files here to upload</h4>
              <p class="fp-fm-drop-subtitle">or select images from your device</p>

              <button type="button" class="fp-fm-btn-select-files" id="btnFmBrowseFiles">
                ${ICONS.upload}
                <span>Select Files</span>
              </button>

              <div class="fp-fm-drop-notes">
                <span>Maximum upload file size: <strong>200 KB</strong> per file</span>
                <span>Allowed image formats: <strong>JPG, PNG, WEBP, GIF, SVG, AVIF</strong></span>
              </div>

              <div class="fp-fm-upload-progress" id="fmUploadProgress">
                <div class="upload-spinner active">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
                </div>
                <span id="fmUploadProgressText">Uploading...</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="fp-fm-footer">
          <button type="button" class="fp-fm-btn-cancel" id="btnFmFooterClose">Close</button>
          <button type="button" class="fp-fm-btn-insert" id="btnFmInsert" disabled>Insert Selected Image</button>
        </div>
      </div>
    `;
  }

  // Bind Event Listeners
  function bindEvents() {
    // Close modal
    const closeBtns = [
      document.getElementById('btnFmClose'),
      document.getElementById('btnFmFooterClose')
    ];
    closeBtns.forEach(btn => {
      btn?.addEventListener('click', () => closeFileManager());
    });

    // Close on backdrop click
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) closeFileManager();
    });

    // Close on Escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalEl?.classList.contains('open')) {
        closeFileManager();
      }
    });

    // Tabs navigation
    document.getElementById('btnFmTabLibrary')?.addEventListener('click', () => switchTab('library'));
    document.getElementById('btnFmTabProducts')?.addEventListener('click', () => switchTab('products'));
    document.getElementById('btnFmTabUpload')?.addEventListener('click', () => switchTab('upload'));
    document.getElementById('btnFmQuickUpload')?.addEventListener('click', () => switchTab('upload'));
    document.getElementById('btnFmQuickUploadProduct')?.addEventListener('click', () => switchTab('upload'));

    // View Switcher (Grid vs List)
    document.getElementById('btnFmViewGrid')?.addEventListener('click', () => setViewMode('grid'));
    document.getElementById('btnFmViewList')?.addEventListener('click', () => setViewMode('list'));

    // Usage Filter Pills (All / Used / Unused)
    document.querySelectorAll('#fmFilterPills .fp-fm-filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#fmFilterPills .fp-fm-filter-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeStatusFilter = btn.dataset.status || 'all';
        renderBrowserItems();
      });
    });

    // Products Category Filter Pills
    document.querySelectorAll('#fmProductCategoryPills .fp-fm-filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#fmProductCategoryPills .fp-fm-filter-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeProductCatFilter = btn.dataset.cat || 'all';
        renderProductBrowserItems();
      });
    });

    // Search filter - Media Library
    const searchInput = document.getElementById('fmSearchInput');
    const searchClear = document.getElementById('fmSearchClearBtn');

    searchInput?.addEventListener('input', (e) => {
      currentFilter = e.target.value.toLowerCase().trim();
      searchClear.style.display = currentFilter ? 'block' : 'none';
      renderBrowserItems();
    });

    searchClear?.addEventListener('click', () => {
      searchInput.value = '';
      currentFilter = '';
      searchClear.style.display = 'none';
      renderBrowserItems();
      searchInput.focus();
    });

    // Search filter - Products
    const searchProdInput = document.getElementById('fmSearchProductsInput');
    const searchProdClear = document.getElementById('fmSearchProductsClearBtn');

    searchProdInput?.addEventListener('input', (e) => {
      currentProductFilter = e.target.value.toLowerCase().trim();
      searchProdClear.style.display = currentProductFilter ? 'block' : 'none';
      renderProductBrowserItems();
    });

    searchProdClear?.addEventListener('click', () => {
      searchProdInput.value = '';
      currentProductFilter = '';
      searchProdClear.style.display = 'none';
      renderProductBrowserItems();
      searchProdInput.focus();
    });

    // Refresh buttons
    document.getElementById('btnFmRefresh')?.addEventListener('click', () => loadMediaLibrary());
    document.getElementById('btnFmRefreshProducts')?.addEventListener('click', () => loadProductImages());

    // File Dropzone & Selection in Upload Tab
    const fileInput = document.getElementById('fmFileInput');
    const dropzoneBox = document.getElementById('fmDropzoneBox');
    const btnBrowse = document.getElementById('btnFmBrowseFiles');

    btnBrowse?.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });

    dropzoneBox?.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput?.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) {
        await handleFilesUpload(files);
        fileInput.value = '';
      }
    });

    // Drag & Drop on dropzone
    ['dragenter', 'dragover'].forEach(evt => {
      dropzoneBox?.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzoneBox.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(evt => {
      dropzoneBox?.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzoneBox.classList.remove('dragover');
      });
    });

    dropzoneBox?.addEventListener('drop', async (e) => {
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length > 0) {
        await handleFilesUpload(files);
      }
    });

    // Also support dropping files on the media browser area
    const browserWrap = document.getElementById('fmBrowserWrap');
    ['dragenter', 'dragover'].forEach(evt => {
      browserWrap?.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        browserWrap.style.outline = '2px dashed #ff5e3a';
      });
    });
    ['dragleave', 'drop'].forEach(evt => {
      browserWrap?.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        browserWrap.style.outline = 'none';
      });
    });
    browserWrap?.addEventListener('drop', async (e) => {
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length > 0) {
        await handleFilesUpload(files);
      }
    });

    // Copy URL
    document.getElementById('btnFmCopyUrl')?.addEventListener('click', () => {
      const urlInput = document.getElementById('fmDetailUrl');
      if (urlInput && urlInput.value) {
        navigator.clipboard.writeText(urlInput.value);
        showToast('Image URL copied to clipboard!');
      }
    });

    document.getElementById('btnFmProductCopyUrl')?.addEventListener('click', () => {
      const urlInput = document.getElementById('fmProductDetailUrl');
      if (urlInput && urlInput.value) {
        navigator.clipboard.writeText(urlInput.value);
        showToast('Product Image URL copied to clipboard!');
      }
    });

    // Delete Action
    document.getElementById('btnFmDeleteFile')?.addEventListener('click', () => {
      if (selectedFile) deleteFile(selectedFile);
    });

    // Insert Action
    document.getElementById('btnFmInsert')?.addEventListener('click', () => {
      confirmSelection();
    });
  }

  // Switch Tabs
  function switchTab(tab) {
    activeTab = tab;
    document.getElementById('btnFmTabLibrary')?.classList.toggle('active', tab === 'library');
    document.getElementById('btnFmTabProducts')?.classList.toggle('active', tab === 'products');
    document.getElementById('btnFmTabUpload')?.classList.toggle('active', tab === 'upload');

    document.getElementById('fmPaneLibrary')?.classList.toggle('active', tab === 'library');
    document.getElementById('fmPaneProducts')?.classList.toggle('active', tab === 'products');
    document.getElementById('fmPaneUpload')?.classList.toggle('active', tab === 'upload');

    if (tab === 'products') {
      loadProductImages();
    }
  }

  // Set View Mode (Grid vs List)
  function setViewMode(mode) {
    viewMode = mode;
    localStorage.setItem('fastpress_media_view_mode', mode);

    const btnGrid = document.getElementById('btnFmViewGrid');
    const btnList = document.getElementById('btnFmViewList');
    btnGrid?.classList.toggle('active', mode === 'grid');
    btnList?.classList.toggle('active', mode === 'list');

    const browserWrap = document.getElementById('fmBrowserWrap');
    if (browserWrap) {
      browserWrap.className = `fp-fm-browser-wrap view-${mode}`;
    }

    renderBrowserItems();
  }

  // Load Media Library from /api/upload
  async function loadMediaLibrary(preferredSelectUrl) {
    const browserWrap = document.getElementById('fmBrowserWrap');
    if (!browserWrap) return;

    browserWrap.innerHTML = `
      <div class="fp-fm-empty">
        <div class="upload-spinner active">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
        </div>
        <p>Loading media from public/uploads...</p>
      </div>
    `;

    try {
      const res = await fetch('/api/upload');
      const data = await res.json();
      if (Array.isArray(data)) {
        allFiles = data;
        renderBrowserItems();

        if (preferredSelectUrl) {
          const match = allFiles.find(f => f.url === preferredSelectUrl);
          if (match) selectFile(match);
        } else if (selectedFile) {
          const stillExists = allFiles.find(f => f.fileName === selectedFile.fileName);
          if (stillExists) selectFile(stillExists);
          else clearSelection();
        }
      } else {
        browserWrap.innerHTML = `<div class="fp-fm-empty"><p>Error loading media: ${data.error || 'Server error'}</p></div>`;
      }
    } catch (err) {
      browserWrap.innerHTML = `<div class="fp-fm-empty"><p>Failed to connect to server: ${err.message}</p></div>`;
    }
  }

  // Render Browser Items in Grid or List Mode
  function renderBrowserItems() {
    const browserWrap = document.getElementById('fmBrowserWrap');
    const countBadge = document.getElementById('fmCountBadge');
    if (!browserWrap) return;

    // Update live counts on filter pills
    const totalCount = allFiles.length;
    const usedCount = allFiles.filter(f => f.isUsed).length;
    const unusedCount = allFiles.filter(f => !f.isUsed).length;

    const countAllEl = document.getElementById('countAll');
    const countUsedEl = document.getElementById('countUsed');
    const countUnusedEl = document.getElementById('countUnused');
    if (countAllEl) countAllEl.textContent = totalCount;
    if (countUsedEl) countUsedEl.textContent = usedCount;
    if (countUnusedEl) countUnusedEl.textContent = unusedCount;

    // Filter by active status (all, used, unused) & search keyword
    let filtered = allFiles;
    if (activeStatusFilter === 'used') {
      filtered = filtered.filter(f => f.isUsed);
    } else if (activeStatusFilter === 'unused') {
      filtered = filtered.filter(f => !f.isUsed);
    }
    if (currentFilter) {
      filtered = filtered.filter(f => f.fileName.toLowerCase().includes(currentFilter));
    }

    if (countBadge) {
      if (currentFilter || activeStatusFilter !== 'all') {
        countBadge.textContent = `Showing ${filtered.length} of ${allFiles.length} images`;
      } else {
        countBadge.textContent = `${allFiles.length} images`;
      }
    }

    if (allFiles.length === 0) {
      browserWrap.innerHTML = `
        <div class="fp-fm-empty">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.35;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          <p style="font-weight: 700; color: #fff;">No images uploaded yet</p>
          <p style="font-size: 0.78rem;">Click the "Upload Files" tab to drag & drop or select images.</p>
          <button type="button" class="fp-fm-btn-select-files" id="btnEmptyStateUpload" style="margin-top: 8px;">
            ${ICONS.upload}
            <span>Upload Images Now</span>
          </button>
        </div>
      `;
      document.getElementById('btnEmptyStateUpload')?.addEventListener('click', () => switchTab('upload'));
      clearSelection();
      return;
    }

    if (filtered.length === 0) {
      const reason = currentFilter && activeStatusFilter !== 'all'
        ? `"${currentFilter}" with status "${activeStatusFilter}"`
        : (currentFilter ? `"${currentFilter}"` : `status "${activeStatusFilter}"`);
      browserWrap.innerHTML = `
        <div class="fp-fm-empty">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.4;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <p>No images found matching ${reason}</p>
          <button type="button" class="fp-fm-btn-cancel" id="btnEmptyClearSearch" style="margin-top: 6px;">Reset Filter</button>
        </div>
      `;
      document.getElementById('btnEmptyClearSearch')?.addEventListener('click', () => {
        const inp = document.getElementById('fmSearchInput');
        if (inp) {
          inp.value = '';
          currentFilter = '';
          document.getElementById('fmSearchClearBtn').style.display = 'none';
        }
        activeStatusFilter = 'all';
        document.querySelectorAll('.fp-fm-filter-pill').forEach(b => b.classList.remove('active'));
        document.getElementById('btnFilterAll')?.classList.add('active');
        renderBrowserItems();
      });
      return;
    }

    browserWrap.innerHTML = '';

    if (viewMode === 'grid') {
      // GRID VIEW
      filtered.forEach(file => {
        const card = document.createElement('div');
        const isSel = selectedFile && selectedFile.fileName === file.fileName;
        card.className = 'fp-fm-grid-card' + (isSel ? ' selected' : '');
        const usageBadge = file.isUsed
          ? `<span class="fp-fm-grid-usage-tag used" title="Used in ${file.usageCount} location(s)">● ${file.usageCount} Used</span>`
          : `<span class="fp-fm-grid-usage-tag unused" title="Not currently used on any page">○ Unused</span>`;

        card.innerHTML = `
          ${usageBadge}
          <img src="${file.url}" alt="${file.fileName}" class="fp-fm-grid-thumb" loading="lazy" />
          <div class="fp-fm-grid-info">
            <span class="fp-fm-grid-name" title="${file.fileName}">${file.fileName}</span>
            <span class="fp-fm-grid-meta">${file.size} • ${file.formattedDate || ''}</span>
          </div>
          <div class="fp-fm-grid-check">${ICONS.check}</div>
        `;

        card.addEventListener('click', () => selectFile(file));
        card.addEventListener('dblclick', () => {
          selectFile(file);
          confirmSelection();
        });

        browserWrap.appendChild(card);
      });
    } else {
      // LIST VIEW
      const header = document.createElement('div');
      header.className = 'fp-fm-list-header';
      header.innerHTML = `
        <div class="fp-fm-col-thumb">Preview</div>
        <div class="fp-fm-col-name">File Name</div>
        <div class="fp-fm-col-size">Size</div>
        <div class="fp-fm-col-date">Date Added</div>
        <div class="fp-fm-col-usage">Page Usage</div>
        <div class="fp-fm-col-actions">Actions</div>
      `;
      browserWrap.appendChild(header);

      filtered.forEach(file => {
        const row = document.createElement('div');
        const isSel = selectedFile && selectedFile.fileName === file.fileName;
        row.className = 'fp-fm-list-row' + (isSel ? ' selected' : '');
        const usageTitles = (file.usedIn || []).map(u => `[${u.type}] ${u.title}`).join(', ');
        const usageTag = file.isUsed
          ? `<span class="fp-fm-list-usage-tag used" title="Used in: ${usageTitles}">● ${file.usageCount} Used</span>`
          : `<span class="fp-fm-list-usage-tag unused" title="Not currently used on any page">○ Unused</span>`;

        row.innerHTML = `
          <div class="fp-fm-col-thumb">
            <img src="${file.url}" alt="${file.fileName}" class="fp-fm-list-img" loading="lazy" />
          </div>
          <div class="fp-fm-col-name">
            <span class="fp-fm-list-filename" title="${file.fileName}">${file.fileName}</span>
          </div>
          <div class="fp-fm-col-size">${file.size}</div>
          <div class="fp-fm-col-date">${file.formattedDate || '-'}</div>
          <div class="fp-fm-col-usage">${usageTag}</div>
          <div class="fp-fm-col-actions">
            <button type="button" class="fp-fm-btn-action select-btn" title="Choose this image">Select</button>
            <button type="button" class="fp-fm-btn-action copy-btn" title="Copy image URL">${ICONS.copy}</button>
            <button type="button" class="fp-fm-btn-action delete-btn" title="Delete file">${ICONS.trash}</button>
          </div>
        `;

        row.addEventListener('click', (e) => {
          if (e.target.closest('.fp-fm-btn-action')) return;
          selectFile(file);
        });

        row.addEventListener('dblclick', () => {
          selectFile(file);
          confirmSelection();
        });

        row.querySelector('.select-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          selectFile(file);
          confirmSelection();
        });

        row.querySelector('.copy-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(file.url);
          showToast('Image URL copied to clipboard!');
        });

        row.querySelector('.delete-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteFile(file);
        });

        browserWrap.appendChild(row);
      });
    }
  }

  // Load Product Images from /api/products
  async function loadProductImages(preferredSelectUrl) {
    const browserWrap = document.getElementById('fmProductsBrowserWrap');
    if (!browserWrap) return;

    browserWrap.innerHTML = `
      <div class="fp-fm-empty">
        <div class="upload-spinner active">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
        </div>
        <p>Loading product catalog images...</p>
      </div>
    `;

    try {
      const res = await fetch('/api/products');
      const rawData = await res.json();
      const products = Array.isArray(rawData) ? rawData : (rawData?.products || []);
      if (Array.isArray(products) && products.length > 0) {
        // Collect all product images
        const items = [];
        products.forEach(p => {
          const allImgs = [p.image, p.featuredImage, ...(p.gallery || []), ...(p.images || [])].filter(Boolean);
          const uniqueImgs = [...new Set(allImgs)];
          uniqueImgs.forEach((imgUrl, idx) => {
            items.push({
              url: imgUrl,
              product: p,
              title: p.title + (idx > 0 ? ` (Angle ${idx + 1})` : ''),
              category: p.category || 'Apparel',
              price: p.price,
              currency: p.currency || '$',
              sku: p.sku || '',
              slug: p.slug
            });
          });
        });
        allProductItems = items;
        renderProductBrowserItems();

        if (preferredSelectUrl) {
          const match = allProductItems.find(it => it.url === preferredSelectUrl);
          if (match) selectProductItem(match);
        }
      } else {
        browserWrap.innerHTML = `<div class="fp-fm-empty"><p>Error loading products: ${products.error || 'Server error'}</p></div>`;
      }
    } catch (err) {
      browserWrap.innerHTML = `<div class="fp-fm-empty"><p>Failed to connect to server: ${err.message}</p></div>`;
    }
  }

  // Render Product Browser Items
  function renderProductBrowserItems() {
    const browserWrap = document.getElementById('fmProductsBrowserWrap');
    const countBadge = document.getElementById('fmProductCountBadge');
    const countAllEl = document.getElementById('countProdAll');
    if (!browserWrap) return;

    if (countAllEl) countAllEl.textContent = allProductItems.length;

    let filtered = allProductItems;
    if (activeProductCatFilter !== 'all') {
      filtered = filtered.filter(it => it.category.toLowerCase().includes(activeProductCatFilter.toLowerCase()));
    }
    if (currentProductFilter) {
      filtered = filtered.filter(it =>
        it.title.toLowerCase().includes(currentProductFilter) ||
        it.category.toLowerCase().includes(currentProductFilter) ||
        it.sku.toLowerCase().includes(currentProductFilter)
      );
    }

    if (countBadge) {
      countBadge.textContent = `${filtered.length} product images`;
    }

    if (allProductItems.length === 0) {
      browserWrap.innerHTML = `
        <div class="fp-fm-empty">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.35;"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
          <p style="font-weight: 700; color: #fff;">No product images found</p>
          <p style="font-size: 0.78rem;">Add products in the Product Studio or upload images.</p>
        </div>
      `;
      return;
    }

    if (filtered.length === 0) {
      browserWrap.innerHTML = `
        <div class="fp-fm-empty">
          <p>No products found matching "${currentProductFilter}"</p>
        </div>
      `;
      return;
    }

    browserWrap.innerHTML = '';
    filtered.forEach(item => {
      const card = document.createElement('div');
      const isSel = selectedFile && selectedFile.url === item.url;
      card.className = 'fp-fm-grid-card' + (isSel ? ' selected' : '');

      card.innerHTML = `
        <span class="fp-fm-grid-usage-tag used" style="background: rgba(96, 165, 250, 0.15); color: #93c5fd; border: 1px solid rgba(96, 165, 250, 0.3);">
          ${item.category} • ${item.currency}${item.price}
        </span>
        <img src="${item.url}" alt="${item.title}" class="fp-fm-grid-thumb" loading="lazy" />
        <div class="fp-fm-grid-info">
          <span class="fp-fm-grid-name" title="${item.title}">${item.title}</span>
          <span class="fp-fm-grid-meta">SKU: ${item.sku}</span>
        </div>
        <div class="fp-fm-grid-check">${ICONS.check}</div>
      `;

      card.addEventListener('click', () => selectProductItem(item));
      card.addEventListener('dblclick', () => {
        selectProductItem(item);
        confirmSelection();
      });

      browserWrap.appendChild(card);
    });
  }

  // Select Product Item & Update Product Inspector Sidebar
  function selectProductItem(item) {
    selectedProductItem = item;
    selectedFile = {
      url: item.url,
      fileName: item.title,
      size: 'Product Image',
      isUsed: true
    };

    // Update active highlight in DOM
    document.querySelectorAll('#fmProductsBrowserWrap .fp-fm-grid-card').forEach(c => {
      const img = c.querySelector('img');
      c.classList.toggle('selected', img && img.src === item.url);
    });

    // Update Product Sidebar
    const emptyEl = document.getElementById('fmProductSidebarEmpty');
    const contentEl = document.getElementById('fmProductSidebarContent');
    if (emptyEl) emptyEl.style.display = 'none';
    if (contentEl) contentEl.style.display = 'flex';

    const detailImg = document.getElementById('fmProductDetailImg');
    const detailName = document.getElementById('fmProductDetailName');
    const detailCat = document.getElementById('fmProductDetailCategory');
    const detailPrice = document.getElementById('fmProductDetailPrice');
    const detailSku = document.getElementById('fmProductDetailSku');
    const detailUrl = document.getElementById('fmProductDetailUrl');
    const detailLinks = document.getElementById('fmProductDetailLinks');

    if (detailImg) detailImg.src = item.url;
    if (detailName) detailName.textContent = item.title;
    if (detailCat) detailCat.textContent = item.category;
    if (detailPrice) detailPrice.textContent = `${item.currency}${item.price}`;
    if (detailSku) detailSku.textContent = item.sku || '-';
    if (detailUrl) detailUrl.value = item.url;

    if (detailLinks && item.slug) {
      detailLinks.innerHTML = `
        <a href="/products/${item.slug}" target="_blank" class="fp-fm-usage-item-row" title="Open Product Page in new tab">
          <span class="fp-fm-usage-type-badge">Product</span>
          <span class="fp-fm-usage-item-title">/products/${item.slug}</span>
          <span class="fp-fm-usage-item-icon">↗</span>
        </a>
      `;
    }

    // Enable Insert button
    const insertBtn = document.getElementById('btnFmInsert');
    if (insertBtn) insertBtn.disabled = false;
  }

  // Select File & Update Inspector Sidebar
  function selectFile(file) {
    selectedFile = file;

    // Update active highlight in DOM
    document.querySelectorAll('.fp-fm-grid-card').forEach(card => {
      const name = card.querySelector('.fp-fm-grid-name')?.textContent;
      card.classList.toggle('selected', name === file.fileName);
    });
    document.querySelectorAll('.fp-fm-list-row').forEach(row => {
      const name = row.querySelector('.fp-fm-list-filename')?.textContent;
      row.classList.toggle('selected', name === file.fileName);
    });

    // Update Sidebar
    const emptyEl = document.getElementById('fmSidebarEmpty');
    const contentEl = document.getElementById('fmSidebarContent');
    if (emptyEl) emptyEl.style.display = 'none';
    if (contentEl) contentEl.style.display = 'flex';

    const detailImg = document.getElementById('fmDetailImg');
    const detailName = document.getElementById('fmDetailName');
    const detailSize = document.getElementById('fmDetailSize');
    const detailDate = document.getElementById('fmDetailDate');
    const detailUrl = document.getElementById('fmDetailUrl');

    if (detailImg) detailImg.src = file.url;
    if (detailName) detailName.textContent = file.fileName;
    if (detailSize) detailSize.textContent = file.size;
    if (detailDate) detailDate.textContent = file.formattedDate || '-';
    if (detailUrl) detailUrl.value = file.url;

    // Update Page Usage tracking in Inspector Sidebar
    const usagePill = document.getElementById('fmUsagePill');
    const usageItemsList = document.getElementById('fmUsageItemsList');

    if (usagePill && usageItemsList) {
      if (file.isUsed && file.usedIn && file.usedIn.length > 0) {
        usagePill.className = 'fp-fm-usage-pill used';
        usagePill.textContent = `${file.usedIn.length} Used`;

        usageItemsList.innerHTML = file.usedIn.map(item => `
          <a href="${item.path}" target="_blank" class="fp-fm-usage-item-row" title="Open ${item.title} (${item.type}) in new tab">
            <span class="fp-fm-usage-type-badge">${item.type}</span>
            <span class="fp-fm-usage-item-title">${item.title}</span>
            <span class="fp-fm-usage-item-icon">↗</span>
          </a>
        `).join('');
      } else {
        usagePill.className = 'fp-fm-usage-pill unused';
        usagePill.textContent = 'Unused';

        usageItemsList.innerHTML = `
          <div class="fp-fm-usage-empty-box">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <span>Not currently used on any page, blog post, template or popup.</span>
          </div>
        `;
      }
    }

    // Enable Insert button
    const insertBtn = document.getElementById('btnFmInsert');
    if (insertBtn) insertBtn.disabled = false;
  }

  function clearSelection() {
    selectedFile = null;
    document.querySelectorAll('.fp-fm-grid-card').forEach(el => el.classList.remove('selected'));
    document.querySelectorAll('.fp-fm-list-row').forEach(el => el.classList.remove('selected'));

    const emptyEl = document.getElementById('fmSidebarEmpty');
    const contentEl = document.getElementById('fmSidebarContent');
    if (emptyEl) emptyEl.style.display = 'flex';
    if (contentEl) contentEl.style.display = 'none';

    const usagePill = document.getElementById('fmUsagePill');
    const usageItemsList = document.getElementById('fmUsageItemsList');
    if (usagePill) {
      usagePill.className = 'fp-fm-usage-pill';
      usagePill.textContent = '-';
    }
    if (usageItemsList) {
      usageItemsList.innerHTML = '';
    }

    const insertBtn = document.getElementById('btnFmInsert');
    if (insertBtn) insertBtn.disabled = true;
  }

  // Upload Files Handler
  async function handleFilesUpload(files) {
    if (!files || files.length === 0) return;

    const MAX_IMAGE_BYTES = 200 * 1024; // 200 KB max image size
    const progressEl = document.getElementById('fmUploadProgress');
    const progressText = document.getElementById('fmUploadProgressText');
    if (progressEl) progressEl.style.display = 'inline-flex';
    if (progressText) progressText.textContent = `Uploading ${files.length} image(s)...`;

    let lastUploadedUrl = null;

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith('image/')) {
          showToast(`Skipped "${file.name}": Not an image file.`, true);
          continue;
        }

        if (file.size > MAX_IMAGE_BYTES) {
          const sizeKb = (file.size / 1024).toFixed(1);
          showToast(`"${file.name}" exceeds the 200 KB limit (${sizeKb} KB). Please resize or compress image.`, true);
          continue;
        }

        if (progressText) {
          progressText.textContent = `Uploading (${i + 1}/${files.length}) ${file.name}...`;
        }

        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (data.success && data.url) {
          lastUploadedUrl = data.url;
        } else {
          showToast(data.error || `Failed to upload ${file.name}`, true);
        }
      }

      showToast(`✓ Upload completed successfully!`);
      // Switch back to Media Library tab and highlight the uploaded file
      switchTab('library');
      await loadMediaLibrary(lastUploadedUrl);
    } catch (err) {
      showToast('Error uploading files: ' + err.message, true);
    } finally {
      if (progressEl) progressEl.style.display = 'none';
    }
  }

  // Delete File
  async function deleteFile(file) {
    if (!file) return;
    const ok = confirm(`Permanently delete "${file.fileName}" from the server?`);
    if (!ok) return;

    try {
      const res = await fetch(`/api/upload?fileName=${encodeURIComponent(file.fileName)}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        showToast('Image deleted from server.');
        clearSelection();
        loadMediaLibrary();
      } else {
        showToast(data.error || 'Failed to delete image.', true);
      }
    } catch (err) {
      showToast('Network error while deleting: ' + err.message, true);
    }
  }

  // Confirm Selection
  function confirmSelection() {
    if (!selectedFile) return;
    const url = selectedFile.url;

    if (typeof onSelectCallback === 'function') {
      onSelectCallback(url, selectedFile);
    } else if (targetComponent) {
      applyImageToComponent(targetComponent, url);
    }

    closeFileManager();
  }

  // Apply image to GrapesJS component
  function applyImageToComponent(comp, url) {
    if (!comp) return;
    try {
      if (typeof comp.set === 'function') {
        const type = comp.get('type') || '';
        const tagName = (comp.get('tagName') || '').toLowerCase();
        if (type === 'image' || tagName === 'img') {
          comp.set('src', url);
          const attrs = comp.getAttributes() || {};
          attrs.src = url;
          comp.set('attributes', attrs);
        } else {
          comp.addStyle({ 'background-image': `url("${url}")` });
        }
      }
    } catch (err) {
      console.warn('[FastPressFileManager] Could not apply image to component:', err);
    }
  }

  // Public API: Open Modal
  function openFileManager(options = {}) {
    if (typeof options === 'function') {
      options = { onSelect: options };
    }

    onSelectCallback = options.onSelect || null;
    targetComponent = options.target || (window.editor?.getSelected ? window.editor.getSelected() : null);

    if (!modalEl) {
      injectStyles();
      createModalDOM();
    }

    modalEl.classList.add('open');

    // Default to library tab unless option specified
    if (options.initialTab === 'upload') {
      switchTab('upload');
    } else {
      switchTab('library');
    }

    loadMediaLibrary(options.selectedUrl);
  }

  function closeFileManager() {
    if (modalEl) modalEl.classList.remove('open');
  }

  // Setup GrapesJS open-assets hook
  function hookGrapesJSEditor(editor) {
    if (!editor || !editor.Commands) return;

    editor.Commands.add('open-assets', {
      run(ed, sender, opts) {
        const target = opts?.target || ed.getSelected();
        openFileManager({
          target,
          onSelect: (url) => {
            if (target) applyImageToComponent(target, url);
          }
        });
      }
    });

    // Preload images into asset manager
    fetch('/api/upload')
      .then(r => r.json())
      .then(list => {
        if (Array.isArray(list) && editor.AssetManager) {
          list.forEach(item => {
            try { editor.AssetManager.add(item.url); } catch (e) {}
          });
        }
      })
      .catch(() => {});
  }

  // Initialize on DOM ready
  function init() {
    injectStyles();
    createModalDOM();

    // Attach to existing GrapesJS instance if present
    if (window.editor) {
      hookGrapesJSEditor(window.editor);
    }

    // Also watch for late editor initialization
    const checkEditorInterval = setInterval(() => {
      if (window.editor) {
        hookGrapesJSEditor(window.editor);
        clearInterval(checkEditorInterval);
      }
    }, 250);
    setTimeout(() => clearInterval(checkEditorInterval), 5000);

    // Wire up all elements with data-open="media-library" or id="btnOpenMediaLibraryNavbar"
    document.querySelectorAll('[data-open="media-library"], #btnOpenMediaLibraryNavbar, #btnActionsOpenMediaLibrary').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        openFileManager();
      });
    });
  }

  // Auto-init on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Export Global API
  window.FastPressFileManager = {
    open: openFileManager,
    close: closeFileManager,
    refresh: () => loadMediaLibrary(),
    switchTab,
    setViewMode,
    hookEditor: hookGrapesJSEditor
  };

  // Backward compatibility aliases
  window.openMediaLibrary = openFileManager;
  window.openImageChooserModal = (target, cb) => {
    openFileManager({
      target,
      onSelect: (url, file) => {
        if (typeof cb === 'function') cb(url, file);
      }
    });
  };

})();
