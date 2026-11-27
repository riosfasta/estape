import fs from 'node:fs';
import path from 'node:path';

import { getDataFile } from '../core/tenantContext';
export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
}

export const defaultCategories: Category[] = [
  { id: 'uncategorized', name: 'Uncategorized', slug: 'uncategorized', description: 'Default category for posts' },
  { id: 'branding', name: 'Branding', slug: 'branding' },
  { id: 'online-marketing', name: 'Online Marketing', slug: 'online-marketing' },
  { id: 'graphic-design', name: 'Graphic Design', slug: 'graphic-design' }
];


export function getCategories(): Category[] {
  try {
    if (fs.existsSync(getDataFile('categories.json'))) {
      const data = fs.readFileSync(getDataFile('categories.json'), 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}
  return defaultCategories;
}

export function writeCategoriesSync(list: Category[]): void {
  fs.writeFileSync(getDataFile('categories.json'), JSON.stringify(list, null, 2), 'utf-8');
}
