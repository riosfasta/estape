import fs from 'node:fs';
import path from 'node:path';
import { getDataDir, getDataFile, getTenantContext } from './tenantContext';

export interface ThemeManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  accentColor?: string;
  fontHeading?: string;
  fontBody?: string;
  previewImage?: string;
}

const THEMES_DIR = path.join(process.cwd(), 'src', 'themes');

/**
 * Get active theme name from tenant context or siteConfig.json, falling back to 'default'.
 */
export function getActiveThemeName(): string {
  const tenantCtx = getTenantContext();
  if (tenantCtx?.theme) {
    const ctxThemeDir = path.join(THEMES_DIR, tenantCtx.theme);
    if (fs.existsSync(ctxThemeDir)) {
      return tenantCtx.theme;
    }
  }
  try {
    const siteConfigPath = getDataFile('siteConfig.json');
    if (fs.existsSync(siteConfigPath)) {
      const raw = fs.readFileSync(siteConfigPath, 'utf-8');
      const config = JSON.parse(raw);
      if (config.activeTheme && typeof config.activeTheme === 'string') {
        const themeDir = path.join(THEMES_DIR, config.activeTheme);
        if (fs.existsSync(themeDir)) {
          return config.activeTheme;
        }
      }
    }
  } catch (err) {
    console.warn('[Core] Error reading active theme:', err);
  }
  return 'default';
}

/**
 * Resolve theme name for an incoming request:
 * explicitTheme -> ?theme= query param -> X-Tenant-Theme header -> siteConfig.activeTheme ('default' fallback).
 */
export function resolveThemeName(
  url?: URL | null,
  headers?: Headers | null,
  explicitTheme?: string | null
): string {
  const candidates = [
    explicitTheme,
    url?.searchParams.get('theme'),
    headers?.get('x-tenant-theme'),
    getTenantContext()?.theme,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'string') {
      const normalized = candidate.trim().toLowerCase();
      if (normalized && fs.existsSync(path.join(THEMES_DIR, normalized))) {
        return normalized;
      }
    }
  }
  return getActiveThemeName();
}

/**
 * Update the active theme in siteConfig.json.
 */
export function setActiveTheme(themeName: string): boolean {
  try {
    const siteConfigPath = getDataFile('siteConfig.json');
    let config: any = {};
    if (fs.existsSync(siteConfigPath)) {
      const raw = fs.readFileSync(siteConfigPath, 'utf-8');
      config = JSON.parse(raw);
    }
    const themeDir = path.join(THEMES_DIR, themeName);
    if (!fs.existsSync(themeDir)) {
      throw new Error(`Theme "${themeName}" does not exist in ${THEMES_DIR}`);
    }
    config.activeTheme = themeName;
    fs.mkdirSync(getDataDir(), { recursive: true });
    fs.writeFileSync(siteConfigPath, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('[Core] Error setting active theme:', err);
    return false;
  }
}

/**
 * Get manifest info for a specific theme or the active theme.
 */
export function getThemeManifest(themeName?: string): ThemeManifest {
  const name = themeName || getActiveThemeName();
  const manifestPath = path.join(THEMES_DIR, name, 'theme.json');
  try {
    if (fs.existsSync(manifestPath)) {
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn(`[Core] Failed to read theme.json for "${name}":`, err);
  }
  return {
    name: name.charAt(0).toUpperCase() + name.slice(1),
    version: '1.0.0',
    description: 'A FastPress theme',
  };
}

/**
 * List all available themes in src/themes.
 */
export function listThemes(): Array<{ id: string; manifest: ThemeManifest; isActive: boolean }> {
  const active = getActiveThemeName();
  try {
    if (!fs.existsSync(THEMES_DIR)) return [];
    const entries = fs.readdirSync(THEMES_DIR, { withFileTypes: true });
    return entries
      .filter((ent) => ent.isDirectory())
      .map((dir) => {
        const manifest = getThemeManifest(dir.name);
        return {
          id: dir.name,
          manifest,
          isActive: dir.name === active,
        };
      });
  } catch (err) {
    console.warn('[Core] Error listing themes:', err);
    return [];
  }
}

/**
 * Get file path for a theme's pages JSON file.
 */
export function getThemePagesFilePath(themeName?: string): string {
  const theme = themeName || getActiveThemeName();
  const themeFile = getDataFile(`pages-${theme}.json`);
  if (fs.existsSync(themeFile)) {
    return themeFile;
  }
  if (theme === 'default') {
    return getDataFile('pages.json');
  }
  return themeFile;
}

/**
 * Get all pages for a specific theme or active theme.
 */
export function getThemePages(themeName?: string): Record<string, any> {
  const theme = themeName || getActiveThemeName();
  const themeFile = getDataFile(`pages-${theme}.json`);
  const legacyFile = getDataFile('pages.json');

  try {
    if (fs.existsSync(themeFile)) {
      const raw = fs.readFileSync(themeFile, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn(`[Core] Failed to read pages-${theme}.json:`, err);
  }

  // Fallback for default theme
  if (theme === 'default') {
    try {
      if (fs.existsSync(legacyFile)) {
        const raw = fs.readFileSync(legacyFile, 'utf-8');
        return JSON.parse(raw);
      }
    } catch {}
  }

  return {};
}

/**
 * Save pages for a specific theme or active theme.
 */
export function saveThemePages(pages: Record<string, any>, themeName?: string): boolean {
  const theme = themeName || getActiveThemeName();
  const themeFile = getDataFile(`pages-${theme}.json`);
  const legacyFile = getDataFile('pages.json');

  try {
    fs.mkdirSync(getDataDir(), { recursive: true });
    fs.writeFileSync(themeFile, JSON.stringify(pages, null, 2), 'utf-8');
    if (theme === 'default') {
      try {
        fs.writeFileSync(legacyFile, JSON.stringify(pages, null, 2), 'utf-8');
      } catch {}
    }
    return true;
  } catch (err) {
    console.error(`[Core] Failed to save pages for theme ${theme}:`, err);
    return false;
  }
}

/**
 * Get global CSS for a theme.
 */
export function getThemeGlobalCss(themeName?: string): string {
  const theme = themeName || getActiveThemeName();
  const cssPath = path.join(THEMES_DIR, theme, 'styles', 'global.css');
  try {
    if (fs.existsSync(cssPath)) {
      return fs.readFileSync(cssPath, 'utf-8');
    }
  } catch {}
  return '';
}
