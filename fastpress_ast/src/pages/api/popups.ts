import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getDataFile } from '../../core/tenantContext';
export const prerender = false;


async function readJsonFile(filePath: string, fallback: any) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writePopups(popups: any[]) {
  await fs.writeFile(getDataFile('popups.json'), JSON.stringify(popups, null, 2), 'utf-8');
}

export const GET: APIRoute = async () => {
  try {
    const popups = await readJsonFile(getDataFile('popups.json'), []);
    const rawPages = await readJsonFile(getDataFile('pages.json'), {});
    const posts = await readJsonFile(getDataFile('posts.json'), []);
    const categories = await readJsonFile(getDataFile('categories.json'), []);

    // Format pages list for targeting selector
    const pagesList = Object.entries(rawPages).map(([slug, p]: [string, any]) => ({
      slug,
      title: p.title || (slug === 'home' ? 'Homepage (Root)' : slug),
      url: slug === 'home' ? '/' : `/${slug}`
    }));

    // Ensure home is included if missing
    if (!pagesList.some(p => p.slug === 'home')) {
      pagesList.unshift({ slug: 'home', title: 'Homepage (Root)', url: '/' });
    }

    // Format posts list for targeting selector
    const postsList = posts.map((post: any) => ({
      slug: post.slug,
      title: post.title || post.slug,
      category: post.category || '',
      categories: post.categories || [post.category].filter(Boolean)
    }));

    // Format categories list
    const categoriesList = categories.map((cat: any) => ({
      id: cat.id || cat.slug,
      slug: cat.slug || cat.id,
      name: cat.name || cat.slug
    }));

    return new Response(JSON.stringify({
      success: true,
      popups,
      pages: pagesList,
      posts: postsList,
      categories: categoriesList
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      success: false,
      error: error?.message || 'Failed to fetch popup data'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const action = body.action || 'save';
    let popups: any[] = await readJsonFile(getDataFile('popups.json'), []);

    if (action === 'save') {
      const popupData = body.popup;
      if (!popupData || !popupData.id) {
        return new Response(JSON.stringify({ success: false, error: 'Invalid popup data or missing ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const now = new Date().toISOString();
      const existingIdx = popups.findIndex(p => p.id === popupData.id);

      if (existingIdx >= 0) {
        popups[existingIdx] = {
          ...popups[existingIdx],
          ...popupData,
          updatedAt: now
        };
      } else {
        popups.push({
          ...popupData,
          createdAt: now,
          updatedAt: now
        });
      }

      await writePopups(popups);
      return new Response(JSON.stringify({
        success: true,
        message: 'Popup saved successfully',
        popup: existingIdx >= 0 ? popups[existingIdx] : popups[popups.length - 1],
        popups
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (action === 'delete') {
      const id = body.id;
      if (!id) {
        return new Response(JSON.stringify({ success: false, error: 'Missing popup ID to delete' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      popups = popups.filter(p => p.id !== id);
      await writePopups(popups);

      return new Response(JSON.stringify({
        success: true,
        message: 'Popup deleted successfully',
        popups
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (action === 'duplicate') {
      const id = body.id;
      const target = popups.find(p => p.id === id);
      if (!target) {
        return new Response(JSON.stringify({ success: false, error: 'Target popup not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const newId = 'popup-' + Math.random().toString(36).substring(2, 9);
      const now = new Date().toISOString();
      const cloned = {
        ...JSON.parse(JSON.stringify(target)),
        id: newId,
        name: `${target.name} (Copy)`,
        status: 'draft',
        createdAt: now,
        updatedAt: now
      };

      popups.push(cloned);
      await writePopups(popups);

      return new Response(JSON.stringify({
        success: true,
        message: 'Popup duplicated successfully',
        popup: cloned,
        popups
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (action === 'toggle_status') {
      const id = body.id;
      const popup = popups.find(p => p.id === id);
      if (!popup) {
        return new Response(JSON.stringify({ success: false, error: 'Popup not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      popup.status = popup.status === 'published' ? 'draft' : 'published';
      popup.updatedAt = new Date().toISOString();
      await writePopups(popups);

      return new Response(JSON.stringify({
        success: true,
        message: `Popup is now ${popup.status}`,
        popup,
        popups
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      success: false,
      error: error?.message || 'Server error processing popup request'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
