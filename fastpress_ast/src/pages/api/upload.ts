import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';

export const prerender = false;

const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');

const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.avif', '.ico'];
const MAX_IMAGE_SIZE = 200 * 1024; // 200 KB max image size
const DATA_DIR = path.join(process.cwd(), 'src', 'data');

interface ImageUsage {
  type: string;
  title: string;
  path: string;
}

async function scanImageUsage(files: string[]): Promise<Record<string, ImageUsage[]>> {
  const usageMap: Record<string, ImageUsage[]> = {};
  for (const f of files) {
    usageMap[f] = [];
  }

  async function safeReadJSON(filename: string): Promise<any> {
    try {
      const content = await fs.readFile(path.join(DATA_DIR, filename), 'utf8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  const [pagesData, postsData, popupsData, templatesData, blogLayoutsData, siteConfig, productsData] = await Promise.all([
    safeReadJSON('pages.json'),
    safeReadJSON('posts.json'),
    safeReadJSON('popups.json'),
    safeReadJSON('templates.json'),
    safeReadJSON('blog-layouts.json'),
    safeReadJSON('siteConfig.json'),
    safeReadJSON('products.json'),
  ]);

  for (const file of files) {
    const url = `/uploads/${file}`;
    const used: ImageUsage[] = [];

    // 1. Pages
    if (pagesData && typeof pagesData === 'object') {
      for (const [slug, p] of Object.entries<any>(pagesData)) {
        const s = JSON.stringify(p);
        if (s.includes(file) || s.includes(url)) {
          used.push({
            type: 'Page',
            title: p.title || (slug === 'home' ? 'Homepage' : slug),
            path: '/' + (slug === 'home' ? '' : slug)
          });
        }
      }
    }

    // 2. Posts
    if (Array.isArray(postsData)) {
      for (const post of postsData) {
        const s = JSON.stringify(post);
        if (s.includes(file) || s.includes(url)) {
          used.push({
            type: 'Post',
            title: post.title || post.slug,
            path: `/blog/${post.slug}`
          });
        }
      }
    }

    // 3. Header / Footer & Templates
    if (Array.isArray(templatesData)) {
      for (const t of templatesData) {
        const s = JSON.stringify(t);
        if (s.includes(file) || s.includes(url)) {
          used.push({
            type: 'Template',
            title: t.name || 'Header/Footer Template',
            path: '/template-editor'
          });
        }
      }
    }

    // 4. Popups
    if (Array.isArray(popupsData)) {
      for (const pop of popupsData) {
        const s = JSON.stringify(pop);
        if (s.includes(file) || s.includes(url)) {
          used.push({
            type: 'Popup',
            title: pop.title || 'Popup',
            path: '/popup-editor'
          });
        }
      }
    }

    // 5. Blog Layouts
    if (Array.isArray(blogLayoutsData)) {
      for (const layout of blogLayoutsData) {
        const s = JSON.stringify(layout);
        if (s.includes(file) || s.includes(url)) {
          used.push({
            type: 'Layout',
            title: layout.name || 'Blog Layout',
            path: '/blog-layout-editor'
          });
        }
      }
    }

    // 6. Site Config
    if (siteConfig && typeof siteConfig === 'object') {
      const s = JSON.stringify(siteConfig);
      if (s.includes(file) || s.includes(url)) {
        used.push({
          type: 'Site Config',
          title: 'Brand / Logo / Favicon',
          path: '/editor'
        });
      }
    }

    // 7. Products
    if (Array.isArray(productsData)) {
      for (const prod of productsData) {
        const s = JSON.stringify(prod);
        if (s.includes(file) || s.includes(url)) {
          used.push({
            type: 'Product',
            title: prod.title || prod.slug,
            path: `/products/${prod.slug}`
          });
        }
      }
    }

    usageMap[file] = used;
  }

  return usageMap;
}

async function ensureUploadDir() {
  try {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
  } catch {}
}

function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// GET: Ambil daftar seluruh file gambar yang ada di public/uploads
export const GET: APIRoute = async () => {
  try {
    await ensureUploadDir();
    const files = await fs.readdir(UPLOADS_DIR);
    const validImageFiles = files.filter(f => ALLOWED_EXTS.includes(path.extname(f).toLowerCase()));

    // Scan where each image is used across pages, posts, templates, popups
    const usageMap = await scanImageUsage(validImageFiles);

    const mediaList = [];
    for (const file of validImageFiles) {
      try {
        const filePath = path.join(UPLOADS_DIR, file);
        const stats = await fs.stat(filePath);
        if (stats.isFile()) {
          const usedIn = usageMap[file] || [];
          mediaList.push({
            fileName: file,
            url: `/uploads/${file}`,
            bytes: stats.size,
            size: formatBytes(stats.size),
            createdAt: stats.mtime.toISOString(),
            formattedDate: new Date(stats.mtime).toLocaleString('en-US', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }),
            usedIn,
            usageCount: usedIn.length,
            isUsed: usedIn.length > 0,
          });
        }
      } catch {}
    }

    // Sort newest first
    mediaList.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return new Response(JSON.stringify(mediaList), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to read uploads folder.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// POST: Upload new image file (FormData or JSON Base64)
export const POST: APIRoute = async ({ request }) => {
  try {
    await ensureUploadDir();

    let fileName = '';
    let buffer: Buffer | null = null;

    const contentType = request.headers.get('content-type') || '';

    // A. Handle Multipart FormData
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = (formData.get('file') || formData.get('image')) as File | null;

      if (!file || typeof file === 'string') {
        return new Response(
          JSON.stringify({ success: false, error: 'Image file was not found in form data.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      fileName = file.name || 'image.jpg';
      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } 
    // B. Handle JSON Payload (Base64)
    else {
      const text = await request.text();
      let body: any = {};
      if (text) {
        body = JSON.parse(text);
      }

      const rawFileName = body.fileName || 'image.jpg';
      const fileData = body.fileData; // data:image/...;base64,...

      if (!fileData) {
        return new Response(
          JSON.stringify({ success: false, error: 'Base64 image data is required.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      fileName = rawFileName;
      const base64Data = fileData.replace(/^data:image\/\w+;base64,/, '');
      buffer = Buffer.from(base64Data, 'base64');
    }

    // Validate extension
    const ext = path.extname(fileName).toLowerCase();
    if (!ALLOWED_EXTS.includes(ext)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `File format "${ext}" is not supported. Supported image formats: ${ALLOWED_EXTS.join(', ')}`,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate file size (max 200 KB)
    if (buffer && buffer.length > MAX_IMAGE_SIZE) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Image "${fileName}" exceeds the 200 KB limit (${formatBytes(buffer.length)}). Maximum allowed size is 200 KB.`,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create safe & unique file name
    const baseName = path.basename(fileName, ext)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 30);
    const uniqueFileName = `${Date.now()}-${baseName}${ext}`;
    const targetFilePath = path.join(UPLOADS_DIR, uniqueFileName);

    await fs.writeFile(targetFilePath, buffer);

    const publicUrl = `/uploads/${uniqueFileName}`;

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Image successfully uploaded to project!',
        url: publicUrl,
        fileName: uniqueFileName,
        data: [publicUrl],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to upload image.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// DELETE: Remove image file from public/uploads
export const DELETE: APIRoute = async ({ url }) => {
  try {
    const rawFileName = url.searchParams.get('fileName') || url.searchParams.get('file');
    if (!rawFileName) {
      return new Response(
        JSON.stringify({ success: false, error: 'Parameter fileName is required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Protect against path traversal
    const safeFileName = path.basename(rawFileName);
    const targetPath = path.join(UPLOADS_DIR, safeFileName);

    try {
      await fs.unlink(targetPath);
      return new Response(
        JSON.stringify({ success: true, message: `File "${safeFileName}" successfully deleted from server.` }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: 'File not found or already deleted.' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to delete file.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
