import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';

export const prerender = false;

const CUSTOM_CODE_FILE = path.join(process.cwd(), 'src', 'data', 'customCode.json');

const DEFAULT_CODE = {
  headScripts: '',
  bodyStartScripts: '',
  bodyEndScripts: '',
  bodyScripts: '',
  customCss: '',
};

async function readCustomCode() {
  try {
    const raw = await fs.readFile(CUSTOM_CODE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    const bodyEnd = typeof parsed.bodyEndScripts === 'string' ? parsed.bodyEndScripts : (typeof parsed.bodyScripts === 'string' ? parsed.bodyScripts : '');
    return {
      headScripts: typeof parsed.headScripts === 'string' ? parsed.headScripts : '',
      bodyStartScripts: typeof parsed.bodyStartScripts === 'string' ? parsed.bodyStartScripts : '',
      bodyEndScripts: bodyEnd,
      bodyScripts: bodyEnd,
      customCss: typeof parsed.customCss === 'string' ? parsed.customCss : '',
    };
  } catch {
    return DEFAULT_CODE;
  }
}

async function writeCustomCode(data: { headScripts: string; bodyStartScripts: string; bodyEndScripts: string; bodyScripts: string; customCss: string }) {
  await fs.writeFile(CUSTOM_CODE_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export const GET: APIRoute = async () => {
  try {
    const data = await readCustomCode();
    return new Response(JSON.stringify({ success: true, data }), {
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

    const current = await readCustomCode();
    const bodyEndVal = body.bodyEndScripts !== undefined ? String(body.bodyEndScripts) : (body.bodyScripts !== undefined ? String(body.bodyScripts) : current.bodyEndScripts);

    const updated = {
      headScripts: body.headScripts !== undefined ? String(body.headScripts) : current.headScripts,
      bodyStartScripts: body.bodyStartScripts !== undefined ? String(body.bodyStartScripts) : current.bodyStartScripts,
      bodyEndScripts: bodyEndVal,
      bodyScripts: bodyEndVal,
      customCss: body.customCss !== undefined ? String(body.customCss) : current.customCss,
    };

    await writeCustomCode(updated);

    return new Response(JSON.stringify({ success: true, message: 'Custom code saved successfully', data: updated }), {
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
