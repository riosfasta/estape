import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getActiveThemeName, getThemePages, saveThemePages } from '../../core/theme';

export const prerender = false;

const HOMEPAGE_FILE = path.join(process.cwd(), 'src', 'data', 'savedHomepage.json');

async function readPages(themeName?: string) {
  const theme = themeName || getActiveThemeName();
  const pages = getThemePages(theme);
  if (!pages.home) {
    pages.home = {
      id: 'home',
      title: 'Home',
      slug: 'home',
      url: '/',
      isCustom: false,
      html: '',
      css: '',
      projectData: null,
      updatedAt: null,
    };
  }
  return pages;
}

async function writePages(pages: any, themeName?: string) {
  const theme = themeName || getActiveThemeName();
  saveThemePages(pages, theme);
}

// GET: Ambil daftar halaman ATAU detail satu halaman
export const GET: APIRoute = async ({ url }) => {
  try {
    const theme = url.searchParams.get('theme') || getActiveThemeName();
    const slug = url.searchParams.get('slug');
    const pages = await readPages(theme);

    if (slug) {
      const pageKey = slug === '/' || slug === '' ? 'home' : slug;
      const page = pages[pageKey];
      if (!page) {
        return new Response(JSON.stringify({ error: 'Page not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(page), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Kembalikan daftar ringkas semua halaman untuk dropdown pemilih
    const list = Object.values(pages).map((p: any) => ({
      id: p.id,
      title: p.title || p.id,
      slug: p.slug,
      url: p.slug === 'home' || p.slug === '' ? '/' : `/${p.slug}`,
      isCustom: Boolean(p.isCustom),
      description: p.description || '',
      keywords: p.keywords || '',
      showHeader: p.showHeader !== false,
      showFooter: p.showFooter !== false,
      schema: p.schema || '',
      updatedAt: p.updatedAt,
    }));

    return new Response(JSON.stringify(list), {
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

// POST: Buat halaman baru ATAU simpan perubahan halaman aktif
export const POST: APIRoute = async ({ request }) => {
  try {
    const text = await request.text();
    let body: any = {};
    if (text && text.trim().length > 0) {
      body = JSON.parse(text);
    }

    const theme = body.theme || getActiveThemeName();
    const pages = await readPages(theme);
    const action = body.action || 'save';

    // 1. Aksi: Buat Halaman Baru
    if (action === 'create') {
      let rawSlug = (body.slug || body.title || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      if (!rawSlug || rawSlug === 'editor' || rawSlug === 'edit-blog' || rawSlug === 'edit-product' || rawSlug === 'blog-layout-editor' || rawSlug === 'product-layout-editor' || rawSlug === 'robots-editor' || rawSlug === 'robots.txt' || rawSlug === 'api' || rawSlug === 'blog' || rawSlug === 'products') {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid page slug or reserved system route.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (pages[rawSlug]) {
        return new Response(
          JSON.stringify({ success: false, error: `A page with slug "/${rawSlug}" already exists.` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const newPage = {
        id: rawSlug,
        title: body.title || rawSlug,
        slug: rawSlug,
        url: `/${rawSlug}`,
        isCustom: true,
        description: body.description ? String(body.description).trim() : '',
        keywords: body.keywords ? String(body.keywords).trim() : '',
        schema: body.schema ? String(body.schema).trim() : '',
        showHeader: body.showHeader !== undefined ? Boolean(body.showHeader) : true,
        showFooter: body.showFooter !== undefined ? Boolean(body.showFooter) : true,
        html: body.html || '',
        css: body.css || '',
        projectData: body.projectData || null,
        updatedAt: new Date().toISOString(),
      };

      pages[rawSlug] = newPage;
      await writePages(pages, theme);

      return new Response(
        JSON.stringify({ success: true, message: `Page "/${rawSlug}" created successfully!`, page: newPage }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. Aksi: Simpan Perubahan Halaman (Save)
    const targetSlug = (body.slug || 'home').trim();
    let pageKey = targetSlug === '/' || targetSlug === '' ? 'home' : targetSlug;

    if (!pages[pageKey]) {
      pages[pageKey] = {
        id: pageKey,
        title: body.title || pageKey,
        slug: pageKey,
        url: pageKey === 'home' ? '/' : `/${pageKey}`,
      };
    }

    let oldSlugKey: string | null = null;
    // Dukungan ganti custom URL / slug untuk halaman kustom (selain home dan blog)
    if (body.newSlug && body.newSlug !== pageKey) {
      if (pageKey === 'home' || pageKey === 'blog') {
        return new Response(
          JSON.stringify({ success: false, error: 'System pages (home and blog) cannot change their URL slug.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const cleanNewSlug = body.newSlug
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      if (!cleanNewSlug || cleanNewSlug === 'editor' || cleanNewSlug === 'edit-blog' || cleanNewSlug === 'edit-product' || cleanNewSlug === 'blog-layout-editor' || cleanNewSlug === 'product-layout-editor' || cleanNewSlug === 'robots-editor' || cleanNewSlug === 'robots.txt' || cleanNewSlug === 'api' || cleanNewSlug === 'blog' || cleanNewSlug === 'products') {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid URL slug or reserved system route.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (pages[cleanNewSlug] && cleanNewSlug !== pageKey) {
        return new Response(
          JSON.stringify({ success: false, error: `A page with URL slug "/${cleanNewSlug}" already exists.` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      oldSlugKey = pageKey;
      pages[cleanNewSlug] = {
        ...pages[pageKey],
        id: cleanNewSlug,
        slug: cleanNewSlug,
        url: `/${cleanNewSlug}`,
      };
      delete pages[pageKey];
      pageKey = cleanNewSlug;
    }

    // Normalisasi: Pastikan iframe video di HTML selalu memiliki atribut src jika html dikirim
    if (body.html !== undefined) {
      let finalHtml = body.html || '';
      if (finalHtml && finalHtml.includes('<iframe') && !finalHtml.includes('src=')) {
        const findVideoInComponents = (comps: any[]): any => {
          if (!comps || !Array.isArray(comps)) return null;
          for (const c of comps) {
            if (c.type === 'video' && (c.videoId || c.src)) return c;
            if (c.components) {
              const found = findVideoInComponents(c.components);
              if (found) return found;
            }
          }
          return null;
        };

        try {
          const pagesList = body.projectData?.pages || [];
          for (const p of pagesList) {
            const frames = p.frames || [];
            for (const f of frames) {
              const vComp = findVideoInComponents(f.component?.components);
              if (vComp) {
                const provider = vComp.provider || 'yt';
                let embedSrc = '';
                if (provider === 'yt' && vComp.videoId) {
                  embedSrc = `https://www.youtube.com/embed/${vComp.videoId}?`;
                } else if (provider === 'vi' && vComp.videoId) {
                  embedSrc = `https://player.vimeo.com/video/${vComp.videoId}?`;
                } else if (provider === 'so' && vComp.src) {
                  embedSrc = vComp.src;
                }
                if (embedSrc) {
                  finalHtml = finalHtml.replace(/<iframe([^>]*?)(\/?>)/, `<iframe$1 src="${embedSrc}"$2`);
                }
                break;
              }
            }
          }
        } catch {}
      }
      pages[pageKey].html = finalHtml;
    }

    if (body.css !== undefined) {
      let finalCss = body.css || '';
      if (finalCss) {
        finalCss = finalCss
          .replace(/@media\s*\(\s*max-width:\s*100%\s*\)\s*\{([^}]*)\}/gi, '$1')
          .replace(/border-(top|right|bottom|left)-(width|style|color):\s*(1px|dashed|rgba\(156,\s*163,\s*175,\s*0\.4\));?/gi, '')
          .replace(/border:\s*1px\s+dashed\s+rgba\(156,\s*163,\s*175,\s*0\.4\);?/gi, '')
          .replace(/border-image-[^:]+:[^;]+;?/gi, '');
      }
      pages[pageKey].css = finalCss;
    }

    pages[pageKey].title = body.title || pages[pageKey].title || pageKey;
    if (body.isCustom !== undefined) pages[pageKey].isCustom = Boolean(body.isCustom);
    if (body.description !== undefined) pages[pageKey].description = String(body.description).trim();
    if (body.keywords !== undefined) pages[pageKey].keywords = String(body.keywords).trim();
    if (body.showHeader !== undefined) pages[pageKey].showHeader = Boolean(body.showHeader);
    if (body.showFooter !== undefined) pages[pageKey].showFooter = Boolean(body.showFooter);
    if (body.schema !== undefined) pages[pageKey].schema = String(body.schema).trim();
    if (body.customCode !== undefined) {
      pages[pageKey].customCode = {
        headScripts: typeof body.customCode?.headScripts === 'string' ? body.customCode.headScripts : '',
        bodyStartScripts: typeof body.customCode?.bodyStartScripts === 'string' ? body.customCode.bodyStartScripts : '',
        customCss: typeof body.customCode?.customCss === 'string' ? body.customCode.customCss : '',
        bodyEndScripts: typeof body.customCode?.bodyEndScripts === 'string' ? body.customCode.bodyEndScripts : (typeof body.customCode?.bodyScripts === 'string' ? body.customCode.bodyScripts : ''),
        bodyScripts: typeof body.customCode?.bodyEndScripts === 'string' ? body.customCode.bodyEndScripts : (typeof body.customCode?.bodyScripts === 'string' ? body.customCode.bodyScripts : ''),
      };
    }
    if (body.projectData !== undefined) pages[pageKey].projectData = body.projectData;
    pages[pageKey].updatedAt = new Date().toISOString();

    await writePages(pages, theme);

    // Sync juga ke savedHomepage.json jika yang diedit adalah homepage
    if (pageKey === 'home') {
      try {
        let existingHome: any = {};
        try {
          const rawHome = await fs.readFile(HOMEPAGE_FILE, 'utf-8');
          existingHome = JSON.parse(rawHome);
        } catch {}

        await fs.writeFile(
          HOMEPAGE_FILE,
          JSON.stringify(
            {
              ...existingHome,
              isCustom: pages[pageKey].isCustom,
              title: pages[pageKey].title,
              description: pages[pageKey].description,
              keywords: pages[pageKey].keywords,
              showHeader: pages[pageKey].showHeader,
              showFooter: pages[pageKey].showFooter,
              schema: pages[pageKey].schema || '',
              customCode: pages[pageKey].customCode || null,
              html: pages[pageKey].html,
              css: pages[pageKey].css,
              projectData: pages[pageKey].projectData,
              updatedAt: pages[pageKey].updatedAt,
            },
            null,
            2
          ),
          'utf-8'
        );
      } catch {}
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Page "${pages[pageKey].title}" saved successfully!`,
        page: pages[pageKey],
        oldSlug: oldSlugKey,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// DELETE: Hapus halaman kustom
export const DELETE: APIRoute = async ({ url }) => {
  try {
    const theme = url.searchParams.get('theme') || getActiveThemeName();
    const slug = url.searchParams.get('slug');
    if (!slug || slug === 'home' || slug === '/' || slug === 'blog') {
      return new Response(JSON.stringify({ success: false, error: 'System pages (home and blog) cannot be deleted.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const pages = await readPages(theme);
    if (!pages[slug]) {
      return new Response(JSON.stringify({ success: false, error: 'Page not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    delete pages[slug];
    await writePages(pages, theme);

    return new Response(JSON.stringify({ success: true, message: `Page "/${slug}" has been deleted.` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
