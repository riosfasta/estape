import fs from 'node:fs';
import path from 'node:path';

import { getDataFile } from '../core/tenantContext';
export interface ProductBuyButton {
  type: 'custom_url' | 'whatsapp' | 'ecommerce';
  url: string; // e.g. Shopee, Tokopedia, Amazon, Shopify, or WhatsApp URL
  label: string; // e.g. "Buy Now", "Order via WhatsApp", "Shop on Shopee"
  target?: '_blank' | '_self';
  whatsappNumber?: string;
  whatsappMessage?: string;
  buttonBg?: string;
  buttonColor?: string;
}

export interface Product {
  id: string;
  slug: string;
  title: string;
  subtitle?: string;
  description: string;
  content: string; // Rich detailed HTML description & specs
  price: number;
  compareAtPrice?: number;
  currency: string;
  sku: string;
  stockStatus: 'in_stock' | 'out_of_stock' | 'preorder';
  rating: number;
  reviewsCount: number;
  category: string;
  categories?: string[];
  categorySlugs?: string[];
  tags: string[];
  sizes?: string[];
  colors?: { name: string; hex: string }[];
  image: string; // Primary featured image
  gallery: string[]; // Additional gallery image URLs
  buyButton: ProductBuyButton;
  secondaryButton?: {
    enabled: boolean;
    type: 'whatsapp' | 'custom_url';
    label: string;
    url?: string;
    whatsappNumber?: string;
    whatsappMessage?: string;
  };
  css?: string;
  projectData?: any;
  keywords?: string;
  schema?: string;
  customCode?: {
    headScripts?: string;
    bodyStartScripts?: string;
    customCss?: string;
    bodyEndScripts?: string;
    bodyScripts?: string;
  };
  showRelated?: boolean;
  relatedTagline?: string;
  relatedTitle?: string;
  relatedCategory?: string;
  relatedOrderBy?: string;
  relatedLimit?: number;
  relatedHtml?: string;
  layoutMode: 'standard' | 'blank';
  layoutId?: string;
  status: 'published' | 'draft';
  featured?: boolean;
  createdAt: string;
  updatedAt: string;
}

export function getProductCategoriesArray(product?: Partial<Product> | null): string[] {
  if (!product) return ['Uncategorized'];
  if (Array.isArray(product.categories) && product.categories.length > 0) {
    const cleaned = product.categories.map((c) => String(c).trim()).filter(Boolean);
    if (cleaned.length > 0) return cleaned;
  }
  if (typeof product.category === 'string' && product.category.trim()) {
    const split = product.category.split(',').map((c) => c.trim()).filter(Boolean);
    if (split.length > 0) return split;
  }
  return ['Uncategorized'];
}

