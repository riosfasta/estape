import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';

export const prerender = false;

const CONFIG_FILE = path.join(process.cwd(), 'src', 'data', 'siteConfig.json');

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
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function writeConfig(config: any) {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export const GET: APIRoute = async () => {
  try {
    const config = await readConfig();
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

export const POST: APIRoute = async ({ request }) => {
  try {
    const text = await request.text();
    let body: any = {};
    if (text && text.trim().length > 0) {
      body = JSON.parse(text);
    }

    const currentConfig = await readConfig();

    if (body.activeTheme !== undefined) {
      currentConfig.activeTheme = String(body.activeTheme).trim();
    }

    if (body.brandName !== undefined) {
      currentConfig.brandName = String(body.brandName).trim() || 'Better';
    }

    if (body.tagline !== undefined) {
      currentConfig.tagline = String(body.tagline).trim();
    }

    if (body.logoUrl !== undefined) {
      currentConfig.logoUrl = String(body.logoUrl).trim();
    }

    if (body.faviconUrl !== undefined) {
      currentConfig.faviconUrl = String(body.faviconUrl).trim();
    }

    if (body.drawerCtaText !== undefined) {
      currentConfig.drawerCtaText = String(body.drawerCtaText).trim();
    }

    if (body.drawerCtaUrl !== undefined) {
      currentConfig.drawerCtaUrl = String(body.drawerCtaUrl).trim();
    }

    if (body.navIndicatorStyle !== undefined) {
      const valid = ['underline', 'overline', 'none'];
      const st = String(body.navIndicatorStyle).trim().toLowerCase();
      currentConfig.navIndicatorStyle = valid.includes(st) ? st : 'underline';
      if (currentConfig.themeConfigs?.furnisite) {
        currentConfig.themeConfigs.furnisite.navIndicatorStyle = currentConfig.navIndicatorStyle;
      }
    }

    if (Array.isArray(body.navItems)) {
      currentConfig.navItems = body.navItems
        .filter((item: any) => item && typeof item.name === 'string')
        .map((item: any) => ({
          name: String(item.name).trim(),
          href: String(item.href || '#').trim(),
          id: String(item.id || item.name.toLowerCase().replace(/[^a-z0-9]/g, '-')),
        }));
    }

    if (body.footer && typeof body.footer === 'object') {
      if (!currentConfig.footer) currentConfig.footer = {};
      if (body.footer.companyName !== undefined) {
        currentConfig.footer.companyName = String(body.footer.companyName).trim();
      }
      if (body.footer.description !== undefined) {
        currentConfig.footer.description = String(body.footer.description).trim();
      }
      if (body.footer.copyrightText !== undefined) {
        currentConfig.footer.copyrightText = String(body.footer.copyrightText).trim();
      }
      if (body.footer.showBackToTop !== undefined) {
        currentConfig.footer.showBackToTop = Boolean(body.footer.showBackToTop);
      }
      if (Array.isArray(body.footer.collections)) {
        currentConfig.footer.collections = body.footer.collections.map((c: any) => ({
          name: String(c.name || '').trim(),
          href: String(c.href || '/products').trim(),
        }));
      }
      if (Array.isArray(body.footer.companyLinks)) {
        currentConfig.footer.companyLinks = body.footer.companyLinks.map((l: any) => ({
          name: String(l.name || '').trim(),
          href: String(l.href || '/about').trim(),
        }));
      }
      if (Array.isArray(body.footer.socialLinks)) {
        currentConfig.footer.socialLinks = body.footer.socialLinks.map((s: any) => ({
          name: String(s.name || '').trim(),
          href: String(s.href || '').trim(),
          enabled: Boolean(s.enabled),
        }));
      }
    }

    // Sync to themeConfigs for the target theme
    const targetTheme = String(body.theme || currentConfig.activeTheme || 'furnisite').trim();
    if (!currentConfig.themeConfigs) currentConfig.themeConfigs = {};
    if (!currentConfig.themeConfigs[targetTheme]) currentConfig.themeConfigs[targetTheme] = {};

    const tc = currentConfig.themeConfigs[targetTheme];
    if (body.brandName !== undefined) tc.brandName = currentConfig.brandName;
    if (body.tagline !== undefined) tc.tagline = currentConfig.tagline;
    if (body.logoUrl !== undefined) tc.logoUrl = currentConfig.logoUrl;
    if (body.drawerCtaText !== undefined) tc.drawerCtaText = currentConfig.drawerCtaText;
    if (body.drawerCtaUrl !== undefined) tc.drawerCtaUrl = currentConfig.drawerCtaUrl;
    if (Array.isArray(body.navItems)) tc.navItems = currentConfig.navItems;
    if (body.footer && typeof body.footer === 'object') {
      tc.footer = { ...currentConfig.footer };
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
