import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  readFootersData,
  writeFootersData,
  getFooters,
  getActiveFooter,
  getFooterById,
  saveFooter,
  setActiveFooter,
  deleteFooter,
  duplicateFooter,
  defaultSampleFooters,
  type FooterConfig,
  type FootersStore
} from '../../data/footers';

export const prerender = false;

const PAGES_FILE = path.join(process.cwd(), 'src', 'data', 'pages.json');
const POSTS_FILE = path.join(process.cwd(), 'src', 'data', 'posts.json');

async function getAvailableResources() {
  let pages: Array<{ slug: string; title: string; url: string }> = [];
  let posts: Array<{ slug: string; title: string; category?: string; url: string }> = [];

  try {
    const rawPages = await fs.readFile(PAGES_FILE, 'utf-8');
    const parsedPages = JSON.parse(rawPages);
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
    const rawPosts = await fs.readFile(POSTS_FILE, 'utf-8');
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

export const GET: APIRoute = async ({ url }) => {
  try {
    const id = url.searchParams.get('id');
    const store = readFootersData();
    const resources = await getAvailableResources();

    if (id) {
      const footer = store.footers.find(f => f.id === id);
      if (!footer) {
        return new Response(JSON.stringify({ error: `Footer with id ${id} not found.` }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ footer, resources }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        activeFooterId: store.activeFooterId,
        footers: store.footers,
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

    // Check if duplicate action
    if (body.action === 'duplicate' && body.id) {
      const duplicated = duplicateFooter(body.id);
      if (!duplicated) {
        return new Response(JSON.stringify({ error: 'Failed to duplicate footer.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true, footer: duplicated }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check restore presets
    if (body.action === 'restore_presets') {
      const store = readFootersData();
      for (const preset of defaultSampleFooters) {
        if (!store.footers.some(f => f.id === preset.id)) {
          store.footers.push(preset);
        }
      }
      writeFootersData(store);
      return new Response(JSON.stringify({ success: true, footers: store.footers, activeFooterId: store.activeFooterId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Normal save
    const footer: FooterConfig = body;
    if (!footer.id || !footer.name) {
      return new Response(JSON.stringify({ error: 'Footer must have an id and name.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const updatedStore = saveFooter(footer);
    return new Response(
      JSON.stringify({
        success: true,
        activeFooterId: updatedStore.activeFooterId,
        footers: updatedStore.footers,
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

export const PUT: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { activeFooterId } = body;

    if (!activeFooterId) {
      return new Response(JSON.stringify({ error: 'activeFooterId is required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const updatedStore = setActiveFooter(activeFooterId);
    return new Response(
      JSON.stringify({
        success: true,
        activeFooterId: updatedStore.activeFooterId,
        footers: updatedStore.footers,
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

    const result = deleteFooter(id);
    if (!result.success) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const store = readFootersData();
    return new Response(
      JSON.stringify({
        success: true,
        activeFooterId: store.activeFooterId,
        footers: store.footers,
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
