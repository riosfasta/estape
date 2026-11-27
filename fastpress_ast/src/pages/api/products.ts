import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { defaultProducts, getProductCategoriesArray, type Product } from '../../data/products';
import { defaultProductLayouts, type ProductLayout } from '../../data/product-layouts';
import { slugifyCategory } from '../../data/product-categories';

import { getDataFile } from '../../core/tenantContext';
export const prerender = false;


const DEFAULT_PRODUCT_IMAGE =
  'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=80';

function slugifyProduct(input: string): string {
  return String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function cleanEditorCss(rawCss: string): string {
  if (!rawCss) return '';
  return rawCss
    .replace(/@media\s*\(\s*max-width:\s*100%\s*\)\s*\{([^}]*)\}/gi, '$1')
    .replace(/border-(top|right|bottom|left)-(width|style|color):\s*(1px|dashed|rgba\(156,\s*163,\s*175,\s*0\.4\));?/gi, '')
    .replace(/border:\s*1px\s+dashed\s+rgba\(156,\s*163,\s*175,\s*0\.4\);?/gi, '')
    .replace(/border-image-[^:]+:[^;]+;?/gi, '');
}

function normalizeCategoriesInput(
  categoriesInput: unknown,
  categoryInput: unknown
): { category: string; categories: string[]; categorySlugs: string[] } {
  let list: string[] = [];

  if (Array.isArray(categoriesInput)) {
    list = categoriesInput.map((c) => String(c).trim()).filter(Boolean);
  } else if (typeof categoriesInput === 'string' && categoriesInput.trim()) {
    list = categoriesInput
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
  } else if (typeof categoryInput === 'string' && categoryInput.trim()) {
    list = categoryInput
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
  }

  // Deduplicate case-insensitively while preserving order
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const item of list) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }

  if (unique.length === 0) {
    unique.push('Uncategorized');
  }

  return {
    category: unique[0] || 'Uncategorized',
    categories: unique,
    categorySlugs: unique.map((c) => slugifyCategory(c)),
  };
}

