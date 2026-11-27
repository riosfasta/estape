import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataFile } from '../../core/tenantContext';
import {
  getMenus,
  getMenuById,
  saveMenu,
  deleteMenu,
  renderMenuHtml,
  type MenuConfig,
  type MenuItem
} from '../../data/menus';

export const prerender = false;


async function getAvailableResources() {
  let pages: Array<{ title: string; url: string }> = [];
  let posts: Array<{ title: string; url: string }> = [];
  let categories: Array<{ title: string; url: string }> = [];

  try {
    const rawPages = await fs.readFile(getDataFile('pages.json'), 'utf-8');
    const parsedPages = JSON.parse(rawPages);
    pages = Object.entries(parsedPages).map(([slug, p]: [string, any]) => ({
      title: p.title || (slug === 'home' ? 'Home' : slug),
      url: slug === 'home' ? '/' : `/${slug}`,
    }));
    if (!pages.some(p => p.url === '/')) {
      pages.unshift({ title: 'Home', url: '/' });
    }
  } catch (err) {
    pages = [
      { title: 'Home', url: '/' },
      { title: 'About', url: '/about' },
      { title: 'Shop', url: '/products' },
      { title: 'Blog', url: '/blog' },
      { title: 'Contact', url: '/contact' }
    ];
  }

  try {
    const rawPosts = await fs.readFile(getDataFile('posts.json'), 'utf-8');
    const parsedPosts = JSON.parse(rawPosts);
    if (Array.isArray(parsedPosts)) {
      posts = parsedPosts.slice(0, 15).map((post: any) => ({
        title: post.title || post.slug,
        url: `/blog/${post.slug}`,
      }));
    }
  } catch (err) {
    posts = [];
  }

  try {
    const rawCats = await fs.readFile(getDataFile('categories.json'), 'utf-8');
    const parsedCats = JSON.parse(rawCats);
    if (Array.isArray(parsedCats)) {
      categories = parsedCats.map((cat: any) => ({
        title: cat.name || cat.title || cat.slug,
        url: `/category/${cat.slug || cat.id}`,
      }));
    }
  } catch (err) {
    categories = [
      { title: 'Living Room', url: '/category/living-room' },
      { title: 'Dining & Kitchen', url: '/category/dining-kitchen' },
      { title: 'Bedroom Sanctuary', url: '/category/bedroom' },
    ];
  }

  return { pages, posts, categories };
}

export const GET: APIRoute = async ({ url }) => {
  try {
    const id = url.searchParams.get('id');
    const resources = await getAvailableResources();
    const allMenus = getMenus();

    if (id) {
      const menu = getMenuById(id);
      if (!menu) {
        return new Response(JSON.stringify({ error: `Menu with id "${id}" not found.` }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          menu,
          renderHtml: renderMenuHtml(menu),
          resources,
          allMenusSummary: allMenus.map(m => ({ id: m.id, name: m.name, slug: m.slug }))
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        menus: allMenus,
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

    // 1. Delete action
    if (body.action === 'delete') {
      const id = body.id;
      if (!id) {
        return new Response(JSON.stringify({ error: 'Menu ID is required for deletion.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const deleted = deleteMenu(id);
      return new Response(JSON.stringify({ success: deleted }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Render action (e.g. for preview or GrapesJS live sync)
    if (body.action === 'render') {
      let menuToRender: MenuConfig | undefined;
      if (body.id) {
        menuToRender = getMenuById(body.id);
        if (menuToRender && body.overrides) {
          menuToRender = { ...menuToRender, ...body.overrides };
        }
      } else if (body.menu) {
        menuToRender = body.menu;
      }

      if (!menuToRender) {
        return new Response(JSON.stringify({ error: 'No menu provided to render.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const html = renderMenuHtml(menuToRender, body.currentPath || '/');
      return new Response(JSON.stringify({ success: true, html }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Save / Upsert action
    const menuData: MenuConfig = body.menu || body;
    if (!menuData || !menuData.name) {
      return new Response(JSON.stringify({ error: 'Menu name is required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!menuData.id) {
      menuData.id = 'menu-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6);
    }
    if (!menuData.slug) {
      menuData.slug = menuData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    // Default fallbacks matching the user's styling screenshot
    if (!menuData.layout) menuData.layout = 'horizontal';
    if (!menuData.alignment) menuData.alignment = 'left';
    if (!menuData.pointer) menuData.pointer = 'underline';
    if (!menuData.animation) menuData.animation = 'fade';
    if (!menuData.submenuIndicator) menuData.submenuIndicator = 'angle';
    if (!menuData.mobileDropdown) {
      menuData.mobileDropdown = {
        breakpoint: 'tablet',
        fullWidth: true,
        textAlign: 'aside',
        toggleButton: 'hamburger',
        toggleAlign: 'right',
      };
    }
    if (!Array.isArray(menuData.items)) {
      menuData.items = [];
    }

    const saved = saveMenu(menuData);
    const html = renderMenuHtml(saved);

    return new Response(JSON.stringify({ success: true, menu: saved, renderHtml: html }), {
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
