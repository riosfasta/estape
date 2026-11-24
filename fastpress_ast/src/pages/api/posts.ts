import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { defaultPosts, type Post } from '../../data/posts';

export const prerender = false;

const POSTS_FILE = path.join(process.cwd(), 'src', 'data', 'posts.json');

async function readPosts(): Promise<Post[]> {
  try {
    const raw = await fs.readFile(POSTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return defaultPosts;
  } catch {
    return defaultPosts;
  }
}

async function writePosts(postsList: Post[]): Promise<void> {
  await fs.writeFile(POSTS_FILE, JSON.stringify(postsList, null, 2), 'utf-8');
}

// GET: Ambil semua artikel atau satu artikel berdasarkan slug/id
export const GET: APIRoute = async ({ url }) => {
  try {
    const slug = url.searchParams.get('slug') || url.searchParams.get('id');
    const postsList = await readPosts();

    if (slug) {
      const found = postsList.find((p) => p.slug === slug || p.id === slug);
      if (!found) {
        return new Response(JSON.stringify({ error: 'Article not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(found), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Kembalikan daftar semua artikel (ringkasan + metadata)
    return new Response(JSON.stringify(postsList), {
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

// POST: Buat artikel baru ATAU simpan perubahan artikel aktif
export const POST: APIRoute = async ({ request }) => {
  try {
    const text = await request.text();
    let body: any = {};
    if (text && text.trim().length > 0) {
      body = JSON.parse(text);
    }

    const postsList = await readPosts();
    const action = body.action || 'save';

    // 1. Aksi: Buat Artikel Baru
    if (action === 'create') {
      let rawSlug = (body.slug || body.title || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      if (!rawSlug) {
        rawSlug = `post-${Date.now()}`;
      }

      if (postsList.some((p) => p.slug === rawSlug)) {
        return new Response(
          JSON.stringify({ success: false, error: `An article with slug "${rawSlug}" already exists.` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const today = new Date();
      const isoDate = today.toISOString().split('T')[0];
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      const formattedDate = `${monthNames[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}`;

      let resolvedCategories: string[] = [];
      if (Array.isArray(body.categories)) {
        resolvedCategories = body.categories.map((c: any) => String(c).trim()).filter(Boolean);
      } else if (typeof body.categories === 'string' && body.categories.trim()) {
        resolvedCategories = body.categories.split(',').map((c: string) => c.trim()).filter(Boolean);
      } else if (body.category) {
        resolvedCategories = [String(body.category).trim()];
      }
      if (resolvedCategories.length === 0) {
        resolvedCategories = ['Uncategorized'];
      }

      const newPost: Post = {
        id: String(Date.now()),
        slug: rawSlug,
        title: body.title || 'New Article Title',
        category: resolvedCategories.join(', '),
        categories: resolvedCategories,
        categorySlugs: Array.isArray(body.categorySlugs) ? body.categorySlugs : resolvedCategories.map(c => c.toLowerCase().replace(/[^a-z0-9-]/g, '-')),
        date: body.date || isoDate,
        formattedDate: body.formattedDate || formattedDate,
        image: body.image || 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=1200&q=80',
        excerpt: body.excerpt || 'Write a concise summary of your article here to engage readers.',
        readTime: body.readTime || '5 min read',
        author: {
          name: body.authorName || 'Better Team',
          role: body.authorRole || 'Content Writer',
          avatar: body.authorAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=240&h=240&q=80',
        },
        content: body.content || `
          <p class="lead">
            This is the opening paragraph of your new article. You can start editing this text directly in the visual editor.
          </p>
          <h2>1. Main Section Subheading</h2>
          <p>
            Write your detailed discussion or in-depth content in this section. Use blocks like headings, images, videos, and accordions to enrich your article.
          </p>
        `,
        css: body.css || '',
        projectData: body.projectData || null,
        updatedAt: new Date().toISOString(),
        keywords: body.keywords || (Array.isArray(body.tags) ? body.tags.join(', ') : (body.tags || '')),
        tags: body.tags || '',
        schema: body.schema ? String(body.schema).trim() : '',
        showRelated: body.showRelated !== undefined ? Boolean(body.showRelated) : true,
        relatedTagline: body.relatedTagline ? String(body.relatedTagline).trim() : 'REKOMENDASI',
        relatedTitle: body.relatedTitle ? String(body.relatedTitle).trim() : 'Artikel Terkait',
        relatedCategory: body.relatedCategory ? String(body.relatedCategory).trim() : 'auto',
        relatedOrderBy: body.relatedOrderBy ? String(body.relatedOrderBy).trim() : 'date-desc',
        relatedLimit: body.relatedLimit ? Number(body.relatedLimit) : 2,
        relatedHtml: body.relatedHtml ? String(body.relatedHtml) : '',
        layoutMode: body.layoutMode || 'standard',
        layoutId: body.layoutId || undefined,
      };

      postsList.unshift(newPost);
      await writePosts(postsList);

      return new Response(
        JSON.stringify({ success: true, message: `Article "${newPost.title}" created successfully!`, post: newPost }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. Aksi: Simpan Perubahan Artikel (Save)
    const targetSlug = (body.slug || body.id || '').trim();
    if (!targetSlug) {
      return new Response(
        JSON.stringify({ success: false, error: 'Target slug or article ID was not provided.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const postIndex = postsList.findIndex((p) => p.slug === targetSlug || p.id === targetSlug);
    if (postIndex === -1) {
      return new Response(
        JSON.stringify({ success: false, error: `Article "${targetSlug}" was not found.` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const currentPost = postsList[postIndex];

    // Jika slug diubah, pastikan tidak bentrok dengan artikel lain
    if (body.newSlug && body.newSlug !== currentPost.slug) {
      const cleanNewSlug = body.newSlug
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      if (postsList.some((p, idx) => idx !== postIndex && p.slug === cleanNewSlug)) {
        return new Response(
          JSON.stringify({ success: false, error: `Slug "${cleanNewSlug}" is already in use by another article.` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      currentPost.slug = cleanNewSlug;
    }

    // Normalisasi CSS jika ada
    let finalCss = body.css !== undefined ? body.css : currentPost.css || '';
    if (finalCss) {
      finalCss = finalCss
        .replace(/@media\s*\(\s*max-width:\s*100%\s*\)\s*\{([^}]*)\}/gi, '$1')
        .replace(/border-(top|right|bottom|left)-(width|style|color):\s*(1px|dashed|rgba\(156,\s*163,\s*175,\s*0\.4\));?/gi, '')
        .replace(/border:\s*1px\s+dashed\s+rgba\(156,\s*163,\s*175,\s*0\.4\);?/gi, '')
        .replace(/border-image-[^:]+:[^;]+;?/gi, '');
    }

    // Update field-field
    if (body.title !== undefined) currentPost.title = body.title;
    
    if (body.categories !== undefined) {
      let resolvedCategories: string[] = [];
      if (Array.isArray(body.categories)) {
        resolvedCategories = body.categories.map((c: any) => String(c).trim()).filter(Boolean);
      } else if (typeof body.categories === 'string' && body.categories.trim()) {
        resolvedCategories = body.categories.split(',').map((c: string) => c.trim()).filter(Boolean);
      }
      currentPost.categories = resolvedCategories;
      currentPost.category = resolvedCategories.join(', ') || body.category || currentPost.category;
      if (!currentPost.categories || currentPost.categories.length === 0) {
        currentPost.categories = ['Uncategorized'];
        currentPost.category = 'Uncategorized';
        currentPost.categorySlugs = ['uncategorized'];
      }
    } else if (body.category !== undefined) {
      currentPost.category = body.category;
      if (!currentPost.categories || currentPost.categories.length === 0) {
        currentPost.categories = body.category.split(',').map((c: string) => c.trim()).filter(Boolean);
      }
      if (!currentPost.categories || currentPost.categories.length === 0) {
        currentPost.categories = ['Uncategorized'];
        currentPost.category = 'Uncategorized';
        currentPost.categorySlugs = ['uncategorized'];
      }
    }
    if (body.categorySlugs !== undefined) {
      currentPost.categorySlugs = Array.isArray(body.categorySlugs) ? body.categorySlugs : [];
    }

    if (body.image !== undefined) currentPost.image = body.image;
    if (body.excerpt !== undefined) currentPost.excerpt = body.excerpt;
    if (body.readTime !== undefined) currentPost.readTime = body.readTime;
    if (body.date !== undefined) currentPost.date = body.date;
    if (body.formattedDate !== undefined) currentPost.formattedDate = body.formattedDate;

    if (body.authorName !== undefined || body.authorRole !== undefined || body.authorAvatar !== undefined) {
      currentPost.author = {
        name: body.authorName !== undefined ? body.authorName : currentPost.author.name,
        role: body.authorRole !== undefined ? body.authorRole : currentPost.author.role,
        avatar: body.authorAvatar !== undefined ? body.authorAvatar : currentPost.author.avatar,
      };
    }

    if (body.content !== undefined) currentPost.content = body.content;
    currentPost.css = finalCss;
    if (body.projectData !== undefined) currentPost.projectData = body.projectData;
    if (body.keywords !== undefined) currentPost.keywords = body.keywords;
    if (body.tags !== undefined) currentPost.tags = body.tags;
    if (body.schema !== undefined) currentPost.schema = String(body.schema).trim();
    if (body.showRelated !== undefined) currentPost.showRelated = Boolean(body.showRelated);
    if (body.relatedTagline !== undefined) currentPost.relatedTagline = String(body.relatedTagline).trim();
    if (body.relatedTitle !== undefined) currentPost.relatedTitle = String(body.relatedTitle).trim();
    if (body.relatedCategory !== undefined) currentPost.relatedCategory = String(body.relatedCategory).trim();
    if (body.relatedOrderBy !== undefined) currentPost.relatedOrderBy = String(body.relatedOrderBy).trim();
    if (body.relatedLimit !== undefined) currentPost.relatedLimit = Number(body.relatedLimit);
    if (body.relatedHtml !== undefined) currentPost.relatedHtml = String(body.relatedHtml);
    if (body.layoutMode !== undefined) currentPost.layoutMode = body.layoutMode;
    if (body.layoutId !== undefined) currentPost.layoutId = body.layoutId;
    if (body.customCode !== undefined) {
      currentPost.customCode = {
        headScripts: typeof body.customCode?.headScripts === 'string' ? body.customCode.headScripts : '',
        bodyStartScripts: typeof body.customCode?.bodyStartScripts === 'string' ? body.customCode.bodyStartScripts : '',
        customCss: typeof body.customCode?.customCss === 'string' ? body.customCode.customCss : '',
        bodyEndScripts: typeof body.customCode?.bodyEndScripts === 'string' ? body.customCode.bodyEndScripts : (typeof body.customCode?.bodyScripts === 'string' ? body.customCode.bodyScripts : ''),
        bodyScripts: typeof body.customCode?.bodyEndScripts === 'string' ? body.customCode.bodyEndScripts : (typeof body.customCode?.bodyScripts === 'string' ? body.customCode.bodyScripts : ''),
      };
    }
    currentPost.updatedAt = new Date().toISOString();

    postsList[postIndex] = currentPost;
    await writePosts(postsList);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Article "${currentPost.title}" saved successfully!`,
        post: currentPost,
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

// DELETE: Hapus artikel berdasarkan slug atau id
export const DELETE: APIRoute = async ({ url }) => {
  try {
    const slug = url.searchParams.get('slug') || url.searchParams.get('id');
    if (!slug) {
      return new Response(JSON.stringify({ success: false, error: 'Article slug or ID is required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const postsList = await readPosts();
    const filtered = postsList.filter((p) => p.slug !== slug && p.id !== slug);

    if (filtered.length === postsList.length) {
      return new Response(JSON.stringify({ success: false, error: 'Article was not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await writePosts(filtered);

    return new Response(JSON.stringify({ success: true, message: 'Article deleted successfully.' }), {
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
