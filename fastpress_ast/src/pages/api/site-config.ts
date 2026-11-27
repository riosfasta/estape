import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveThemeName } from '../../core/theme';

import { getDataFile } from '../../core/tenantContext';
export const prerender = false;


const DEFAULT_CONFIG = {
  brandName: 'Better SaaS',
  tagline: 'Modern Platform',
  logoUrl: '',
  faviconUrl: '/favicon.svg',
  navItems: [
    { name: 'Home', href: '/#', id: 'home' },
    { name: 'About Us', href: '/#about', id: 'about' },
    { name: 'Our Work', href: '/#work', id: 'work' },
    { name: 'Testimonials', href: '/#testimonials', id: 'testimonials' },
    { name: 'Our Service', href: '/#services', id: 'services' },
    { name: 'Blog', href: '/blog', id: 'blog' },
    { name: 'Builder', href: '/editor', id: 'editor' },
    { name: 'Contact', href: '/#contact', id: 'contact' },
  ],
  footer: {
    companyName: 'Better Corp Inc.',
    copyrightText: 'All Rights Reserved.',
    showBackToTop: true,
    socialLinks: [
      { name: 'Facebook', href: 'https://facebook.com', enabled: true },
      { name: 'Twitter', href: 'https://twitter.com', enabled: true },
      { name: 'LinkedIn', href: 'https://linkedin.com', enabled: true },
      { name: 'Instagram', href: 'https://instagram.com', enabled: true },
      { name: 'Dribbble', href: 'https://dribbble.com', enabled: true },
    ],
  },
};

async function readConfig() {
  try {
    const raw = await fs.readFile(getDataFile('siteConfig.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function writeConfig(config: any) {
  await fs.writeFile(getDataFile('siteConfig.json'), JSON.stringify(config, null, 2), 'utf-8');
}

export const GET: APIRoute = async ({ url, request }) => {
  try {
    const config = await readConfig();
    const requestedTheme = url.searchParams.get('theme') || request.headers.get('x-tenant-theme');
    const resolvedTheme = resolveThemeName(url, request.headers);
    if (requestedTheme) {
      config.activeTheme = resolvedTheme;
    }
    return new Response(JSON.stringify(config), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request, url }) => {
  try {
    const text = await request.text();
    let body: any = {};
    if (text && text.trim().length > 0) {
      body = JSON.parse(text);
    }

    const currentConfig = await readConfig();
    const targetTheme = resolveThemeName(url, request.headers, body.theme);
    const isGlobalThemeTarget = !body.theme || targetTheme === (currentConfig.activeTheme || 'furnisite');

    if (body.activeTheme !== undefined) {
      currentConfig.activeTheme = String(body.activeTheme).trim();
    }

    if (!currentConfig.themeConfigs) currentConfig.themeConfigs = {};
    if (!currentConfig.themeConfigs[targetTheme]) currentConfig.themeConfigs[targetTheme] = {};
    const tc = currentConfig.themeConfigs[targetTheme];

    if (body.brandName !== undefined) {
      const val = String(body.brandName).trim() || 'Better';
      tc.brandName = val;
      if (isGlobalThemeTarget) currentConfig.brandName = val;
    }

    if (body.tagline !== undefined) {
      const val = String(body.tagline).trim();
      tc.tagline = val;
      if (isGlobalThemeTarget) currentConfig.tagline = val;
    }

    if (body.logoUrl !== undefined) {
      const val = String(body.logoUrl).trim();
      tc.logoUrl = val;
      if (isGlobalThemeTarget) currentConfig.logoUrl = val;
    }

    if (body.faviconUrl !== undefined) {
      currentConfig.faviconUrl = String(body.faviconUrl).trim();
    }

    if (body.drawerCtaText !== undefined) {
      const val = String(body.drawerCtaText).trim();
      tc.drawerCtaText = val;
      if (isGlobalThemeTarget) currentConfig.drawerCtaText = val;
    }

    if (body.drawerCtaUrl !== undefined) {
      const val = String(body.drawerCtaUrl).trim();
      tc.drawerCtaUrl = val;
      if (isGlobalThemeTarget) currentConfig.drawerCtaUrl = val;
    }

    if (body.navIndicatorStyle !== undefined) {
      const valid = ['underline', 'overline', 'none'];
      const st = String(body.navIndicatorStyle).trim().toLowerCase();
      const val = valid.includes(st) ? st : 'underline';
      tc.navIndicatorStyle = val;
      if (isGlobalThemeTarget) currentConfig.navIndicatorStyle = val;
    }

    if (Array.isArray(body.navItems)) {
      const mapped = body.navItems
        .filter((item: any) => item && typeof item.name === 'string')
        .map((item: any) => ({
          name: String(item.name).trim(),
          href: String(item.href || '#').trim(),
          id: String(item.id || item.name.toLowerCase().replace(/[^a-z0-9]/g, '-')),
        }));
      tc.navItems = mapped;
      if (isGlobalThemeTarget) currentConfig.navItems = mapped;
    }

    if (body.footer && typeof body.footer === 'object') {
      if (!tc.footer) tc.footer = {};
      if (!currentConfig.footer) currentConfig.footer = {};
      const nextFooter: any = { ...tc.footer };
      if (body.footer.companyName !== undefined) {
        nextFooter.companyName = String(body.footer.companyName).trim();
      }
      if (body.footer.description !== undefined) {
        nextFooter.description = String(body.footer.description).trim();
      }
      if (body.footer.copyrightText !== undefined) {
        nextFooter.copyrightText = String(body.footer.copyrightText).trim();
      }
      if (body.footer.showBackToTop !== undefined) {
        nextFooter.showBackToTop = Boolean(body.footer.showBackToTop);
      }
      if (Array.isArray(body.footer.collections)) {
        nextFooter.collections = body.footer.collections.map((c: any) => ({
          name: String(c.name || '').trim(),
          href: String(c.href || '/products').trim(),
        }));
      }
      if (Array.isArray(body.footer.companyLinks)) {
        nextFooter.companyLinks = body.footer.companyLinks.map((l: any) => ({
          name: String(l.name || '').trim(),
          href: String(l.href || '/about').trim(),
        }));
      }
      if (Array.isArray(body.footer.socialLinks)) {
        nextFooter.socialLinks = body.footer.socialLinks.map((s: any) => ({
          name: String(s.name || '').trim(),
          href: String(s.href || '').trim(),
          enabled: Boolean(s.enabled),
        }));
      }
      tc.footer = nextFooter;
      if (isGlobalThemeTarget) currentConfig.footer = nextFooter;
    }

    await writeConfig(currentConfig);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Site configuration saved successfully',
        config: currentConfig,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
