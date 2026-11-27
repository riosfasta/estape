import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getDataFile } from '../../core/tenantContext';
export const prerender = false;


const EMPTY_CODE = {
  headScripts: '',
  bodyStartScripts: '',
  bodyEndScripts: '',
  bodyScripts: '',
  customCss: '',
};

export const GET: APIRoute = async ({ url }) => {
  try {
    const rawSlug = url.searchParams.get('slug') || 'home';
    const type = (url.searchParams.get('type') || 'page').toLowerCase();

    if (type === 'post') {
      let posts: any[] = [];
      try {
        const raw = await fs.readFile(getDataFile('posts.json'), 'utf-8');
        posts = JSON.parse(raw);
      } catch {}
      const post = posts.find((p: any) => p.slug === rawSlug || p.id === rawSlug);
      if (!post) {
        return new Response(JSON.stringify({ success: false, error: 'Article not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const code = post.customCode || EMPTY_CODE;
      return new Response(JSON.stringify({ success: true, data: code, target: { type: 'post', slug: rawSlug, title: post.title } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (type === 'product') {
      let products: any[] = [];
      try {
        const raw = await fs.readFile(getDataFile('products.json'), 'utf-8');
        products = JSON.parse(raw);
      } catch {}
      const product = products.find((p: any) => p.slug === rawSlug || p.id === rawSlug);
      if (!product) {
        return new Response(JSON.stringify({ success: false, error: 'Product not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const code = product.customCode || EMPTY_CODE;
      return new Response(JSON.stringify({ success: true, data: code, target: { type: 'product', slug: rawSlug, title: product.title } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Default: Page
    const pageKey = rawSlug === '/' || rawSlug === '' ? 'home' : rawSlug;
    let pages: any = {};
    try {
      const raw = await fs.readFile(getDataFile('pages.json'), 'utf-8');
      pages = JSON.parse(raw);
    } catch {}

    const page = pages[pageKey];
    if (!page) {
      return new Response(JSON.stringify({ success: false, error: `Page "${pageKey}" not found` }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const code = page.customCode || EMPTY_CODE;
    return new Response(JSON.stringify({ success: true, data: code, target: { type: 'page', slug: pageKey, title: page.title || pageKey } }), {
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

export const POST: APIRoute = async ({ request }) => {
  try {
    const text = await request.text();
    let body: any = {};
    if (text && text.trim().length > 0) {
      body = JSON.parse(text);
    }

    const rawSlug = (body.slug || 'home').trim();
    const type = (body.type || 'page').toLowerCase();
    const bodyEndVal = body.bodyEndScripts !== undefined ? String(body.bodyEndScripts) : (body.bodyScripts !== undefined ? String(body.bodyScripts) : '');

    const customCode = {
      headScripts: body.headScripts !== undefined ? String(body.headScripts) : '',
      bodyStartScripts: body.bodyStartScripts !== undefined ? String(body.bodyStartScripts) : '',
      bodyEndScripts: bodyEndVal,
      bodyScripts: bodyEndVal,
      customCss: body.customCss !== undefined ? String(body.customCss) : '',
    };

    if (type === 'post') {
      let posts: any[] = [];
      try {
        const raw = await fs.readFile(getDataFile('posts.json'), 'utf-8');
        posts = JSON.parse(raw);
      } catch {}

      const postIdx = posts.findIndex((p: any) => p.slug === rawSlug || p.id === rawSlug);
      if (postIdx === -1) {
        return new Response(JSON.stringify({ success: false, error: `Article "${rawSlug}" not found` }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      posts[postIdx].customCode = customCode;
      posts[postIdx].updatedAt = new Date().toISOString();
      await fs.writeFile(getDataFile('posts.json'), JSON.stringify(posts, null, 2), 'utf-8');

      return new Response(
        JSON.stringify({
          success: true,
          message: `Custom code for post "${posts[postIdx].title}" saved successfully!`,
          data: customCode,
          target: { type: 'post', slug: rawSlug, title: posts[postIdx].title },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (type === 'product') {
      let products: any[] = [];
      try {
        const raw = await fs.readFile(getDataFile('products.json'), 'utf-8');
        products = JSON.parse(raw);
      } catch {}

      const prodIdx = products.findIndex((p: any) => p.slug === rawSlug || p.id === rawSlug);
      if (prodIdx === -1) {
        return new Response(JSON.stringify({ success: false, error: `Product "${rawSlug}" not found` }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      products[prodIdx].customCode = customCode;
      products[prodIdx].updatedAt = new Date().toISOString();
      await fs.writeFile(getDataFile('products.json'), JSON.stringify(products, null, 2), 'utf-8');

      return new Response(
        JSON.stringify({
          success: true,
          message: `Custom code for product "${products[prodIdx].title}" saved successfully!`,
          data: customCode,
          target: { type: 'product', slug: rawSlug, title: products[prodIdx].title },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Default: Page
    const pageKey = rawSlug === '/' || rawSlug === '' ? 'home' : rawSlug;
    let pages: any = {};
    try {
      const raw = await fs.readFile(getDataFile('pages.json'), 'utf-8');
      pages = JSON.parse(raw);
    } catch {}

    if (!pages[pageKey]) {
      pages[pageKey] = {
        id: pageKey,
        title: pageKey,
        slug: pageKey,
        url: pageKey === 'home' ? '/' : `/${pageKey}`,
      };
    }

    pages[pageKey].customCode = customCode;
    pages[pageKey].updatedAt = new Date().toISOString();
    await fs.writeFile(getDataFile('pages.json'), JSON.stringify(pages, null, 2), 'utf-8');

    // Sync to savedHomepage.json if editing home
    if (pageKey === 'home') {
      try {
        let homeJson: any = {};
        try {
          const rawHome = await fs.readFile(getDataFile('savedHomepage.json'), 'utf-8');
          homeJson = JSON.parse(rawHome);
        } catch {}
        homeJson.customCode = customCode;
        homeJson.updatedAt = new Date().toISOString();
        await fs.writeFile(getDataFile('savedHomepage.json'), JSON.stringify(homeJson, null, 2), 'utf-8');
      } catch {}
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Custom code for page "${pages[pageKey].title || pageKey}" saved successfully!`,
        data: customCode,
        target: { type: 'page', slug: pageKey, title: pages[pageKey].title || pageKey },
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
