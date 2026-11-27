import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  readHeadersData,
  writeHeadersData,
  getHeaders,
  getActiveHeader,
  getActiveHeaderForTheme,
  saveHeader,
  setActiveHeader,
  deleteHeader,
  duplicateHeader,
  type HeaderConfig
} from '../../data/headers';
import { resolveThemeName, getThemePages } from '../../core/theme';

import { getDataFile } from '../../core/tenantContext';
export const prerender = false;


async function getAvailableResources(themeName?: string) {
  let pages: Array<{ slug: string; title: string; url: string }> = [];
  let posts: Array<{ slug: string; title: string; category?: string; url: string }> = [];

  try {
    const parsedPages = getThemePages(themeName);
    pages = Object.entries(parsedPages).map(([slug, p]: [string, any]) => ({
      slug,
      title: p.title || (slug === 'home' ? 'Home' : slug),
      url: slug === 'home' ? '/' : `/${slug}`,
    }));
    if (!pages.some(p => p.slug === 'home')) {
      pages.unshift({ slug: 'home', title: 'Home', url: '/' });
    }
  } catch (err) {
    pages = [
      { slug: 'home', title: 'Home', url: '/' },
      { slug: 'tentang-kami', title: 'Tentang Kami', url: '/tentang-kami' },
      { slug: 'blog', title: 'Blog', url: '/blog' },
    ];
  }

  try {
    const rawPosts = await fs.readFile(getDataFile('posts.json'), 'utf-8');
    const parsedPosts = JSON.parse(rawPosts);
    if (Array.isArray(parsedPosts)) {
      posts = parsedPosts.map((post: any) => ({
        slug: post.slug,
        title: post.title || post.slug,
        category: post.category || (Array.isArray(post.categories) ? post.categories.join(', ') : ''),
        url: `/blog/${post.slug}`,
      }));
    }
  } catch (err) {
    posts = [];
  }

  return { pages, posts };
}

export const GET: APIRoute = async ({ url, request }) => {
  try {
    const theme = resolveThemeName(url, request.headers);
    const id = url.searchParams.get('id');
    const store = readHeadersData();
    const resources = await getAvailableResources(theme);
    const activeForTheme = getActiveHeaderForTheme(theme);

    if (id) {
      const header = store.headers.find(h => h.id === id);
      if (!header) {
        return new Response(JSON.stringify({ error: `Header with id ${id} not found.` }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ header, resources }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        activeHeaderId: activeForTheme.id,
        activeHeaderIds: store.activeHeaderIds || {},
        headers: store.headers,
        resources,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();

    // Check if this is a duplication request
    if (body.action === 'duplicate' && body.id) {
      const duplicated = duplicateHeader(body.id);
      if (!duplicated) {
        return new Response(JSON.stringify({ error: 'Failed to duplicate header.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true, header: duplicated }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if this is a preset loader / restore
    if (body.action === 'restore_presets') {
      const { defaultSampleHeaders } = await import('../../data/headers');
      const store = readHeadersData();
      // append missing presets
      for (const preset of defaultSampleHeaders) {
        if (!store.headers.some(h => h.id === preset.id)) {
          store.headers.push(preset);
        }
      }
      writeHeadersData(store);
      return new Response(JSON.stringify({ success: true, headers: store.headers }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Otherwise, normal save
    const header: HeaderConfig = body;
    if (!header.id || !header.name) {
      return new Response(JSON.stringify({ error: 'Header must have an id and name.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const updatedStore = saveHeader(header);
    return new Response(JSON.stringify({ success: true, activeHeaderId: updatedStore.activeHeaderId, headers: updatedStore.headers }), {
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

export const PUT: APIRoute = async ({ request, url }) => {
  try {
    const body = await request.json();
    const { activeHeaderId } = body;

    if (!activeHeaderId) {
      return new Response(JSON.stringify({ error: 'activeHeaderId is required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const theme = resolveThemeName(url, request.headers, body.theme);
    const updatedStore = setActiveHeader(activeHeaderId, theme);
    return new Response(
      JSON.stringify({
        success: true,
        activeHeaderId: getActiveHeaderForTheme(theme).id,
        activeHeaderIds: updatedStore.activeHeaderIds || {},
        headers: updatedStore.headers,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ url }) => {
  try {
    const id = url.searchParams.get('id');
    if (!id) {
      return new Response(JSON.stringify({ error: 'id query param is required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = deleteHeader(id);
    if (!result.success) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const store = readHeadersData();
    return new Response(JSON.stringify({ success: true, activeHeaderId: store.activeHeaderId, headers: store.headers }), {
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
