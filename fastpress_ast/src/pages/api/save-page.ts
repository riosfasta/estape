import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getDataFile } from '../../core/tenantContext';
export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const filePath = getDataFile('savedHomepage.json');
    const content = await fs.readFile(filePath, 'utf-8');
    return new Response(content, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ isCustom: false, html: '', css: '', projectData: null }), {
      status: 200,
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

    const filePath = getDataFile('savedHomepage.json');
    
    await fs.writeFile(
      filePath,
      JSON.stringify(
        {
          isCustom: body.isCustom !== undefined ? body.isCustom : true,
          html: body.html || '',
          css: body.css || '',
          projectData: body.projectData || null,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      'utf-8'
    );

    return new Response(JSON.stringify({ success: true, message: 'Halaman utama berhasil diperbarui!' }), {
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
