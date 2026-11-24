import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  defaultProductCategories,
  slugifyCategory,
  type ProductCategory,
} from '../../data/product-categories';
import { defaultProducts, getProductCategoriesArray, type Product } from '../../data/products';

export const prerender = false;

const CATEGORIES_FILE = path.join(process.cwd(), 'src', 'data', 'product-categories.json');
const PRODUCTS_FILE = path.join(process.cwd(), 'src', 'data', 'products.json');

async function readCategories(): Promise<ProductCategory[]> {
  try {
    const raw = await fs.readFile(CATEGORIES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {}
  return [...defaultProductCategories];
}

async function writeCategories(list: ProductCategory[]): Promise<void> {
  await fs.writeFile(CATEGORIES_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

async function readProducts(): Promise<Product[]> {
  try {
    const raw = await fs.readFile(PRODUCTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {}
  return [...defaultProducts];
}

async function writeProducts(list: Product[]): Promise<void> {
  await fs.writeFile(PRODUCTS_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

export const GET: APIRoute = async () => {
  try {
    const categories = await readCategories();
    return new Response(JSON.stringify(categories), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Failed to read product categories' }), {
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

    if (action === 'create') {
      const name = String(body.name || '').trim();
      if (!name) {
        return new Response(
          JSON.stringify({ success: false, error: 'Category name is required.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const slug = slugifyCategory(body.slug || name);
      if (categories.some((c) => c.slug.toLowerCase() === slug.toLowerCase() || c.name.toLowerCase() === name.toLowerCase())) {
        return new Response(
          JSON.stringify({ success: false, error: `Category "${name}" or slug "${slug}" already exists.` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const newCategory: ProductCategory = {
        id: slug,
        name,
        slug,
        description: String(body.description || '').trim(),
      };

      categories.push(newCategory);
      await writeCategories(categories);

      return new Response(
        JSON.stringify({
          success: true,
          message: `Product category "${name}" created!`,
          category: newCategory,
          categories,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'rename') {
      const targetSlug = String(body.slug || body.id || '').trim().toLowerCase();
      const newName = String(body.newName || body.name || '').trim();
      if (!targetSlug || !newName) {
        return new Response(
          JSON.stringify({ success: false, error: 'Target category and new name are required.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const catIdx = categories.findIndex(
        (c) => c.slug.toLowerCase() === targetSlug || c.id.toLowerCase() === targetSlug
      );
      if (catIdx === -1) {
        return new Response(
          JSON.stringify({ success: false, error: 'Category not found.' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const oldName = categories[catIdx].name;
      if (oldName.toLowerCase() === 'uncategorized') {
        return new Response(
          JSON.stringify({ success: false, error: 'The default "Uncategorized" category cannot be renamed.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (categories.some((c, i) => i !== catIdx && c.name.toLowerCase() === newName.toLowerCase())) {
        return new Response(
          JSON.stringify({ success: false, error: `Category "${newName}" already exists.` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const newSlug = slugifyCategory(newName);
      categories[catIdx] = {
        ...categories[catIdx],
        id: newSlug,
        name: newName,
        slug: newSlug,
      };
      await writeCategories(categories);

      // Cascade rename to existing products
      const productsList = await readProducts();
      let updatedCount = 0;
      const oldLower = oldName.toLowerCase();
      for (const prod of productsList) {
        const cats = getProductCategoriesArray(prod);
        if (cats.some((c) => c.toLowerCase() === oldLower)) {
          const renamedCats = Array.from(new Set(cats.map((c) => (c.toLowerCase() === oldLower ? newName : c))));
          prod.categories = renamedCats;
          prod.category = renamedCats.join(', ');
          prod.categorySlugs = renamedCats.map((c) => slugifyCategory(c));
          prod.updatedAt = new Date().toISOString();
          updatedCount++;
        }
      }
      if (updatedCount > 0) {
        await writeProducts(productsList);
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: `Category renamed to "${newName}" (${updatedCount} product(s) updated).`,
          category: categories[catIdx],
          categories,
          updatedProducts: productsList,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'delete') {
      const targetSlug = String(body.slug || body.id || '').trim().toLowerCase();
      if (!targetSlug) {
        return new Response(
          JSON.stringify({ success: false, error: 'Category slug or ID is required.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const catToDelete = categories.find(
        (c) => c.slug.toLowerCase() === targetSlug || c.id.toLowerCase() === targetSlug
      );
      if (!catToDelete) {
        return new Response(
          JSON.stringify({ success: false, error: 'Category not found.' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (catToDelete.slug.toLowerCase() === 'uncategorized' || catToDelete.name.toLowerCase() === 'uncategorized') {
        return new Response(
          JSON.stringify({ success: false, error: 'The default "Uncategorized" category cannot be deleted.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const filtered = categories.filter(
        (c) => c.slug.toLowerCase() !== catToDelete.slug.toLowerCase() && c.id.toLowerCase() !== catToDelete.id.toLowerCase()
      );

      if (!filtered.some((c) => c.slug.toLowerCase() === 'uncategorized')) {
        filtered.unshift({
          id: 'uncategorized',
          name: 'Uncategorized',
          slug: 'uncategorized',
          description: 'Default category for uncategorized products',
        });
      }

      await writeCategories(filtered);

      const productsList = await readProducts();
      let affectedProductsCount = 0;
      let uncategorizedCount = 0;
      const delNameLower = catToDelete.name.toLowerCase();

      for (const prod of productsList) {
        const cats = getProductCategoriesArray(prod);
        if (cats.some((c) => c.toLowerCase() === delNameLower)) {
          const remaining = cats.filter((c) => c.toLowerCase() !== delNameLower);
          if (remaining.length === 0) {
            prod.categories = ['Uncategorized'];
            prod.categorySlugs = ['uncategorized'];
            prod.category = 'Uncategorized';
            uncategorizedCount++;
          } else {
            prod.categories = remaining;
            prod.categorySlugs = remaining.map((c) => slugifyCategory(c));
            prod.category = remaining.join(', ');
          }
          prod.updatedAt = new Date().toISOString();
          affectedProductsCount++;
        }
      }

      if (affectedProductsCount > 0) {
        await writeProducts(productsList);
      }

      const msg = uncategorizedCount > 0
        ? `Category "${catToDelete.name}" deleted. ${uncategorizedCount} product(s) moved to "Uncategorized".`
        : `Category "${catToDelete.name}" deleted successfully.`;

      return new Response(
        JSON.stringify({
          success: true,
          message: msg,
          categories: filtered,
          deletedCategory: catToDelete,
          affectedProductsCount,
          updatedProducts: productsList,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Category operation failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
