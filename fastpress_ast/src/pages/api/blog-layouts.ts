import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getBlogLayouts, type BlogLayout, defaultBlogLayouts } from '../../data/blog-layouts';
import { getPosts, type Post } from '../../data/posts';

export const prerender = false;

const LAYOUTS_FILE = path.join(process.cwd(), 'src', 'data', 'blog-layouts.json');
const POSTS_FILE = path.join(process.cwd(), 'src', 'data', 'posts.json');

async function readLayouts(): Promise<BlogLayout[]> {
  try {
    const raw = await fs.readFile(LAYOUTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  return defaultBlogLayouts;
}

async function writeLayouts(layouts: BlogLayout[]): Promise<void> {
  await fs.writeFile(LAYOUTS_FILE, JSON.stringify(layouts, null, 2), 'utf-8');
}

async function readPosts(): Promise<Post[]> {
  try {
    const raw = await fs.readFile(POSTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  return getPosts();
}

async function writePosts(postsList: Post[]): Promise<void> {
  await fs.writeFile(POSTS_FILE, JSON.stringify(postsList, null, 2), 'utf-8');
}

// GET: fetch layouts and post assignment status
export const GET: APIRoute = async ({ url }) => {
  try {
    const layouts = await readLayouts();
    const posts = await readPosts();
    const id = url.searchParams.get('id');

    if (id) {
      const found = layouts.find(l => l.id === id);
      if (!found) {
        return new Response(JSON.stringify({ success: false, error: 'Layout not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ success: true, layout: found }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const postsSummary = posts.map(p => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      image: p.image,
      category: p.category,
      layoutMode: p.layoutMode || 'standard',
      layoutId: p.layoutId || (layouts.find(l => l.appliedPostSlugs?.includes(p.slug))?.id) || layouts[0]?.id
    }));

    return new Response(JSON.stringify({
      success: true,
      layouts,
      posts: postsSummary
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// POST: handle create, save, duplicate, delete, apply_posts, set_default
export const POST: APIRoute = async ({ request }) => {
  try {
    const text = await request.text();
    let body: any = {};
    if (text && text.trim().length > 0) {
      body = JSON.parse(text);
    }

    const action = body.action || 'save';
    let layouts = await readLayouts();
    let posts = await readPosts();
    const now = new Date().toISOString();

    // 1. SAVE LAYOUT
    if (action === 'save') {
      const layoutData = body.layout;
      if (!layoutData || !layoutData.id) {
        return new Response(JSON.stringify({ success: false, error: 'Missing layout data or ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const idx = layouts.findIndex(l => l.id === layoutData.id);
      if (idx >= 0) {
        layouts[idx] = {
          ...layouts[idx],
          ...layoutData,
          updatedAt: now
        };
      } else {
        layouts.push({
          ...layoutData,
          createdAt: now,
          updatedAt: now
        });
      }

      // If marked as default, unmark others
      if (layoutData.isDefault) {
        layouts.forEach(l => {
          if (l.id !== layoutData.id) l.isDefault = false;
        });
      }

      await writeLayouts(layouts);

      return new Response(JSON.stringify({
        success: true,
        message: `Layout "${layoutData.name || 'Layout'}" saved successfully!`,
        layout: idx >= 0 ? layouts[idx] : layouts[layouts.length - 1],
        layouts
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 2. CREATE NEW LAYOUT
    if (action === 'create') {
      const name = (body.name || 'Custom Blog Layout').trim();
      const rawId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'layout';
      let newId = `layout-${rawId}-${Date.now().toString(36)}`;

      const baseLayout = body.templateId ? layouts.find(l => l.id === body.templateId) : null;
      const initialHtml = baseLayout?.html || defaultBlogLayouts[0].html;
      const initialCss = baseLayout?.css || defaultBlogLayouts[0].css;

      const newLayout: BlogLayout = {
        id: newId,
        name,
        description: body.description || 'Custom standard blog post layout',
        isDefault: false,
        appliedPostSlugs: Array.isArray(body.appliedPostSlugs) ? body.appliedPostSlugs : [],
        html: initialHtml,
        css: initialCss,
        projectData: baseLayout?.projectData || null,
        createdAt: now,
        updatedAt: now
      };

      layouts.push(newLayout);

      // If posts were assigned to this new layout
      if (newLayout.appliedPostSlugs.length > 0) {
        posts = posts.map(p => {
          if (newLayout.appliedPostSlugs.includes(p.slug)) {
            return { ...p, layoutMode: 'standard', layoutId: newLayout.id };
          }
          return p;
        });
        await writePosts(posts);
      }

      await writeLayouts(layouts);

      return new Response(JSON.stringify({
        success: true,
        message: `Layout "${newLayout.name}" created!`,
        layout: newLayout,
        layouts
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 3. DUPLICATE LAYOUT
    if (action === 'duplicate') {
      const sourceId = body.id;
      const source = layouts.find(l => l.id === sourceId);
      if (!source) {
        return new Response(JSON.stringify({ success: false, error: 'Source layout not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const clonedId = `layout-${Math.random().toString(36).substring(2, 9)}`;
      const cloned: BlogLayout = {
        ...JSON.parse(JSON.stringify(source)),
        id: clonedId,
        name: `${source.name} (Copy)`,
        isDefault: false,
        appliedPostSlugs: [], // Start without applied posts
        createdAt: now,
        updatedAt: now
      };

      layouts.push(cloned);
      await writeLayouts(layouts);

      return new Response(JSON.stringify({
        success: true,
        message: `Duplicated "${source.name}"`,
        layout: cloned,
        layouts
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 4. APPLY POSTS TO LAYOUT (Specify which blog posts the layout is applied to)
    if (action === 'apply_posts') {
      const layoutId = body.layoutId;
      const slugs: string[] = Array.isArray(body.slugs) ? body.slugs : [];
      const makeDefault = Boolean(body.isDefault);

      const targetLayout = layouts.find(l => l.id === layoutId);
      if (!targetLayout) {
        return new Response(JSON.stringify({ success: false, error: 'Layout not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Update layout's appliedPostSlugs
      targetLayout.appliedPostSlugs = slugs;
      if (makeDefault) {
        targetLayout.isDefault = true;
        layouts.forEach(l => {
          if (l.id !== layoutId) l.isDefault = false;
        });
      }
      targetLayout.updatedAt = now;

      // Also clean other layouts so a post isn't claimed by multiple layouts
      layouts.forEach(l => {
        if (l.id !== layoutId) {
          l.appliedPostSlugs = (l.appliedPostSlugs || []).filter(s => !slugs.includes(s));
        }
      });

      // Update posts.json:
      // Posts in `slugs` become layoutMode: 'standard' and layoutId: layoutId
      // Posts that were previously under this layout but now removed become blank or default
      const defaultLayout = layouts.find(l => l.isDefault) || layouts[0];
      posts = posts.map(p => {
        if (slugs.includes(p.slug)) {
          return { ...p, layoutMode: 'standard', layoutId: layoutId };
        } else if (p.layoutId === layoutId) {
          // Post was unselected from this layout
          return { ...p, layoutMode: 'standard', layoutId: defaultLayout.id };
        }
        return p;
      });

      await writeLayouts(layouts);
      await writePosts(posts);

      return new Response(JSON.stringify({
        success: true,
        message: `Layout applied to ${slugs.length} post${slugs.length === 1 ? '' : 's'}!`,
        layout: targetLayout,
        layouts
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 5. DELETE LAYOUT
    if (action === 'delete') {
      const id = body.id;
      if (layouts.length <= 1) {
        return new Response(JSON.stringify({ success: false, error: 'Cannot delete the only remaining layout.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const target = layouts.find(l => l.id === id);
      if (!target) {
        return new Response(JSON.stringify({ success: false, error: 'Layout not found.' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      layouts = layouts.filter(l => l.id !== id);
      // If deleted was default, make the first one default
      if (target.isDefault && layouts.length > 0) {
        layouts[0].isDefault = true;
      }

      const newDefault = layouts.find(l => l.isDefault) || layouts[0];

      // Reassign any posts that used this layout to the new default
      posts = posts.map(p => {
        if (p.layoutId === id) {
          return { ...p, layoutId: newDefault.id };
        }
        return p;
      });

      // Also add those slugs to newDefault
      if (target.appliedPostSlugs && target.appliedPostSlugs.length > 0) {
        newDefault.appliedPostSlugs = Array.from(new Set([...(newDefault.appliedPostSlugs || []), ...target.appliedPostSlugs]));
      }

      await writeLayouts(layouts);
      await writePosts(posts);

      return new Response(JSON.stringify({
        success: true,
        message: `Layout "${target.name}" deleted.`,
        layouts
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: false, error: 'Invalid action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
