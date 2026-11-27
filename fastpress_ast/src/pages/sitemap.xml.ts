import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getProducts } from '../data/products';

import { getDataFile } from '../core/tenantContext';
export const prerender = false;


function formatDate(dateStr?: string | null): string {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
    return d.toISOString().split('T')[0];
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

function escapeXml(unsafe: string): string {
  return String(unsafe || '').replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

interface SitemapUrl {
  loc: string;
  lastmod: string;
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority: string;
  image?: {
    loc: string;
    title?: string;
  } | null;
}

export const GET: APIRoute = async ({ url }) => {
  try {
    const origin = url.origin || 'http://localhost:4321';
    const siteUrl = (process.env.SITE_URL || origin).replace(/\/+$/, '');

    // 1. Baca Pages
    let pagesData: Record<string, any> = {};
    try {
      const rawPages = await fs.readFile(getDataFile('pages.json'), 'utf-8');
      pagesData = JSON.parse(rawPages);
    } catch {
      pagesData = {};
    }

    // 2. Baca Posts
    let postsData: any[] = [];
    try {
      const rawPosts = await fs.readFile(getDataFile('posts.json'), 'utf-8');
      postsData = JSON.parse(rawPosts);
      if (!Array.isArray(postsData)) postsData = [];
    } catch {
      postsData = [];
    }

    const sitemapUrls: SitemapUrl[] = [];

    // --- A. Homepage ---
    const homeLastmod = formatDate(pagesData.home?.updatedAt);
    sitemapUrls.push({
      loc: `${siteUrl}/`,
      lastmod: homeLastmod,
      changefreq: 'daily',
      priority: '1.0',
    });

    // --- B. Blog Index ---
    let latestPostDate = pagesData.blog?.updatedAt;
    if (postsData.length > 0) {
      const dates = postsData.map(p => p.updatedAt || p.date).filter(Boolean);
      if (dates.length > 0) {
        latestPostDate = dates[0];
      }
    }
    sitemapUrls.push({
      loc: `${siteUrl}/blog`,
      lastmod: formatDate(latestPostDate),
      changefreq: 'daily',
      priority: '0.9',
    });

    // --- B2. Products Catalog & Single Product Pages ---
    const productsData = getProducts().filter((p) => p.status !== 'draft');
    const latestProductDate =
      pagesData.products?.updatedAt ||
      productsData.map((p) => p.updatedAt || p.createdAt).filter(Boolean)[0];
    sitemapUrls.push({
      loc: `${siteUrl}/products`,
      lastmod: formatDate(latestProductDate),
      changefreq: 'daily',
      priority: '0.9',
    });

    productsData.forEach((product) => {
      if (!product.slug) return;
      sitemapUrls.push({
        loc: `${siteUrl}/products/${encodeURIComponent(product.slug)}`,
        lastmod: formatDate(product.updatedAt || product.createdAt),
        changefreq: 'weekly',
        priority: '0.8',
        image: product.image
          ? {
              loc: product.image.startsWith('http') ? product.image : `${siteUrl}${product.image}`,
              title: product.title,
            }
          : null,
      });
    });

    // --- C. Custom Pages dari Page Builder ---
    Object.keys(pagesData).forEach((slug) => {
      if (slug === 'home' || slug === 'blog' || slug === 'products') return;
      if (
        !slug ||
        slug === 'editor' ||
        slug === 'edit-blog' ||
        slug === 'edit-product' ||
        slug === 'blog-layout-editor' ||
        slug === 'product-layout-editor' ||
        slug === 'robots-editor' ||
        slug === 'robots.txt' ||
        slug === 'api'
      )
        return;

      const page = pagesData[slug];
      sitemapUrls.push({
        loc: `${siteUrl}/${encodeURIComponent(slug)}`,
        lastmod: formatDate(page?.updatedAt),
        changefreq: 'weekly',
        priority: '0.8',
      });
    });

    // --- D. Blog Posts ---
    postsData.forEach((post) => {
      if (!post || !post.slug) return;
      const postLoc = `${siteUrl}/blog/${encodeURIComponent(post.slug)}`;
      const postLastmod = formatDate(post.updatedAt || post.date);

      let imageObj: { loc: string; title?: string } | null = null;
      if (post.image && typeof post.image === 'string') {
        const imgLoc = post.image.startsWith('http')
          ? post.image
          : `${siteUrl}${post.image.startsWith('/') ? '' : '/'}${post.image}`;
        imageObj = {
          loc: imgLoc,
          title: post.title || '',
        };
      }

      sitemapUrls.push({
        loc: postLoc,
        lastmod: postLastmod,
        changefreq: 'monthly',
        priority: '0.7',
        image: imageObj,
      });
    });

    // Bangun dokumen XML Sitemap
    const xmlEntries = sitemapUrls.map((item) => {
      let entry = `  <url>\n    <loc>${escapeXml(item.loc)}</loc>\n    <lastmod>${item.lastmod}</lastmod>\n    <changefreq>${item.changefreq}</changefreq>\n    <priority>${item.priority}</priority>`;
      if (item.image) {
        entry += `\n    <image:image>\n      <image:loc>${escapeXml(item.image.loc)}</image:loc>`;
        if (item.image.title) {
          entry += `\n      <image:title>${escapeXml(item.image.title)}</image:title>`;
        }
        entry += `\n    </image:image>`;
      }
      entry += `\n  </url>`;
      return entry;
    }).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${xmlEntries}\n</urlset>`;

    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (err: any) {
    return new Response(`Error generating sitemap: ${err.message}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
};
