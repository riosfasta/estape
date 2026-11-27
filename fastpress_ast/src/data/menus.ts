import fs from 'node:fs';
import path from 'node:path';

import { getDataFile } from '../core/tenantContext';
export interface MenuItem {
  id: string;
  label: string;
  url: string;
  target?: '_self' | '_blank';
  icon?: string;
  badge?: string;
  badgeColor?: string;
  description?: string;
  children?: MenuItem[];
}

export type MenuLayout = 'horizontal' | 'vertical' | 'dropdown';
export type MenuAlignment = 'left' | 'center' | 'right' | 'justify';
export type MenuPointer = 'underline' | 'overline' | 'double-line' | 'framed' | 'background' | 'none';
export type MenuAnimation = 'fade' | 'slide' | 'grow' | 'drop-in' | 'none';
export type MenuSubmenuIndicator = 'angle' | 'chevron' | 'classic' | 'plus' | 'none';

export interface MobileDropdownConfig {
  breakpoint: 'tablet' | 'mobile' | 'none';
  fullWidth: boolean;
  textAlign: 'aside' | 'center';
  toggleButton: 'hamburger' | 'none';
  toggleAlign: 'left' | 'center' | 'right';
}

export interface TypographyConfig {
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  letterSpacing?: string;
  lineHeight?: string;
}

export interface ColorStateConfig {
  color?: string;
  hoverColor?: string;
  activeColor?: string;
  pointerColor?: string;
}

export interface SubMenuConfig {
  typography?: TypographyConfig;
  color?: string;
  hoverColor?: string;
  activeColor?: string;
  bgColor?: string;
  hoverBgColor?: string;
  borderColor?: string;
  borderRadius?: string;
  boxShadow?: string;
  minWidth?: string;
}

export interface MenuStyleConfig {
  mainMenu?: {
    typography?: TypographyConfig;
    colors?: ColorStateConfig;
    spacing?: {
      horizontalPadding?: string;
      verticalPadding?: string;
      spaceBetween?: string;
    };
  };
  subMenu?: SubMenuConfig;
}

export interface MenuConfig {
  id: string;
  name: string;
  slug: string;
  description?: string;
  layout: MenuLayout;
  alignment: MenuAlignment;
  pointer: MenuPointer;
  animation: MenuAnimation;
  submenuIndicator: MenuSubmenuIndicator;
  mobileDropdown: MobileDropdownConfig;
  styles?: MenuStyleConfig;
  items: MenuItem[];
}

export interface MenusStore {
  menus: MenuConfig[];
}


