import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { defaultCategories, type Category } from '../../data/categories';
import { defaultPosts, type Post } from '../../data/posts';

export const prerender = false;

const CATEGORIES_FILE = path.join(process.cwd(), 'src', 'data', 'categories.json');
const POSTS_FILE = path.join(process.cwd(), 'src', 'data', 'posts.json');

async function readCategories(): Promise<Category[]> {
  try {
    const raw = await fs.readFile(CATEGORIES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return defaultCategories;
  } catch {
    return defaultCategories;
  }
}

async function writeCategories(list: Category[]): Promise<void> {
  await fs.writeFile(CATEGORIES_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

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

export const GET: APIRoute = async () => {
  try {
    const categories = await readCategories();
    return new Response(JSON.stringify(categories), {
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

    const categories = await readCategories();
    const action = body.action || 'create';

    // 1. Create Category
    if (action === 'create') {
      const name = (body.name || '').trim();
      if (!name) {
        return new Response(
          JSON.stringify({ success: false, error: 'Category name is required.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      let slug = (body.slug || name)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      if (!slug) {
        slug = `cat-${Date.now()}`;
      }

      if (categories.some((c) => c.slug === slug || c.name.toLowerCase() === name.toLowerCase())) {
        return new Response(
          JSON.stringify({ success: false, error: `Category "${name}" or slug "${slug}" already exists.` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const newCategory: Category = {
        id: slug,
        name,
        slug,
        description: body.description || '',
      };

      categories.push(newCategory);
      await writeCategories(categories);

      return new Response(
        JSON.stringify({ success: true, message: `Category "${name}" created!`, category: newCategory, categories }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. Delete Category
    if (action === 'delete') {
      const targetSlug = (body.slug || body.id || '').trim().toLowerCase();
      if (!targetSlug) {
        return new Response(
          JSON.stringify({ success: false, error: 'Category slug or ID is required.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Find category to delete
      const catToDelete = categories.find(
        (c) => c.slug.toLowerCase() === targetSlug || c.id.toLowerCase() === targetSlug
      );
      if (!catToDelete) {
        return new Response(
          JSON.stringify({ success: false, error: 'Category not found.' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Protect default "Uncategorized" category from deletion
      if (catToDelete.slug.toLowerCase() === 'uncategorized' || catToDelete.name.toLowerCase() === 'uncategorized') {
        return new Response(
          JSON.stringify({ success: false, error: 'The default "Uncategorized" category cannot be deleted.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Filter out deleted category
      let filtered = categories.filter(
        (c) => c.slug.toLowerCase() !== catToDelete.slug.toLowerCase() && c.id.toLowerCase() !== catToDelete.id.toLowerCase()
      );

      // Ensure "Uncategorized" always exists in the master list
      const hasUncategorized = filtered.some(
        (c) => c.slug.toLowerCase() === 'uncategorized' || c.name.toLowerCase() === 'uncategorized'
      );
      if (!hasUncategorized) {
        filtered.unshift({
          id: 'uncategorized',
          name: 'Uncategorized',
          slug: 'uncategorized',
          description: 'Default category for posts without specific category',
        });
      }

      await writeCategories(filtered);

      // Automatically update all posts using this category!
      const postsList = await readPosts();
      let affectedPostsCount = 0;
      let uncategorizedPostsCount = 0;

      const delNameLower = catToDelete.name.toLowerCase();
      const delSlugLower = catToDelete.slug.toLowerCase();

      for (const post of postsList) {
        let postCats: string[] = [];
        if (Array.isArray(post.categories) && post.categories.length > 0) {
          postCats = [...post.categories];
        } else if (typeof post.category === 'string' && post.category.trim()) {
          postCats = post.category.split(',').map((c) => c.trim()).filter(Boolean);
        }

        let postSlugs: string[] = [];
        if (Array.isArray(post.categorySlugs) && post.categorySlugs.length > 0) {
          postSlugs = [...post.categorySlugs];
        } else {
          postSlugs = postCats.map((c) => c.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''));
        }

        const matchCat = postCats.some((c) => c.toLowerCase() === delNameLower);
        const matchSlug = postSlugs.some((s) => s.toLowerCase() === delSlugLower);

        if (matchCat || matchSlug) {
          const remainingCats = postCats.filter((c) => c.toLowerCase() !== delNameLower);
          const remainingSlugs = postSlugs.filter((s) => s.toLowerCase() !== delSlugLower);

          if (remainingCats.length === 0) {
            // Post has no other categories left! Automatically reassign to "Uncategorized"
            post.categories = ['Uncategorized'];
            post.categorySlugs = ['uncategorized'];
            post.category = 'Uncategorized';
            uncategorizedPostsCount++;
          } else {
            post.categories = remainingCats;
            post.categorySlugs = remainingSlugs;
            post.category = remainingCats.join(', ');
          }

          post.updatedAt = new Date().toISOString();
          affectedPostsCount++;
        }
      }

      if (affectedPostsCount > 0) {
        await writePosts(postsList);
      }

      const msg = uncategorizedPostsCount > 0
        ? `Category "${catToDelete.name}" deleted successfully. ${uncategorizedPostsCount} post(s) automatically moved to "Uncategorized".`
        : `Category "${catToDelete.name}" deleted successfully.`;

      return new Response(
        JSON.stringify({
          success: true,
          message: msg,
          categories: filtered,
          deletedCategory: catToDelete,
          affectedPostsCount,
          uncategorizedPostsCount,
          updatedPosts: postsList,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
