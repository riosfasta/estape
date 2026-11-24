import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { defaultProductLayouts, type ProductLayout } from '../../data/product-layouts';
import { getProducts, getProductCategoriesArray, type Product } from '../../data/products';

export const prerender = false;

const PRODUCT_LAYOUTS_FILE = path.join(process.cwd(), 'src', 'data', 'product-layouts.json');
const PRODUCTS_FILE = path.join(process.cwd(), 'src', 'data', 'products.json');

async function readLayouts(): Promise<ProductLayout[]> {
  try {
    const raw = await fs.readFile(PRODUCT_LAYOUTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  return JSON.parse(JSON.stringify(defaultProductLayouts));
}

async function writeLayouts(layouts: ProductLayout[]): Promise<void> {
  await fs.writeFile(PRODUCT_LAYOUTS_FILE, JSON.stringify(layouts, null, 2), 'utf-8');
}

async function readProducts(): Promise<Product[]> {
  try {
    const raw = await fs.readFile(PRODUCTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  return getProducts();
}

async function writeProducts(list: Product[]): Promise<void> {
  await fs.writeFile(PRODUCTS_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

export const GET: APIRoute = async ({ url }) => {
  try {
    const layouts = await readLayouts();
    const products = await readProducts();
    const id = url.searchParams.get('id');

    if (id) {
      const found = layouts.find((l) => l.id === id);
      if (!found) {
        return new Response(JSON.stringify({ success: false, error: 'Product layout not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true, layout: found }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const defaultLayoutId = layouts.find((l) => l.isDefault)?.id || layouts[0]?.id;
    const productsSummary = products.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      image: p.image,
      price: p.price,
      currency: p.currency,
      category: getProductCategoriesArray(p).join(', '),
      layoutMode: p.layoutMode || 'standard',
      layoutId:
        p.layoutId ||
        layouts.find((l) => l.appliedProductSlugs?.includes(p.slug))?.id ||
        defaultLayoutId,
    }));

    return new Response(
      JSON.stringify({
        success: true,
        layouts,
        products: productsSummary,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Failed to read product layouts' }), {
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

    const action = body.action || 'save';
    let layouts = await readLayouts();
    let products = await readProducts();
    const now = new Date().toISOString();

    if (action === 'save') {
      const layoutData = body.layout;
      if (!layoutData || !layoutData.id) {
        return new Response(JSON.stringify({ success: false, error: 'Missing layout data or ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const idx = layouts.findIndex((l) => l.id === layoutData.id);
      if (idx >= 0) {
        layouts[idx] = { ...layouts[idx], ...layoutData, updatedAt: now };
      } else {
        layouts.push({ ...layoutData, createdAt: now, updatedAt: now });
      }

      if (layoutData.isDefault) {
        layouts.forEach((l) => {
          if (l.id !== layoutData.id) l.isDefault = false;
        });
      }

      await writeLayouts(layouts);
      const saved = idx >= 0 ? layouts[idx] : layouts[layouts.length - 1];

      return new Response(
        JSON.stringify({
          success: true,
          message: `Product layout "${saved.name || 'Layout'}" saved!`,
          layout: saved,
          layouts,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'create') {
      const name = String(body.name || 'Custom Product Layout').trim();
      const rawId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'product-layout';
      const newId = `prod-layout-${rawId}-${Date.now().toString(36)}`;

      const baseLayout = body.templateId ? layouts.find((l) => l.id === body.templateId) : null;
      const newLayout: ProductLayout = {
        id: newId,
        name,
        description: String(body.description || 'Custom standard layout for single product pages').trim(),
        isDefault: Boolean(body.isDefault),
        appliedProductSlugs: Array.isArray(body.appliedProductSlugs) ? body.appliedProductSlugs : [],
        html: baseLayout?.html || defaultProductLayouts[0].html,
        css: baseLayout?.css || defaultProductLayouts[0].css,
        projectData: baseLayout?.projectData || null,
        createdAt: now,
        updatedAt: now,
      };

      if (newLayout.isDefault) {
        layouts.forEach((l) => {
          l.isDefault = false;
        });
      }
      layouts.push(newLayout);

      if (newLayout.appliedProductSlugs.length > 0) {
        products = products.map((p) =>
          newLayout.appliedProductSlugs.includes(p.slug)
            ? { ...p, layoutMode: 'standard', layoutId: newLayout.id }
            : p
        );
        await writeProducts(products);
      }

      await writeLayouts(layouts);

      return new Response(
        JSON.stringify({
          success: true,
          message: `Layout "${newLayout.name}" created!`,
          layout: newLayout,
          layouts,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'duplicate') {
      const source = layouts.find((l) => l.id === body.id);
      if (!source) {
        return new Response(JSON.stringify({ success: false, error: 'Source layout not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const cloned: ProductLayout = {
        ...JSON.parse(JSON.stringify(source)),
        id: `prod-layout-${Math.random().toString(36).slice(2, 9)}`,
        name: `${source.name} (Copy)`,
        isDefault: false,
        appliedProductSlugs: [],
        createdAt: now,
        updatedAt: now,
      };

      layouts.push(cloned);
      await writeLayouts(layouts);

      return new Response(
        JSON.stringify({
          success: true,
          message: `Duplicated "${source.name}"`,
          layout: cloned,
          layouts,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'apply_products') {
      const layoutId = body.layoutId;
      const slugs: string[] = Array.isArray(body.slugs) ? body.slugs : [];
      const makeDefault = Boolean(body.isDefault);

      const targetLayout = layouts.find((l) => l.id === layoutId);
      if (!targetLayout) {
        return new Response(JSON.stringify({ success: false, error: 'Layout not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      targetLayout.appliedProductSlugs = slugs;
      targetLayout.updatedAt = now;
      if (makeDefault) {
        targetLayout.isDefault = true;
        layouts.forEach((l) => {
          if (l.id !== layoutId) l.isDefault = false;
        });
      }

      layouts.forEach((l) => {
        if (l.id !== layoutId) {
          l.appliedProductSlugs = (l.appliedProductSlugs || []).filter((s) => !slugs.includes(s));
        }
      });

      const defaultLayout = layouts.find((l) => l.isDefault) || layouts[0];
      products = products.map((p) => {
        if (slugs.includes(p.slug)) {
          return { ...p, layoutMode: 'standard', layoutId };
        }
        if (p.layoutId === layoutId) {
          return { ...p, layoutMode: 'standard', layoutId: defaultLayout.id };
        }
        return p;
      });

      await writeLayouts(layouts);
      await writeProducts(products);

      return new Response(
        JSON.stringify({
          success: true,
          message: `Layout applied to ${slugs.length} product${slugs.length === 1 ? '' : 's'}!`,
          layout: targetLayout,
          layouts,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'delete') {
      const id = body.id;
      if (layouts.length <= 1) {
        return new Response(JSON.stringify({ success: false, error: 'Cannot delete the only remaining product layout.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const target = layouts.find((l) => l.id === id);
      if (!target) {
        return new Response(JSON.stringify({ success: false, error: 'Layout not found.' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      layouts = layouts.filter((l) => l.id !== id);
      if (target.isDefault && layouts.length > 0) {
        layouts[0].isDefault = true;
      }

      const newDefault = layouts.find((l) => l.isDefault) || layouts[0];
      products = products.map((p) => (p.layoutId === id ? { ...p, layoutId: newDefault.id } : p));
      if (Array.isArray(target.appliedProductSlugs) && target.appliedProductSlugs.length > 0) {
        newDefault.appliedProductSlugs = Array.from(
          new Set([...(newDefault.appliedProductSlugs || []), ...target.appliedProductSlugs])
        );
      }

      await writeLayouts(layouts);
      await writeProducts(products);

      return new Response(
        JSON.stringify({
          success: true,
          message: `Layout "${target.name}" deleted.`,
          layouts,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ success: false, error: 'Invalid action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Product layout operation failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