export const defaultProducts: Product[] = [
  {
    id: 'prod-1',
    slug: 'japanese-heavyweight-oversized-tee',
    title: 'Japanese Heavyweight Oversized Tee',
    subtitle: '280 GSM Premium Combed Cotton · Boxy Streetwear Silhouette',
    description: 'Crafted from ultra-dense 280 GSM combed Japanese cotton with drop-shoulders and reinforced double-needle collar.',
    content: `
      <h3>Product Overview</h3>
      <p>The definitive heavyweight tee built for everyday longevity and modern drape. Woven from 100% ring-spun combed long-staple cotton, this shirt maintains its structured silhouette wash after wash.</p>
      
      <h4>Features & Construction</h4>
      <ul>
        <li><strong>Fabric:</strong> 280 GSM (8.2 oz) 100% pre-shrunk combed cotton</li>
        <li><strong>Fit:</strong> Relaxed boxy streetwear cut with dropped shoulder seams</li>
        <li><strong>Collar:</strong> 1.25" thick 1x1 ribbed collar that will not bacon or stretch</li>
        <li><strong>Finish:</strong> Silicon washed for exceptional softness and minimal lint</li>
      </ul>

      <h4>Care Guide</h4>
      <p>Machine wash cold with like colors inside out. Hang dry or tumble dry low. Do not bleach or dry clean.</p>
    `,
    price: 34.00,
    compareAtPrice: 48.00,
    currency: '$',
    sku: 'TEE-HVY-001',
    stockStatus: 'in_stock',
    rating: 4.9,
    reviewsCount: 142,
    category: 'T-Shirts',
    tags: ['Streetwear', 'Oversized', 'Heavyweight', 'Unisex', 'Cotton'],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    colors: [
      { name: 'Vintage Washed Black', hex: '#18181b' },
      { name: 'Bone White', hex: '#f4f4f5' },
      { name: 'Sage Green', hex: '#4d5d53' },
      { name: 'Washed Charcoal', hex: '#3f3f46' }
    ],
    image: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=80',
      'https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?auto=format&fit=crop&w=900&q=80',
      'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?auto=format&fit=crop&w=900&q=80'
    ],
    buyButton: {
      type: 'custom_url',
      url: 'https://shopee.com',
      label: 'Buy Now — $34.00',
      target: '_blank'
    },
    secondaryButton: {
      enabled: true,
      type: 'whatsapp',
      label: 'Order via WhatsApp 💬',
      whatsappNumber: '628123456789',
      whatsappMessage: 'Hi! I would like to order the Japanese Heavyweight Oversized Tee ($34.00).'
    },
    layoutMode: 'standard',
    status: 'published',
    featured: true,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-10T12:00:00.000Z'
  },
  {
    id: 'prod-2',
    slug: 'vintage-washed-french-terry-hoodie',
    title: 'Vintage Washed French Terry Hoodie',
    subtitle: '450 GSM Heavy French Terry · Garment Dyed & Sun Faded',
    description: 'Ultra-plush heavyweight French terry hoodie with double-layer hood, hidden kangaroo stash pocket, and ribbed side gussets.',
    content: `
      <h3>Product Overview</h3>
      <p>An everyday luxury pullover engineered from 450 GSM custom-milled French terry. Each garment undergoes a specialized enzyme wash to create a subtly aged patina unique to every piece.</p>
      
      <h4>Features & Construction</h4>
      <ul>
        <li><strong>Fabric:</strong> 450 GSM 100% French Terry Cotton (unbrushed loops)</li>
        <li><strong>Hood:</strong> Double-layered heavy structured hood without drawstrings</li>
        <li><strong>Details:</strong> Ribbed side-panels for natural range of motion and stretch</li>
        <li><strong>Cuffs:</strong> Heavy duty 2x2 elastane ribbing at waist and wrists</li>
      </ul>
    `,
    price: 68.00,
    compareAtPrice: 85.00,
    currency: '$',
    sku: 'HD-TER-002',
    stockStatus: 'in_stock',
    rating: 4.8,
    reviewsCount: 98,
    category: 'Hoodies',
    tags: ['Hoodie', 'French Terry', 'Vintage Wash', 'Streetwear'],
    sizes: ['M', 'L', 'XL'],
    colors: [
      { name: 'Charcoal Wash', hex: '#27272a' },
      { name: 'Sand Taupe', hex: '#d4d4d8' },
      { name: 'Midnight Navy', hex: '#1e293b' }
    ],
    image: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=900&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=900&q=80',
      'https://images.unsplash.com/photo-1509967419530-da38b4704bc6?auto=format&fit=crop&w=900&q=80'
    ],
    buyButton: {
      type: 'whatsapp',
      url: 'https://wa.me/628123456789?text=Hello%20I%20want%20to%20order%20the%20Vintage%20Washed%20French%20Terry%20Hoodie',
      label: 'Order on WhatsApp 💬',
      target: '_blank',
      whatsappNumber: '628123456789',
      whatsappMessage: 'Hello, I want to order the Vintage Washed French Terry Hoodie ($68.00).'
    },
    secondaryButton: {
      enabled: true,
      type: 'custom_url',
      label: 'Shop on Tokopedia',
      url: 'https://tokopedia.com'
    },
    layoutMode: 'standard',
    status: 'published',
    featured: true,
    createdAt: '2026-11-02T10:00:00.000Z',
    updatedAt: '2026-11-10T12:00:00.000Z'
  },
  {
    id: 'prod-3',
    slug: 'selvedge-raw-denim-trucker-jacket',
    title: 'Selvedge Raw Denim Trucker Jacket',
    subtitle: '14.5 oz Japanese Redline Selvedge Denim · Solid Brass Hardware',
    description: 'Iconic Type-III silhouette cut from unwashed 14.5 oz red-line shuttle-loom selvedge denim designed to develop rich custom fades.',
    content: `
      <h3>Product Overview</h3>
      <p>Heritage construction meets contemporary tailoring. Sourced from Okayama shuttle looms, this denim starts stiff and molds intimately to your body over months of continuous wear.</p>
      
      <h4>Features & Construction</h4>
      <ul>
        <li><strong>Selvedge:</strong> Visible red-line selvedge on front interior placket</li>
        <li><strong>Hardware:</strong> Custom embossed antique brass shank buttons</li>
        <li><strong>Pockets:</strong> Two chest flap pockets plus twin deep interior welt pockets</li>
        <li><strong>Stitching:</strong> Heavy-gauge dual-tone poly-core thread for lifelong durability</li>
      </ul>
    `,
    price: 129.00,
    compareAtPrice: 165.00,
    currency: '$',
    sku: 'JKT-DEN-003',
    stockStatus: 'in_stock',
    rating: 5.0,
    reviewsCount: 76,
    category: 'Jackets',
    tags: ['Denim', 'Selvedge', 'Heritage', 'Trucker Jacket'],
    sizes: ['S', 'M', 'L', 'XL'],
    colors: [
      { name: 'Deep Indigo Raw', hex: '#1e3a5f' }
    ],
    image: 'https://images.unsplash.com/photo-1576995853123-5a10305d93c0?auto=format&fit=crop&w=900&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1576995853123-5a10305d93c0?auto=format&fit=crop&w=900&q=80',
      'https://images.unsplash.com/photo-1543076447-215ad9ba6923?auto=format&fit=crop&w=900&q=80'
    ],
    buyButton: {
      type: 'custom_url',
      url: 'https://amazon.com',
      label: 'Buy Now on Amazon',
      target: '_blank'
    },
    secondaryButton: {
      enabled: true,
      type: 'whatsapp',
      label: 'Consult Size on WhatsApp',
      whatsappNumber: '628123456789',
      whatsappMessage: 'Hi, I need sizing advice for the Selvedge Raw Denim Trucker Jacket.'
    },
    layoutMode: 'standard',
    status: 'published',
    featured: true,
    createdAt: '2026-11-03T10:00:00.000Z',
    updatedAt: '2026-11-10T12:00:00.000Z'
  },
  {
    id: 'prod-4',
    slug: 'relaxed-fit-tactical-cargo-pants',
    title: 'Relaxed Fit Tactical Cargo Pants',
    subtitle: 'Ripstop Cotton Blend · Modular Bellow Pockets & Cinch Ankle Ties',
    description: 'Durable military-spec ripstop cargo pants with 8 ergonomic storage pockets, articulated knee darts, and adjustable drawstring cuffs.',
    content: `
      <h3>Product Overview</h3>
      <p>Utilitarian performance engineered for urban mobility. Built with high-tensile ripstop fabric that prevents tears and resists light moisture.</p>
      
      <h4>Features & Construction</h4>
      <ul>
        <li><strong>Fabric:</strong> 65% Cotton, 35% Polyester Ripstop weave</li>
        <li><strong>Storage:</strong> 2 slant hand pockets, 2 rear pockets, 4 expandable accordion cargo compartments</li>
        <li><strong>Ergonomics:</strong> Articulated knee darts for unrestricted bending and climbing</li>
        <li><strong>Hem:</strong> Integrated bungee-toggle system to switch between wide and tapered fit</li>
      </ul>
    `,
    price: 59.00,
    compareAtPrice: 79.00,
    currency: '$',
    sku: 'PNT-CRG-004',
    stockStatus: 'in_stock',
    rating: 4.7,
    reviewsCount: 89,
    category: 'Pants',
    tags: ['Cargo', 'Tactical', 'Techwear', 'Streetwear'],
    sizes: ['28', '30', '32', '34', '36'],
    colors: [
      { name: 'Olive Drab', hex: '#3f4e38' },
      { name: 'Stealth Black', hex: '#18181b' },
      { name: 'Desert Khaki', hex: '#d2b48c' }
    ],
    image: 'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?auto=format&fit=crop&w=900&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?auto=format&fit=crop&w=900&q=80',
      'https://images.unsplash.com/photo-1517445312882-bc9910d016b7?auto=format&fit=crop&w=900&q=80'
    ],
    buyButton: {
      type: 'custom_url',
      url: 'https://tokopedia.com',
      label: 'Shop on Tokopedia — $59.00',
      target: '_blank'
    },
    secondaryButton: {
      enabled: true,
      type: 'whatsapp',
      label: 'Order on WhatsApp',
      whatsappNumber: '628123456789',
      whatsappMessage: 'Hi! I want to order the Relaxed Fit Tactical Cargo Pants.'
    },
    layoutMode: 'standard',
    status: 'published',
    featured: false,
    createdAt: '2026-11-04T10:00:00.000Z',
    updatedAt: '2026-11-10T12:00:00.000Z'
  },
  {
    id: 'prod-5',
    slug: 'minimalist-organic-linen-camp-shirt',
    title: 'Minimalist Organic Linen Camp Collar Shirt',
    subtitle: '100% Normandy Flax Linen · Relaxed Resort Collar',
    description: 'Airy, breathable summer staple woven from pure Normandy flax linen. Features a retro Cuban camp collar and genuine shell buttons.',
    content: `
      <h3>Product Overview</h3>
      <p>The ultimate warm-weather button-down. Highly breathable linen wicks moisture away and naturally regulates body heat, delivering breezy all-day comfort.</p>
      
      <h4>Features & Construction</h4>
      <ul>
        <li><strong>Fabric:</strong> 100% Certified Organic French/Normandy Linen</li>
        <li><strong>Collar:</strong> Spread Cuban camp collar that rests flat against the collarbone</li>
        <li><strong>Buttons:</strong> Genuine trocas mother-of-pearl buttons</li>
        <li><strong>Cut:</strong> Straight square hem with subtle side vents for untucked styling</li>
      </ul>
    `,
    price: 48.00,
    compareAtPrice: 62.00,
    currency: '$',
    sku: 'SHT-LIN-005',
    stockStatus: 'in_stock',
    rating: 4.8,
    reviewsCount: 54,
    category: 'Shirts',
    tags: ['Linen', 'Summer', 'Camp Collar', 'Resort', 'Organic'],
    sizes: ['S', 'M', 'L', 'XL'],
    colors: [
      { name: 'Natural Sand', hex: '#e4d5b7' },
      { name: 'Crisp White', hex: '#ffffff' },
      { name: 'Sky Blue', hex: '#93c5fd' }
    ],
    image: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=900&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=900&q=80',
      'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=900&q=80'
    ],
    buyButton: {
      type: 'custom_url',
      url: 'https://shopee.com',
      label: 'Buy Now — $48.00',
      target: '_blank'
    },
    secondaryButton: {
      enabled: true,
      type: 'whatsapp',
      label: 'Order on WhatsApp',
      whatsappNumber: '628123456789',
      whatsappMessage: 'Hi! I would like to purchase the Minimalist Organic Linen Camp Shirt.'
    },
    layoutMode: 'standard',
    status: 'published',
    featured: true,
    createdAt: '2026-11-05T10:00:00.000Z',
    updatedAt: '2026-11-10T12:00:00.000Z'
  },
  {
    id: 'prod-6',
    slug: 'acid-wash-retro-graphic-crewneck',
    title: 'Acid Wash Retro Graphic Crewneck',
    subtitle: '380 GSM Heavy Fleece · Vintage Mineral Wash Treatment',
    description: 'Distressed vintage-look crewneck with nostalgic typographic front print and relaxed drop-shoulder drape.',
    content: `
      <h3>Product Overview</h3>
      <p>Every piece is uniquely acid-washed by hand. Brushed interior fleece provides cozy warmth, while raw vintage seam details deliver authentic 90s aesthetic.</p>
    `,
    price: 54.00,
    compareAtPrice: 70.00,
    currency: '$',
    sku: 'CRW-RET-006',
    stockStatus: 'in_stock',
    rating: 4.6,
    reviewsCount: 42,
    category: 'Sweatshirts',
    tags: ['Sweatshirt', 'Graphic', 'Acid Wash', 'Retro'],
    sizes: ['M', 'L', 'XL'],
    colors: [
      { name: 'Mineral Grey', hex: '#52525b' },
      { name: 'Faded Black', hex: '#27272a' }
    ],
    image: 'https://images.unsplash.com/photo-1509967419530-da38b4704bc6?auto=format&fit=crop&w=900&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1509967419530-da38b4704bc6?auto=format&fit=crop&w=900&q=80'
    ],
    buyButton: {
      type: 'whatsapp',
      url: 'https://wa.me/628123456789?text=Hello%20I%20want%20to%20order%20the%20Acid%20Wash%20Retro%20Graphic%20Crewneck',
      label: 'Order on WhatsApp 💬',
      target: '_blank'
    },
    layoutMode: 'standard',
    status: 'published',
    featured: false,
    createdAt: '2026-11-06T10:00:00.000Z',
    updatedAt: '2026-11-10T12:00:00.000Z'
  },
  {
    id: 'prod-7',
    slug: 'waterproof-technical-windbreaker',
    title: 'Waterproof Technical Windbreaker Jacket',
    subtitle: '3-Layer DWR Coated Shell · Aquaguard YKK Zippers',
    description: 'Ultralight waterproof windbreaker with fully taped seams, breathable pit zips, and packable stowaway pocket.',
    content: `
      <h3>Product Overview</h3>
      <p>Engineered for unpredictable weather and city commuting. Breathable membrane keeps you completely dry without causing overheating.</p>
    `,
    price: 95.00,
    compareAtPrice: 120.00,
    currency: '$',
    sku: 'JKT-WND-007',
    stockStatus: 'in_stock',
    rating: 4.9,
    reviewsCount: 61,
    category: 'Outerwear',
    tags: ['Waterproof', 'Windbreaker', 'Techwear', 'Jacket'],
    sizes: ['S', 'M', 'L', 'XL'],
    colors: [
      { name: 'Matte Obsidian', hex: '#0f172a' },
      { name: 'Glacier Silver', hex: '#cbd5e1' }
    ],
    image: 'https://images.unsplash.com/photo-1544441893-675973e31985?auto=format&fit=crop&w=900&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1544441893-675973e31985?auto=format&fit=crop&w=900&q=80'
    ],
    buyButton: {
      type: 'custom_url',
      url: 'https://shopee.com',
      label: 'Buy Now — $95.00',
      target: '_blank'
    },
    secondaryButton: {
      enabled: true,
      type: 'whatsapp',
      label: 'Ask Questions via WhatsApp',
      whatsappNumber: '628123456789'
    },
    layoutMode: 'standard',
    status: 'published',
    featured: true,
    createdAt: '2026-11-07T10:00:00.000Z',
    updatedAt: '2026-11-10T12:00:00.000Z'
  },
  {
    id: 'prod-8',
    slug: 'pleated-wide-leg-tailored-trousers',
    title: 'Pleated Wide-Leg Tailored Trousers',
    subtitle: 'Wool-Viscose Blend · Double Front Pleats & Relaxed Fluid Drape',
    description: 'Modern sartorial trousers combining refined formal tailoring with a fluid, wide-leg contemporary cut.',
    content: `
      <h3>Product Overview</h3>
      <p>Elevate your everyday rotation with wide tailored pleats that provide elegant movement and effortless drape.</p>
    `,
    price: 64.00,
    compareAtPrice: 89.00,
    currency: '$',
    sku: 'PNT-TRS-008',
    stockStatus: 'in_stock',
    rating: 4.7,
    reviewsCount: 38,
    category: 'Pants',
    tags: ['Trousers', 'Pleated', 'Tailored', 'Smart Casual'],
    sizes: ['30', '32', '34', '36'],
    colors: [
      { name: 'Mocha Brown', hex: '#45322e' },
      { name: 'Slate Grey', hex: '#64748b' }
    ],
    image: 'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?auto=format&fit=crop&w=900&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?auto=format&fit=crop&w=900&q=80'
    ],
    buyButton: {
      type: 'custom_url',
      url: 'https://tokopedia.com',
      label: 'Buy on Tokopedia',
      target: '_blank'
    },
    layoutMode: 'standard',
    status: 'published',
    featured: false,
    createdAt: '2026-11-08T10:00:00.000Z',
    updatedAt: '2026-11-10T12:00:00.000Z'
  },
  {
    id: 'prod-9',
    slug: 'heavy-knit-ribbed-beanie-scarf-set',
    title: 'Heavy Knit Ribbed Beanie & Scarf Set',
    subtitle: '100% Extra-Fine Merino Wool Blend · Thermal Ribbed Stitch',
    description: 'Winter-ready pairing of an unstructured fisherman beanie and matching fringeless chunky knit scarf.',
    content: `
      <h3>Product Overview</h3>
      <p>Ultra-warm, itch-free merino wool accessory combo. Classic 2x2 rib stitch stretches to conform comfortably to any head shape.</p>
    `,
    price: 29.00,
    compareAtPrice: 39.00,
    currency: '$',
    sku: 'ACC-SET-009',
    stockStatus: 'in_stock',
    rating: 4.9,
    reviewsCount: 114,
    category: 'Accessories',
    tags: ['Beanie', 'Scarf', 'Merino Wool', 'Winter', 'Knitwear'],
    sizes: ['One Size Fits All'],
    colors: [
      { name: 'Oatmeal Heather', hex: '#d6d3d1' },
      { name: 'Forest Evergreen', hex: '#14532d' },
      { name: 'Pitch Black', hex: '#0a0a0a' }
    ],
    image: 'https://images.unsplash.com/photo-1576871337622-98d48d1cf531?auto=format&fit=crop&w=900&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1576871337622-98d48d1cf531?auto=format&fit=crop&w=900&q=80'
    ],
    buyButton: {
      type: 'whatsapp',
      url: 'https://wa.me/628123456789?text=Hello%20I%20want%20to%20order%20the%20Heavy%20Knit%20Ribbed%20Beanie%20Set',
      label: 'Order on WhatsApp ($29.00) 💬',
      target: '_blank'
    },
    layoutMode: 'standard',
    status: 'published',
    featured: false,
    createdAt: '2026-11-09T10:00:00.000Z',
    updatedAt: '2026-11-10T12:00:00.000Z'
  },
  {
    id: 'prod-10',
    slug: 'everyday-corduroy-overshirt',
    title: 'Everyday Corduroy Overshirt',
    subtitle: '8-Wale Chunky Cotton Corduroy · Tortoise Resin Buttons',
    description: 'Substantial chunky wale corduroy jacket shirt designed to be layered over tees and hoodies as lightweight outerwear.',
    content: `
      <h3>Product Overview</h3>
      <p>A tactile wardrobe essential. Dense 8-wale corduroy provides subtle insulation while lending distinctive texture to any outfit.</p>
    `,
    price: 52.00,
    compareAtPrice: 68.00,
    currency: '$',
    sku: 'SHT-CRD-010',
    stockStatus: 'in_stock',
    rating: 4.8,
    reviewsCount: 77,
    category: 'Shirts',
    tags: ['Corduroy', 'Overshirt', 'Layering', 'Autumn'],
    sizes: ['S', 'M', 'L', 'XL'],
    colors: [
      { name: 'Caramel Brown', hex: '#92400e' },
      { name: 'Olive Green', hex: '#365314' },
      { name: 'Ink Navy', hex: '#172554' }
    ],
    image: 'https://images.unsplash.com/photo-1603252109303-2751441dd157?auto=format&fit=crop&w=900&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1603252109303-2751441dd157?auto=format&fit=crop&w=900&q=80'
    ],
    buyButton: {
      type: 'custom_url',
      url: 'https://shopee.com',
      label: 'Buy Now — $52.00',
      target: '_blank'
    },
    secondaryButton: {
      enabled: true,
      type: 'whatsapp',
      label: 'WhatsApp Quick Order',
      whatsappNumber: '628123456789'
    },
    layoutMode: 'standard',
    status: 'published',
    featured: true,
    createdAt: '2026-11-10T10:00:00.000Z',
    updatedAt: '2026-11-10T12:00:00.000Z'
  }
];


export function getProducts(): Product[] {
  try {
    if (fs.existsSync(getDataFile('products.json'))) {
      const data = fs.readFileSync(getDataFile('products.json'), 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}
  return defaultProducts;
}

export function getProductBySlug(slug: string): Product | undefined {
  const all = getProducts();
  return all.find((p) => p.slug === slug || p.id === slug);
}

export function writeProductsSync(productsList: Product[]): void {
  fs.writeFileSync(getDataFile('products.json'), JSON.stringify(productsList, null, 2), 'utf-8');
}

export const products: Product[] = getProducts();
