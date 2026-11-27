import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getDataFile } from '../../core/tenantContext';
export const prerender = false;

const FONTS_DIR = path.join(process.cwd(), 'public', 'fonts');

interface CustomFont {
  id: string;
  name: string;
  family: string;
  type: 'upload' | 'google';
  url: string;
  fileName?: string;
  format?: string;
  weight?: string;
  style?: string;
  createdAt?: string;
}

async function readFonts(): Promise<CustomFont[]> {
  try {
    const raw = await fs.readFile(getDataFile('fonts.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    const defaults: CustomFont[] = [
      {
        id: 'plus-jakarta-sans',
        name: 'Plus Jakarta Sans',
        family: 'Plus Jakarta Sans',
        type: 'google',
        url: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap',
      },
      {
        id: 'montserrat',
        name: 'Montserrat',
        family: 'Montserrat',
        type: 'google',
        url: 'https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&display=swap',
      },
    ];
    await fs.writeFile(getDataFile('fonts.json'), JSON.stringify(defaults, null, 2), 'utf-8');
    return defaults;
  }
}

async function writeFonts(fonts: CustomFont[]) {
  await fs.writeFile(getDataFile('fonts.json'), JSON.stringify(fonts, null, 2), 'utf-8');
}

export const GET: APIRoute = async () => {
  try {
    const fonts = await readFonts();
    return new Response(JSON.stringify(fonts), {
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
    const body = await request.json();
    const action = body.action || 'upload';
    const fonts = await readFonts();

    // 1. Upload file font (.woff2, .woff, .ttf, .otf)
    if (action === 'upload') {
      const rawName = (body.name || '').trim();
      const rawFileName = (body.fileName || '').trim();
      const fileData = body.fileData; // base64 string

      if (!rawName) {
        return new Response(JSON.stringify({ success: false, error: 'Font Family Name is required.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!fileData || !rawFileName) {
        return new Response(JSON.stringify({ success: false, error: 'Font file data is missing.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const ext = path.extname(rawFileName).toLowerCase();
      const allowedExts = ['.woff2', '.woff', '.ttf', '.otf'];
      if (!allowedExts.includes(ext)) {
        return new Response(
          JSON.stringify({ success: false, error: 'Only .woff2, .woff, .ttf, and .otf font formats are supported.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      let format = 'woff2';
      if (ext === '.woff') format = 'woff';
      else if (ext === '.ttf') format = 'truetype';
      else if (ext === '.otf') format = 'opentype';

      // Sanitasi nama file & buat ID unik
      const slug = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const safeBaseName = rawFileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeFileName = `${safeBaseName}_${Date.now()}${ext}`;

      // Buat folder public/fonts jika belum ada
      await fs.mkdir(FONTS_DIR, { recursive: true });

      // Simpan buffer file
      const base64Data = fileData.includes('base64,') ? fileData.split('base64,')[1] : fileData;
      const buffer = Buffer.from(base64Data, 'base64');
      const targetPath = path.join(FONTS_DIR, safeFileName);
      await fs.writeFile(targetPath, buffer);

      const newFont: CustomFont = {
        id: slug || `font-${Date.now()}`,
        name: rawName,
        family: rawName,
        type: 'upload',
        fileName: safeFileName,
        url: `/fonts/${safeFileName}`,
        format: format,
        weight: body.weight || 'normal',
        style: body.style || 'normal',
        createdAt: new Date().toISOString(),
      };

      // Cek apakah ID sudah ada, replace jika ya, atau append
      const existingIdx = fonts.findIndex(f => f.id === newFont.id);
      if (existingIdx >= 0) {
        fonts[existingIdx] = newFont;
      } else {
        fonts.push(newFont);
      }

      await writeFonts(fonts);

      return new Response(JSON.stringify({ success: true, font: newFont, fonts }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Tambah Google Font
    if (action === 'google') {
      const rawName = (body.name || '').trim();
      if (!rawName) {
        return new Response(JSON.stringify({ success: false, error: 'Google Font name is required.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const slug = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const encodedName = encodeURIComponent(rawName).replace(/%20/g, '+');
      const googleUrl = `https://fonts.googleapis.com/css2?family=${encodedName}:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&display=swap`;

      const newFont: CustomFont = {
        id: slug,
        name: rawName,
        family: rawName,
        type: 'google',
        url: googleUrl,
        createdAt: new Date().toISOString(),
      };

      const existingIdx = fonts.findIndex(f => f.id === newFont.id);
      if (existingIdx >= 0) {
        fonts[existingIdx] = newFont;
      } else {
        fonts.push(newFont);
      }

      await writeFonts(fonts);

      return new Response(JSON.stringify({ success: true, font: newFont, fonts }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Hapus Font Kustom
    if (action === 'delete') {
      const fontId = (body.id || '').trim();
      if (!fontId) {
        return new Response(JSON.stringify({ success: false, error: 'Font ID is required.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const targetFont = fonts.find(f => f.id === fontId);
      if (!targetFont) {
        return new Response(JSON.stringify({ success: false, error: 'Font not found.' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Hapus file fisik jika bertipe upload
      if (targetFont.type === 'upload' && targetFont.fileName) {
        try {
          const filePath = path.join(FONTS_DIR, targetFont.fileName);
          await fs.unlink(filePath);
        } catch {}
      }

      const updatedFonts = fonts.filter(f => f.id !== fontId);
      await writeFonts(updatedFonts);

      return new Response(JSON.stringify({ success: true, fonts: updatedFonts }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: false, error: 'Unknown action.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
