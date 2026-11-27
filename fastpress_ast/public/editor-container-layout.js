/**
 * ============================================================================
 * Elementor-Style Container Layout Styler for FastPress Editor (GrapesJS)
 * Provides Elementor-like Container layout controls for all div & section elements.
 * ============================================================================
 */

(function () {
  'use strict';

  // SVG Icons
  const ICONS = {
    desktop: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
    tablet: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`,
    mobile: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`,
    link: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
    unlink: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`
  };

  const CONTAINER_TAGS = ['div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'container'];

  // ============================================================================
  // Keyboard & Text-Editing Safeguards
  // Prevents accidental deletion of text sections/components when user presses
  // Backspace or Delete to fix typos or edit contenteditable / input elements.
  // ============================================================================
  function isUserEditingText(editor, e) {
    const target = e ? e.target : null;
    if (target) {
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
      if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') return true;
      if (target.closest && target.closest('[contenteditable="true"], [contenteditable=""], [contenteditable], input, textarea, select, .gjs-rte-toolbar, .gjs-sm-field, .gjs-fields')) return true;
    }
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable || (activeEl.closest && activeEl.closest('[contenteditable="true"], .gjs-sm-field')))) {
      return true;
    }
    try {
      const frameDoc = editor?.Canvas?.getDocument?.();
      if (frameDoc && frameDoc.activeElement) {
        const fActive = frameDoc.activeElement;
        if (fActive.tagName === 'INPUT' || fActive.tagName === 'TEXTAREA' || fActive.isContentEditable || (fActive.closest && fActive.closest('[contenteditable="true"], [contenteditable]'))) {
          return true;
        }
      }
    } catch (err) {}
    if (editor?.getEditing && editor.getEditing()) return true;
    if (editor?.getModel && editor.getModel().isEditing && editor.getModel().isEditing()) return true;
    return false;
  }

  function setupKeyboardSafeguards(editor) {
    if (!editor || editor.__keyboardSafeguardsInitialized) return;
    editor.__keyboardSafeguardsInitialized = true;

    // 1. Guard GrapesJS core:component-delete command
    try {
      const origDelete = editor.Commands.get('core:component-delete');
      if (origDelete) {
        editor.Commands.add('core:component-delete', {
          run(ed, sender, opts = {}) {
            if (isUserEditingText(ed)) return;
            if (origDelete.run) return origDelete.run.call(this, ed, sender, opts);
          }
        });
      }
    } catch (err) {
      console.warn('Keyboard safeguard GrapesJS command warning:', err);
    }

    // 2. Capture-phase keydown handler on canvas frame and document
    function handleKeydownCapture(e) {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (isUserEditingText(editor, e)) {
          // Allow native character deletion inside text element / input,
          // but STOP event propagation so no outer keymaps or layer-delete handlers delete the component!
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
      }
    }

    function attachIframeListeners() {
      try {
        const frameDoc = editor.Canvas.getDocument();
        if (frameDoc && !frameDoc.__backspaceSafeguardAttached) {
          frameDoc.__backspaceSafeguardAttached = true;
          frameDoc.addEventListener('keydown', handleKeydownCapture, true);
        }
        if (frameDoc && !frameDoc.__headingDblClickAttached) {
          frameDoc.__headingDblClickAttached = true;
          frameDoc.addEventListener('dblclick', (e) => {
            const headingEl = e.target?.closest?.('h1, h2, h3, h4, h5, h6, [data-gjs-type="heading"]');
            if (headingEl) {
              const comp = editor.getSelected();
              if (comp) {
                const tag = (comp.get('tagName') || '').toLowerCase();
                const type = (comp.get('type') || '').toLowerCase();
                if (/^h[1-6]$/i.test(tag) || type === 'heading') {
                  if (!comp.get('editable')) comp.set('editable', true);
                  if (comp.get('droppable')) comp.set('droppable', false);
                  const view = comp.getView ? comp.getView() : comp.view;
                  if (view && typeof view.onActive === 'function' && !editor.getEditing?.()) {
                    view.onActive(e);
                  }
                }
              }
            }
          }, true);
        }
      } catch (e) {}
    }

    editor.on('load', attachIframeListeners);
    attachIframeListeners();
    setTimeout(attachIframeListeners, 200);
    setTimeout(attachIframeListeners, 800);
    setTimeout(attachIframeListeners, 2000);

    if (typeof document !== 'undefined' && !document.__backspaceSafeguardAttached) {
      document.__backspaceSafeguardAttached = true;
      document.addEventListener('keydown', handleKeydownCapture, true);
    }
  }

  function initContainerLayoutStyler(editor) {
    if (!editor) return;
    setupKeyboardSafeguards(editor);
    if (editor.__containerLayoutStylerInitialized) return;
    editor.__containerLayoutStylerInitialized = true;

    let isGapsLinked = true;

    // Helper: Is component a div, section, or container
    function isContainerComp(comp) {
      if (!comp) return false;
      const tag = (comp.get('tagName') || comp.get('type') || '').toLowerCase();
      if (CONTAINER_TAGS.includes(tag)) return true;
      const s = comp.getStyle ? comp.getStyle() : {};
      if (s.display === 'flex' || s.display === 'grid' || s.display === 'inline-flex') return true;
      return false;
    }

    // Helper: Get active device id
    function getActiveDevice() {
      let dev = editor.getDevice ? editor.getDevice() : 'desktop';
      if (dev && typeof dev === 'object') {
        dev = dev.id || (dev.get && dev.get('id')) || dev.name || 'desktop';
      }
      return (dev || 'desktop').toLowerCase();
    }

    // Helper: Get active styles (normal vs hover, responsive device cascading)
    function getCompActiveStyles(comp) {
      if (!comp) return {};
      let s = Object.assign({}, comp.getStyle ? comp.getStyle() : {});
      const id = comp.getId ? comp.getId() : '';
      if (id) {
        const normRule = editor.Css.getRule(`#${id}`);
        if (normRule && normRule.getStyle) {
          Object.assign(s, normRule.getStyle());
        }
      }

      const curDev = getActiveDevice();
      if (window.activeComponentStylingState === 'hover') {
        if (id) {
          const hoverRule = editor.Css.getRule(`#${id}:hover`);
          if (hoverRule && hoverRule.getStyle) {
            Object.assign(s, hoverRule.getStyle());
          }
        }
      } else {
        if (curDev === 'tablet' || curDev === 'mobile') {
          if (id) {
            const tabRule = editor.Css.getRule(`#${id}`, { mediaText: '(max-width: 992px)' })
              || editor.Css.getRule(`#${id}`, { mediaText: '(max-width: 768px)' });
            if (tabRule && tabRule.getStyle) {
              Object.assign(s, tabRule.getStyle());
            }
          }
        }
        if (curDev === 'mobile') {
          if (id) {
            const mobRule = editor.Css.getRule(`#${id}`, { mediaText: '(max-width: 480px)' });
            if (mobRule && mobRule.getStyle) {
              Object.assign(s, mobRule.getStyle());
            }
          }
        }
        try {
          const target = editor.getSelectedToStyle ? editor.getSelectedToStyle() : null;
          if (target && target !== comp && target.getStyle) {
            Object.assign(s, target.getStyle());
          }
        } catch (e) {}
      }
      return s;
    }

    // Helper: Set active style
    function setCompActiveStyle(prop, val) {
      const comp = editor.getSelected();
      if (!comp) return;

      const id = comp.getId ? comp.getId() : '';
      const curDev = getActiveDevice();

      if (window.activeComponentStylingState === 'hover') {
        let hoverRule = editor.Css.getRule(`#${id}:hover`);
        if (!hoverRule) {
          hoverRule = editor.Css.setRule(`#${id}:hover, #${id}.gjs-hover-preview`, {});
        }
        if (val === '' || val === undefined) {
          if (hoverRule.removeStyle) hoverRule.removeStyle(prop);
          else hoverRule.addStyle({ [prop]: '' });
        } else {
          hoverRule.addStyle({ [prop]: val });
        }
      } else if (curDev !== 'desktop') {
        // Active device is Tablet or Mobile: apply style to active device's media rule
        try {
          const target = editor.getSelectedToStyle ? editor.getSelectedToStyle() : null;
          if (target && target.addStyle) {
            if (val === '' || val === undefined) {
              if (target.removeStyle) target.removeStyle(prop);
              else target.addStyle({ [prop]: '' });
            } else {
              target.addStyle({ [prop]: val });
            }
          } else if (id) {
            const media = curDev === 'tablet' ? '(max-width: 992px)' : '(max-width: 480px)';
            let devRule = editor.Css.getRule(`#${id}`, { mediaText: media });
            if (!devRule) {
              devRule = editor.Css.setRule(`#${id}`, { [prop]: val }, { mediaText: media });
            } else {
              if (val === '' || val === undefined) {
                if (devRule.removeStyle) devRule.removeStyle(prop);
                else devRule.addStyle({ [prop]: '' });
              } else {
                devRule.addStyle({ [prop]: val });
              }
            }
          }
        } catch (err) {
          console.warn('Responsive style set error:', err);
        }
      } else {
        // Desktop: apply to base component and desktop rule
        if (val === '' || val === undefined) {
          if (comp.removeStyle) comp.removeStyle(prop);
          else comp.addStyle({ [prop]: '' });
          if (id) {
            const normRule = editor.Css.getRule(`#${id}`);
            if (normRule) {
              if (normRule.removeStyle) normRule.removeStyle(prop);
              else normRule.addStyle({ [prop]: '' });
            }
          }
        } else {
          comp.addStyle({ [prop]: val });
          if (id) {
            const normRule = editor.Css.getRule(`#${id}`);
            if (normRule) normRule.addStyle({ [prop]: val });
          }
        }
      }

      // Sync with GrapesJS StyleManager model if property exists
      try {
        const sm = editor.StyleManager;
        if (sm && sm.getProperty) {
          const p = sm.getProperty(prop) || sm.getProperty('Layout & Position', prop) || sm.getProperty('Dimension & Spacing', prop) || sm.getProperty('dimension_&_spacing', prop) || sm.getProperty('layout_&_position', prop);
          if (p && p.setValue) p.setValue(val, { silent: true });
        }
      } catch (e) {}
    }

    // Parse value and unit (e.g. "100%", "450px")
    function parseValAndUnit(str, defaultVal, defaultUnit) {
      if (!str) return { val: defaultVal, unit: defaultUnit };
      const m = String(str).trim().match(/^([\d.]+)([a-zA-Z%]*)$/);
      if (m) {
        return { val: m[1], unit: m[2] || defaultUnit };
      }
      return { val: str, unit: defaultUnit };
    }

    // Parse gap values
    function parseGapValues(style) {
      let rowVal = '20', colVal = '20', unit = 'px';
      const gap = style.gap || '';
      const rowGap = style['row-gap'] || '';
      const colGap = style['column-gap'] || '';

      if (gap) {
        const parts = gap.trim().split(/\s+/);
        if (parts.length === 1) {
          const m = parts[0].match(/^([\d.]+)([a-zA-Z%]*)$/);
          if (m) {
            rowVal = m[1];
            colVal = m[1];
            if (m[2]) unit = m[2];
          }
        } else if (parts.length >= 2) {
          const m1 = parts[0].match(/^([\d.]+)([a-zA-Z%]*)$/);
          const m2 = parts[1].match(/^([\d.]+)([a-zA-Z%]*)$/);
          if (m1) { rowVal = m1[1]; if (m1[2]) unit = m1[2]; }
          if (m2) { colVal = m2[1]; if (m2[2]) unit = m2[2]; }
        }
      }
      if (rowGap) {
        const m = rowGap.match(/^([\d.]+)([a-zA-Z%]*)$/);
        if (m) { rowVal = m[1]; if (m[2]) unit = m[2]; }
      }
      if (colGap) {
        const m = colGap.match(/^([\d.]+)([a-zA-Z%]*)$/);
        if (m) { colVal = m[1]; if (m[2]) unit = m[2]; }
      }
      return { rowVal, colVal, unit };
    }

    // HTML Template for Elementor-style Container Panel
    function buildContainerPanelHTML() {
      return `
        <div class="el-container-header" id="elContainerHeader" title="Click to toggle Container settings">
          <span class="el-caret">▾</span>
          <span class="el-title">Container</span>
          <span class="el-badge" id="elContainerTagBadge">DIV</span>
        </div>
        <div class="el-container-body" id="elContainerBody">
          <!-- Row 1: Container Layout -->
          <div class="el-row el-inline-row">
            <span class="el-label">Container Layout</span>
            <div class="el-control">
              <select class="el-select" id="elContainerLayout">
                <option value="flex">Flexbox</option>
                <option value="grid">Grid</option>
                <option value="block">Block</option>
              </select>
            </div>
          </div>

          <!-- Row 2: Content Width -->
          <div class="el-row el-inline-row">
            <span class="el-label">Content Width</span>
            <div class="el-control">
              <select class="el-select" id="elContentWidth">
                <option value="full">Full Width</option>
                <option value="boxed">Boxed</option>
                <option value="custom">Custom</option>
              </select>
            </div>
          </div>

          <!-- Row 3: Width Slider -->
          <div class="el-row el-stack-row">
            <div class="el-label-bar">
              <span class="el-label">
                Width
                <span class="el-device-icon" title="Toggle Responsive View">${ICONS.desktop}</span>
              </span>
              <div class="el-unit-select-wrap">
                <select class="el-unit-select" id="elWidthUnit">
                  <option value="%">%</option>
                  <option value="px">px</option>
                  <option value="vw">vw</option>
                </select>
              </div>
            </div>
            <div class="el-slider-control">
              <input type="range" class="el-range-slider" id="elWidthSlider" min="0" max="100" value="100" />
              <input type="number" class="el-number-input" id="elWidthInput" value="100" placeholder="100" />
            </div>
          </div>

          <!-- Row 4: Min Height Slider -->
          <div class="el-row el-stack-row">
            <div class="el-label-bar">
              <span class="el-label">
                Min Height
                <span class="el-device-icon" title="Toggle Responsive View">${ICONS.desktop}</span>
              </span>
              <div class="el-unit-select-wrap">
                <select class="el-unit-select" id="elMinHeightUnit">
                  <option value="px">px</option>
                  <option value="vh">vh</option>
                  <option value="%">%</option>
                </select>
              </div>
            </div>
            <div class="el-slider-control">
              <input type="range" class="el-range-slider" id="elMinHeightSlider" min="0" max="1000" value="0" />
              <input type="number" class="el-number-input" id="elMinHeightInput" placeholder="" />
            </div>
            <div class="el-helper-text">To achieve full height Container use 100vh.</div>
          </div>

          <!-- Items Subheading -->
          <div class="el-subheading" id="elItemsHeader">Items</div>

          <!-- Row 5: Direction (Flexbox items) -->
          <div class="el-row el-inline-row el-flex-item-row" id="elDirectionRow">
            <span class="el-label">
              Direction
              <span class="el-device-icon" title="Toggle Responsive View">${ICONS.desktop}</span>
            </span>
            <div class="el-btn-group" id="elFlexDirectionGroup">
              <button type="button" class="el-btn is-active" data-val="row" title="Row (Horizontal)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              </button>
              <button type="button" class="el-btn" data-val="column" title="Column (Vertical)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
              </button>
              <button type="button" class="el-btn" data-val="row-reverse" title="Row Reverse">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
              </button>
              <button type="button" class="el-btn" data-val="column-reverse" title="Column Reverse">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
              </button>
            </div>
          </div>

          <!-- Row 6: Justify Content (Flexbox items) -->
          <div class="el-row el-stack-row el-flex-item-row" id="elJustifyRow">
            <div class="el-label-bar">
              <span class="el-label">
                Justify Content
                <span class="el-device-icon" title="Toggle Responsive View">${ICONS.desktop}</span>
              </span>
            </div>
            <div class="el-btn-group el-btn-group-full" id="elJustifyContentGroup">
              <button type="button" class="el-btn is-active" data-val="flex-start" title="Start">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <line x1="3" y1="4" x2="3" y2="20" stroke="currentColor" stroke-width="2.2"/>
                  <rect x="7" y="6" width="3.5" height="12" rx="0.5" fill="currentColor"/>
                  <rect x="13.5" y="6" width="3.5" height="12" rx="0.5" fill="currentColor"/>
                </svg>
              </button>
              <button type="button" class="el-btn" data-val="center" title="Center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <line x1="12" y1="2" x2="12" y2="22" stroke="currentColor" stroke-dasharray="2 2" stroke-width="1.3"/>
                  <rect x="5.5" y="6" width="3.5" height="12" rx="0.5" fill="currentColor"/>
                  <rect x="15" y="6" width="3.5" height="12" rx="0.5" fill="currentColor"/>
                </svg>
              </button>
              <button type="button" class="el-btn" data-val="flex-end" title="End">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <line x1="21" y1="4" x2="21" y2="20" stroke="currentColor" stroke-width="2.2"/>
                  <rect x="7" y="6" width="3.5" height="12" rx="0.5" fill="currentColor"/>
                  <rect x="13.5" y="6" width="3.5" height="12" rx="0.5" fill="currentColor"/>
                </svg>
              </button>
              <button type="button" class="el-btn" data-val="space-between" title="Space Between">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <line x1="3" y1="4" x2="3" y2="20" stroke="currentColor" stroke-width="1.8"/>
                  <line x1="21" y1="4" x2="21" y2="20" stroke="currentColor" stroke-width="1.8"/>
                  <rect x="6.5" y="6" width="3" height="12" rx="0.5" fill="currentColor"/>
                  <rect x="14.5" y="6" width="3" height="12" rx="0.5" fill="currentColor"/>
                </svg>
              </button>
              <button type="button" class="el-btn" data-val="space-around" title="Space Around">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <rect x="4" y="6" width="2.5" height="12" rx="0.5" fill="currentColor"/>
                  <rect x="10.75" y="6" width="2.5" height="12" rx="0.5" fill="currentColor"/>
                  <rect x="17.5" y="6" width="2.5" height="12" rx="0.5" fill="currentColor"/>
                </svg>
              </button>
              <button type="button" class="el-btn" data-val="space-evenly" title="Space Evenly">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="6" width="2.5" height="12" rx="0.5" fill="currentColor"/>
                  <rect x="10.75" y="6" width="2.5" height="12" rx="0.5" fill="currentColor"/>
                  <rect x="18.5" y="6" width="2.5" height="12" rx="0.5" fill="currentColor"/>
                </svg>
              </button>
            </div>
          </div>

          <!-- Row 7: Align Items (Flexbox items) -->
          <div class="el-row el-inline-row el-flex-item-row" id="elAlignRow">
            <span class="el-label">
              Align Items
              <span class="el-device-icon" title="Toggle Responsive View">${ICONS.desktop}</span>
            </span>
            <div class="el-btn-group" id="elAlignItemsGroup">
              <button type="button" class="el-btn is-active" data-val="flex-start" title="Start">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <line x1="3" y1="4" x2="21" y2="4" stroke="currentColor" stroke-width="2.2"/>
                  <rect x="6.5" y="7" width="3.5" height="7" rx="0.5" fill="currentColor"/>
                  <rect x="14" y="7" width="3.5" height="12" rx="0.5" fill="currentColor"/>
                </svg>
              </button>
              <button type="button" class="el-btn" data-val="center" title="Center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <line x1="2" y1="12" x2="22" y2="12" stroke="currentColor" stroke-dasharray="2 2" stroke-width="1.3"/>
                  <rect x="6.5" y="8" width="3.5" height="8" rx="0.5" fill="currentColor"/>
                  <rect x="14" y="5" width="3.5" height="14" rx="0.5" fill="currentColor"/>
                </svg>
              </button>
              <button type="button" class="el-btn" data-val="flex-end" title="End">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <line x1="3" y1="20" x2="21" y2="20" stroke="currentColor" stroke-width="2.2"/>
                  <rect x="6.5" y="10" width="3.5" height="7" rx="0.5" fill="currentColor"/>
                  <rect x="14" y="6" width="3.5" height="11" rx="0.5" fill="currentColor"/>
                </svg>
              </button>
              <button type="button" class="el-btn" data-val="stretch" title="Stretch">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <line x1="3" y1="3" x2="21" y2="3" stroke="currentColor" stroke-width="1.8"/>
                  <line x1="3" y1="21" x2="21" y2="21" stroke="currentColor" stroke-width="1.8"/>
                  <rect x="6.5" y="6" width="3.5" height="12" rx="0.5" fill="currentColor"/>
                  <rect x="14" y="6" width="3.5" height="12" rx="0.5" fill="currentColor"/>
                </svg>
              </button>
            </div>
          </div>

          <!-- Row 8: Gaps -->
          <div class="el-row el-stack-row el-flex-item-row" id="elGapsRow">
            <div class="el-label-bar">
              <span class="el-label">
                Gaps
                <span class="el-device-icon" title="Toggle Responsive View">${ICONS.desktop}</span>
              </span>
              <div class="el-unit-select-wrap">
                <select class="el-unit-select" id="elGapUnit">
                  <option value="px">px</option>
                  <option value="%">%</option>
                  <option value="rem">rem</option>
                </select>
              </div>
            </div>
            <div class="el-gaps-inputs-wrap">
              <div class="el-gap-box">
                <input type="number" class="el-gap-input" id="elGapColInput" value="20" placeholder="0" />
                <span class="el-sub-label">Column</span>
              </div>
              <div class="el-gap-box">
                <input type="number" class="el-gap-input" id="elGapRowInput" value="20" placeholder="0" />
                <span class="el-sub-label">Row</span>
              </div>
              <button type="button" class="el-link-btn is-linked" id="elGapLinkBtn" title="Link/Unlink Column & Row Gaps">
                ${ICONS.link}
              </button>
            </div>
          </div>

          <!-- Row 9: Wrap (Flexbox items) -->
          <div class="el-row el-inline-row el-flex-item-row" id="elWrapRow">
            <span class="el-label">
              Wrap
              <span class="el-device-icon" title="Toggle Responsive View">${ICONS.desktop}</span>
            </span>
            <div class="el-btn-group" id="elFlexWrapGroup">
              <button type="button" class="el-btn is-active" data-val="nowrap" title="No wrap">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="17" y2="12"/><polyline points="13 7 18 12 13 17"/><line x1="21" y1="5" x2="21" y2="19"/></svg>
              </button>
              <button type="button" class="el-btn" data-val="wrap" title="Wrap">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h12a4 4 0 0 1 0 8H7"/><polyline points="10 12 7 15 10 18"/></svg>
              </button>
            </div>
          </div>
          <div class="el-row el-flex-item-row" id="elWrapHelperRow" style="padding-top: 0;">
            <div class="el-helper-text">
              Items within the container can stay in a single line (No wrap), or break into multiple lines (Wrap).
            </div>
          </div>

          <!-- Grid Mode Settings (shown when layout is Grid) -->
          <div id="elGridSection" style="display: none;">
            <div class="el-row el-inline-row">
              <span class="el-label">Grid Columns</span>
              <div class="el-control">
                <select class="el-select" id="elGridCols">
                  <option value="1">1 Column</option>
                  <option value="2">2 Columns</option>
                  <option value="3">3 Columns</option>
                  <option value="4">4 Columns</option>
                  <option value="6">6 Columns</option>
                  <option value="12">12 Columns</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // Ensure container sector DOM element exists in styles-container
    function ensureContainerSector() {
      const stylesContainer = document.getElementById('styles-container');
      if (!stylesContainer) return null;

      let sectorEl = stylesContainer.querySelector('.el-container-sector');
      if (!sectorEl) {
        sectorEl = document.createElement('div');
        sectorEl.className = 'el-container-sector';
        sectorEl.innerHTML = buildContainerPanelHTML();

        // Insert after state toolbar if present, or as first child
        const stateToolbar = stylesContainer.querySelector('.gjs-sm-state-toolbar');
        if (stateToolbar && stateToolbar.nextSibling) {
          stylesContainer.insertBefore(sectorEl, stateToolbar.nextSibling);
        } else if (stylesContainer.firstChild) {
          stylesContainer.insertBefore(sectorEl, stylesContainer.firstChild);
        } else {
          stylesContainer.appendChild(sectorEl);
        }

        bindContainerEvents(sectorEl);
      }
      return sectorEl;
    }

    // Update Responsive Device Icons
    function updateDeviceIcons(sectorEl) {
      if (!sectorEl) return;
      const device = getActiveDevice();
      let iconSvg = ICONS.desktop;
      if (device === 'tablet') iconSvg = ICONS.tablet;
      else if (device === 'mobile') iconSvg = ICONS.mobile;

      sectorEl.querySelectorAll('.el-device-icon').forEach(iconEl => {
        iconEl.innerHTML = iconSvg;
        iconEl.title = `Current View: ${device.toUpperCase()} (Click to switch)`;
      });
    }

    // Cycle Device (Desktop -> Tablet -> Mobile -> Desktop)
    function cycleDevice() {
      if (!editor.setDevice) return;
      const cur = getActiveDevice();
      let next = 'desktop';
      if (cur === 'desktop') next = 'tablet';
      else if (cur === 'tablet') next = 'mobile';
      else next = 'desktop';

      editor.setDevice(next);
      // Trigger update of top toolbar device buttons if they exist
      document.querySelectorAll('[data-device], .btn-device').forEach(btn => {
        const d = (btn.getAttribute('data-device') || btn.dataset.device || '').toLowerCase();
        if (d === next) btn.classList.add('active');
        else btn.classList.remove('active');
      });
      syncTopbarDeviceDropdown();
      setTimeout(syncContainerUI, 40);
    }

    // Bind all events inside the Container panel
    function bindContainerEvents(sectorEl) {
      // 1. Collapsible Header
      const header = sectorEl.querySelector('#elContainerHeader');
      if (header) {
        header.addEventListener('click', () => {
          sectorEl.classList.toggle('is-collapsed');
        });
      }

      // 2. Responsive Screen Icon clicks
      sectorEl.querySelectorAll('.el-device-icon').forEach(iconEl => {
        iconEl.addEventListener('click', (e) => {
          e.stopPropagation();
          cycleDevice();
        });
      });

      // 3. Container Layout (Flexbox, Grid, Block)
      const layoutSelect = sectorEl.querySelector('#elContainerLayout');
      if (layoutSelect) {
        layoutSelect.addEventListener('change', () => {
          const val = layoutSelect.value;
          if (val === 'flex') {
            setCompActiveStyle('display', 'flex');
          } else if (val === 'grid') {
            setCompActiveStyle('display', 'grid');
            setCompActiveStyle('grid-template-columns', 'repeat(3, 1fr)');
          } else {
            setCompActiveStyle('display', 'block');
          }
          syncContainerUI();
        });
      }

      // 4. Content Width (Full, Boxed, Custom)
      const contentWidthSelect = sectorEl.querySelector('#elContentWidth');
      if (contentWidthSelect) {
        contentWidthSelect.addEventListener('change', () => {
          const val = contentWidthSelect.value;
          if (val === 'boxed') {
            setCompActiveStyle('width', '100%');
            setCompActiveStyle('max-width', '1140px');
            setCompActiveStyle('margin-left', 'auto');
            setCompActiveStyle('margin-right', 'auto');
          } else if (val === 'full') {
            setCompActiveStyle('width', '100%');
            setCompActiveStyle('max-width', 'none');
          }
          syncContainerUI();
        });
      }

      // 5. Width Slider & Input & Unit
      const widthSlider = sectorEl.querySelector('#elWidthSlider');
      const widthInput = sectorEl.querySelector('#elWidthInput');
      const widthUnit = sectorEl.querySelector('#elWidthUnit');

      function applyWidth() {
        const val = widthInput.value || widthSlider.value || '100';
        const unit = widthUnit.value || '%';
        setCompActiveStyle('width', `${val}${unit}`);
      }

      if (widthSlider) {
        widthSlider.addEventListener('input', () => {
          widthInput.value = widthSlider.value;
          applyWidth();
        });
      }
      if (widthInput) {
        widthInput.addEventListener('input', () => {
          widthSlider.value = widthInput.value;
          applyWidth();
        });
      }
      if (widthUnit) {
        widthUnit.addEventListener('change', () => {
          if (widthUnit.value === 'px') {
            widthSlider.max = 1600;
          } else {
            widthSlider.max = 100;
          }
          applyWidth();
        });
      }

      // 6. Min Height Slider & Input & Unit
      const minHeightSlider = sectorEl.querySelector('#elMinHeightSlider');
      const minHeightInput = sectorEl.querySelector('#elMinHeightInput');
      const minHeightUnit = sectorEl.querySelector('#elMinHeightUnit');

      function applyMinHeight() {
        const val = minHeightInput.value || minHeightSlider.value;
        if (!val || val === '0') {
          setCompActiveStyle('min-height', '');
        } else {
          const unit = minHeightUnit.value || 'px';
          setCompActiveStyle('min-height', `${val}${unit}`);
        }
      }

      if (minHeightSlider) {
        minHeightSlider.addEventListener('input', () => {
          minHeightInput.value = minHeightSlider.value;
          applyMinHeight();
        });
      }
      if (minHeightInput) {
        minHeightInput.addEventListener('input', () => {
          minHeightSlider.value = minHeightInput.value || 0;
          applyMinHeight();
        });
      }
      if (minHeightUnit) {
        minHeightUnit.addEventListener('change', () => {
          if (minHeightUnit.value === 'px') {
            minHeightSlider.max = 1000;
          } else {
            minHeightSlider.max = 100;
          }
          applyMinHeight();
        });
      }

      // 7. Direction Buttons
      sectorEl.querySelectorAll('#elFlexDirectionGroup .el-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const val = btn.dataset.val;
          sectorEl.querySelectorAll('#elFlexDirectionGroup .el-btn').forEach(b => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          // If container display is not flex, promote to flex
          const comp = editor.getSelected();
          if (comp) {
            const s = getCompActiveStyles(comp);
            if (s.display !== 'flex' && s.display !== 'inline-flex') {
              setCompActiveStyle('display', 'flex');
            }
          }
          setCompActiveStyle('flex-direction', val);
          syncContainerUI();
        });
      });

      // 8. Justify Content Buttons
      sectorEl.querySelectorAll('#elJustifyContentGroup .el-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const val = btn.dataset.val;
          sectorEl.querySelectorAll('#elJustifyContentGroup .el-btn').forEach(b => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          setCompActiveStyle('justify-content', val);
        });
      });

      // 9. Align Items Buttons
      sectorEl.querySelectorAll('#elAlignItemsGroup .el-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const val = btn.dataset.val;
          sectorEl.querySelectorAll('#elAlignItemsGroup .el-btn').forEach(b => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          setCompActiveStyle('align-items', val);
        });
      });

      // 10. Gaps (Column, Row, Link button, Unit)
      const gapColInput = sectorEl.querySelector('#elGapColInput');
      const gapRowInput = sectorEl.querySelector('#elGapRowInput');
      const gapUnit = sectorEl.querySelector('#elGapUnit');
      const gapLinkBtn = sectorEl.querySelector('#elGapLinkBtn');

      function applyGaps() {
        const unit = gapUnit.value || 'px';
        const colVal = gapColInput.value !== '' ? gapColInput.value : '0';
        const rowVal = gapRowInput.value !== '' ? gapRowInput.value : '0';

        if (isGapsLinked) {
          setCompActiveStyle('gap', `${colVal}${unit}`);
          setCompActiveStyle('row-gap', '');
          setCompActiveStyle('column-gap', '');
        } else {
          setCompActiveStyle('row-gap', `${rowVal}${unit}`);
          setCompActiveStyle('column-gap', `${colVal}${unit}`);
          setCompActiveStyle('gap', `${rowVal}${unit} ${colVal}${unit}`);
        }
      }

      if (gapLinkBtn) {
        gapLinkBtn.addEventListener('click', () => {
          isGapsLinked = !isGapsLinked;
          if (isGapsLinked) {
            gapLinkBtn.classList.add('is-linked');
            gapLinkBtn.innerHTML = ICONS.link;
            gapRowInput.value = gapColInput.value;
            applyGaps();
          } else {
            gapLinkBtn.classList.remove('is-linked');
            gapLinkBtn.innerHTML = ICONS.unlink;
          }
        });
      }

      if (gapColInput) {
        gapColInput.addEventListener('input', () => {
          if (isGapsLinked) {
            gapRowInput.value = gapColInput.value;
          }
          applyGaps();
        });
      }

      if (gapRowInput) {
        gapRowInput.addEventListener('input', () => {
          if (isGapsLinked) {
            gapColInput.value = gapRowInput.value;
          }
          applyGaps();
        });
      }

      if (gapUnit) {
        gapUnit.addEventListener('change', applyGaps);
      }

      // 11. Wrap Buttons
      sectorEl.querySelectorAll('#elFlexWrapGroup .el-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const val = btn.dataset.val;
          sectorEl.querySelectorAll('#elFlexWrapGroup .el-btn').forEach(b => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          setCompActiveStyle('flex-wrap', val);
        });
      });

      // 12. Grid Columns Select
      const gridColsSelect = sectorEl.querySelector('#elGridCols');
      if (gridColsSelect) {
        gridColsSelect.addEventListener('change', () => {
          const cols = gridColsSelect.value;
          setCompActiveStyle('grid-template-columns', `repeat(${cols}, 1fr)`);
        });
      }
    }

    // Synchronize UI values with current selected component
    function syncContainerUI() {
      const stylesContainer = document.getElementById('styles-container');
      if (!stylesContainer) return;

      const comp = editor.getSelected();
      const sectorEl = ensureContainerSector();
      if (!sectorEl) return;

      if (!comp || !isContainerComp(comp)) {
        sectorEl.style.display = 'none';
        stylesContainer.classList.remove('has-el-container-active');
        return;
      }

      // Show container sector & hide duplicate raw properties
      sectorEl.style.display = 'block';
      stylesContainer.classList.add('has-el-container-active');

      const tag = (comp.get('tagName') || comp.get('type') || 'DIV').toUpperCase();
      const badge = sectorEl.querySelector('#elContainerTagBadge');
      if (badge) badge.textContent = tag;

      updateDeviceIcons(sectorEl);

      const styles = getCompActiveStyles(comp);

      // 1. Container Layout
      const layoutSelect = sectorEl.querySelector('#elContainerLayout');
      const isGrid = styles.display === 'grid' || styles.display === 'inline-grid';
      const isBlock = styles.display === 'block';
      const isFlex = styles.display === 'flex' || styles.display === 'inline-flex' || (!isGrid && !isBlock);

      if (layoutSelect) {
        if (isGrid) layoutSelect.value = 'grid';
        else if (isBlock) layoutSelect.value = 'block';
        else layoutSelect.value = 'flex';
      }

      // Toggle flex vs grid sections
      const flexRows = sectorEl.querySelectorAll('.el-flex-item-row');
      const gridSec = sectorEl.querySelector('#elGridSection');
      const itemsHeader = sectorEl.querySelector('#elItemsHeader');

      if (isGrid) {
        flexRows.forEach(r => r.style.display = 'none');
        if (gridSec) gridSec.style.display = 'block';
        if (itemsHeader) {
          itemsHeader.style.display = 'block';
          itemsHeader.textContent = 'Grid Items';
        }
      } else if (isFlex) {
        flexRows.forEach(r => r.style.display = '');
        if (gridSec) gridSec.style.display = 'none';
        if (itemsHeader) {
          itemsHeader.style.display = 'block';
          itemsHeader.textContent = 'Items';
        }
      } else {
        // Block layout - hide items controls
        flexRows.forEach(r => r.style.display = 'none');
        if (gridSec) gridSec.style.display = 'none';
        if (itemsHeader) itemsHeader.style.display = 'none';
      }

      // 2. Content Width
      const contentWidthSelect = sectorEl.querySelector('#elContentWidth');
      if (contentWidthSelect) {
        if (styles['max-width'] && styles['max-width'] !== 'none' && (styles['margin-left'] === 'auto' || styles['margin']?.includes('auto'))) {
          contentWidthSelect.value = 'boxed';
        } else if (styles.width === '100%' && (!styles['max-width'] || styles['max-width'] === 'none')) {
          contentWidthSelect.value = 'full';
        } else {
          contentWidthSelect.value = 'custom';
        }
      }

      // 3. Width
      const widthSlider = sectorEl.querySelector('#elWidthSlider');
      const widthInput = sectorEl.querySelector('#elWidthInput');
      const widthUnit = sectorEl.querySelector('#elWidthUnit');
      const parsedWidth = parseValAndUnit(styles.width, '100', '%');

      if (widthUnit) widthUnit.value = parsedWidth.unit;
      if (widthSlider) {
        widthSlider.max = parsedWidth.unit === 'px' ? 1600 : 100;
        widthSlider.value = parsedWidth.val;
      }
      if (widthInput) widthInput.value = parsedWidth.val;

      // 4. Min Height
      const minHeightSlider = sectorEl.querySelector('#elMinHeightSlider');
      const minHeightInput = sectorEl.querySelector('#elMinHeightInput');
      const minHeightUnit = sectorEl.querySelector('#elMinHeightUnit');
      const parsedMinHeight = parseValAndUnit(styles['min-height'], '', 'px');

      if (minHeightUnit) minHeightUnit.value = parsedMinHeight.unit;
      if (minHeightSlider) {
        minHeightSlider.max = parsedMinHeight.unit === 'px' ? 1000 : 100;
        minHeightSlider.value = parsedMinHeight.val || 0;
      }
      if (minHeightInput) minHeightInput.value = parsedMinHeight.val || '';

      // 5. Direction
      const dir = styles['flex-direction'] || 'row';
      sectorEl.querySelectorAll('#elFlexDirectionGroup .el-btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.val === dir);
      });

      // 6. Justify Content
      const just = styles['justify-content'] || 'flex-start';
      sectorEl.querySelectorAll('#elJustifyContentGroup .el-btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.val === just);
      });

      // 7. Align Items
      const align = styles['align-items'] || 'flex-start';
      sectorEl.querySelectorAll('#elAlignItemsGroup .el-btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.val === align);
      });

      // 8. Gaps
      const gapColInput = sectorEl.querySelector('#elGapColInput');
      const gapRowInput = sectorEl.querySelector('#elGapRowInput');
      const gapUnit = sectorEl.querySelector('#elGapUnit');
      const parsedGaps = parseGapValues(styles);

      if (gapColInput) gapColInput.value = parsedGaps.colVal;
      if (gapRowInput) gapRowInput.value = parsedGaps.rowVal;
      if (gapUnit) gapUnit.value = parsedGaps.unit;

      // 9. Wrap
      const wrap = styles['flex-wrap'] || 'nowrap';
      sectorEl.querySelectorAll('#elFlexWrapGroup .el-btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.val === wrap);
      });

      // 10. Grid Template Columns
      const gridColsSelect = sectorEl.querySelector('#elGridCols');
      if (gridColsSelect && styles['grid-template-columns']) {
        const m = styles['grid-template-columns'].match(/repeat\((\d+)/);
        if (m) gridColsSelect.value = m[1];
      }
    }

    // Attach Editor Events
    editor.on('component:selected', (comp) => {
      if (comp) {
        const tag = (comp.get('tagName') || '').toLowerCase();
        const type = (comp.get('type') || '').toLowerCase();
        if (/^h[1-6]$/i.test(tag) || type === 'heading') {
          if (!comp.get('editable')) comp.set('editable', true);
          if (comp.get('droppable')) comp.set('droppable', false);
        }
      }
      setTimeout(syncContainerUI, 30);
    });

    editor.on('component:deselected', () => {
      setTimeout(syncContainerUI, 30);
    });

    editor.on('component:styleUpdate', () => {
      syncContainerUI();
    });

    editor.on('styleManager:change', () => {
      setTimeout(syncContainerUI, 40);
    });

    // Listen for device changes
    editor.on('device:select change:device', () => {
      const sectorEl = document.querySelector('.el-container-sector');
      if (sectorEl) updateDeviceIcons(sectorEl);
      syncTopbarDeviceDropdown();
      setTimeout(syncContainerUI, 40);
    });

    // Observer for styles container changes (e.g. tabs or state switchers)
    const stylesTarget = document.getElementById('styles-container');
    if (stylesTarget) {
      const obs = new MutationObserver(() => {
        if (!stylesTarget.querySelector('.el-container-sector')) {
          syncContainerUI();
        }
      });
      obs.observe(stylesTarget, { childList: true });
    }

    // Initialize Topbar Dropdowns and Panel Toggle
    initEditorTopbarControls();
    initDropzoneLayoutPicker(editor);
    initSectionTopPlusButton(editor);
    initSectionHoverHighlight(editor);

    // Initial sync
    setTimeout(syncContainerUI, 100);
  }

  // Topbar Controls (Device Dropdown, View & Code Dropdown, Panel Toggle)
  function initEditorTopbarControls() {
    // 1. Device Dropdown (skip if managed by DeviceSwitcher.astro)
    const devWrap = document.getElementById('deviceDropdownWrap');
    const devBtn = document.getElementById('btnDeviceDropdown');
    const devMenu = document.getElementById('deviceDropdownMenu');
    const devIcon = document.getElementById('deviceActiveIcon');
    const devLabel = document.getElementById('deviceActiveLabel');
    const isManagedByDeviceSwitcher =
      devWrap && (devWrap.classList.contains('device-switcher-component') || devWrap.dataset.devInitialized === 'true');

    if (devBtn && devWrap && !isManagedByDeviceSwitcher) {
      devWrap.dataset.devInitialized = 'true';
      devBtn.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.topbar-dropdown-wrap.open, .nav-dropdown.open').forEach(w => {
          if (w !== devWrap) w.classList.remove('open');
        });
        devWrap.classList.toggle('open');
      };
    }

    if (devMenu && !isManagedByDeviceSwitcher) {
      devMenu.querySelectorAll('.topbar-dropdown-item').forEach(item => {
        item.onclick = (e) => {
          e.stopPropagation();
          const dev = item.dataset.device || item.dataset.val;
          if (dev && window.editor && window.editor.setDevice) {
            window.editor.setDevice(dev);
          }
          // Also trigger matching existing buttons if any
          const existBtn = document.querySelector(`.device-btn[data-device="${dev}"], #btnDevice${dev.charAt(0).toUpperCase() + dev.slice(1)}, #btn${dev.charAt(0).toUpperCase() + dev.slice(1)}`);
          if (existBtn && existBtn !== item) {
            try { existBtn.click(); } catch (err) {}
          }
          devMenu.querySelectorAll('.topbar-dropdown-item').forEach(it => it.classList.remove('active'));
          item.classList.add('active');

          const titleEl = item.querySelector('.topbar-item-title') || item;
          if (titleEl && devLabel) {
            devLabel.textContent = titleEl.textContent.trim();
          }
          const iconEl = item.querySelector('.topbar-item-icon svg');
          if (iconEl && devIcon) {
            devIcon.innerHTML = iconEl.outerHTML;
          }

          devWrap.classList.remove('open');
        };
      });
    }

    // 2. View Actions Dropdown (Live Site, Preview, Code) - skip if managed by editor.astro (.nav-dropdown)
    const viewWrap = document.getElementById('viewActionsDropdownWrap');
    const viewBtn = document.getElementById('btnViewActionsDropdown');
    const viewMenu = document.getElementById('viewActionsDropdownMenu');
    const isManagedByEditorPage =
      viewWrap && (!viewWrap.classList.contains('topbar-dropdown-wrap') || viewWrap.dataset.viewInitialized === 'true');

    if (viewBtn && viewWrap && !isManagedByEditorPage) {
      viewWrap.dataset.viewInitialized = 'true';
      viewBtn.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.topbar-dropdown-wrap.open, .nav-dropdown.open').forEach(w => {
          if (w !== viewWrap) w.classList.remove('open');
        });
        viewWrap.classList.toggle('open');
      };
    }

    if (viewMenu && !isManagedByEditorPage) {
      // Delegate click to close menu after clicking an action
      viewMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.topbar-dropdown-item');
        if (item) {
          viewWrap.classList.remove('open');
        }
      });
    }

    // 3. Panel Toggle Button
    const panelBtns = document.querySelectorAll('#btnToggleSidebar, .btn-toggle-panel');
    panelBtns.forEach(btn => {
      if (btn.__sidebarToggleBound) return;
      btn.__sidebarToggleBound = true;

      // On /editor, editor.astro's inline script already binds #btnToggleSidebar
      if (window.location.pathname.startsWith('/editor') && btn.id === 'btnToggleSidebar') {
        return;
      }

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const sidebar = document.querySelector('.editor-sidebar, .builder-sidebar');
        if (sidebar) {
          sidebar.classList.toggle('is-collapsed');
          const isCollapsed = sidebar.classList.contains('is-collapsed');
          btn.classList.toggle('active', !isCollapsed);
          btn.classList.toggle('is-collapsed', isCollapsed);
          if (window.editor && window.editor.refresh) {
            window.editor.refresh();
          }
          window.dispatchEvent(new Event('resize'));
        }
      });
    });

    // Close all topbar dropdowns on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.topbar-dropdown-wrap')) {
        document.querySelectorAll('.topbar-dropdown-wrap.open').forEach(w => w.classList.remove('open'));
      }
    });

    syncTopbarDeviceDropdown();
  }

  function syncTopbarDeviceDropdown() {
    if (!window.editor || !window.editor.getDevice) return;
    let curDev = window.editor.getDevice();
    if (curDev && typeof curDev === 'object') {
      curDev = curDev.id || (curDev.get && curDev.get('id')) || curDev.name || 'desktop';
    }
    curDev = (curDev || 'desktop').toLowerCase();

    const devMenu = document.getElementById('deviceDropdownMenu');
    const devIcon = document.getElementById('deviceActiveIcon');
    const devLabel = document.getElementById('deviceActiveLabel');

    if (devMenu) {
      devMenu.querySelectorAll('.topbar-dropdown-item').forEach(it => {
        const d = (it.dataset.device || it.dataset.val || '').toLowerCase();
        if (d === curDev) {
          it.classList.add('active');
          const titleEl = it.querySelector('.topbar-item-title');
          if (titleEl && devLabel) devLabel.textContent = titleEl.textContent.trim();
          const iconEl = it.querySelector('.topbar-item-icon svg');
          if (iconEl && devIcon) devIcon.innerHTML = iconEl.outerHTML;
        } else {
          it.classList.remove('active');
        }
      });
    }
  }


  // ============================================================================
  // ELEMENTOR-STYLE DROPZONE LAYOUT PICKER (FLEXBOX / GRID)
  // ============================================================================

  const DROPZONE_PICKER_CSS = `
    .empty-workspace-dropzone {
      position: relative !important;
      min-height: 180px !important;
      transition: all 0.2s ease !important;
    }
    .dropzone-picker-wrap {
      width: 100%;
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 6px 0;
      animation: dropzoneFadeIn 0.2s ease;
      user-select: none;
      box-sizing: border-box;
    }
    @keyframes dropzoneFadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .dropzone-picker-close {
      position: absolute;
      top: -24px;
      right: 4px;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: #64748b;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
      z-index: 10;
    }
    .dropzone-picker-close:hover {
      background: #f1f5f9;
      color: #0f172a;
    }
    .dropzone-picker-back {
      position: absolute;
      top: -24px;
      left: 4px;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: #64748b;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
      z-index: 10;
    }
    .dropzone-picker-back:hover {
      background: #f1f5f9;
      color: #0f172a;
    }
    .dropzone-picker-title {
      color: #4b5563;
      font-size: 15px;
      font-weight: 500;
      text-align: center;
      margin-bottom: 22px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .dropzone-layout-cards {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 40px;
    }
    .dropzone-layout-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      background: transparent;
      border: none;
      padding: 8px;
      cursor: pointer;
      transition: all 0.18s ease;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .dropzone-layout-card .dropzone-layout-icon {
      width: 72px;
      height: 72px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.18s ease, filter 0.18s ease;
    }
    .dropzone-layout-card:hover .dropzone-layout-icon {
      transform: translateY(-2px);
      filter: brightness(0.92);
    }
    .dropzone-layout-card .dropzone-layout-label {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.06em;
      color: #475569;
      transition: color 0.18s ease;
    }
    .dropzone-layout-card:hover .dropzone-layout-label {
      color: #0f172a;
    }
    .dropzone-structures-grid {
      display: grid;
      grid-template-columns: repeat(6, 76px);
      gap: 14px;
      justify-content: center;
      align-items: center;
    }
    @media (max-width: 640px) {
      .dropzone-structures-grid {
        grid-template-columns: repeat(3, 76px);
      }
    }
    .dropzone-structure-card {
      width: 76px;
      height: 46px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 4px;
      padding: 0;
      margin: 0;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }
    .dropzone-structure-card svg {
      width: 76px;
      height: 46px;
      display: block;
      transition: filter 0.15s ease;
    }
    .dropzone-structure-card:hover {
      transform: translateY(-2px);
      border-color: #3b82f6;
      box-shadow: 0 4px 10px rgba(59, 130, 246, 0.18);
    }
    .dropzone-structure-card:hover svg rect:not([fill="none"]) {
      fill: #94a3b8;
    }
  `;

  const FLEXBOX_STRUCTURES = [
    {
      id: 'flex-col',
      title: 'Direction: Column (1 container)',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect width="76" height="46" rx="2" fill="#cbd5e1"/><path d="M38 14v18M32 26l6 6 6-6" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      html: `<div class="fp-container" style="display: flex; flex-direction: column; gap: 20px; padding: 24px; width: 100%; min-height: 120px; box-sizing: border-box;"></div>`
    },
    {
      id: 'flex-row',
      title: 'Direction: Row (1 container)',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect width="76" height="46" rx="2" fill="#cbd5e1"/><path d="M29 23h18M41 17l6 6-6 6" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      html: `<div class="fp-container" style="display: flex; flex-direction: row; gap: 20px; padding: 24px; width: 100%; min-height: 120px; box-sizing: border-box;"></div>`
    },
    {
      id: 'flex-2-col',
      title: '2 Equal Columns (50% / 50%)',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect x="0" y="0" width="37" height="46" rx="2" fill="#cbd5e1"/><rect x="39" y="0" width="37" height="46" rx="2" fill="#cbd5e1"/></svg>`,
      html: `<div class="fp-container" style="display: flex; flex-direction: row; gap: 20px; padding: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="flex: 1 1 0%; min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="flex: 1 1 0%; min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div></div>`
    },
    {
      id: 'flex-3-col',
      title: '3 Equal Columns (33% / 33% / 33%)',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect x="0" y="0" width="24" height="46" rx="2" fill="#cbd5e1"/><rect x="26" y="0" width="24" height="46" rx="2" fill="#cbd5e1"/><rect x="52" y="0" width="24" height="46" rx="2" fill="#cbd5e1"/></svg>`,
      html: `<div class="fp-container" style="display: flex; flex-direction: row; gap: 20px; padding: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="flex: 1 1 0%; min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="flex: 1 1 0%; min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="flex: 1 1 0%; min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div></div>`
    },
    {
      id: 'flex-4-col',
      title: '4 Equal Columns (25% each)',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect x="0" y="0" width="17.5" height="46" rx="1.5" fill="#cbd5e1"/><rect x="19.5" y="0" width="17.5" height="46" rx="1.5" fill="#cbd5e1"/><rect x="39" y="0" width="17.5" height="46" rx="1.5" fill="#cbd5e1"/><rect x="58.5" y="0" width="17.5" height="46" rx="1.5" fill="#cbd5e1"/></svg>`,
      html: `<div class="fp-container" style="display: flex; flex-direction: row; gap: 20px; padding: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="flex: 1 1 0%; min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="flex: 1 1 0%; min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="flex: 1 1 0%; min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="flex: 1 1 0%; min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div></div>`
    },
    {
      id: 'flex-2-col-33-67',
      title: '2 Columns (33% / 67%)',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect x="0" y="0" width="24" height="46" rx="2" fill="#cbd5e1"/><rect x="26" y="0" width="50" height="46" rx="2" fill="#cbd5e1"/></svg>`,
      html: `<div class="fp-container" style="display: flex; flex-direction: row; gap: 20px; padding: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="flex: 1 1 0%; min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="flex: 2 1 0%; min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div></div>`
    },
    {
      id: 'flex-2x2-grid',
      title: '4 Quadrants (2x2)',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect x="0" y="0" width="37" height="22" rx="1.5" fill="#cbd5e1"/><rect x="39" y="0" width="37" height="22" rx="1.5" fill="#cbd5e1"/><rect x="0" y="24" width="37" height="22" rx="1.5" fill="#cbd5e1"/><rect x="39" y="24" width="37" height="22" rx="1.5" fill="#cbd5e1"/></svg>`,
      html: `<div class="fp-container" style="display: flex; flex-wrap: wrap; gap: 20px; padding: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="flex: 1 1 calc(50% - 10px); min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="flex: 1 1 calc(50% - 10px); min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="flex: 1 1 calc(50% - 10px); min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="flex: 1 1 calc(50% - 10px); min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div></div>`
    },
    {
      id: 'flex-1-top-2-bottom',
      title: '1 Row Top, 2 Columns Bottom',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect x="0" y="0" width="76" height="22" rx="1.5" fill="#cbd5e1"/><rect x="0" y="24" width="37" height="22" rx="1.5" fill="#cbd5e1"/><rect x="39" y="24" width="37" height="22" rx="1.5" fill="#cbd5e1"/></svg>`,
      html: `<div class="fp-container" style="display: flex; flex-direction: column; gap: 20px; padding: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="width: 100%; min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container" style="display: flex; flex-direction: row; gap: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="flex: 1 1 0%; min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="flex: 1 1 0%; min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div></div></div>`
    },
    {
      id: 'flex-1-left-2-right',
      title: '1 Large Left, 2 Stacked Right',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect x="0" y="0" width="37" height="46" rx="1.5" fill="#cbd5e1"/><rect x="39" y="0" width="37" height="22" rx="1.5" fill="#cbd5e1"/><rect x="39" y="24" width="37" height="22" rx="1.5" fill="#cbd5e1"/></svg>`,
      html: `<div class="fp-container" style="display: flex; flex-direction: row; gap: 20px; padding: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="flex: 1 1 0%; min-height: 180px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container" style="display: flex; flex-direction: column; flex: 1 1 0%; gap: 20px; box-sizing: border-box;"><div class="fp-container cell" style="flex: 1 1 0%; min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="flex: 1 1 0%; min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div></div></div>`
    },
    {
      id: 'flex-6-boxes',
      title: '6 Boxes (3 Columns Top, 3 Columns Bottom)',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect x="0" y="0" width="24" height="22" rx="1.5" fill="#cbd5e1"/><rect x="26" y="0" width="24" height="22" rx="1.5" fill="#cbd5e1"/><rect x="52" y="0" width="24" height="22" rx="1.5" fill="#cbd5e1"/><rect x="0" y="24" width="24" height="22" rx="1.5" fill="#cbd5e1"/><rect x="26" y="24" width="24" height="22" rx="1.5" fill="#cbd5e1"/><rect x="52" y="24" width="24" height="22" rx="1.5" fill="#cbd5e1"/></svg>`,
      html: `<div class="fp-container" style="display: flex; flex-wrap: wrap; gap: 20px; padding: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="flex: 1 1 calc(33.333% - 14px); min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="flex: 1 1 calc(33.333% - 14px); min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="flex: 1 1 calc(33.333% - 14px); min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="flex: 1 1 calc(33.333% - 14px); min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="flex: 1 1 calc(33.333% - 14px); min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="flex: 1 1 calc(33.333% - 14px); min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div></div>`
    },
    {
      id: 'flex-1-top-3-bottom',
      title: '1 Row Top, 3 Columns Bottom',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect x="0" y="0" width="76" height="22" rx="1.5" fill="#cbd5e1"/><rect x="0" y="24" width="24" height="22" rx="1.5" fill="#cbd5e1"/><rect x="26" y="24" width="24" height="22" rx="1.5" fill="#cbd5e1"/><rect x="52" y="24" width="24" height="22" rx="1.5" fill="#cbd5e1"/></svg>`,
      html: `<div class="fp-container" style="display: flex; flex-direction: column; gap: 20px; padding: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="width: 100%; min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container" style="display: flex; flex-direction: row; gap: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="flex: 1 1 0%; min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="flex: 1 1 0%; min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="flex: 1 1 0%; min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div></div></div>`
    },
    {
      id: 'flex-2-col-67-33',
      title: '2 Columns (67% / 33%)',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect x="0" y="0" width="50" height="46" rx="2" fill="#cbd5e1"/><rect x="52" y="0" width="24" height="46" rx="2" fill="#cbd5e1"/></svg>`,
      html: `<div class="fp-container" style="display: flex; flex-direction: row; gap: 20px; padding: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="flex: 2 1 0%; min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="flex: 1 1 0%; min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div></div>`
    }
  ];

  const GRID_STRUCTURES = [
    {
      id: 'grid-1-col',
      title: '1 Column Grid',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect width="76" height="46" rx="2" fill="#cbd5e1"/></svg>`,
      html: `<div class="fp-container" style="display: grid; grid-template-columns: 1fr; gap: 20px; padding: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div></div>`
    },
    {
      id: 'grid-2-col',
      title: '2 Columns Grid',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect x="0" y="0" width="37" height="46" rx="2" fill="#cbd5e1"/><rect x="39" y="0" width="37" height="46" rx="2" fill="#cbd5e1"/></svg>`,
      html: `<div class="fp-container" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; padding: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div></div>`
    },
    {
      id: 'grid-3-col',
      title: '3 Columns Grid',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect x="0" y="0" width="24" height="46" rx="2" fill="#cbd5e1"/><rect x="26" y="0" width="24" height="46" rx="2" fill="#cbd5e1"/><rect x="52" y="0" width="24" height="46" rx="2" fill="#cbd5e1"/></svg>`,
      html: `<div class="fp-container" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; padding: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div></div>`
    },
    {
      id: 'grid-4-col',
      title: '4 Columns Grid',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect x="0" y="0" width="17.5" height="46" rx="1.5" fill="#cbd5e1"/><rect x="19.5" y="0" width="17.5" height="46" rx="1.5" fill="#cbd5e1"/><rect x="39" y="0" width="17.5" height="46" rx="1.5" fill="#cbd5e1"/><rect x="58.5" y="0" width="17.5" height="46" rx="1.5" fill="#cbd5e1"/></svg>`,
      html: `<div class="fp-container" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; padding: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div></div>`
    },
    {
      id: 'grid-2-col-1-2',
      title: '2 Columns Grid (1fr 2fr)',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect x="0" y="0" width="24" height="46" rx="2" fill="#cbd5e1"/><rect x="26" y="0" width="50" height="46" rx="2" fill="#cbd5e1"/></svg>`,
      html: `<div class="fp-container" style="display: grid; grid-template-columns: 1fr 2fr; gap: 20px; padding: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div></div>`
    },
    {
      id: 'grid-2-col-2-1',
      title: '2 Columns Grid (2fr 1fr)',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect x="0" y="0" width="50" height="46" rx="2" fill="#cbd5e1"/><rect x="52" y="0" width="24" height="46" rx="2" fill="#cbd5e1"/></svg>`,
      html: `<div class="fp-container" style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px; padding: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div></div>`
    },
    {
      id: 'grid-2x2',
      title: '2x2 Grid (4 cells)',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect x="0" y="0" width="37" height="22" rx="1.5" fill="#cbd5e1"/><rect x="39" y="0" width="37" height="22" rx="1.5" fill="#cbd5e1"/><rect x="0" y="24" width="37" height="22" rx="1.5" fill="#cbd5e1"/><rect x="39" y="24" width="37" height="22" rx="1.5" fill="#cbd5e1"/></svg>`,
      html: `<div class="fp-container" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; padding: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div></div>`
    },
    {
      id: 'grid-3x2',
      title: '3x2 Grid (6 cells)',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect x="0" y="0" width="24" height="22" rx="1.5" fill="#cbd5e1"/><rect x="26" y="0" width="24" height="22" rx="1.5" fill="#cbd5e1"/><rect x="52" y="0" width="24" height="22" rx="1.5" fill="#cbd5e1"/><rect x="0" y="24" width="24" height="22" rx="1.5" fill="#cbd5e1"/><rect x="26" y="24" width="24" height="22" rx="1.5" fill="#cbd5e1"/><rect x="52" y="24" width="24" height="22" rx="1.5" fill="#cbd5e1"/></svg>`,
      html: `<div class="fp-container" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; padding: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div></div>`
    },
    {
      id: 'grid-3-col-1-2-1',
      title: '3 Columns Grid (1fr 2fr 1fr)',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect x="0" y="0" width="18" height="46" rx="1.5" fill="#cbd5e1"/><rect x="20" y="0" width="36" height="46" rx="1.5" fill="#cbd5e1"/><rect x="58" y="0" width="18" height="46" rx="1.5" fill="#cbd5e1"/></svg>`,
      html: `<div class="fp-container" style="display: grid; grid-template-columns: 1fr 2fr 1fr; gap: 20px; padding: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 100px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div></div>`
    },
    {
      id: 'grid-4x2',
      title: '4x2 Grid (8 cells)',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect x="0" y="0" width="17.5" height="22" rx="1.5" fill="#cbd5e1"/><rect x="19.5" y="0" width="17.5" height="22" rx="1.5" fill="#cbd5e1"/><rect x="39" y="0" width="17.5" height="22" rx="1.5" fill="#cbd5e1"/><rect x="58.5" y="0" width="17.5" height="22" rx="1.5" fill="#cbd5e1"/><rect x="0" y="24" width="17.5" height="22" rx="1.5" fill="#cbd5e1"/><rect x="19.5" y="24" width="17.5" height="22" rx="1.5" fill="#cbd5e1"/><rect x="39" y="24" width="17.5" height="22" rx="1.5" fill="#cbd5e1"/><rect x="58.5" y="24" width="17.5" height="22" rx="1.5" fill="#cbd5e1"/></svg>`,
      html: `<div class="fp-container" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; padding: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 80px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div></div>`
    },
    {
      id: 'grid-left-tall',
      title: '1 Left Tall (span 2), 2 Right Stacked',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect x="0" y="0" width="37" height="46" rx="1.5" fill="#cbd5e1"/><rect x="39" y="0" width="37" height="22" rx="1.5" fill="#cbd5e1"/><rect x="39" y="24" width="37" height="22" rx="1.5" fill="#cbd5e1"/></svg>`,
      html: `<div class="fp-container" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="grid-row: span 2; min-height: 200px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 90px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 90px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div></div>`
    },
    {
      id: 'grid-right-tall',
      title: '2 Left Stacked, 1 Right Tall (span 2)',
      svg: `<svg viewBox="0 0 76 46" fill="none"><rect x="0" y="0" width="37" height="22" rx="1.5" fill="#cbd5e1"/><rect x="0" y="24" width="37" height="22" rx="1.5" fill="#cbd5e1"/><rect x="39" y="0" width="37" height="46" rx="1.5" fill="#cbd5e1"/></svg>`,
      html: `<div class="fp-container" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding: 20px; width: 100%; box-sizing: border-box;"><div class="fp-container cell" style="min-height: 90px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="min-height: 90px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div><div class="fp-container cell" style="grid-column: 2; grid-row: 1 / span 2; min-height: 200px; padding: 16px; border: 1px dashed rgba(160, 174, 192, 0.4); border-radius: 4px; box-sizing: border-box;"></div></div>`
    }
  ];

  function renderDropzoneStep(dz, step, layoutType, editor) {
    if (!dz) return;
    const btnRow = dz.querySelector('.dropzone-buttons-row');
    const hint = dz.querySelector('.dropzone-hint, .dropzone-text');
    let pickerWrap = dz.querySelector('.dropzone-picker-wrap');

    if (step === 'default') {
      if (pickerWrap) pickerWrap.remove();
      if (btnRow) btnRow.style.removeProperty('display');
      if (hint) hint.style.removeProperty('display');
      return;
    }

    if (btnRow) btnRow.style.setProperty('display', 'none', 'important');
    if (hint) hint.style.setProperty('display', 'none', 'important');

    if (!pickerWrap) {
      pickerWrap = document.createElement('div');
      pickerWrap.className = 'dropzone-picker-wrap';
      pickerWrap.setAttribute('data-gjs-layerable', 'false');
      pickerWrap.setAttribute('data-gjs-selectable', 'false');
      pickerWrap.setAttribute('data-gjs-hoverable', 'false');
      pickerWrap.setAttribute('data-gjs-highlightable', 'false');
      pickerWrap.setAttribute('data-gjs-badgable', 'false');
      pickerWrap.setAttribute('data-gjs-draggable', 'false');
      pickerWrap.setAttribute('data-gjs-droppable', 'false');
      dz.appendChild(pickerWrap);
    }

    if (step === 'layout') {
      pickerWrap.innerHTML = `
        <button type="button" class="dropzone-picker-close" title="Close" data-gjs-selectable="false" data-gjs-hoverable="false">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
        <div class="dropzone-picker-title">Which layout would you like to use?</div>
        <div class="dropzone-layout-cards">
          <button type="button" class="dropzone-layout-card" data-layout="flexbox" title="Flexbox Container">
            <div class="dropzone-layout-icon">
              <svg width="68" height="68" viewBox="0 0 72 72" fill="none">
                <rect x="0" y="0" width="34" height="72" rx="2" fill="#cbd5e1"/>
                <rect x="38" y="0" width="34" height="34" rx="2" fill="#cbd5e1"/>
                <rect x="38" y="38" width="34" height="34" rx="2" fill="#cbd5e1"/>
              </svg>
            </div>
            <span class="dropzone-layout-label">FLEXBOX</span>
          </button>
          <button type="button" class="dropzone-layout-card" data-layout="grid" title="Grid Container">
            <div class="dropzone-layout-icon">
              <svg width="68" height="68" viewBox="0 0 72 72" fill="none">
                <rect x="1" y="1" width="70" height="70" rx="2" fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-dasharray="3 3"/>
                <line x1="36" y1="1" x2="36" y2="71" stroke="#94a3b8" stroke-width="1.8" stroke-dasharray="3 3"/>
                <line x1="1" y1="36" x2="71" y2="36" stroke="#94a3b8" stroke-width="1.8" stroke-dasharray="3 3"/>
              </svg>
            </div>
            <span class="dropzone-layout-label">GRID</span>
          </button>
        </div>
      `;
    } else if (step === 'structure') {
      const structures = layoutType === 'grid' ? GRID_STRUCTURES : FLEXBOX_STRUCTURES;
      const cardsHtml = structures.map(s => `
        <button type="button" class="dropzone-structure-card" data-layout="${layoutType}" data-structure="${s.id}" title="${s.title}">
          ${s.svg}
        </button>
      `).join('');

      pickerWrap.innerHTML = `
        <button type="button" class="dropzone-picker-back" title="Back to layout choice" data-gjs-selectable="false" data-gjs-hoverable="false">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <button type="button" class="dropzone-picker-close" title="Close" data-gjs-selectable="false" data-gjs-hoverable="false">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
        <div class="dropzone-picker-title">Select your structure</div>
        <div class="dropzone-structures-grid">
          ${cardsHtml}
        </div>
      `;
    }
  }

  function insertContainerStructure(editor, dz, html) {
    if (!editor) return;
    const wrapper = editor.getWrapper();
    let newComp;

    // Find the exact matching dropzone component
    let targetComp = null;
    if (dz) {
      const dzId = dz.id;
      if (dzId) {
        targetComp = wrapper.find(`#${dzId}`)[0];
      }
      if (!targetComp) {
        const allDropzones = wrapper.find('.empty-workspace-dropzone, #emptyWorkspaceDropzone');
        targetComp = allDropzones.find(c => {
          const el = c.getView ? c.getView()?.el : c.getEl ? c.getEl() : null;
          return el === dz;
        }) || allDropzones[0];
      }
    } else {
      targetComp = wrapper.find('#emptyWorkspaceDropzone, .empty-workspace-dropzone')[0];
    }

    if (targetComp) {
      const parent = targetComp.parent() || wrapper;
      const index = targetComp.index();
      newComp = parent.append(html, { at: index })[0];
      targetComp.remove();
    } else {
      newComp = wrapper.append(html)[0];
    }

    if (newComp) {
      editor.select(newComp);
    }

    const tabStyles = document.querySelector('.tab-btn[data-tab="styles"], #btnTabStyles');
    if (tabStyles) tabStyles.click();

    if (typeof window.showToast === 'function') {
      window.showToast('✓ Container added to canvas', true);
    }
  }

  function openDropzoneLayoutPicker(dz, editor) {
    if (!dz) return;
    renderDropzoneStep(dz, 'layout', null, editor || window.editor);
  }

  function initDropzoneLayoutPicker(editor) {
    if (!editor || !editor.Canvas) return;

    function setupCanvasIframe() {
      const frameDoc = editor.Canvas.getDocument();
      if (!frameDoc) return;

      // Inject iframe styles if missing
      if (!frameDoc.getElementById('fp-dropzone-picker-styles')) {
        const style = frameDoc.createElement('style');
        style.id = 'fp-dropzone-picker-styles';
        style.textContent = DROPZONE_PICKER_CSS;
        frameDoc.head.appendChild(style);
      }

      if (frameDoc.__dropzoneLayoutPickerBound) return;
      frameDoc.__dropzoneLayoutPickerBound = true;

      frameDoc.addEventListener('click', (e) => {
        // 1. Plus button clicked in dropzone -> Open Layout Choice
        const btnAdd = e.target.closest('#btnDropzoneAddBlock, .btn-trigger-add-block');
        if (btnAdd) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          const dz = btnAdd.closest('.empty-workspace-dropzone, #emptyWorkspaceDropzone');
          if (dz) {
            renderDropzoneStep(dz, 'layout', null, editor);
          }
          return;
        }

        // 2. Close button clicked -> Restore initial dropzone state
        const btnClose = e.target.closest('.dropzone-picker-close');
        if (btnClose) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          const dz = btnClose.closest('.empty-workspace-dropzone, #emptyWorkspaceDropzone');
          if (dz) {
            renderDropzoneStep(dz, 'default', null, editor);
          }
          return;
        }

        // 3. Layout Card clicked (Flexbox or Grid) -> Open Structure Choice
        const layoutCard = e.target.closest('.dropzone-layout-card');
        if (layoutCard) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          const dz = layoutCard.closest('.empty-workspace-dropzone, #emptyWorkspaceDropzone');
          const layout = layoutCard.dataset.layout || 'flexbox';
          if (dz) {
            renderDropzoneStep(dz, 'structure', layout, editor);
          }
          return;
        }

        // 4. Back button clicked -> Return to Layout Choice
        const btnBack = e.target.closest('.dropzone-picker-back');
        if (btnBack) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          const dz = btnBack.closest('.empty-workspace-dropzone, #emptyWorkspaceDropzone');
          if (dz) {
            renderDropzoneStep(dz, 'layout', null, editor);
          }
          return;
        }

        // 5. Structure Card clicked -> Insert Container Structure into canvas
        const structCard = e.target.closest('.dropzone-structure-card');
        if (structCard) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          const dz = structCard.closest('.empty-workspace-dropzone, #emptyWorkspaceDropzone');
          const structId = structCard.dataset.structure;
          const layout = structCard.dataset.layout;
          const pool = layout === 'grid' ? GRID_STRUCTURES : FLEXBOX_STRUCTURES;
          const struct = pool.find(s => s.id === structId);
          if (struct) {
            insertContainerStructure(editor, dz, struct.html);
          }
          return;
        }
      }, true);
    }

    editor.on('load', setupCanvasIframe);
    setupCanvasIframe();
    setTimeout(setupCanvasIframe, 100);
    setTimeout(setupCanvasIframe, 600);
    setTimeout(setupCanvasIframe, 1500);
  }

  // ============================================================================
  // Section / Div Top-Middle Plus Button
  // When a section or div is clicked/selected, displays a "+" button in the top middle.
  // Clicking the plus button inserts a new empty dropzone above that section/div.
  // ============================================================================
  function initSectionTopPlusButton(editor) {
    if (!editor || !editor.Canvas) return;
    if (editor.__sectionTopPlusButtonInitialized) return;
    editor.__sectionTopPlusButtonInitialized = true;

    const PLUS_CSS = `
      #gjs-section-top-plus-btn {
        position: absolute;
        transform: translate(-50%, -50%);
        z-index: 999999;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: #0284c7;
        color: #ffffff;
        border: 2px solid #ffffff;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(2, 132, 199, 0.35);
        display: none;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
        user-select: none;
        outline: none;
        padding: 0;
        margin: 0;
        pointer-events: auto;
      }
      #gjs-section-top-plus-btn:hover {
        background: #0369a1;
        transform: translate(-50%, -50%) scale(1.15);
        box-shadow: 0 4px 14px rgba(2, 132, 199, 0.5);
      }
      #gjs-section-top-plus-btn:active {
        transform: translate(-50%, -50%) scale(0.95);
      }
      #gjs-section-top-plus-btn svg {
        width: 14px;
        height: 14px;
        stroke-width: 2.8;
        pointer-events: none;
      }
      #gjs-section-top-plus-btn .fp-section-plus-tooltip {
        position: absolute;
        bottom: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%) translateY(4px);
        background: #0f172a;
        color: #ffffff;
        font-size: 11px;
        font-weight: 600;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        padding: 4px 8px;
        border-radius: 4px;
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.15s ease, transform 0.15s ease;
        box-shadow: 0 2px 6px rgba(0,0,0,0.25);
      }
      #gjs-section-top-plus-btn:hover .fp-section-plus-tooltip {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    `;

    function isEligibleSectionOrDiv(comp) {
      if (!comp) return false;
      if (comp.is && comp.is('wrapper')) return false;

      // Don't show on dropzone itself or its placeholder buttons/hints
      const classes = comp.getClasses ? comp.getClasses() : [];
      if (classes.includes('empty-workspace-dropzone') || classes.includes('dropzone-buttons-row') || classes.includes('fp-dropzone-picker')) {
        return false;
      }

      const id = comp.getId ? comp.getId() : '';
      if (id && id.includes('emptyWorkspaceDropzone')) {
        return false;
      }

      const tag = (comp.get('tagName') || comp.get('type') || '').toLowerCase();
      if (CONTAINER_TAGS.includes(tag)) return true;

      const s = comp.getStyle ? comp.getStyle() : {};
      if (s.display === 'flex' || s.display === 'grid' || s.display === 'inline-flex') return true;

      return false;
    }

    function setupCanvasIframePlusBtn() {
      const frameDoc = editor.Canvas.getDocument();
      if (!frameDoc || !frameDoc.body) return null;

      if (!frameDoc.getElementById('fp-section-plus-styles')) {
        const style = frameDoc.createElement('style');
        style.id = 'fp-section-plus-styles';
        style.textContent = PLUS_CSS;
        frameDoc.head.appendChild(style);
      }

      let btn = frameDoc.getElementById('gjs-section-top-plus-btn');
      if (!btn) {
        btn = frameDoc.createElement('button');
        btn.id = 'gjs-section-top-plus-btn';
        btn.type = 'button';
        btn.setAttribute('data-gjs-selectable', 'false');
        btn.setAttribute('data-gjs-hoverable', 'false');
        btn.setAttribute('data-gjs-highlightable', 'false');
        btn.setAttribute('data-gjs-layerable', 'false');
        btn.setAttribute('data-gjs-droppable', 'false');
        btn.setAttribute('data-gjs-draggable', 'false');
        btn.setAttribute('data-gjs-badgable', 'false');
        btn.setAttribute('data-gjs-copyable', 'false');
        btn.setAttribute('data-gjs-removable', 'false');
        btn.setAttribute('data-gjs-type', 'none');
        btn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span class="fp-section-plus-tooltip">Add Section / Dropzone</span>
        `;
        frameDoc.body.appendChild(btn);

        btn.addEventListener('mousedown', (e) => {
          e.stopPropagation();
        });

        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();

          const curComp = editor.getSelected();
          if (!curComp) return;

          const parent = curComp.parent();
          const index = curComp.index();

          const isDark = typeof window !== 'undefined' && window.location.pathname.includes('popup');
          const borderCol = isDark ? '#374151' : '#cdd5e0';
          const bgCol = isDark ? 'rgba(17, 24, 39, 0.6)' : '#ffffff';
          const btnBg = isDark ? '#374151' : '#e2e8f0';
          const btnCol = isDark ? '#f3f4f6' : '#1e293b';

          const dzUniqueId = 'emptyWorkspaceDropzone_' + Date.now();
          const dzHtml = `
<div class="empty-workspace-dropzone" id="${dzUniqueId}" style="border: 2px dashed ${borderCol}; border-radius: 6px; padding: 42px 20px; margin: 30px auto; max-width: 960px; min-height: 140px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: ${bgCol}; user-select: none;">
  <div class="dropzone-buttons-row" data-gjs-layerable="false" data-gjs-selectable="false" data-gjs-hoverable="false" data-gjs-highlightable="false" data-gjs-badgable="false" data-gjs-draggable="false" data-gjs-droppable="false" data-gjs-copyable="false" data-gjs-removable="false" style="display: flex; align-items: center; gap: 14px;">
    <button type="button" class="dropzone-btn btn-trigger-add-block" id="btnDropzoneAddBlock" data-gjs-layerable="false" data-gjs-selectable="false" data-gjs-hoverable="false" data-gjs-highlightable="false" data-gjs-badgable="false" data-gjs-draggable="false" data-gjs-droppable="false" data-gjs-copyable="false" data-gjs-removable="false" title="Add Block / Widget" style="width: 44px; height: 44px; border-radius: 50%; background: ${btnBg}; color: ${btnCol}; border: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); transition: all 0.2s;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" data-gjs-layerable="false" data-gjs-selectable="false" data-gjs-hoverable="false"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
    </button>
    <button type="button" class="dropzone-btn btn-trigger-add-template" id="btnDropzoneAddTemplate" data-gjs-layerable="false" data-gjs-selectable="false" data-gjs-hoverable="false" data-gjs-highlightable="false" data-gjs-badgable="false" data-gjs-draggable="false" data-gjs-droppable="false" data-gjs-copyable="false" data-gjs-removable="false" title="Add a Saved Template" style="width: 44px; height: 44px; border-radius: 50%; background: ${btnBg}; color: ${btnCol}; border: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); transition: all 0.2s;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
    </button>
  </div>
  <div class="dropzone-hint" data-gjs-layerable="false" data-gjs-selectable="false" data-gjs-hoverable="false" data-gjs-highlightable="false" data-gjs-badgable="false" data-gjs-draggable="false" data-gjs-droppable="false" data-gjs-copyable="false" data-gjs-removable="false" style="color: #64748b; font-size: 13px; font-style: italic; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    Drag widget here
  </div>
</div>`;

          let newComp = null;
          if (parent) {
            newComp = parent.append(dzHtml, { at: index })[0];
          } else {
            const wrapper = editor.getWrapper();
            newComp = wrapper.append(dzHtml, { at: 0 })[0];
          }

          if (newComp) {
            editor.select(newComp);
            try {
              const el = newComp.getEl();
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } catch (err) {}
          }
        });
      }

      const frameWin = frameDoc.defaultView || window;
      if (!frameWin.__sectionPlusScrollBound) {
        frameWin.__sectionPlusScrollBound = true;
        frameWin.addEventListener('scroll', updatePosition, { passive: true });
        frameWin.addEventListener('resize', updatePosition, { passive: true });
      }

      return btn;
    }

    function updatePosition() {
      const frameDoc = editor.Canvas.getDocument();
      if (!frameDoc) return;
      const btn = frameDoc.getElementById('gjs-section-top-plus-btn');
      if (!btn) return;

      const comp = editor.getSelected();
      if (!comp || !isEligibleSectionOrDiv(comp)) {
        btn.style.display = 'none';
        return;
      }

      const view = comp.getView ? comp.getView() : comp.view;
      const el = view ? view.el : comp.getEl ? comp.getEl() : null;
      if (!el || !el.isConnected) {
        btn.style.display = 'none';
        return;
      }

      const rect = el.getBoundingClientRect();
      const frameWin = frameDoc.defaultView || window;
      const scrollY = frameWin.scrollY || frameDoc.documentElement.scrollTop || 0;
      const scrollX = frameWin.scrollX || frameDoc.documentElement.scrollLeft || 0;

      // Check if element is way off-screen
      if (rect.bottom < -40 || rect.top > frameWin.innerHeight + 40) {
        btn.style.display = 'none';
        return;
      }

      let top = rect.top + scrollY;
      let left = rect.left + scrollX + (rect.width / 2);

      // Keep button on canvas if section top is at 0
      if (top < 16) {
        top = 16;
      }

      btn.style.top = `${top}px`;
      btn.style.left = `${left}px`;
      btn.style.display = 'flex';
    }

    function showButton(comp) {
      if (!isEligibleSectionOrDiv(comp)) {
        hideButton();
        return;
      }
      setupCanvasIframePlusBtn();
      updatePosition();
      requestAnimationFrame(updatePosition);
      setTimeout(updatePosition, 30);
      setTimeout(updatePosition, 100);
      setTimeout(updatePosition, 300);
    }

    function hideButton() {
      const frameDoc = editor.Canvas.getDocument();
      if (!frameDoc) return;
      const btn = frameDoc.getElementById('gjs-section-top-plus-btn');
      if (btn) btn.style.display = 'none';
    }

    editor.on('component:selected', (comp) => {
      showButton(comp);
    });

    editor.on('component:deselected', () => {
      hideButton();
    });

    editor.on('component:drag:end component:resize component:styleUpdate component:update canvas:scroll frame:scroll', () => {
      updatePosition();
    });

    editor.on('device:select change:device', () => {
      setTimeout(updatePosition, 50);
      setTimeout(updatePosition, 250);
    });

    editor.on('load', () => {
      setupCanvasIframePlusBtn();
    });

    setupCanvasIframePlusBtn();
    setTimeout(setupCanvasIframePlusBtn, 200);
    setTimeout(setupCanvasIframePlusBtn, 800);
  }

  // ============================================================================
  // SECTION & CONTENT HOVER HIGHLIGHTING
  // When a section or container is hovered, highlights the wrapper and all
  // internal columns/contents with clear visual guides, and shows a Section badge.
  // NOTE: Never use background-color: ... !important; here so that user custom
  // background colors (like #10b981) on divs and columns are ALWAYS preserved!
  // ============================================================================
  const HOVER_HIGHLIGHT_CSS = `
    /* Base helper for empty columns/containers anywhere on canvas */
    .cell:empty,
    .fp-container:empty,
    div[style*="display: flex"] > div:empty,
    div[style*="display:flex"] > div:empty,
    div[style*="display: grid"] > div:empty,
    div[style*="display:grid"] > div:empty,
    div.row > div:empty,
    [class*="col-"]:empty {
      min-height: 80px !important;
      outline: 1.5px dashed rgba(2, 132, 199, 0.4) !important;
      outline-offset: -2px !important;
      background-color: rgba(248, 250, 252, 0.45);
      position: relative !important;
    }

    /* Subtle "Column" placeholder label for empty columns */
    .cell:empty::before,
    .fp-container:empty::before,
    div[style*="display: flex"] > div:empty::before,
    div[style*="display:flex"] > div:empty::before,
    div[style*="display: grid"] > div:empty::before,
    div[style*="display:grid"] > div:empty::before,
    div.row > div:empty::before {
      content: "Column";
      position: absolute;
      top: 6px;
      left: 8px;
      font-size: 10px;
      font-weight: 700;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #94a3b8;
      letter-spacing: 0.5px;
      pointer-events: none;
      text-transform: uppercase;
    }

    /* Section / Container wrapper hover */
    section:hover,
    div.fp-container:not(.cell):hover,
    div.row:hover,
    div[class*="section"]:hover,
    div[class*="container"]:not(.cell):hover,
    [data-gjs-type="container"]:hover,
    [data-gjs-type="row"]:hover,
    [data-gjs-type="section"]:hover,
    .fp-section-hovered {
      outline: 2px solid #0284c7 !important;
      outline-offset: -2px !important;
      position: relative;
    }

    /* Highlight all direct columns / content inside hovered section */
    section:hover > div,
    section:hover > .container > .row > div,
    section:hover > .row > div,
    section:hover > .row > .cell,
    section:hover div[style*="display: flex"] > div,
    section:hover div[style*="display:flex"] > div,
    section:hover div[style*="display: grid"] > div,
    section:hover div[style*="display:grid"] > div,
    div.row:hover > div,
    div.row:hover > .cell,
    div.fp-container:not(.cell):hover > div,
    div[class*="section"]:hover > div,
    div[class*="container"]:not(.cell):hover > div,
    .fp-section-hovered > div,
    .fp-section-hovered > .container > .row > div,
    .fp-section-hovered > .row > div,
    .fp-section-hovered div[style*="display: flex"] > div,
    .fp-section-hovered div[style*="display:flex"] > div,
    .fp-section-hovered div[style*="display: grid"] > div,
    .fp-section-hovered div[style*="display:grid"] > div,
    .fp-section-content-highlight {
      outline: 1.5px dashed #0284c7 !important;
      outline-offset: -2px !important;
      transition: outline 0.15s ease;
    }

    /* When a specific inner column or content is hovered */
    section:hover > div:hover,
    section:hover > .row > div:hover,
    section:hover div[style*="display: flex"] > div:hover,
    section:hover div[style*="display:flex"] > div:hover,
    section:hover div[style*="display: grid"] > div:hover,
    section:hover div[style*="display:grid"] > div:hover,
    div.row:hover > div:hover,
    div.row:hover > .cell:hover,
    div.fp-container:not(.cell):hover > div:hover,
    .fp-section-content-hovered {
      outline: 2px solid #0284c7 !important;
      outline-offset: -2px !important;
    }

    /* When a Column inside is selected, highlight parent section and sibling columns */
    section:has(.gjs-selected),
    div.fp-container:has(.gjs-selected),
    div.row:has(.gjs-selected) {
      outline: 1.5px dashed rgba(2, 132, 199, 0.5) !important;
      outline-offset: -2px !important;
    }
    section:has(.gjs-selected) > div:not(.gjs-selected),
    section:has(.gjs-selected) div[style*="display: flex"] > div:not(.gjs-selected),
    section:has(.gjs-selected) div[style*="display:flex"] > div:not(.gjs-selected),
    div.row:has(.gjs-selected) > div:not(.gjs-selected) {
      outline: 1.5px dashed rgba(2, 132, 199, 0.45) !important;
      outline-offset: -2px !important;
    }

    /* Floating Section Badge Tab */
    #fp-section-hover-badge {
      position: absolute;
      background: #0284c7;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 11px;
      font-weight: 600;
      line-height: 1;
      padding: 4px 9px;
      border-radius: 4px 4px 0 0;
      display: none;
      align-items: center;
      gap: 6px;
      z-index: 999998;
      pointer-events: none;
      user-select: none;
      box-shadow: 0 -2px 6px rgba(0,0,0,0.12);
      transition: opacity 0.15s ease;
    }
    #fp-section-hover-badge svg {
      width: 12px;
      height: 12px;
      stroke-width: 2.2;
    }
  `;

  function initSectionHoverHighlight(editor) {
    if (!editor || !editor.Canvas) return;
    if (editor.__sectionHoverHighlightInitialized) return;
    editor.__sectionHoverHighlightInitialized = true;

    function setupHoverTracking() {
      const frameDoc = editor.Canvas.getDocument();
      if (!frameDoc || !frameDoc.body) return;

      if (!frameDoc.getElementById('fp-section-hover-styles')) {
        const style = frameDoc.createElement('style');
        style.id = 'fp-section-hover-styles';
        style.textContent = HOVER_HIGHLIGHT_CSS;
        frameDoc.head.appendChild(style);
      }

      let badge = frameDoc.getElementById('fp-section-hover-badge');
      if (!badge) {
        badge = frameDoc.createElement('div');
        badge.id = 'fp-section-hover-badge';
        badge.setAttribute('data-gjs-selectable', 'false');
        badge.setAttribute('data-gjs-hoverable', 'false');
        badge.setAttribute('data-gjs-highlightable', 'false');
        badge.setAttribute('data-gjs-layerable', 'false');
        badge.setAttribute('data-gjs-droppable', 'false');
        badge.setAttribute('data-gjs-draggable', 'false');
        badge.setAttribute('data-gjs-badgable', 'false');
        badge.setAttribute('data-gjs-copyable', 'false');
        badge.setAttribute('data-gjs-removable', 'false');
        badge.setAttribute('data-gjs-type', 'none');
        badge.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"></rect>
            <line x1="12" y1="3" x2="12" y2="21"></line>
          </svg>
          <span id="fp-section-badge-label">Section</span>
        `;
        frameDoc.body.appendChild(badge);
      }

      let currentHoveredSection = null;

      function getSectionWrapper(target) {
        if (!target || target === frameDoc.body || target === frameDoc.documentElement) return null;
        if (target.id === 'gjs-section-top-plus-btn' || target.id === 'fp-section-hover-badge') return null;
        if (target.closest && target.closest('.empty-workspace-dropzone, #emptyWorkspaceDropzone')) return null;

        let cur = target;
        let best = null;
        while (cur && cur !== frameDoc.body && cur !== frameDoc.documentElement) {
          const tag = (cur.tagName || '').toLowerCase();
          const isSec = tag === 'section' ||
            (cur.classList && (cur.classList.contains('row') || cur.classList.contains('fp-container') || cur.classList.contains('container') || (typeof cur.className === 'string' && cur.className.includes('section')))) ||
            cur.getAttribute('data-gjs-type') === 'container' ||
            cur.getAttribute('data-gjs-type') === 'section' ||
            cur.parentElement === frameDoc.body;

          if (isSec && !(cur.classList && cur.classList.contains('cell'))) {
            best = cur;
            break;
          }
          cur = cur.parentElement;
        }
        return best;
      }

      function updateBadgePosition(sec) {
        if (!sec || !sec.isConnected) {
          badge.style.display = 'none';
          return;
        }
        const rect = sec.getBoundingClientRect();
        const frameWin = frameDoc.defaultView || window;
        const scrollY = frameWin.scrollY || frameDoc.documentElement.scrollTop || 0;
        const scrollX = frameWin.scrollX || frameDoc.documentElement.scrollLeft || 0;

        if (rect.bottom < 0 || rect.top > frameWin.innerHeight) {
          badge.style.display = 'none';
          return;
        }

        let top = rect.top + scrollY - 21;
        if (top < 0) top = rect.top + scrollY + 2;
        const left = rect.left + scrollX + 16;

        badge.style.top = `${top}px`;
        badge.style.left = `${left}px`;
        badge.style.display = 'inline-flex';

        const label = badge.querySelector('#fp-section-badge-label');
        if (label) {
          const tag = (sec.tagName || '').toLowerCase();
          label.textContent = tag === 'section' ? 'Section' : 'Container';
        }
      }

      function onMouseMove(e) {
        const sec = getSectionWrapper(e.target);
        if (sec !== currentHoveredSection) {
          if (currentHoveredSection && currentHoveredSection.isConnected) {
            currentHoveredSection.classList.remove('fp-section-hovered');
          }
          currentHoveredSection = sec;
          if (sec) {
            sec.classList.add('fp-section-hovered');
            updateBadgePosition(sec);
          } else {
            badge.style.display = 'none';
          }
        } else if (sec) {
          updateBadgePosition(sec);
        }
      }

      function onMouseLeave() {
        if (currentHoveredSection && currentHoveredSection.isConnected) {
          currentHoveredSection.classList.remove('fp-section-hovered');
        }
        currentHoveredSection = null;
        badge.style.display = 'none';
      }

      if (!frameDoc.__sectionHoverBound) {
        frameDoc.__sectionHoverBound = true;
        frameDoc.addEventListener('mousemove', onMouseMove, { passive: true });
        frameDoc.addEventListener('mouseleave', onMouseLeave, { passive: true });
        const frameWin = frameDoc.defaultView || window;
        frameWin.addEventListener('scroll', () => {
          if (currentHoveredSection) updateBadgePosition(currentHoveredSection);
        }, { passive: true });
        frameWin.addEventListener('resize', () => {
          if (currentHoveredSection) updateBadgePosition(currentHoveredSection);
        }, { passive: true });
      }
    }

    editor.on('load', setupHoverTracking);
    editor.on('canvas:scroll frame:scroll', () => {
      const frameDoc = editor.Canvas.getDocument();
      const hovered = frameDoc ? frameDoc.querySelector('.fp-section-hovered') : null;
      if (hovered) {
        const badge = frameDoc.getElementById('fp-section-hover-badge');
        if (badge) {
          const rect = hovered.getBoundingClientRect();
          const frameWin = frameDoc.defaultView || window;
          const scrollY = frameWin.scrollY || 0;
          const scrollX = frameWin.scrollX || 0;
          let top = rect.top + scrollY - 21;
          if (top < 0) top = rect.top + scrollY + 2;
          badge.style.top = `${top}px`;
          badge.style.left = `${rect.left + scrollX + 16}px`;
        }
      }
    });

    setupHoverTracking();
    setTimeout(setupHoverTracking, 150);
    setTimeout(setupHoverTracking, 600);
  }

  // Export
  window.openDropzoneLayoutPicker = openDropzoneLayoutPicker;
  window.initDropzoneLayoutPicker = initDropzoneLayoutPicker;
  window.initSectionTopPlusButton = initSectionTopPlusButton;
  window.initSectionHoverHighlight = initSectionHoverHighlight;

  // Export to window
  window.initContainerLayoutStyler = initContainerLayoutStyler;
  window.setupKeyboardSafeguards = setupKeyboardSafeguards;

  // Auto-init if window.editor already exists or when set
  if (typeof window !== 'undefined') {
    function autoInitEditor() {
      if (window.editor) {
        setupKeyboardSafeguards(window.editor);
        initContainerLayoutStyler(window.editor);
      }
    }
    autoInitEditor();
    setTimeout(autoInitEditor, 50);
    setTimeout(autoInitEditor, 200);
    setTimeout(autoInitEditor, 600);
    setTimeout(autoInitEditor, 1500);
  }
})();
