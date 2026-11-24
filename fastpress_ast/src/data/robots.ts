import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createDefaultRobotsConfig,
  createUid,
  compileRobotsTxt,
  type RobotsConfig,
  type RobotsGroup,
  type RobotsRule,
} from '../lib/robots-utils';

const DATA_DIR = path.join(process.cwd(), 'src', 'data');
const ROBOTS_FILE = path.join(DATA_DIR, 'robots.json');

export interface DiscoveredRoute {
  title: string;
  url: string;
  kind: 'Public' | 'Blog' | 'Product' | 'System' | 'Studio';
}

export function sanitizeRobotsConfig(input: any): RobotsConfig {
  const defaults = createDefaultRobotsConfig();
  if (!input || typeof input !== 'object') {
    return defaults;
  }

  const mode = input.mode === 'raw' ? 'raw' : 'visual';
  const headerComment = typeof input.headerComment === 'string' ? input.headerComment : '';
  const autoIncludeSitemap =
    input.autoIncludeSitemap !== undefined ? Boolean(input.autoIncludeSitemap) : true;

  const customSitemaps: string[] = Array.isArray(input.customSitemaps)
    ? input.customSitemaps
        .map((s: any) => String(s || '').replace(/[\r\n]+/g, ' ').trim())
        .filter(Boolean)
    : [];

  const host = typeof input.host === 'string' ? input.host.replace(/[\r\n]+/g, ' ').trim() : '';

  const groups: RobotsGroup[] = Array.isArray(input.groups)
    ? input.groups
        .filter((g: any) => g && typeof g === 'object')
        .map((g: any): RobotsGroup => {
          const userAgents = Array.isArray(g.userAgents)
            ? g.userAgents.map((ua: any) => String(ua || '').replace(/[\r\n]+/g, ' ').trim()).filter(Boolean)
            : [];
          const rules: RobotsRule[] = Array.isArray(g.rules)
            ? g.rules
                .filter((r: any) => r && typeof r === 'object')
                .map((r: any): RobotsRule => ({
                  id: typeof r.id === 'string' && r.id ? r.id : createUid('rule'),
                  type: r.type === 'Allow' ? 'Allow' : 'Disallow',
                  path: typeof r.path === 'string' ? r.path.replace(/[\r\n]+/g, ' ').trim() : '',
                  comment:
                    typeof r.comment === 'string' && r.comment.trim()
                      ? r.comment.replace(/[\r\n]+/g, ' ').trim()
                      : undefined,
                }))
            : [];

          let crawlDelay: number | null = null;
          if (g.crawlDelay !== null && g.crawlDelay !== undefined && g.crawlDelay !== '') {
            const parsedDelay = Number(g.crawlDelay);
            if (!Number.isNaN(parsedDelay) && parsedDelay > 0) {
              crawlDelay = parsedDelay;
            }
          }

          return {
            id: typeof g.id === 'string' && g.id ? g.id : createUid('grp'),
            userAgents,
            rules,
            crawlDelay,
            comment: typeof g.comment === 'string' && g.comment.trim() ? g.comment.trim() : undefined,
          };
        })
    : defaults.groups;

  const normalized: RobotsConfig = {
    mode,
    headerComment,
    autoIncludeSitemap,
    customSitemaps,
    host,
    groups,
    rawText: typeof input.rawText === 'string' ? input.rawText : '',
    updatedAt: typeof input.updatedAt === 'string' && input.updatedAt ? input.updatedAt : new Date().toISOString(),
  };

  if (normalized.mode === 'visual' && !normalized.rawText) {
    normalized.rawText = compileRobotsTxt(normalized, '{SITE_URL}');
  }

  return normalized;
}

export async function readRobotsConfig(): Promise<RobotsConfig> {
  try {
    const raw = await fs.readFile(ROBOTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return sanitizeRobotsConfig(parsed);
  } catch {
    return createDefaultRobotsConfig();
  }
}

export async function writeRobotsConfig(input: any): Promise<RobotsConfig> {
  const sanitized = sanitizeRobotsConfig({
    ...input,
    updatedAt: new Date().toISOString(),
  });
  if (sanitized.mode === 'visual') {
    sanitized.rawText = compileRobotsTxt(sanitized, '{SITE_URL}');
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(ROBOTS_FILE, JSON.stringify(sanitized, null, 2), 'utf-8');
  return sanitized;
}

async function safeReadJson(filename: string): Promise<any> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, filename), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function discoverSiteRoutes(): Promise<DiscoveredRoute[]> {
  const routes: DiscoveredRoute[] = [
    { title: 'Homepage', url: '/', kind: 'Public' },
    { title: 'Blog Index', url: '/blog', kind: 'Blog' },
    { title: 'Products Catalog', url: '/products', kind: 'Product' },
    { title: 'XML Sitemap', url: '/sitemap.xml', kind: 'System' },
    { title: 'Page Builder', url: '/editor', kind: 'Studio' },
    { title: 'Blog Editor', url: '/edit-blog', kind: 'Studio' },
    { title: 'Blog Layouts', url: '/blog-layout-editor', kind: 'Studio' },
    { title: 'Product Studio', url: '/edit-product', kind: 'Studio' },
    { title: 'Product Layouts', url: '/product-layout-editor', kind: 'Studio' },
    { title: 'API Endpoints', url: '/api/pages', kind: 'Studio' },
  ];

  const [pagesData, postsData, productsData] = await Promise.all([
    safeReadJson('pages.json'),
    safeReadJson('posts.json'),
    safeReadJson('products.json'),
  ]);

  const seen = new Set(routes.map((r) => r.url));

  if (pagesData && typeof pagesData === 'object') {
    for (const [slug, page] of Object.entries<any>(pagesData)) {
      if (!slug || slug === 'home' || slug === 'blog') continue;
      const routeUrl = `/${slug}`;
      if (!seen.has(routeUrl)) {
        seen.add(routeUrl);
        routes.push({
          title: page?.title || slug,
          url: routeUrl,
          kind: 'Public',
        });
      }
    }
  }

  if (Array.isArray(postsData)) {
    for (const post of postsData.slice(0, 6)) {
      if (!post?.slug) continue;
      const routeUrl = `/blog/${post.slug}`;
      if (!seen.has(routeUrl)) {
        seen.add(routeUrl);
        routes.push({
          title: post.title || post.slug,
          url: routeUrl,
          kind: 'Blog',
        });
      }
    }
  }

  if (Array.isArray(productsData)) {
    for (const prod of productsData.slice(0, 6)) {
      if (!prod?.slug) continue;
      const routeUrl = `/products/${prod.slug}`;
      if (!seen.has(routeUrl)) {
        seen.add(routeUrl);
        routes.push({
          title: prod.title || prod.slug,
          url: routeUrl,
          kind: 'Product',
        });
      }
    }
  }

  return routes;
}