function normalizeTagsInput(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

async function readProducts(): Promise<Product[]> {
  try {
    const raw = await fs.readFile(getDataFile('products.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {}
  return JSON.parse(JSON.stringify(defaultProducts));
}

async function writeProducts(list: Product[]): Promise<void> {
  await fs.writeFile(getDataFile('products.json'), JSON.stringify(list, null, 2), 'utf-8');
}

async function readLayouts(): Promise<ProductLayout[]> {
  try {
    const raw = await fs.readFile(getDataFile('product-layouts.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {}
  return JSON.parse(JSON.stringify(defaultProductLayouts));
}

async function writeLayouts(layouts: ProductLayout[]): Promise<void> {
  await fs.writeFile(getDataFile('product-layouts.json'), JSON.stringify(layouts, null, 2), 'utf-8');
}

async function syncProductLayoutSlugs(params: {
  oldSlug?: string;
  newSlug?: string;
  layoutId?: string;
  layoutMode?: 'standard' | 'blank';
  removeOnly?: boolean;
}): Promise<void> {
  const { oldSlug, newSlug, layoutId, layoutMode, removeOnly } = params;
  if (!oldSlug && !newSlug) return;

  const layouts = await readLayouts();
  let modified = false;

  for (const layout of layouts) {
    const current = Array.isArray(layout.appliedProductSlugs) ? [...layout.appliedProductSlugs] : [];
    const next = current.filter((s) => s !== oldSlug && s !== newSlug);

    if (!removeOnly && newSlug && layoutMode !== 'blank' && layoutId && layout.id === layoutId) {
      if (!next.includes(newSlug)) {
        next.push(newSlug);
      }
    }

    if (next.length !== current.length || next.some((v, idx) => current[idx] !== v)) {
      layout.appliedProductSlugs = next;
      layout.updatedAt = new Date().toISOString();
      modified = true;
    }
  }

  if (modified) {
    await writeLayouts(layouts);
  }
}

export const GET: APIRoute = async ({ url }) => {
  try {
    const query = url.searchParams.get('slug') || url.searchParams.get('id');
    const products = await readProducts();

    if (query) {
      const found = products.find((p) => p.slug === query || p.id === query);
      if (!found) {
        return new Response(JSON.stringify({ error: 'Product not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(found), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(products), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Failed to read products' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const products = await readProducts();
    const action = body.action || 'save';

    // 1. Create a new product
    if (action === 'create') {
      const title = String(body.title || 'New Product').trim() || 'New Product';
      let rawSlug = slugifyProduct(body.slug || title);
      if (!rawSlug) {
        rawSlug = `product-${Date.now()}`;
      }

      if (products.some((p) => p.slug === rawSlug)) {
        return new Response(
          JSON.stringify({ success: false, error: `A product with slug "${rawSlug}" already exists.` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const layouts = await readLayouts();
      const defaultLayoutId = layouts.find((l) => l.isDefault)?.id || layouts[0]?.id || 'standard-product-default';
      const resolvedCats = normalizeCategoriesInput(body.categories, body.category);
      const tags = normalizeTagsInput(body.tags);
      const now = new Date().toISOString();

      const newProduct: Product = {
        id: `prod-${Date.now()}`,
        slug: rawSlug,
        title,
        subtitle: String(body.subtitle || 'Signature Essential Collection').trim(),
        description: String(
          body.description || 'Concise summary highlighting craftsmanship, materials, and everyday fit.'
        ).trim(),
        content:
          typeof body.content === 'string' && body.content.trim()
            ? body.content
            : `<h3>Product Overview</h3><p>Introduce your product materials, fit, and signature craftsmanship here.</p><ul><li>Premium construction built for daily wear</li><li>True-to-size tailoring with durable stitching</li></ul>`,
        price: Number(body.price ?? 49.0),
        compareAtPrice: body.compareAtPrice ? Number(body.compareAtPrice) : undefined,
        currency: String(body.currency || '$'),
        sku: String(body.sku || `SKU-${String(Date.now()).slice(-6)}`),
        stockStatus:
          body.stockStatus === 'out_of_stock' || body.stockStatus === 'preorder'
            ? body.stockStatus
            : 'in_stock',
        rating: Number(body.rating ?? 5.0),
        reviewsCount: Number(body.reviewsCount ?? 0),
        category: resolvedCats.category,
        categories: resolvedCats.categories,
        categorySlugs: resolvedCats.categorySlugs,
        tags,
        sizes: Array.isArray(body.sizes) ? body.sizes : ['S', 'M', 'L', 'XL'],
        colors: Array.isArray(body.colors)
          ? body.colors
          : [
              { name: 'Obsidian Black', hex: '#18181b' },
              { name: 'Stone Grey', hex: '#71717a' },
            ],
        image: String(body.image || DEFAULT_PRODUCT_IMAGE),
        gallery: Array.isArray(body.gallery) && body.gallery.length > 0
          ? body.gallery
          : [String(body.image || DEFAULT_PRODUCT_IMAGE)],
        buyButton: {
          type: body.buyButton?.type === 'custom_url' ? 'custom_url' : 'whatsapp',
          label: String(body.buyButton?.label || 'Order via WhatsApp'),
          url: String(body.buyButton?.url || '#'),
          whatsappNumber: String(body.buyButton?.whatsappNumber || '6281234567890'),
          whatsappMessage: String(
            body.buyButton?.whatsappMessage ||
              `Hi, I want to order "${title}". Is it currently in stock?`
          ),
          buttonBg: String(body.buyButton?.buttonBg || '#ff5e3a'),
          buttonColor: String(body.buyButton?.buttonColor || '#ffffff'),
          target: body.buyButton?.target === '_self' ? '_self' : '_blank',
        },
        secondaryButton: body.secondaryButton
          ? {
              enabled: body.secondaryButton.enabled !== false,
              type: body.secondaryButton.type === 'custom_url' ? 'custom_url' : 'whatsapp',
              label: String(body.secondaryButton.label || 'Chat / Ask About Fit'),
              url: body.secondaryButton.url || '',
              whatsappNumber: String(body.secondaryButton.whatsappNumber || '6281234567890'),
              whatsappMessage: String(body.secondaryButton.whatsappMessage || ''),
            }
          : {
              enabled: true,
              type: 'whatsapp',
              label: 'Chat / Ask About Fit',
              whatsappNumber: '6281234567890',
              whatsappMessage: `Hi, I have a question about "${title}".`,
            },
        css: cleanEditorCss(String(body.css || '')),
        projectData: body.projectData ?? null,
        keywords: String(body.keywords || tags.join(', ')),
        schema: String(body.schema || ''),
        customCode: body.customCode || undefined,
        showRelated: body.showRelated !== undefined ? Boolean(body.showRelated) : true,
        relatedTagline: String(body.relatedTagline || 'COMPLETE THE LOOK'),
        relatedTitle: String(body.relatedTitle || 'You May Also Like'),
        relatedCategory: String(body.relatedCategory || 'auto'),
        relatedOrderBy: String(body.relatedOrderBy || 'featured'),
        relatedLimit: body.relatedLimit ? Number(body.relatedLimit) : 4,
        relatedHtml: typeof body.relatedHtml === 'string' ? body.relatedHtml : '',
        layoutMode: body.layoutMode === 'blank' ? 'blank' : 'standard',
        layoutId: body.layoutMode === 'blank' ? undefined : String(body.layoutId || defaultLayoutId),
        status: body.status === 'draft' ? 'draft' : 'published',
        featured: Boolean(body.featured),
        createdAt: now,
        updatedAt: now,
      };

      products.unshift(newProduct);
      await writeProducts(products);
      await syncProductLayoutSlugs({
        newSlug: newProduct.slug,
        layoutId: newProduct.layoutId,
        layoutMode: newProduct.layoutMode,
      });

      return new Response(JSON.stringify({ success: true, product: newProduct }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Duplicate an existing product
    if (action === 'duplicate') {
      const targetId = body.id || body.slug;
      const source = products.find((p) => p.id === targetId || p.slug === targetId);
      if (!source) {
        return new Response(JSON.stringify({ success: false, error: 'Source product not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const now = Date.now();
      const newProduct: Product = {
        ...JSON.parse(JSON.stringify(source)),
        id: `prod-${now}`,
        title: `${source.title} (Copy)`,
        slug: `${source.slug}-copy-${String(now).slice(-4)}`,
        sku: `${source.sku || 'SKU'}-CPY`,
        status: 'draft',
        featured: false,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
      };

      products.unshift(newProduct);
      await writeProducts(products);
      await syncProductLayoutSlugs({
        newSlug: newProduct.slug,
        layoutId: newProduct.layoutId,
        layoutMode: newProduct.layoutMode,
      });

      return new Response(JSON.stringify({ success: true, product: newProduct }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Save / Create via payload
    const targetIdentifier = String(body.id || body.slug || '').trim();
    const index = targetIdentifier
      ? products.findIndex((p) => p.id === targetIdentifier || p.slug === targetIdentifier)
      : -1;

    if (index === -1 && !body.slug && !body.title) {
      return new Response(JSON.stringify({ success: false, error: 'Product slug or ID is required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const now = new Date().toISOString();

    if (index >= 0) {
      const existing = products[index];
      const previousSlug = existing.slug;

      let resolvedSlug = existing.slug;
      const requestedSlug = body.newSlug || (body.slug && body.slug !== existing.slug ? body.slug : '');
      if (requestedSlug) {
        const cleanSlug = slugifyProduct(requestedSlug);
        if (!cleanSlug) {
          return new Response(JSON.stringify({ success: false, error: 'Invalid product slug.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (products.some((p, i) => i !== index && p.slug === cleanSlug)) {
          return new Response(
            JSON.stringify({ success: false, error: `Slug "${cleanSlug}" is already used by another product.` }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
        resolvedSlug = cleanSlug;
      }

      const resolvedCats =
        body.categories !== undefined || body.category !== undefined
          ? normalizeCategoriesInput(body.categories ?? getProductCategoriesArray(existing), body.category)
          : normalizeCategoriesInput(existing.categories, existing.category);

      const finalCss = body.css !== undefined ? cleanEditorCss(String(body.css || '')) : existing.css || '';

      const updatedProduct: Product = {
        ...existing,
        ...body,
        id: existing.id,
        slug: resolvedSlug,
        category: resolvedCats.category,
        categories: resolvedCats.categories,
        categorySlugs: Array.isArray(body.categorySlugs) ? body.categorySlugs : resolvedCats.categorySlugs,
        tags: body.tags !== undefined ? normalizeTagsInput(body.tags) : existing.tags || [],
        price: body.price !== undefined ? Number(body.price) : existing.price,
        compareAtPrice:
          body.compareAtPrice !== undefined && body.compareAtPrice !== '' && body.compareAtPrice !== null
            ? Number(body.compareAtPrice)
            : body.compareAtPrice === '' || body.compareAtPrice === null
              ? undefined
              : existing.compareAtPrice,
        rating: body.rating !== undefined ? Number(body.rating) : existing.rating,
        reviewsCount: body.reviewsCount !== undefined ? Number(body.reviewsCount) : existing.reviewsCount,
        css: finalCss,
        layoutMode: body.layoutMode === 'blank' ? 'blank' : body.layoutMode === 'standard' ? 'standard' : existing.layoutMode || 'standard',
        layoutId: body.layoutId !== undefined ? (body.layoutId || undefined) : existing.layoutId,
        schema: body.schema !== undefined ? String(body.schema).trim() : existing.schema,
        keywords: body.keywords !== undefined ? String(body.keywords) : existing.keywords,
        showRelated: body.showRelated !== undefined ? Boolean(body.showRelated) : existing.showRelated,
        relatedTagline: body.relatedTagline !== undefined ? String(body.relatedTagline) : existing.relatedTagline,
        relatedTitle: body.relatedTitle !== undefined ? String(body.relatedTitle) : existing.relatedTitle,
        relatedCategory: body.relatedCategory !== undefined ? String(body.relatedCategory) : existing.relatedCategory,
        relatedOrderBy: body.relatedOrderBy !== undefined ? String(body.relatedOrderBy) : existing.relatedOrderBy,
        relatedLimit: body.relatedLimit !== undefined ? Number(body.relatedLimit) : existing.relatedLimit,
        relatedHtml: body.relatedHtml !== undefined ? String(body.relatedHtml) : existing.relatedHtml,
        updatedAt: now,
      };
      delete (updatedProduct as any).newSlug;
      delete (updatedProduct as any).action;

      if (body.customCode !== undefined) {
        updatedProduct.customCode = {
          headScripts: typeof body.customCode?.headScripts === 'string' ? body.customCode.headScripts : '',
          bodyStartScripts: typeof body.customCode?.bodyStartScripts === 'string' ? body.customCode.bodyStartScripts : '',
          customCss: typeof body.customCode?.customCss === 'string' ? body.customCode.customCss : '',
          bodyEndScripts:
            typeof body.customCode?.bodyEndScripts === 'string'
              ? body.customCode.bodyEndScripts
              : typeof body.customCode?.bodyScripts === 'string'
                ? body.customCode.bodyScripts
                : '',
          bodyScripts:
            typeof body.customCode?.bodyEndScripts === 'string'
              ? body.customCode.bodyEndScripts
              : typeof body.customCode?.bodyScripts === 'string'
                ? body.customCode.bodyScripts
                : '',
        };
      }

      products[index] = updatedProduct;
      await writeProducts(products);

      if (body.layoutId !== undefined || body.layoutMode !== undefined || resolvedSlug !== previousSlug) {
        await syncProductLayoutSlugs({
          oldSlug: previousSlug,
          newSlug: resolvedSlug,
          layoutId: updatedProduct.layoutId,
          layoutMode: updatedProduct.layoutMode,
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: `Product "${updatedProduct.title}" saved successfully!`,
          product: updatedProduct,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Fallback upsert create if no existing ID matched
    const cleanSlug = slugifyProduct(body.slug || body.title || `product-${Date.now()}`);
    if (products.some((p) => p.slug === cleanSlug)) {
      return new Response(
        JSON.stringify({ success: false, error: `Slug "${cleanSlug}" already exists.` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const resolvedCats = normalizeCategoriesInput(body.categories, body.category);
    const createdProduct: Product = {
      ...body,
      id: body.id || `prod-${Date.now()}`,
      slug: cleanSlug,
      title: body.title || 'Untitled Product',
      category: resolvedCats.category,
      categories: resolvedCats.categories,
      categorySlugs: resolvedCats.categorySlugs,
      tags: normalizeTagsInput(body.tags),
      price: Number(body.price || 0),
      currency: body.currency || '$',
      rating: Number(body.rating || 5),
      reviewsCount: Number(body.reviewsCount || 0),
      image: body.image || DEFAULT_PRODUCT_IMAGE,
      gallery: Array.isArray(body.gallery) ? body.gallery : [body.image || DEFAULT_PRODUCT_IMAGE],
      css: cleanEditorCss(String(body.css || '')),
      layoutMode: body.layoutMode === 'blank' ? 'blank' : 'standard',
      status: body.status || 'published',
      createdAt: now,
      updatedAt: now,
    };
    delete (createdProduct as any).action;

    products.unshift(createdProduct);
    await writeProducts(products);
    await syncProductLayoutSlugs({
      newSlug: createdProduct.slug,
      layoutId: createdProduct.layoutId,
      layoutMode: createdProduct.layoutMode,
    });

    return new Response(JSON.stringify({ success: true, product: createdProduct }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Failed to save product' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ url }) => {
  try {
    const id = url.searchParams.get('id') || url.searchParams.get('slug');
    if (!id) {
      return new Response(JSON.stringify({ success: false, error: 'Missing product id or slug' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const products = await readProducts();
    const target = products.find((p) => p.id === id || p.slug === id);
    if (!target) {
      return new Response(JSON.stringify({ success: false, error: 'Product not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const filtered = products.filter((p) => p.id !== target.id);
    await writeProducts(filtered);
    await syncProductLayoutSlugs({ oldSlug: target.slug, removeOnly: true });

    return new Response(JSON.stringify({ success: true, message: 'Product deleted.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Failed to delete product' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
