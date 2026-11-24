import fs from 'node:fs';
import path from 'node:path';
import type { Post } from './posts';
import { syncGlobalTemplates, cleanLiveContent } from './templates';

export interface BlogLayout {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  appliedPostSlugs: string[];
  html: string;
  css: string;
  projectData?: any;
  createdAt?: string;
  updatedAt?: string;
}

const LAYOUTS_FILE = path.join(process.cwd(), 'src', 'data', 'blog-layouts.json');

export const defaultBlogLayouts: BlogLayout[] = [
  {
    id: 'standard-default-layout',
    name: 'Standard Blog Layout (Default)',
    description: 'Clean, elegant editorial layout with centered container, bold typography, featured hero image, and author bio card.',
    isDefault: true,
    appliedPostSlugs: [
      'branding-identity-modern-age',
      'online-marketing-strategies-growth',
      'graphic-design-principles-conversion',
      'hunter-xx-hunter-custom-slug'
    ],
    html: `<article class="single-post-article standard-post-layout" data-post-layout="standard-default-layout">
  <!-- Post Header Section -->
  <header class="post-header-wrap" style="padding: 40px 0 28px 0; background: #f9fafb; border-bottom: 1px solid #e5e7eb; margin-bottom: 32px;">
    <div class="layout-container" style="max-width: 900px; margin: 0 auto; padding: 0 20px;">
      
      <!-- Breadcrumb Navigation -->
      <div data-post-element="breadcrumbs" style="margin-bottom: 16px;">
        <nav class="breadcrumb-nav" aria-label="Breadcrumb">
          <ol class="breadcrumb-list" style="display: flex; align-items: center; gap: 8px; list-style: none; padding: 0; margin: 0; font-size: 0.85rem; color: #6b7280;">
            <li><a href="/" style="color: #4b5563; text-decoration: none;">Home</a></li>
            <li aria-hidden="true" style="color: #9ca3af;">/</li>
            <li><a href="/blog" style="color: #4b5563; text-decoration: none;">Blog</a></li>
            <li aria-hidden="true" style="color: #9ca3af;">/</li>
            <li class="breadcrumb-current" style="color: #111827; font-weight: 600;">Article</li>
          </ol>
        </nav>
      </div>

      <!-- Category Badges -->
      <div data-post-element="categories" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px;">
        <span class="post-category-badge" style="display: inline-block; padding: 4px 12px; background: rgba(255, 94, 58, 0.12); color: #ff5e3a; font-family: 'Montserrat', sans-serif; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; border-radius: 9999px;">Category</span>
      </div>

      <!-- Main Article Title -->
      <h1 data-post-element="title" style="font-family: 'Montserrat', sans-serif; font-size: 2.35rem; font-weight: 800; color: #111827; line-height: 1.25; margin-bottom: 18px;">
        Article Title
      </h1>

      <!-- Author & Date Meta Bar -->
      <div data-post-element="meta" style="display: flex; align-items: center; gap: 18px; flex-wrap: wrap;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <img data-post-element="author-avatar" src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=240&h=240&q=80" alt="Author" style="width: 42px; height: 42px; border-radius: 50%; object-fit: cover; border: 2px solid #ff5e3a;" />
          <div>
            <div data-post-element="author-name" style="font-size: 0.88rem; font-weight: 700; color: #111827;">Better Team</div>
            <div data-post-element="author-role" style="font-size: 0.75rem; color: #6b7280;">Author Role</div>
          </div>
        </div>
        <div style="width: 1px; height: 26px; background-color: #e5e7eb;"></div>
        <div style="display: flex; align-items: center; gap: 14px; font-size: 0.82rem; color: #6b7280;">
          <span data-post-element="post-date">📅 Date</span>
          <span data-post-element="post-readtime">⏱️ 5 min read</span>
        </div>
      </div>

    </div>
  </header>

  <!-- Featured Image -->
  <div class="layout-container" style="max-width: 900px; margin: 0 auto 32px auto; padding: 0 20px;">
    <div data-post-element="image" style="border-radius: 12px; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.06); max-height: 440px;">
      <img src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80" alt="Featured Media" style="width: 100%; height: 100%; object-fit: cover; display: block;" />
    </div>
  </div>

  <!-- Article Body Content Container -->
  <div class="layout-container" style="max-width: 900px; margin: 0 auto; padding: 0 20px 48px 20px;">
    
    <!-- Dynamic Article Content -->
    <div data-post-element="content" class="post-content" style="font-size: 1.08rem; line-height: 1.85; color: #374151;">
      <p class="lead" style="font-size: 1.22rem; font-weight: 500; color: #1f2937; margin-bottom: 20px; line-height: 1.75;">
        Article body content goes here. When you assign blog posts to this layout, their unique content will render smoothly within this block.
      </p>
      <h2>Section Heading</h2>
      <p>
        Edit this standard layout in the Blog Layout Builder to update the structure, colors, spacing, and styling across all blog posts using this layout.
      </p>
    </div>

    <!-- Article Tags Bar -->
    <div data-post-element="tags" style="margin-top: 36px; padding-top: 20px; border-top: 1px solid #e5e7eb; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
      <span style="font-size: 0.78rem; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">TAGS:</span>
      <span style="display: inline-block; padding: 3px 10px; background: #f3f4f6; color: #4b5563; font-size: 0.8rem; border-radius: 6px;">#Blog</span>
    </div>

    <!-- Author Bio Box -->
    <div data-post-element="author-bio-box" style="display: flex; align-items: center; gap: 20px; padding: 24px; background-color: #f9fafb; border-radius: 12px; border: 1px solid #e5e7eb; margin-top: 36px;">
      <img data-post-element="author-avatar" src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=240&h=240&q=80" alt="Author" style="width: 64px; height: 64px; border-radius: 50%; object-fit: cover; flex-shrink: 0;" />
      <div>
        <span style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; color: #ff5e3a; letter-spacing: 1px;">Written by</span>
        <h3 data-post-element="author-name" style="font-size: 1.12rem; font-weight: 800; color: #111827; margin: 3px 0 5px 0;">Better Team</h3>
        <p data-post-element="author-bio" style="font-size: 0.88rem; color: #6b7280; line-height: 1.55; margin: 0;">
          Creative industry professional focused on developing visual strategy, brand communication, and high-impact user experiences.
        </p>
      </div>
    </div>

  </div>

  <!-- Related Articles Section -->
  <div data-post-element="related"></div>
</article>`,
    css: `/* Standard Default Blog Layout Styles */
.standard-post-layout {
  font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #1f2937;
  background-color: #ffffff;
}
.standard-post-layout h1, 
.standard-post-layout h2, 
.standard-post-layout h3 {
  font-family: 'Montserrat', sans-serif;
}
.standard-post-layout .breadcrumb-nav {
  margin-bottom: 16px;
}
.standard-post-layout .breadcrumb-list {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  list-style: none !important;
  padding: 0 !important;
  margin: 0 !important;
  font-size: 0.85rem !important;
  color: #6b7280 !important;
}
.standard-post-layout .breadcrumb-list li {
  display: inline-flex !important;
  align-items: center !important;
  list-style: none !important;
}
.standard-post-layout .breadcrumb-list a {
  color: #4b5563 !important;
  text-decoration: none !important;
  transition: color 0.15s ease;
}
.standard-post-layout .breadcrumb-list a:hover {
  color: #ff5e3a !important;
}
.standard-post-layout .breadcrumb-current {
  color: #111827 !important;
  font-weight: 600 !important;
}
.standard-post-layout .post-category-badge {
  display: inline-block !important;
  padding: 4px 12px !important;
  background-color: rgba(255, 94, 58, 0.12) !important;
  color: #ff5e3a !important;
  font-family: 'Montserrat', sans-serif !important;
  font-size: 0.72rem !important;
  font-weight: 700 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.05em !important;
  border-radius: 9999px !important;
  text-decoration: none !important;
}
.standard-post-layout [data-post-element="title"] {
  font-family: 'Montserrat', sans-serif;
  font-size: 2.35rem;
  font-weight: 800;
  color: #111827;
  line-height: 1.25;
  margin-bottom: 18px;
}
.standard-post-layout [data-post-element="meta"] {
  display: flex !important;
  align-items: center !important;
  gap: 18px !important;
  flex-wrap: wrap !important;
}
.standard-post-layout .author-avatar,
.standard-post-layout img[data-post-element="author-avatar"] {
  width: 42px !important;
  height: 42px !important;
  border-radius: 50% !important;
  object-fit: cover !important;
  border: 2px solid #ff5e3a !important;
  display: inline-block !important;
}
.standard-post-layout [data-post-element="author-name"] {
  font-size: 0.88rem;
  font-weight: 700;
  color: #111827;
}
.standard-post-layout [data-post-element="author-role"] {
  font-size: 0.75rem;
  color: #6b7280;
}
.standard-post-layout [data-post-element="image"] {
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0,0,0,0.06);
  max-height: 440px;
}
.standard-post-layout [data-post-element="image"] img {
  width: 100% !important;
  height: 100% !important;
  object-fit: cover !important;
  display: block !important;
}
.standard-post-layout .post-content {
  font-size: 1.08rem;
  line-height: 1.85;
  color: #374151;
}
.standard-post-layout .post-content h2 {
  font-size: 1.65rem;
  font-weight: 800;
  color: #111827;
  margin: 36px 0 16px 0;
  line-height: 1.35;
}
.standard-post-layout .post-content p {
  margin-bottom: 20px;
}
.standard-post-layout .post-content blockquote {
  border-left: 4px solid #ff5e3a;
  padding: 16px 22px;
  background: #fff5f2;
  margin: 28px 0;
  border-radius: 0 8px 8px 0;
  font-style: italic;
  color: #374151;
}
.standard-post-layout .post-content ul, 
.standard-post-layout .post-content ol {
  margin: 20px 0 24px 28px;
}
.standard-post-layout .post-content li {
  margin-bottom: 8px;
}
.standard-post-layout [data-post-element="author-bio-box"] {
  display: flex !important;
  align-items: center !important;
  gap: 20px !important;
  padding: 24px !important;
  background-color: #f9fafb !important;
  border-radius: 12px !important;
  border: 1px solid #e5e7eb !important;
  margin-top: 36px !important;
}
.standard-post-layout [data-post-element="author-bio-box"] img[data-post-element="author-avatar"] {
  width: 64px !important;
  height: 64px !important;
  border-radius: 50% !important;
  object-fit: cover !important;
  flex-shrink: 0 !important;
  border: none !important;
}`
  },
  {
    id: 'magazine-sidebar-layout',
    name: 'Magazine with Sticky Sidebar',
    description: 'Modern 2-column editorial layout: 70% main reading area and 30% sticky sidebar with author profile, newsletter CTA, and quick links.',
    isDefault: false,
    appliedPostSlugs: [],
    html: `<article class="single-post-article magazine-sidebar-layout" data-post-layout="magazine-sidebar-layout">
  <!-- Post Header Bar -->
  <header style="padding: 36px 0 24px 0; background: #0f141e; color: #f3f4f6; border-bottom: 1px solid #232a38; margin-bottom: 36px;">
    <div style="max-width: 1160px; margin: 0 auto; padding: 0 24px;">
      
      <!-- Breadcrumb Navigation -->
      <div data-post-element="breadcrumbs" style="margin-bottom: 14px;">
        <nav aria-label="Breadcrumb">
          <ol style="display: flex; align-items: center; gap: 8px; list-style: none; padding: 0; margin: 0; font-size: 0.82rem; color: #9ca3af;">
            <li><a href="/" style="color: #9ca3af; text-decoration: none;">Home</a></li>
            <li aria-hidden="true">/</li>
            <li><a href="/blog" style="color: #9ca3af; text-decoration: none;">Blog</a></li>
            <li aria-hidden="true">/</li>
            <li style="color: #f3f4f6; font-weight: 600;">Article</li>
          </ol>
        </nav>
      </div>

      <!-- Category Badges -->
      <div data-post-element="categories" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;">
        <span style="display: inline-block; padding: 4px 12px; background: rgba(255, 94, 58, 0.2); color: #ff7555; font-family: 'Montserrat', sans-serif; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; border-radius: 9999px;">EDITORIAL</span>
      </div>

      <!-- Title -->
      <h1 data-post-element="title" style="font-family: 'Montserrat', sans-serif; font-size: 2.5rem; font-weight: 800; color: #ffffff; line-height: 1.25; margin-bottom: 16px;">
        Article Title
      </h1>

      <!-- Meta info -->
      <div data-post-element="meta" style="display: flex; align-items: center; gap: 16px; font-size: 0.85rem; color: #9ca3af;">
        <span data-post-element="post-date">📅 Date</span>
        <span>•</span>
        <span data-post-element="post-readtime">⏱️ 5 min read</span>
      </div>

    </div>
  </header>

  <!-- 2-Column Content Layout (70% content + 30% sidebar) -->
  <div style="max-width: 1160px; margin: 0 auto; padding: 0 24px 60px 24px; display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 40px; align-items: start;">
    
    <!-- Main Content Column -->
    <main style="min-width: 0;">
      <!-- Featured Image -->
      <div data-post-element="image" style="border-radius: 12px; overflow: hidden; margin-bottom: 32px; box-shadow: 0 8px 24px rgba(0,0,0,0.08);">
        <img src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80" alt="Featured Media" style="width: 100%; height: auto; max-height: 460px; object-fit: cover; display: block;" />
      </div>

      <!-- Content Body -->
      <div data-post-element="content" class="post-content" style="font-size: 1.08rem; line-height: 1.85; color: #374151;">
        <p class="lead" style="font-size: 1.2rem; font-weight: 500; color: #111827; margin-bottom: 20px;">
          Sample article content in magazine 2-column sidebar layout.
        </p>
      </div>

      <!-- Tags Bar -->
      <div data-post-element="tags" style="margin-top: 36px; padding-top: 20px; border-top: 1px solid #e5e7eb; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
        <span style="font-size: 0.78rem; font-weight: 700; color: #6b7280;">TAGS:</span>
        <span style="display: inline-block; padding: 3px 10px; background: #f3f4f6; color: #4b5563; font-size: 0.8rem; border-radius: 6px;">#Magazine</span>
      </div>
    </main>

    <!-- Sidebar Column (Sticky) -->
    <aside style="position: sticky; top: 90px; display: flex; flex-direction: column; gap: 24px;">
      
      <!-- Author Profile Card -->
      <div data-post-element="author" style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 22px; box-shadow: 0 4px 14px rgba(0,0,0,0.03); text-align: center;">
        <img data-post-element="author-avatar" src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=240&h=240&q=80" alt="Author" style="width: 72px; height: 72px; border-radius: 50%; object-fit: cover; margin: 0 auto 12px auto; display: block; border: 3px solid #ff5e3a;" />
        <span style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: #ff5e3a; letter-spacing: 1px;">Article Author</span>
        <h4 data-post-element="author-name" style="font-family: 'Montserrat', sans-serif; font-size: 1.05rem; font-weight: 800; color: #111827; margin: 4px 0 2px 0;">Better Team</h4>
        <div data-post-element="author-role" style="font-size: 0.78rem; color: #6b7280; margin-bottom: 12px;">Head of Strategy</div>
        <p data-post-element="author-bio" style="font-size: 0.82rem; color: #4b5563; line-height: 1.5; margin: 0;">
          Digital strategist and creator crafting meaningful online experiences.
        </p>
      </div>

      <!-- Newsletter CTA Widget -->
      <div style="background: linear-gradient(135deg, #161b24, #0b0e14); border: 1px solid #283142; border-radius: 12px; padding: 22px; color: #ffffff;">
        <span style="font-size: 0.68rem; font-weight: 700; text-transform: uppercase; color: #ff7555; letter-spacing: 1px;">Stay Updated</span>
        <h4 style="font-family: 'Montserrat', sans-serif; font-size: 1.05rem; font-weight: 800; margin: 4px 0 8px 0;">Subscribe to Insights</h4>
        <p style="font-size: 0.8rem; color: #9ca3af; line-height: 1.45; margin-bottom: 14px;">
          Get our freshest design, branding, and marketing strategies straight to your inbox.
        </p>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <input type="email" placeholder="Enter your email..." style="width: 100%; padding: 8px 12px; border-radius: 6px; border: 1px solid #374151; background: #1c212b; color: #f3f4f6; font-size: 0.82rem;" />
          <button type="button" style="width: 100%; padding: 8px 12px; border-radius: 6px; background: #ff5e3a; color: #ffffff; border: none; font-weight: 700; font-size: 0.82rem; cursor: pointer;">Subscribe Free</button>
        </div>
      </div>

    </aside>

  </div>

  <!-- Related Section -->
  <div data-post-element="related"></div>
</article>`,
    css: `@media (max-width: 860px) {
  .magazine-sidebar-layout > div[style*="grid-template-columns"] {
    grid-template-columns: 1fr !important;
  }
}`
  },
  {
    id: 'minimal-clean-layout',
    name: 'Minimalist Focus Story',
    description: 'Distraction-free, typography-focused reading experience designed for in-depth long-form writing.',
    isDefault: false,
    appliedPostSlugs: [],
    html: `<article class="single-post-article minimal-clean-layout" data-post-layout="minimal-clean-layout">
  <div style="max-width: 760px; margin: 0 auto; padding: 56px 20px 72px 20px;">
    
    <!-- Breadcrumb -->
    <div data-post-element="breadcrumbs" style="margin-bottom: 24px;">
      <nav aria-label="Breadcrumb">
        <ol style="display: flex; align-items: center; gap: 6px; list-style: none; padding: 0; margin: 0; font-size: 0.8rem; color: #9ca3af;">
          <li><a href="/" style="color: #9ca3af; text-decoration: none;">Home</a></li>
          <li aria-hidden="true">/</li>
          <li><a href="/blog" style="color: #9ca3af; text-decoration: none;">Blog</a></li>
        </ol>
      </nav>
    </div>

    <!-- Category -->
    <div data-post-element="categories" style="margin-bottom: 12px;">
      <span style="font-size: 0.75rem; font-weight: 700; color: #ff5e3a; text-transform: uppercase; letter-spacing: 1px;">Article</span>
    </div>

    <!-- Title -->
    <h1 data-post-element="title" style="font-family: 'Montserrat', sans-serif; font-size: 2.6rem; font-weight: 800; color: #111827; line-height: 1.2; margin-bottom: 20px;">
      Article Title
    </h1>

    <!-- Subtitle / Excerpt -->
    <p data-post-element="excerpt" style="font-size: 1.25rem; color: #6b7280; line-height: 1.6; margin-bottom: 28px; font-weight: 400;">
      A brief intro summary that sets the premise for the article.
    </p>

    <!-- Author & Meta Line -->
    <div data-post-element="meta" style="display: flex; align-items: center; justify-content: space-between; padding: 14px 0; border-top: 1px solid #f3f4f6; border-bottom: 1px solid #f3f4f6; margin-bottom: 36px;">
      <div style="display: flex; align-items: center; gap: 10px;">
        <img data-post-element="author-avatar" src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=240&h=240&q=80" alt="Author" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover;" />
        <span data-post-element="author-name" style="font-size: 0.88rem; font-weight: 600; color: #111827;">Better Team</span>
      </div>
      <div style="display: flex; align-items: center; gap: 12px; font-size: 0.82rem; color: #9ca3af;">
        <span data-post-element="post-date">Date</span>
        <span>•</span>
        <span data-post-element="post-readtime">5 min</span>
      </div>
    </div>

    <!-- Featured Image -->
    <div data-post-element="image" style="margin-bottom: 36px; border-radius: 8px; overflow: hidden;">
      <img src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80" alt="Featured Media" style="width: 100%; height: auto; max-height: 420px; object-fit: cover; display: block;" />
    </div>

    <!-- Article Content Body -->
    <div data-post-element="content" class="post-content" style="font-size: 1.12rem; line-height: 1.9; color: #374151;">
      <p>Clean minimal blog post body text.</p>
    </div>

    <!-- Tags -->
    <div data-post-element="tags" style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #f3f4f6;">
      <span style="font-size: 0.8rem; color: #6b7280;">Tagged in:</span>
      <span style="color: #ff5e3a; font-weight: 600; font-size: 0.82rem; margin-left: 6px;">#Story</span>
    </div>

    <!-- Author Card -->
    <div data-post-element="author-bio-box" style="margin-top: 48px; padding: 24px; background: #fafafa; border-radius: 8px;">
      <div style="font-size: 0.72rem; text-transform: uppercase; font-weight: 700; color: #9ca3af; letter-spacing: 0.5px; margin-bottom: 4px;">About the author</div>
      <h4 data-post-element="author-name" style="margin: 0 0 6px 0; font-size: 1rem; color: #111827;">Better Team</h4>
      <p data-post-element="author-bio" style="font-size: 0.85rem; color: #6b7280; line-height: 1.5; margin: 0;">Writer & strategist at Better Corp.</p>
    </div>

  </div>

  <!-- Related Section -->
  <div data-post-element="related"></div>
</article>`,
    css: `.minimal-clean-layout {
  font-family: 'Plus Jakarta Sans', sans-serif;
  color: #2b2f38;
}
.minimal-clean-layout .post-content h2 {
  font-size: 1.7rem;
  font-weight: 700;
  margin: 36px 0 16px 0;
  color: #111827;
}`
  }
];