export function readMenusData(): MenusStore {
  try {
    if (!fs.existsSync(getDataFile('menus.json'))) {
      return { menus: [] };
    }
    const raw = fs.readFileSync(getDataFile('menus.json'), 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading menus.json:', err);
    return { menus: [] };
  }
}

export function writeMenusData(data: MenusStore): void {
  try {
    fs.writeFileSync(getDataFile('menus.json'), JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing menus.json:', err);
  }
}

export function getMenus(): MenuConfig[] {
  return readMenusData().menus;
}

export function getMenuById(id: string): MenuConfig | undefined {
  const store = readMenusData();
  return store.menus.find(m => m.id === id || m.slug === id);
}

export function saveMenu(menu: MenuConfig): MenuConfig {
  const store = readMenusData();
  const existingIndex = store.menus.findIndex(m => m.id === menu.id);
  if (existingIndex >= 0) {
    store.menus[existingIndex] = menu;
  } else {
    store.menus.push(menu);
  }
  writeMenusData(store);
  return menu;
}

export function deleteMenu(id: string): boolean {
  const store = readMenusData();
  const initialLen = store.menus.length;
  store.menus = store.menus.filter(m => m.id !== id && m.slug !== id);
  if (store.menus.length !== initialLen) {
    writeMenusData(store);
    return true;
  }
  return false;
}

// Generate self-contained standalone HTML + CSS for Nav Menu widget based on configuration
export function renderMenuHtml(menu: MenuConfig, currentPath: string = '/'): string {
  const layout = menu.layout || 'horizontal';
  const alignment = menu.alignment || 'left';
  const pointer = menu.pointer || 'underline';
  const animation = menu.animation || 'fade';
  const indicator = menu.submenuIndicator || 'angle';
  const mb = menu.mobileDropdown || {
    breakpoint: 'tablet',
    fullWidth: true,
    textAlign: 'aside',
    toggleButton: 'hamburger',
    toggleAlign: 'right',
  };

  const indicatorSvg = (() => {
    switch (indicator) {
      case 'angle':
        return '<svg class="nm-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>';
      case 'chevron':
        return '<svg class="nm-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>';
      case 'classic':
        return '<span class="nm-arrow-classic">▼</span>';
      case 'plus':
        return '<span class="nm-arrow-plus">+</span>';
      default:
        return '';
    }
  })();

  const renderItems = (items: MenuItem[], depth = 0): string => {
    return items.map(item => {
      const hasChildren = Array.isArray(item.children) && item.children.length > 0;
      const isExternal = item.target === '_blank';
      const cleanHref = (item.url || '#').replace(/\/$/, '') || '/';
      const normPath = currentPath.replace(/\/$/, '') || '/';
      const isActive = (cleanHref === normPath) || (normPath !== '/' && cleanHref !== '/' && normPath.startsWith(cleanHref));

      const linkContent = `
        <span class="nm-link-title">${escapeHtml(item.label)}</span>
        ${item.badge ? `<span class="nm-badge" style="${item.badgeColor ? `background:${item.badgeColor}` : ''}">${escapeHtml(item.badge)}</span>` : ''}
        ${hasChildren && indicator !== 'none' ? indicatorSvg : ''}
      `;

      return `
        <li class="nm-item ${hasChildren ? 'nm-has-children' : ''} ${isActive ? 'is-active' : ''}">
          <a href="${escapeHtml(item.url || '#')}" 
             target="${isExternal ? '_blank' : '_self'}" 
             rel="${isExternal ? 'noopener noreferrer' : ''}"
             class="nm-link ${isActive ? 'is-active' : ''}">
            ${linkContent}
          </a>
          ${hasChildren ? `
            <ul class="nm-submenu nm-sub-depth-${depth + 1}">
              ${renderItems(item.children || [], depth + 1)}
            </ul>
          ` : ''}
        </li>
      `;
    }).join('');
  };

  const menuItemsHtml = renderItems(menu.items || []);

  const st = menu.styles || {};
  const mainTypo = st.mainMenu?.typography || {};
  const mainColors = st.mainMenu?.colors || {};
  const mainSpacing = st.mainMenu?.spacing || {};
  const sub = st.subMenu || {};
  const subTypo = sub.typography || {};

  const cssVarList = [
    mainTypo.fontFamily ? `--nm-font-family: ${mainTypo.fontFamily};` : '',
    mainTypo.fontSize ? `--nm-font-size: ${mainTypo.fontSize};` : '',
    mainTypo.fontWeight ? `--nm-font-weight: ${mainTypo.fontWeight};` : '',
    mainTypo.textTransform && mainTypo.textTransform !== 'none' ? `--nm-text-transform: ${mainTypo.textTransform};` : '',
    mainTypo.letterSpacing ? `--nm-letter-spacing: ${mainTypo.letterSpacing};` : '',
    mainColors.color ? `--nm-color: ${mainColors.color};` : '',
    mainColors.hoverColor ? `--nm-color-hover: ${mainColors.hoverColor};` : '',
    mainColors.activeColor ? `--nm-color-active: ${mainColors.activeColor};` : '',
    mainColors.pointerColor ? `--nm-pointer-color: ${mainColors.pointerColor};` : '',
    mainSpacing.horizontalPadding ? `--nm-padding-x: ${mainSpacing.horizontalPadding};` : '',
    mainSpacing.verticalPadding ? `--nm-padding-y: ${mainSpacing.verticalPadding};` : '',
    mainSpacing.spaceBetween ? `--nm-gap: ${mainSpacing.spaceBetween};` : '',
    // Submenu styles
    subTypo.fontFamily ? `--nm-sub-font-family: ${subTypo.fontFamily};` : '',
    subTypo.fontSize ? `--nm-sub-font-size: ${subTypo.fontSize};` : '',
    subTypo.fontWeight ? `--nm-sub-font-weight: ${subTypo.fontWeight};` : '',
    subTypo.textTransform && subTypo.textTransform !== 'none' ? `--nm-sub-text-transform: ${subTypo.textTransform};` : '',
    subTypo.letterSpacing ? `--nm-sub-letter-spacing: ${subTypo.letterSpacing};` : '',
    sub.color ? `--nm-sub-color: ${sub.color};` : '',
    sub.hoverColor ? `--nm-sub-color-hover: ${sub.hoverColor};` : '',
    sub.activeColor ? `--nm-sub-color-active: ${sub.activeColor};` : '',
    sub.bgColor ? `--nm-sub-bg: ${sub.bgColor};` : '',
    sub.hoverBgColor ? `--nm-sub-bg-hover: ${sub.hoverBgColor};` : '',
    sub.borderColor ? `--nm-sub-border-color: ${sub.borderColor};` : '',
    sub.borderRadius ? `--nm-sub-border-radius: ${sub.borderRadius};` : '',
    sub.boxShadow ? `--nm-sub-shadow: ${sub.boxShadow};` : '',
    sub.minWidth ? `--nm-sub-min-width: ${sub.minWidth};` : '',
  ].filter(Boolean);

  const styleAttr = cssVarList.length > 0 ? ` style="${escapeHtml(cssVarList.join(' '))}"` : '';

  return `
<div class="fp-nav-menu-widget" 
     data-menu-id="${escapeHtml(menu.id)}"
     data-layout="${layout}" 
     data-align="${alignment}" 
     data-pointer="${pointer}" 
     data-animation="${animation}" 
     data-indicator="${indicator}"
     data-breakpoint="${mb.breakpoint || 'tablet'}"
     data-fullwidth="${mb.fullWidth ? 'true' : 'false'}"
     data-text-align="${mb.textAlign || 'aside'}"
     data-toggle-align="${mb.toggleAlign || 'right'}"${styleAttr}>
  
  ${mb.toggleButton === 'hamburger' ? `
    <button type="button" class="nm-mobile-toggle" aria-label="Toggle Menu" aria-expanded="false">
      <span class="nm-hamburger-icon">
        <span></span>
        <span></span>
        <span></span>
      </span>
      <span class="nm-toggle-label">Menu</span>
    </button>
  ` : ''}

  <nav class="nm-nav-wrapper">
    <ul class="nm-menu-list">
      ${menuItemsHtml}
    </ul>
  </nav>
</div>
  `.trim();
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
