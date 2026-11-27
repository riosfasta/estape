import fs from 'node:fs';
import path from 'node:path';

import { getDataFile } from '../core/tenantContext';
export interface ProductCategory {
  id: string;
  name: string;
  slug: string;
  description?: string;
}

export const defaultProductCategories: ProductCategory[] = [
  { id: 'uncategorized', name: 'Uncategorized', slug: 'uncategorized', description: 'Default category for uncategorized products' },
  { id: 't-shirts', name: 'T-Shirts', slug: 't-shirts', description: 'Heavyweight & graphic tees' },
  { id: 'hoodies', name: 'Hoodies', slug: 'hoodies', description: 'French terry & fleece pullovers' },
  { id: 'jackets', name: 'Jackets', slug: 'jackets', description: 'Denim, canvas & structured jackets' },
  { id: 'outerwear', name: 'Outerwear', slug: 'outerwear', description: 'Technical windbreakers & shells' },
  { id: 'pants', name: 'Pants', slug: 'pants', description: 'Cargo pants & tailored trousers' },
  { id: 'shirts', name: 'Shirts', slug: 'shirts', description: 'Camp shirts & overshirts' },
  { id: 'sweatshirts', name: 'Sweatshirts', slug: 'sweatshirts', description: 'Crewnecks & washed pullovers' },
  { id: 'accessories', name: 'Accessories', slug: 'accessories', description: 'Headwear, scarves & essentials' },
];


export function slugifyCategory(input: string): string {
  const clean = String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return clean || `cat-${Date.now()}`;
}

export function getProductCategories(): ProductCategory[] {
  try {
    if (fs.existsSync(getDataFile('product-categories.json'))) {
      const data = fs.readFileSync(getDataFile('product-categories.json'), 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}
  return defaultProductCategories;
}

export function writeProductCategoriesSync(list: ProductCategory[]): void {
  fs.writeFileSync(getDataFile('product-categories.json'), JSON.stringify(list, null, 2), 'utf-8');
}
