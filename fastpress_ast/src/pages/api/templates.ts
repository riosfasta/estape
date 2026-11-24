import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getTemplates, type Template, defaultTemplates } from '../../data/templates';

export const prerender = false;

const TEMPLATES_FILE = path.join(process.cwd(), 'src', 'data', 'templates.json');

async function readTemplates(): Promise<Template[]> {
  try {
    const raw = await fs.readFile(TEMPLATES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  return defaultTemplates;
}

async function writeTemplates(templates: Template[]): Promise<void> {
  await fs.writeFile(TEMPLATES_FILE, JSON.stringify(templates, null, 2), 'utf-8');
}

// GET: fetch all templates or a specific template
export const GET: APIRoute = async ({ url }) => {
  try {
    const id = url.searchParams.get('id');
    const type = url.searchParams.get('type');
    let templates = await readTemplates();

    if (id) {
      const found = templates.find(t => t.id === id);
      if (!found) {
        return new Response(JSON.stringify({ success: false, error: 'Template not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ success: true, template: found }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (type === 'global' || type === 'individual') {
      templates = templates.filter(t => t.type === type);
    }

    return new Response(JSON.stringify({ success: true, templates }), {
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

// POST: create, save, duplicate, delete
export const POST: APIRoute = async ({ request }) => {
  try {
    const text = await request.text();
    let body: any = {};
    if (text && text.trim().length > 0) {
      body = JSON.parse(text);
    }

    const action = body.action || 'save';
    let templates = await readTemplates();
    const now = new Date().toISOString();

    // 1. SAVE EXISTING TEMPLATE
    if (action === 'save') {
      const tplData = body.template;
      if (!tplData || !tplData.id) {
        return new Response(JSON.stringify({ success: false, error: 'Missing template data or ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const idx = templates.findIndex(t => t.id === tplData.id);
      if (idx >= 0) {
        templates[idx] = {
          ...templates[idx],
          ...tplData,
          isCustomized: true,
          updatedAt: now
        };
      } else {
        templates.push({
          ...tplData,
          isCustomized: true,
          createdAt: now,
          updatedAt: now
        });
      }

      await writeTemplates(templates);

      return new Response(JSON.stringify({
        success: true,
        message: `Template "${tplData.name}" saved!`,
        template: idx >= 0 ? templates[idx] : templates[templates.length - 1],
        templates
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 2. CREATE NEW TEMPLATE
    if (action === 'create') {
      const name = (body.name || 'Untitled Template').trim();
      const type = (body.type === 'global' ? 'global' : 'individual');
      const category = (body.category || 'General').trim();
      const rawId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'template';
      const newId = `tpl-${type}-${rawId}-${Date.now().toString(36)}`;

      let initialHtml = body.html;
      if (!initialHtml || !initialHtml.trim()) {
        if (type === 'global') {
          initialHtml = `<div class="global-template-wrapper" data-global-template-id="${newId}" style="padding: 30px 20px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; margin: 20px auto; max-width: 900px; font-family: 'Plus Jakarta Sans', sans-serif;">
  <span style="display: inline-block; font-size: 0.7rem; font-weight: 700; color: #10b981; background: rgba(16,185,129,0.12); padding: 2px 8px; border-radius: 999px; text-transform: uppercase;">GLOBAL TEMPLATE</span>
  <h3 style="font-family: 'Montserrat', sans-serif; font-size: 1.45rem; font-weight: 800; color: #111827; margin: 8px 0 6px 0;">${name}</h3>
  <p style="font-size: 0.92rem; color: #4b5563; line-height: 1.6; margin: 0;">This is a reusable global template. Any modifications made here will automatically synchronize across every page where it is placed.</p>
</div>`;
        } else {
          initialHtml = `<div class="individual-template-wrapper" style="padding: 30px 20px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; margin: 20px auto; max-width: 900px; font-family: 'Plus Jakarta Sans', sans-serif;">
  <span style="display: inline-block; font-size: 0.7rem; font-weight: 700; color: #6366f1; background: rgba(99,102,241,0.12); padding: 2px 8px; border-radius: 999px; text-transform: uppercase;">INDIVIDUAL TEMPLATE</span>
  <h3 style="font-family: 'Montserrat', sans-serif; font-size: 1.45rem; font-weight: 800; color: #111827; margin: 8px 0 6px 0;">${name}</h3>
  <p style="font-size: 0.92rem; color: #4b5563; line-height: 1.6; margin: 0;">This is an individual template. When inserted into any page or post, it acts as an independent copy that can be modified without affecting other pages.</p>
</div>`;
        }
      }

      const newTemplate: Template = {
        id: newId,
        name,
        type,
        category,
        description: body.description || (type === 'global' ? 'Global synchronized template' : 'Independent reusable template'),
        html: initialHtml,
        css: body.css || '',
        projectData: body.projectData || null,
        createdAt: now,
        updatedAt: now
      };

      templates.push(newTemplate);
      await writeTemplates(templates);

      return new Response(JSON.stringify({
        success: true,
        message: `Template "${newTemplate.name}" created!`,
        template: newTemplate,
        templates
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 3. DUPLICATE TEMPLATE
    if (action === 'duplicate') {
      const id = body.id;
      const target = templates.find(t => t.id === id);
      if (!target) {
        return new Response(JSON.stringify({ success: false, error: 'Target template not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const newId = `tpl-${target.type}-${Math.random().toString(36).substring(2, 9)}`;
      let clonedHtml = target.html;
      if (target.type === 'global') {
        // replace old global id with new global id
        clonedHtml = clonedHtml.replace(new RegExp(target.id, 'g'), newId);
      }

      const cloned: Template = {
        ...JSON.parse(JSON.stringify(target)),
        id: newId,
        name: `${target.name} (Copy)`,
        html: clonedHtml,
        createdAt: now,
        updatedAt: now
      };

      templates.push(cloned);
      await writeTemplates(templates);

      return new Response(JSON.stringify({
        success: true,
        message: `Template "${target.name}" duplicated!`,
        template: cloned,
        templates
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 4. DELETE TEMPLATE
    if (action === 'delete') {
      const id = body.id;
      if (!id) {
        return new Response(JSON.stringify({ success: false, error: 'Missing template ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const target = templates.find(t => t.id === id);
      if (!target) {
        return new Response(JSON.stringify({ success: false, error: 'Template not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      templates = templates.filter(t => t.id !== id);
      await writeTemplates(templates);

      return new Response(JSON.stringify({
        success: true,
        message: `Template "${target.name}" deleted.`,
        templates
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), {
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
