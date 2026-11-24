import fs from 'node:fs';
import path from 'node:path';

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

const CATEGORIES_FILE = path.join(process.cwd(), 'src', 'data', 'categories.json');

export function getCategories(): Category[] {
  try {
    if (fs.existsSync(CATEGORIES_FILE)) {
      const data = fs.readFileSync(CATEGORIES_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}
  return defaultCategories;
}

export function writeCategoriesSync(list: Category[]): void {
  fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(list, null, 2), 'utf-8');
}