export function getBlogLayouts(): BlogLayout[] {
  try {
    if (fs.existsSync(LAYOUTS_FILE)) {
      const data = fs.readFileSync(LAYOUTS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}
  return defaultBlogLayouts;
}

export function writeBlogLayoutsSync(layouts: BlogLayout[]): void {
  fs.writeFileSync(LAYOUTS_FILE, JSON.stringify(layouts, null, 2), 'utf-8');
}

export function getBlogLayoutById(id?: string): BlogLayout {
  const layouts = getBlogLayouts();
  if (id) {
    const found = layouts.find(l => l.id === id);
    if (found) return found;
  }
  return layouts.find(l => l.isDefault) || layouts[0] || defaultBlogLayouts[0];
}

export function getBlogLayoutForPost(post: Partial<Post>): BlogLayout {
  const layouts = getBlogLayouts();
  // 1. Direct layoutId match on post
  if (post.layoutId) {
    const found = layouts.find(l => l.id === post.layoutId);
    if (found) return found;
  }
  // 2. Slug listed in layout's appliedPostSlugs
  if (post.slug) {
    const matched = layouts.find(l => Array.isArray(l.appliedPostSlugs) && l.appliedPostSlugs.includes(post.slug!));
    if (matched) return matched;
  }
  // 3. Fallback to default layout
  return layouts.find(l => l.isDefault) || layouts[0] || defaultBlogLayouts[0];
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Replaces dynamic placeholders and data-post-element containers in layout HTML
 * with real values from the specified blog post.
 */
export function renderBlogLayout(
  layout: BlogLayout,
  post: Post,
  allPosts: Post[] = []
): { html: string; css: string } {
  let outputHtml = layout.html || '';

  // Multi-categories
  const categories: string[] = Array.isArray(post.categories) && post.categories.length > 0
    ? post.categories
    : typeof post.category === 'string' && post.category.trim()
      ? post.category.split(',').map((c) => c.trim()).filter(Boolean)
      : ['Uncategorized'];

  // Tags
  const postTags: string[] = Array.isArray(post.tags)
    ? post.tags
    : typeof post.tags === 'string' && post.tags.trim()
      ? post.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

  const authorName = post.author?.name || 'Better Team';
  const authorRole = post.author?.role || 'Contributor';
  const authorAvatar = post.author?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=240&h=240&q=80';
  const postDate = post.formattedDate || post.date || '';
  const readTime = post.readTime || '5 min read';
  const postTitle = post.title || 'Untitled Post';
  const postExcerpt = post.excerpt || '';
  const postImage = post.image || 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80';

  // 1. Article Content: replace inner content of [data-post-element="content"]
  outputHtml = outputHtml.replace(
    /(<([a-zA-Z0-9]+)[^>]*\bdata-post-element=["']content["'][^>]*>)([\s\S]*?)(<\/\2>)/gi,
    `$1${cleanLiveContent(post.content || '')}$4`
  );

  // 2. Main Title: replace inner content of [data-post-element="title"]
  outputHtml = outputHtml.replace(
    /(<([a-zA-Z0-9]+)[^>]*\bdata-post-element=["']title["'][^>]*>)([\s\S]*?)(<\/\2>)/gi,
    `$1${escapeHtml(postTitle)}$4`
  );

  // 3. Excerpt: replace inner content of [data-post-element="excerpt"]
  outputHtml = outputHtml.replace(
    /(<([a-zA-Z0-9]+)[^>]*\bdata-post-element=["']excerpt["'][^>]*>)([\s\S]*?)(<\/\2>)/gi,
    `$1${escapeHtml(postExcerpt)}$4`
  );

  // 4. Featured Image: update src and alt inside or on [data-post-element="image"]
  outputHtml = outputHtml.replace(
    /(<img[^>]*\bdata-post-element=["']image["'][^>]*?)(\/?>)/gi,
    (match, p1, p2) => {
      let tag = p1.replace(/\bsrc=["'][^"']*["']/gi, '').replace(/\balt=["'][^"']*["']/gi, '');
      return `${tag} src="${postImage}" alt="${escapeHtml(postTitle)}"${p2}`;
    }
  );
  // Also handle wrapper [data-post-element="image"] containing an <img>
  outputHtml = outputHtml.replace(
    /(<([a-zA-Z0-9]+)[^>]*\bdata-post-element=["']image["'][^>]*>)([\s\S]*?)(<\/\2>)/gi,
    (match, openTag, tagName, innerContent, closeTag) => {
      if (tagName.toLowerCase() === 'img') return match;
      const updatedInner = innerContent.replace(
        /(<img[^>]*?)(\/?>)/gi,
        (imgMatch: string, imgP1: string, imgP2: string) => {
          let tag = imgP1.replace(/\bsrc=["'][^"']*["']/gi, '').replace(/\balt=["'][^"']*["']/gi, '');
          return `${tag} src="${postImage}" alt="${escapeHtml(postTitle)}"${imgP2}`;
        }
      );
      return `${openTag}${updatedInner}${closeTag}`;
    }
  );

  // 5. Author Avatar: update src and alt
  outputHtml = outputHtml.replace(
    /(<img[^>]*\bdata-post-element=["']author-avatar["'][^>]*?)(\/?>)/gi,
    (match, p1, p2) => {
      let tag = p1.replace(/\bsrc=["'][^"']*["']/gi, '').replace(/\balt=["'][^"']*["']/gi, '');
      return `${tag} src="${authorAvatar}" alt="${escapeHtml(authorName)}"${p2}`;
    }
  );

  // 6. Author Name
  outputHtml = outputHtml.replace(
    /(<([a-zA-Z0-9]+)[^>]*\bdata-post-element=["']author-name["'][^>]*>)([\s\S]*?)(<\/\2>)/gi,
    `$1${escapeHtml(authorName)}$4`
  );

  // 7. Author Role
  outputHtml = outputHtml.replace(
    /(<([a-zA-Z0-9]+)[^>]*\bdata-post-element=["']author-role["'][^>]*>)([\s\S]*?)(<\/\2>)/gi,
    `$1${escapeHtml(authorRole)}$4`
  );

  // 8. Post Date
  outputHtml = outputHtml.replace(
    /(<([a-zA-Z0-9]+)[^>]*\bdata-post-element=["']post-date["'][^>]*>)([\s\S]*?)(<\/\2>)/gi,
    `$1📅 ${escapeHtml(postDate)}$4`
  );

  // 9. Read Time
  outputHtml = outputHtml.replace(
    /(<([a-zA-Z0-9]+)[^>]*\bdata-post-element=["']post-readtime["'][^>]*>)([\s\S]*?)(<\/\2>)/gi,
    `$1⏱️ ${escapeHtml(readTime)}$4`
  );

  // 10. Breadcrumbs
  const breadcrumbHtml = `
    <nav class="breadcrumb-nav" aria-label="Breadcrumb">
      <ol class="breadcrumb-list" style="display: flex; align-items: center; gap: 8px; list-style: none; padding: 0; margin: 0; font-size: 0.85rem; color: #6b7280;">
        <li><a href="/" style="color: #4b5563; text-decoration: none;">Home</a></li>
        <li aria-hidden="true" style="color: #9ca3af;">/</li>
        <li><a href="/blog" style="color: #4b5563; text-decoration: none;">Blog</a></li>
        <li aria-hidden="true" style="color: #9ca3af;">/</li>
        <li class="breadcrumb-current" style="color: #111827; font-weight: 600;">${escapeHtml(categories[0] || 'Article')}</li>
      </ol>
    </nav>
  `;
  outputHtml = outputHtml.replace(
    /(<([a-zA-Z0-9]+)[^>]*\bdata-post-element=["']breadcrumbs["'][^>]*>)([\s\S]*?)(<\/\2>)/gi,
    `$1${breadcrumbHtml}$4`
  );

  // 11. Categories List
  const categoriesHtml = categories.map(cat => (
    `<span class="post-category-badge" style="display: inline-block; padding: 4px 12px; background: rgba(255, 94, 58, 0.12); color: #ff5e3a; font-family: 'Montserrat', sans-serif; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; border-radius: 9999px;">${escapeHtml(cat)}</span>`
  )).join('');
  outputHtml = outputHtml.replace(
    /(<([a-zA-Z0-9]+)[^>]*\bdata-post-element=["']categories["'][^>]*>)([\s\S]*?)(<\/\2>)/gi,
    `$1${categoriesHtml}$4`
  );

  // 12. Tags List
  const tagsHtml = postTags.length > 0 ? `
    <span style="font-size: 0.78rem; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">TAGS:</span>
    ${postTags.map(t => `<span style="display: inline-block; padding: 3px 10px; background: #f3f4f6; color: #4b5563; font-size: 0.8rem; border-radius: 6px;">#${escapeHtml(t)}</span>`).join(' ')}
  ` : '';
  outputHtml = outputHtml.replace(
    /(<([a-zA-Z0-9]+)[^>]*\bdata-post-element=["']tags["'][^>]*>)([\s\S]*?)(<\/\2>)/gi,
    `$1${tagsHtml}$4`
  );

  // 13. Author Bio Box
  const authorBioHtml = `
    <img src="${authorAvatar}" alt="${escapeHtml(authorName)}" style="width: 64px; height: 64px; border-radius: 50%; object-fit: cover; flex-shrink: 0;" />
    <div>
      <span style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; color: #ff5e3a; letter-spacing: 1px;">Written by</span>
      <h3 style="font-size: 1.12rem; font-weight: 800; color: #111827; margin: 3px 0 5px 0;">${escapeHtml(authorName)}</h3>
      <p style="font-size: 0.88rem; color: #6b7280; line-height: 1.55; margin: 0;">
        Creative industry professional focused on developing visual strategy, brand communication, and high-impact user experiences.
      </p>
    </div>
  `;
  outputHtml = outputHtml.replace(
    /(<([a-zA-Z0-9]+)[^>]*\bdata-post-element=["']author-bio-box["'][^>]*>)([\s\S]*?)(<\/\2>)/gi,
    `$1${authorBioHtml}$4`
  );

  // 14. Related Articles Section
  if (post.showRelated !== false) {
    let relatedCandidates = allPosts.filter(p => p.id !== post.id && p.slug !== post.slug);
    const relatedLimit = Math.max(1, Number(post.relatedLimit) || 2);
    const relatedList = relatedCandidates.slice(0, relatedLimit);

    if (relatedList.length > 0) {
      const relatedHtml = `
        <section class="related-posts-section py-section bg-light" style="margin-top: 60px; padding: 60px 0; background-color: #f8fafc; border-top: 1px solid #e2e8f0;">
          <div style="max-width: 1160px; margin: 0 auto; padding: 0 20px;">
            <div style="text-align: center; margin-bottom: 36px;">
              <span style="display: block; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #ff5e3a; margin-bottom: 6px;">${escapeHtml(post.relatedTagline || 'RECOMMENDED')}</span>
              <h2 style="font-family: 'Montserrat', sans-serif; font-size: 1.85rem; font-weight: 800; color: #111827; margin: 0;">${escapeHtml(post.relatedTitle || 'Related Articles')}</h2>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px;">
              ${relatedList.map(r => `
                <article style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
                  <a href="/blog/${r.slug}" style="display: block; aspect-ratio: 16/9; overflow: hidden;">
                    <img src="${r.image}" alt="${escapeHtml(r.title)}" style="width: 100%; height: 100%; object-fit: cover;" />
                  </a>
                  <div style="padding: 20px; display: flex; flex-direction: column; flex-grow: 1; justify-content: space-between;">
                    <div>
                      <span style="font-size: 0.72rem; font-weight: 700; color: #ff5e3a; text-transform: uppercase;">${escapeHtml(r.category || 'Blog')}</span>
                      <h3 style="font-family: 'Montserrat', sans-serif; font-size: 1.12rem; font-weight: 700; color: #111827; margin: 8px 0;">
                        <a href="/blog/${r.slug}" style="color: inherit; text-decoration: none;">${escapeHtml(r.title)}</a>
                      </h3>
                      <p style="font-size: 0.88rem; color: #64748b; line-height: 1.5; margin: 0 0 16px 0;">${escapeHtml(r.excerpt)}</p>
                    </div>
                    <a href="/blog/${r.slug}" style="color: #ff5e3a; font-weight: 700; font-size: 0.82rem; text-decoration: none;">Read More &rarr;</a>
                  </div>
                </article>
              `).join('')}
            </div>
          </div>
        </section>
      `;
      outputHtml = outputHtml.replace(
        /(<([a-zA-Z0-9]+)[^>]*\bdata-post-element=["']related["'][^>]*>)([\s\S]*?)(<\/\2>)/gi,
        `$1${relatedHtml}$4`
      );
    }
  }

  // 15. Token replacements fallback: {{post.title}}, {{post.excerpt}}, {{post.content}}, etc.
  outputHtml = outputHtml
    .replace(/\{\{post\.title\}\}/g, escapeHtml(postTitle))
    .replace(/\{\{post\.excerpt\}\}/g, escapeHtml(postExcerpt))
    .replace(/\{\{post\.content\}\}/g, cleanLiveContent(post.content || ''))
    .replace(/\{\{post\.image\}\}/g, postImage)
    .replace(/\{\{post\.author\.name\}\}/g, escapeHtml(authorName))
    .replace(/\{\{post\.author\.role\}\}/g, escapeHtml(authorRole))
    .replace(/\{\{post\.author\.avatar\}\}/g, authorAvatar)
    .replace(/\{\{post\.date\}\}/g, escapeHtml(postDate))
    .replace(/\{\{post\.readTime\}\}/g, escapeHtml(readTime));

  // 16. Strip any back-button element so live post matches edit mode
  outputHtml = outputHtml.replace(
    /(<!--\s*Back (?:to Blog|Button)[^>]*-->\s*)?<([a-zA-Z0-9]+)[^>]*\bdata-post-element=["']back-button["'][^>]*>[\s\S]*?<\/\2>/gi,
    ''
  );

  const combinedCss = `${layout.css || ''}\n${post.css || ''}`;

  return {
    html: cleanLiveContent(syncGlobalTemplates(outputHtml)),
    css: combinedCss
  };
}
