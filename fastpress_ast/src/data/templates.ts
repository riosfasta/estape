import fs from 'node:fs';
import path from 'node:path';

import { getDataFile } from '../core/tenantContext';
export type TemplateType = 'global' | 'individual';

export interface Template {
  id: string;
  name: string;
  type: TemplateType; // 'global' = synced everywhere; 'individual' = standalone copy
  category: string; // 'Hero', 'Header', 'CTA', 'Feature', 'Testimonial', 'Footer', etc.
  description?: string;
  html: string;
  css: string;
  projectData?: any;
  thumbnail?: string;
  createdAt?: string;
  updatedAt?: string;
}


export const defaultTemplates: Template[] = [
  // --- 1. GLOBAL TEMPLATES (Same everywhere it's placed, editing it updates all instances) ---
  {
    id: 'tpl-global-furnisite-navbar',
    name: 'Global Furnisite Luxury Navbar',
    type: 'global',
    category: 'Header',
    description: 'Theme navigation bar with brand, desktop links, catalog search, bag counter, and mobile hamburger drawer.',
    html: `<header class="block-furnisite-navbar pop-drawer-component" data-global-template-id="tpl-global-furnisite-navbar">
  <div class="bfn-container">
    <div style="display: flex; align-items: center; gap: 14px;">
      <button type="button" class="pop-drawer-trigger-btn" style="background: none; border: none; cursor: pointer; padding: 6px; display: inline-flex; align-items: center; justify-content: center; color: #111827; border-radius: 4px;" aria-label="Toggle navigation drawer" title="Click to pop out drawer">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
      </button>
      <a href="/" class="bfn-brand">INFURNISH</a>
    </div>
    <nav>
      <ul class="bfn-nav">
        <li><a href="/" class="bfn-nav-link is-active">Home</a></li>
        <li><a href="/about" class="bfn-nav-link">About</a></li>
        <li><a href="/products" class="bfn-nav-link">Shop</a></li>
        <li><a href="/blog" class="bfn-nav-link">Blog</a></li>
        <li><a href="/contact" class="bfn-nav-link">Contact</a></li>
      </ul>
    </nav>
    <div class="bfn-actions">
      <a href="/products" class="bfn-icon-btn" title="Search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
      </a>
      <a href="/products" class="bfn-icon-btn" style="position: relative;" title="Shopping Bag">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>
        <span style="position: absolute; top: -2px; right: -4px; background: #111827; color: #ffffff; font-size: 0.65rem; font-weight: 700; width: 16px; height: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">0</span>
      </a>
      <a href="/products" style="background-color: #111827; color: #ffffff; padding: 9px 20px; border-radius: 9999px; font-size: 0.82rem; font-weight: 700; text-decoration: none; letter-spacing: 0.02em;">Explore Catalog</a>
    </div>
  </div>
  <div class="pop-drawer-overlay">
    <div class="pop-drawer-backdrop"></div>
    <aside class="pop-drawer-panel">
      <div class="pop-drawer-header">
        <div class="pop-drawer-brand">INFURNISH</div>
        <button type="button" class="pop-drawer-close-btn" aria-label="Close Drawer" title="Close">✕</button>
      </div>
      <div class="pop-drawer-search">
        <input type="text" placeholder="Search furniture, styles..." class="pop-drawer-search-input" />
      </div>
      <nav class="pop-drawer-nav">
        <ul class="pop-drawer-menu">
          <li><a href="/" class="pop-drawer-link is-active"><span>Home</span><span class="pop-drawer-arrow">&rarr;</span></a></li>
          <li><a href="/about" class="pop-drawer-link"><span>About Our Studio</span><span class="pop-drawer-arrow">&rarr;</span></a></li>
          <li><a href="/products" class="pop-drawer-link"><span>Shop Catalog</span><span class="pop-drawer-arrow">&rarr;</span></a></li>
          <li><a href="/blog" class="pop-drawer-link"><span>Living Space Journal</span><span class="pop-drawer-arrow">&rarr;</span></a></li>
          <li><a href="/contact" class="pop-drawer-link"><span>Showrooms & Contact</span><span class="pop-drawer-arrow">&rarr;</span></a></li>
        </ul>
      </nav>
      <div class="pop-drawer-promo">
        <div class="pop-drawer-promo-badge">PROMO CODE: LUXE10</div>
        <div class="pop-drawer-promo-title">Enjoy 10% Off Your Initial Order</div>
        <p class="pop-drawer-promo-desc">Thoughtfully crafted furniture designed to transform modern living spaces.</p>
        <a href="/products" class="pop-drawer-cta-btn">Shop Collection &rarr;</a>
      </div>
      <div class="pop-drawer-footer">
        <div class="pop-drawer-socials">
          <a href="#" class="pop-drawer-social-icon" title="Instagram">📸</a>
          <a href="#" class="pop-drawer-social-icon" title="Pinterest">📌</a>
          <a href="#" class="pop-drawer-social-icon" title="Twitter">🐦</a>
          <a href="#" class="pop-drawer-social-icon" title="Facebook">📘</a>
        </div>
        <p class="pop-drawer-contact-info">Need assistance? <a href="/contact">contact@infurnish.com</a></p>
      </div>
    </aside>
  </div>
</header>`,
    css: `.block-furnisite-navbar { background-color: #ffffff; border-bottom: 1px solid #f0f0f0; padding: 14px 24px; font-family: 'Plus Jakarta Sans', -apple-system, sans-serif; width: 100%; box-sizing: border-box; }
.block-furnisite-navbar .bfn-container { max-width: 1240px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.block-furnisite-navbar .bfn-container > div:first-child, .block-furnisite-navbar .bfn-brand-group { display: inline-flex; align-items: center; gap: 14px; }
.block-furnisite-navbar .bfn-brand { font-family: 'Montserrat', sans-serif; font-size: 1.35rem; font-weight: 800; letter-spacing: 0.08em; color: #111827; text-transform: uppercase; text-decoration: none; display: inline-flex; align-items: center; line-height: 1; }
.block-furnisite-navbar .pop-drawer-trigger-btn svg { display: block; }
.block-furnisite-navbar .bfn-nav { display: flex; align-items: center; gap: 32px; list-style: none; padding: 0; margin: 0; }
.block-furnisite-navbar .bfn-nav li { list-style: none; margin: 0; padding: 0; }
.block-furnisite-navbar .bfn-nav a,
.block-furnisite-navbar .bfn-nav-link {
  font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
  font-size: 0.92rem;
  font-weight: 500;
  color: #4b5563;
  text-decoration: none;
  position: relative;
  padding: 6px 2px;
  display: inline-block;
  transition: color 0.18s ease;
}
.block-furnisite-navbar .bfn-nav a:hover,
.block-furnisite-navbar .bfn-nav a.is-active,
.block-furnisite-navbar .bfn-nav-link:hover,
.block-furnisite-navbar .bfn-nav-link.is-active {
  color: #111827;
  font-weight: 600;
}
.block-furnisite-navbar .bfn-nav a::after,
.block-furnisite-navbar .bfn-nav-link::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background-color: #111827;
  transform: scaleX(0);
  transform-origin: center;
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.2s ease;
  border-radius: 1px;
}
.block-furnisite-navbar .bfn-nav a:hover::after,
.block-furnisite-navbar .bfn-nav-link:hover::after {
  transform: scaleX(0.5);
  background-color: #9ca3af;
}
.block-furnisite-navbar .bfn-nav a.is-active::after,
.block-furnisite-navbar .bfn-nav-link.is-active::after {
  transform: scaleX(1);
  background-color: #111827;
}
.block-furnisite-navbar .bfn-actions { display: flex; align-items: center; gap: 16px; }
.block-furnisite-navbar .bfn-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 50%; background: #f4f4f5; color: #18181b; text-decoration: none; font-size: 1rem; }
.block-furnisite-navbar .pop-drawer-trigger-btn { background: transparent; border: none; cursor: pointer; padding: 6px; display: inline-flex; align-items: center; justify-content: center; color: #111827; border-radius: 4px; transition: background 0.15s ease; }
.block-furnisite-navbar .pop-drawer-trigger-btn:hover { background: #f4f4f5; }
.pop-drawer-overlay { position: fixed; inset: 0; z-index: 99999; visibility: hidden; opacity: 0; transition: opacity 0.25s ease, visibility 0.25s ease; pointer-events: none; }
.pop-drawer-overlay.is-open, .pop-drawer-overlay[data-open="true"] { visibility: visible; opacity: 1; pointer-events: auto; }
.pop-drawer-backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.45); backdrop-filter: blur(2px); cursor: pointer; }
.pop-drawer-panel { position: absolute; top: 0; left: 0; bottom: 0; width: 340px; max-width: 85vw; background: #ffffff; box-shadow: 4px 0 24px rgba(0, 0, 0, 0.15); transform: translateX(-100%); transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1); display: flex; flex-direction: column; overflow-y: auto; z-index: 10; }
.pop-drawer-overlay.is-open .pop-drawer-panel, .pop-drawer-overlay[data-open="true"] .pop-drawer-panel { transform: translateX(0); }
.pop-drawer-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid #f0f0f0; }
.pop-drawer-brand { font-family: 'Montserrat', sans-serif; font-weight: 800; font-size: 1.15rem; letter-spacing: 0.08em; color: #111827; text-transform: uppercase; }
.pop-drawer-close-btn { background: #f4f4f5; border: none; width: 32px; height: 32px; border-radius: 50%; font-size: 0.85rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #4b5563; transition: all 0.15s ease; }
.pop-drawer-close-btn:hover { background: #111827; color: #ffffff; }
.pop-drawer-search { padding: 16px 24px 8px; }
.pop-drawer-search-input { width: 100%; padding: 10px 14px; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 0.86rem; background: #f9fafb; outline: none; transition: border-color 0.15s ease; box-sizing: border-box; }
.pop-drawer-nav { padding: 8px 16px; flex: 1; }
.pop-drawer-menu { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.pop-drawer-menu li { list-style: none; padding: 0; margin: 0; }
.pop-drawer-link { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; font-size: 0.95rem; font-weight: 600; color: #374151; text-decoration: none; border-radius: 6px; transition: all 0.15s ease; }
.pop-drawer-link:hover, .pop-drawer-link.is-active { background: #f3f4f6; color: #111827; padding-left: 16px; }
.pop-drawer-arrow { font-size: 0.9rem; color: #9ca3af; transition: transform 0.15s ease; }
.pop-drawer-link:hover .pop-drawer-arrow { transform: translateX(3px); color: #111827; }
.pop-drawer-promo { margin: 16px 20px; padding: 16px; background: #faf9f6; border: 1px solid #f0eee6; border-radius: 10px; }
.pop-drawer-promo-badge { font-size: 0.7rem; font-weight: 700; color: #b45309; letter-spacing: 0.05em; margin-bottom: 6px; text-transform: uppercase; }
.pop-drawer-promo-title { font-weight: 700; font-size: 0.92rem; color: #18181b; margin-bottom: 4px; }
.pop-drawer-promo-desc { font-size: 0.8rem; color: #71717a; line-height: 1.45; margin: 0 0 10px 0; }
.pop-drawer-cta-btn { display: inline-block; background: #18181b; color: #ffffff; padding: 7px 14px; border-radius: 6px; font-size: 0.78rem; font-weight: 700; text-decoration: none; }
.pop-drawer-cta-btn:hover { background: #27272a; }
.pop-drawer-footer { padding: 18px 24px; border-top: 1px solid #f0f0f0; background: #ffffff; }
.pop-drawer-socials { display: flex; gap: 10px; margin-bottom: 12px; }
.pop-drawer-social-icon { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: #f4f4f5; text-decoration: none; font-size: 0.88rem; transition: background 0.15s ease; }
.pop-drawer-social-icon:hover { background: #e4e4e7; }
.pop-drawer-contact-info { font-size: 0.78rem; color: #9ca3af; margin: 0; }
.pop-drawer-contact-info a { color: #4b5563; font-weight: 600; text-decoration: underline; }`
  },
  {
    id: 'tpl-global-furnisite-footer',
    name: 'Global Furnisite 4-Column Footer',
    type: 'global',
    category: 'Footer',
    description: 'Universal 4-column furniture footer with newsletter, collections, studio links, copyright & socials.',
    html: `<footer class="block-furnisite-footer" data-global-template-id="tpl-global-furnisite-footer">
  <div class="bff-container">
    <div class="bff-grid">
      <!-- Col 1: Brand & Bio -->
      <div class="bff-col">
        <h3 class="bff-brand">INFURNISH</h3>
        <p class="bff-desc">Thoughtfully crafted furniture designed to transform modern living spaces with timeless simplicity, natural textures, and lasting comfort.</p>
        <div class="bff-socials">
          <a href="#" class="bff-social-link" title="Instagram">📸</a>
          <a href="#" class="bff-social-link" title="Pinterest">📌</a>
          <a href="#" class="bff-social-link" title="Twitter">🐦</a>
          <a href="#" class="bff-social-link" title="Facebook">📘</a>
        </div>
      </div>
      <!-- Col 2: Collections -->
      <div class="bff-col">
        <h4 class="bff-heading">Collections</h4>
        <ul class="bff-links">
          <li><a href="/products">Living Room</a></li>
          <li><a href="/products">Dining & Kitchen</a></li>
          <li><a href="/products">Bedroom Sanctuary</a></li>
          <li><a href="/products">Lighting & Fixtures</a></li>
          <li><a href="/products">Storage & Shelving</a></li>
        </ul>
      </div>
      <!-- Col 3: Studio -->
      <div class="bff-col">
        <h4 class="bff-heading">Studio</h4>
        <ul class="bff-links">
          <li><a href="/about">About Our Studio</a></li>
          <li><a href="/blog">Living Space Journal</a></li>
          <li><a href="/about#vision">Our Vision & Mission</a></li>
          <li><a href="/contact">Showrooms & Contact</a></li>
        </ul>
      </div>
      <!-- Col 4: Newsletter -->
      <div class="bff-col">
        <h4 class="bff-heading">The Newsletter</h4>
        <p class="bff-newsletter-text">Receive design insights, private lookbook access, and 10% off your initial order.</p>
        <div class="bff-newsletter-form">
          <input type="email" placeholder="Your email address" class="bff-newsletter-input" />
          <button type="button" class="bff-newsletter-btn">Subscribe</button>
        </div>
      </div>
    </div>
    <!-- Bottom Bar -->
    <div class="bff-bottom">
      <p class="bff-copyright">&copy; 2026 INFURNISH Studio. All Rights Reserved.</p>
      <div class="bff-legal-links">
        <a href="/privacy">Privacy Policy</a>
        <a href="/terms">Terms of Service</a>
        <a href="/shipping">Shipping Policy</a>
      </div>
    </div>
  </div>
</footer>`,
    css: `.block-furnisite-footer { background-color: #ffffff; color: #18181b; border-top: 1px solid #e5e7eb; padding: 60px 24px 30px; font-family: 'Plus Jakarta Sans', -apple-system, sans-serif; width: 100%; box-sizing: border-box; }
.block-furnisite-footer * { box-sizing: border-box; }
.block-furnisite-footer .bff-container { max-width: 1240px; margin: 0 auto; }
.block-furnisite-footer .bff-grid { display: grid; grid-template-columns: 2fr 1fr 1fr 1.5fr; gap: 40px; margin-bottom: 40px; }
@media (max-width: 900px) { .block-furnisite-footer .bff-grid { grid-template-columns: 1fr 1fr; } }
@media (max-width: 600px) { .block-furnisite-footer .bff-grid { grid-template-columns: 1fr; } }
.block-furnisite-footer .bff-col { display: flex; flex-direction: column; }
.block-furnisite-footer .bff-brand { font-family: 'Montserrat', sans-serif; font-size: 1.35rem; font-weight: 800; letter-spacing: 0.08em; margin: 0 0 14px 0; color: #111827; text-transform: uppercase; }
.block-furnisite-footer .bff-desc { font-size: 0.88rem; line-height: 1.65; color: #6b7280; margin: 0 0 18px 0; max-width: 320px; }
.block-furnisite-footer .bff-socials { display: flex; gap: 12px; font-size: 1.15rem; }
.block-furnisite-footer .bff-social-link { text-decoration: none; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 50%; background: #f4f4f5; border: 1px solid #e4e4e7; transition: all 0.15s ease; }
.block-furnisite-footer .bff-social-link:hover { background: #18181b; color: #fff; }
.block-furnisite-footer .bff-heading { font-family: 'Montserrat', sans-serif; font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 16px 0; color: #111827; }
.block-furnisite-footer .bff-links { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.block-furnisite-footer .bff-links li { list-style: none; padding: 0; margin: 0; }
.block-furnisite-footer .bff-links a { color: #6b7280; text-decoration: none; font-size: 0.88rem; transition: color 0.15s ease; }
.block-furnisite-footer .bff-links a:hover { color: #111827; }
.block-furnisite-footer .bff-newsletter-text { font-size: 0.88rem; color: #6b7280; line-height: 1.6; margin: 0 0 14px 0; }
.block-furnisite-footer .bff-newsletter-form { display: flex; gap: 8px; }
.block-furnisite-footer .bff-newsletter-input { flex: 1; padding: 10px 14px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 0.85rem; outline: none; background: #f9fafb; color: #111827; }
.block-furnisite-footer .bff-newsletter-btn { background-color: #111827; color: #ffffff; border: none; padding: 10px 18px; border-radius: 6px; font-weight: 700; font-size: 0.85rem; cursor: pointer; white-space: nowrap; }
.block-furnisite-footer .bff-bottom { border-top: 1px solid #f3f4f6; padding-top: 24px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; font-size: 0.82rem; color: #9ca3af; }
.block-furnisite-footer .bff-copyright { margin: 0; color: #9ca3af; }
.block-furnisite-footer .bff-legal-links { display: flex; gap: 18px; }
.block-furnisite-footer .bff-legal-links a { color: #9ca3af; text-decoration: none; font-size: 0.82rem; }
.block-furnisite-footer .bff-legal-links a:hover { color: #111827; }`
  },
  {
    id: 'tpl-global-pop-drawer',
    name: 'Global Pop Navigation Drawer',
    type: 'global',
    category: 'Header',
    description: 'Full slide-out pop navigation drawer with trigger button, animated backdrop, search, links, promo card & socials.',
    html: `<div class="pop-drawer-component" data-global-template-id="tpl-global-pop-drawer">
  <button type="button" class="pop-drawer-trigger-btn" aria-label="Toggle Drawer Menu" title="Click to pop out drawer">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
    <span class="pop-drawer-trigger-label">Menu</span>
  </button>
  <div class="pop-drawer-overlay">
    <div class="pop-drawer-backdrop"></div>
    <aside class="pop-drawer-panel">
      <div class="pop-drawer-header">
        <div class="pop-drawer-brand">INFURNISH</div>
        <button type="button" class="pop-drawer-close-btn" aria-label="Close Drawer" title="Close">✕</button>
      </div>
      <div class="pop-drawer-search">
        <input type="text" placeholder="Search furniture, styles..." class="pop-drawer-search-input" />
      </div>
      <nav class="pop-drawer-nav">
        <ul class="pop-drawer-menu">
          <li><a href="/" class="pop-drawer-link is-active"><span>Home</span><span class="pop-drawer-arrow">&rarr;</span></a></li>
          <li><a href="/about" class="pop-drawer-link"><span>About Our Studio</span><span class="pop-drawer-arrow">&rarr;</span></a></li>
          <li><a href="/products" class="pop-drawer-link"><span>Shop Catalog</span><span class="pop-drawer-arrow">&rarr;</span></a></li>
          <li><a href="/blog" class="pop-drawer-link"><span>Living Space Journal</span><span class="pop-drawer-arrow">&rarr;</span></a></li>
          <li><a href="/contact" class="pop-drawer-link"><span>Showrooms & Contact</span><span class="pop-drawer-arrow">&rarr;</span></a></li>
        </ul>
      </nav>
      <div class="pop-drawer-promo">
        <div class="pop-drawer-promo-badge">PROMO CODE: LUXE10</div>
        <div class="pop-drawer-promo-title">Enjoy 10% Off Your Initial Order</div>
        <p class="pop-drawer-promo-desc">Thoughtfully crafted furniture designed to transform modern living spaces.</p>
        <a href="/products" class="pop-drawer-cta-btn">Shop Collection &rarr;</a>
      </div>
      <div class="pop-drawer-footer">
        <div class="pop-drawer-socials">
          <a href="#" class="pop-drawer-social-icon" title="Instagram">📸</a>
          <a href="#" class="pop-drawer-social-icon" title="Pinterest">📌</a>
          <a href="#" class="pop-drawer-social-icon" title="Twitter">🐦</a>
          <a href="#" class="pop-drawer-social-icon" title="Facebook">📘</a>
        </div>
        <p class="pop-drawer-contact-info">Need assistance? <a href="/contact">contact@infurnish.com</a></p>
      </div>
    </aside>
  </div>
</div>`,
    css: `.pop-drawer-component { display: inline-block; font-family: 'Plus Jakarta Sans', -apple-system, sans-serif; }
.pop-drawer-component * { box-sizing: border-box; }
.pop-drawer-trigger-btn { display: inline-flex; align-items: center; gap: 8px; background: #ffffff; color: #18181b; border: 1px solid #e4e4e7; padding: 8px 14px; border-radius: 6px; font-weight: 600; font-size: 0.88rem; cursor: pointer; transition: all 0.15s ease; }
.pop-drawer-trigger-btn:hover { background: #f4f4f5; border-color: #d4d4d8; }
.pop-drawer-overlay { position: fixed; inset: 0; z-index: 99999; visibility: hidden; opacity: 0; transition: opacity 0.25s ease, visibility 0.25s ease; pointer-events: none; }
.pop-drawer-overlay.is-open, .pop-drawer-overlay[data-open="true"] { visibility: visible; opacity: 1; pointer-events: auto; }
.pop-drawer-backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.45); backdrop-filter: blur(2px); }
.pop-drawer-panel { position: absolute; top: 0; left: 0; bottom: 0; width: 340px; max-width: 85vw; background: #ffffff; box-shadow: 4px 0 24px rgba(0, 0, 0, 0.15); transform: translateX(-100%); transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1); display: flex; flex-direction: column; overflow-y: auto; z-index: 10; }
.pop-drawer-overlay.is-open .pop-drawer-panel, .pop-drawer-overlay[data-open="true"] .pop-drawer-panel { transform: translateX(0); }
.pop-drawer-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid #f0f0f0; }
.pop-drawer-brand { font-family: 'Montserrat', sans-serif; font-weight: 800; font-size: 1.15rem; letter-spacing: 0.08em; color: #111827; text-transform: uppercase; }
.pop-drawer-close-btn { background: #f4f4f5; border: none; width: 32px; height: 32px; border-radius: 50%; font-size: 0.85rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #4b5563; transition: all 0.15s ease; }
.pop-drawer-close-btn:hover { background: #111827; color: #ffffff; }
.pop-drawer-search { padding: 16px 24px 8px; }
.pop-drawer-search-input { width: 100%; padding: 10px 14px; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 0.86rem; background: #f9fafb; outline: none; transition: border-color 0.15s ease; }
.pop-drawer-nav { padding: 8px 16px; flex: 1; }
.pop-drawer-menu { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.pop-drawer-menu li { list-style: none; padding: 0; margin: 0; }
.pop-drawer-link { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; font-size: 0.95rem; font-weight: 600; color: #374151; text-decoration: none; border-radius: 6px; transition: all 0.15s ease; }
.pop-drawer-link:hover, .pop-drawer-link.is-active { background: #f3f4f6; color: #111827; padding-left: 16px; }
.pop-drawer-arrow { font-size: 0.9rem; color: #9ca3af; transition: transform 0.15s ease; }
.pop-drawer-link:hover .pop-drawer-arrow { transform: translateX(3px); color: #111827; }
.pop-drawer-promo { margin: 16px 20px; padding: 16px; background: #faf9f6; border: 1px solid #f0eee6; border-radius: 10px; }
.pop-drawer-promo-badge { font-size: 0.7rem; font-weight: 700; color: #b45309; letter-spacing: 0.05em; margin-bottom: 6px; text-transform: uppercase; }
.pop-drawer-promo-title { font-weight: 700; font-size: 0.92rem; color: #18181b; margin-bottom: 4px; }
.pop-drawer-promo-desc { font-size: 0.8rem; color: #71717a; line-height: 1.45; margin: 0 0 10px 0; }
.pop-drawer-cta-btn { display: inline-block; background: #18181b; color: #ffffff; padding: 7px 14px; border-radius: 6px; font-size: 0.78rem; font-weight: 700; text-decoration: none; }
.pop-drawer-cta-btn:hover { background: #27272a; }
.pop-drawer-footer { padding: 18px 24px; border-top: 1px solid #f0f0f0; background: #ffffff; }
.pop-drawer-socials { display: flex; gap: 10px; margin-bottom: 12px; }
.pop-drawer-social-icon { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: #f4f4f5; text-decoration: none; font-size: 0.88rem; transition: background 0.15s ease; }
.pop-drawer-social-icon:hover { background: #e4e4e7; }
.pop-drawer-contact-info { font-size: 0.78rem; color: #9ca3af; margin: 0; }
.pop-drawer-contact-info a { color: #4b5563; font-weight: 600; text-decoration: underline; }`
  },
  {
    id: 'tpl-global-announcement',
    name: 'Global Top Announcement Bar',
    type: 'global',
    category: 'Header',
    description: 'A global notification bar placed across pages. Any text or link changes synchronize globally.',
    html: `<div class="global-announcement-bar" data-global-template-id="tpl-global-announcement" style="background: linear-gradient(90deg, #ff5e3a, #ff7e5f); color: #ffffff; padding: 10px 20px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 0.85rem; font-weight: 600; text-align: center; display: flex; align-items: center; justify-content: center; gap: 10px; box-shadow: 0 2px 10px rgba(255, 94, 58, 0.2);">
  <span style="background: rgba(255,255,255,0.25); padding: 2px 8px; border-radius: 9999px; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 800;">NEW</span>
  <span>✨ Introducing BUGMEGA 2.0 with Visual Reusable Templates!</span>
  <a href="/blog" style="color: #ffffff; text-decoration: underline; font-weight: 700; margin-left: 6px;">Learn more &rarr;</a>
</div>`,
    css: `.global-announcement-bar a:hover { opacity: 0.85; }`
  },
  {
    id: 'tpl-global-newsletter',
    name: 'Global Newsletter Subscription Box',
    type: 'global',
    category: 'CTA',
    description: 'Global lead generation box. Place on multiple pages; updating layout or copy syncs everywhere.',
    html: `<div class="global-newsletter-card" data-global-template-id="tpl-global-newsletter" style="max-width: 860px; margin: 40px auto; padding: 36px 32px; background: linear-gradient(135deg, #161b24, #0b0e14); border: 1px solid #283142; border-radius: 16px; color: #ffffff; text-align: center; box-shadow: 0 12px 30px rgba(0,0,0,0.25); font-family: 'Plus Jakarta Sans', sans-serif;">
  <span style="display: inline-block; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #ff5e3a; margin-bottom: 8px;">STAY AHEAD</span>
  <h3 style="font-family: 'Montserrat', sans-serif; font-size: 1.85rem; font-weight: 800; color: #ffffff; margin: 0 0 10px 0;">Subscribe to Better Insights</h3>
  <p style="font-size: 0.95rem; color: #9ca3af; max-width: 540px; margin: 0 auto 22px auto; line-height: 1.6;">
    Join 15,000+ modern founders and designers receiving weekly actionable growth tactics and design principles.
  </p>
  <div style="display: flex; gap: 10px; max-width: 480px; margin: 0 auto; flex-wrap: wrap;">
    <input type="email" placeholder="Enter your work email address..." style="flex: 1; min-width: 240px; padding: 12px 16px; border-radius: 8px; border: 1px solid #374151; background: #1c212b; color: #f3f4f6; font-size: 0.88rem; outline: none;" />
    <button type="button" style="padding: 12px 22px; border-radius: 8px; background: #ff5e3a; color: #ffffff; border: none; font-weight: 700; font-size: 0.88rem; cursor: pointer; transition: background 0.15s;">Subscribe Free</button>
  </div>
  <span style="display: block; font-size: 0.72rem; color: #6b7280; margin-top: 12px;">No spam guaranteed. Unsubscribe anytime with 1 click.</span>
</div>`,
    css: `.global-newsletter-card button:hover { background: #ff7555; }`
  },
  {
    id: 'tpl-global-footer-cta',
    name: 'Global Pre-Footer Conversion Banner',
    type: 'global',
    category: 'CTA',
    description: 'Universal bottom CTA section for driving high-value inquiries and discovery calls.',
    html: `<section class="global-footer-cta-section" data-global-template-id="tpl-global-footer-cta" style="padding: 60px 20px; background: #0f141e; border-top: 1px solid #232a38; border-bottom: 1px solid #232a38; font-family: 'Plus Jakarta Sans', sans-serif;">
  <div style="max-width: 1000px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 30px; flex-wrap: wrap;">
    <div style="max-width: 600px;">
      <span style="font-size: 0.75rem; font-weight: 700; color: #ff5e3a; text-transform: uppercase; letter-spacing: 1px;">READY TO ELEVATE YOUR BRAND?</span>
      <h2 style="font-family: 'Montserrat', sans-serif; font-size: 2.1rem; font-weight: 800; color: #ffffff; margin: 8px 0 10px 0; line-height: 1.25;">Let's build something exceptional together.</h2>
      <p style="font-size: 0.95rem; color: #9ca3af; margin: 0; line-height: 1.6;">Our multidisciplinary team helps forward-thinking companies design and launch market-leading digital experiences.</p>
    </div>
    <div style="display: flex; gap: 12px; align-items: center;">
      <a href="/contact" style="padding: 12px 26px; border-radius: 8px; background: #ff5e3a; color: #ffffff; font-weight: 700; text-decoration: none; font-size: 0.9rem; display: inline-block;">Start a Project &rarr;</a>
      <a href="/portfolio" style="padding: 12px 22px; border-radius: 8px; border: 1px solid #374151; color: #e5e7eb; font-weight: 600; text-decoration: none; font-size: 0.9rem; display: inline-block;">View Work</a>
    </div>
  </div>
</section>`,
    css: `@media(max-width: 768px) { .global-footer-cta-section > div { flex-direction: column; text-align: center; } }`
  },

  // --- 2. INDIVIDUAL TEMPLATES (Standalone copy, editing on one page does not affect other pages) ---
  {
    id: 'tpl-indiv-hero',
    name: 'Modern Split Hero Section',
    type: 'individual',
    category: 'Hero',
    description: 'High-impact hero section with left-side value proposition, CTA buttons, and right-side showcase image.',
    html: `<section class="individual-split-hero" style="padding: 70px 20px; background-color: #ffffff; font-family: 'Plus Jakarta Sans', sans-serif;">
  <div style="max-width: 1140px; margin: 0 auto; display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 48px; align-items: center;">
    <div>
      <span style="display: inline-block; padding: 4px 14px; background: rgba(255, 94, 58, 0.12); color: #ff5e3a; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; border-radius: 9999px; margin-bottom: 16px;">DIGITAL INNOVATION</span>
      <h1 style="font-family: 'Montserrat', sans-serif; font-size: 2.85rem; font-weight: 800; color: #111827; line-height: 1.2; margin: 0 0 18px 0;">Transform Your Vision into an Impactful Brand</h1>
      <p style="font-size: 1.12rem; color: #4b5563; line-height: 1.7; margin: 0 0 28px 0;">
        We craft tailor-made identity systems, intuitive web experiences, and measurable growth marketing strategies that accelerate modern businesses.
      </p>
      <div style="display: flex; gap: 14px; align-items: center; flex-wrap: wrap;">
        <a href="#services" style="padding: 13px 28px; background: #ff5e3a; color: #ffffff; font-weight: 700; border-radius: 8px; text-decoration: none; font-size: 0.92rem; display: inline-flex; align-items: center; gap: 6px;">
          <span>Explore Services</span>
          <span>&rarr;</span>
        </a>
        <a href="#portfolio" style="padding: 13px 24px; border: 1px solid #d1d5db; color: #374151; font-weight: 600; border-radius: 8px; text-decoration: none; font-size: 0.92rem;">Our Portfolio</a>
      </div>
    </div>
    <div style="border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.12); max-height: 480px;">
      <img src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1000&q=80" alt="Team collaborating" style="width: 100%; height: 100%; object-fit: cover; display: block;" />
    </div>
  </div>
</section>`,
    css: `@media(max-width: 860px) { .individual-split-hero > div { grid-template-columns: 1fr !important; } }`
  },
  {
    id: 'tpl-indiv-feature-grid',
    name: '3-Column Value Features Grid',
    type: 'individual',
    category: 'Feature',
    description: 'Clean 3-column feature blocks with icons, bold titles, and explanatory copy.',
    html: `<section class="individual-features-grid" style="padding: 64px 20px; background: #f9fafb; font-family: 'Plus Jakarta Sans', sans-serif;">
  <div style="max-width: 1140px; margin: 0 auto;">
    <div style="text-align: center; margin-bottom: 48px;">
      <span style="font-size: 0.75rem; font-weight: 700; color: #ff5e3a; text-transform: uppercase; letter-spacing: 1px;">CORE CAPABILITIES</span>
      <h2 style="font-family: 'Montserrat', sans-serif; font-size: 2.2rem; font-weight: 800; color: #111827; margin: 8px 0 12px 0;">Why Leading Brands Choose Us</h2>
      <p style="font-size: 1rem; color: #6b7280; max-width: 600px; margin: 0 auto;">Comprehensive solutions engineered for measurable commercial impact.</p>
    </div>
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 28px;">
      <div style="background: #ffffff; padding: 32px 26px; border-radius: 12px; border: 1px solid #e5e7eb; box-shadow: 0 4px 14px rgba(0,0,0,0.03);">
        <div style="width: 48px; height: 48px; border-radius: 10px; background: rgba(255, 94, 58, 0.12); color: #ff5e3a; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; margin-bottom: 18px;">🎯</div>
        <h3 style="font-family: 'Montserrat', sans-serif; font-size: 1.25rem; font-weight: 700; color: #111827; margin: 0 0 10px 0;">Brand Strategy</h3>
        <p style="font-size: 0.92rem; color: #4b5563; line-height: 1.6; margin: 0;">Uncovering market positioning, brand voice, and clear messaging that resonates with your core demographic.</p>
      </div>
      <div style="background: #ffffff; padding: 32px 26px; border-radius: 12px; border: 1px solid #e5e7eb; box-shadow: 0 4px 14px rgba(0,0,0,0.03);">
        <div style="width: 48px; height: 48px; border-radius: 10px; background: rgba(16, 185, 129, 0.12); color: #10b981; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; margin-bottom: 18px;">⚡</div>
        <h3 style="font-family: 'Montserrat', sans-serif; font-size: 1.25rem; font-weight: 700; color: #111827; margin: 0 0 10px 0;">High-Speed Performance</h3>
        <p style="font-size: 0.92rem; color: #4b5563; line-height: 1.6; margin: 0;">Sub-second load times built on modern static architectures that maximize SEO rankings and conversion rates.</p>
      </div>
      <div style="background: #ffffff; padding: 32px 26px; border-radius: 12px; border: 1px solid #e5e7eb; box-shadow: 0 4px 14px rgba(0,0,0,0.03);">
        <div style="width: 48px; height: 48px; border-radius: 10px; background: rgba(99, 102, 241, 0.12); color: #6366f1; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; margin-bottom: 18px;">📈</div>
        <h3 style="font-family: 'Montserrat', sans-serif; font-size: 1.25rem; font-weight: 700; color: #111827; margin: 0 0 10px 0;">Conversion Architecture</h3>
        <p style="font-size: 0.92rem; color: #4b5563; line-height: 1.6; margin: 0;">Data-driven user flow layouts designed specifically to turn passive page visitors into engaged, loyal customers.</p>
      </div>
    </div>
  </div>
</section>`,
    css: ``
  },
  {
    id: 'tpl-indiv-testimonial',
    name: 'Client Quote Testimonial Card',
    type: 'individual',
    category: 'Testimonial',
    description: 'Elegant client endorsement card with star rating, quote, avatar, and credentials.',
    html: `<div class="individual-testimonial-card" style="max-width: 740px; margin: 32px auto; padding: 36px 32px; background: #ffffff; border-radius: 14px; border: 1px solid #e5e7eb; box-shadow: 0 10px 25px rgba(0,0,0,0.05); font-family: 'Plus Jakarta Sans', sans-serif; text-align: center;">
  <div style="color: #f59e0b; font-size: 1.15rem; margin-bottom: 14px;">★★★★★</div>
  <blockquote style="font-size: 1.2rem; font-style: italic; color: #1f2937; line-height: 1.65; margin: 0 0 24px 0; font-weight: 500;">
    "Working with this platform completely shifted how our business operates. Our new identity increased lead conversion by over 140% in the first quarter alone."
  </blockquote>
  <div style="display: flex; align-items: center; justify-content: center; gap: 14px;">
    <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=160&h=160&q=80" alt="Client avatar" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover;" />
    <div style="text-align: left;">
      <div style="font-size: 0.92rem; font-weight: 700; color: #111827;">Elena Rostova</div>
      <div style="font-size: 0.78rem; color: #6b7280;">Chief Operating Officer, Horizon Media</div>
    </div>
  </div>
</div>`,
    css: ``
  }
];

export function getTemplates(): Template[] {
  try {
    if (fs.existsSync(getDataFile('templates.json'))) {
      const data = fs.readFileSync(getDataFile('templates.json'), 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}
  return defaultTemplates;
}

export function writeTemplatesSync(templates: Template[]): void {
  fs.writeFileSync(getDataFile('templates.json'), JSON.stringify(templates, null, 2), 'utf-8');
}

export function getTemplateById(id: string): Template | undefined {
  const all = getTemplates();
  return all.find(t => t.id === id);
}

/**
 * Synchronizes all elements containing `data-global-template-id="tpl-..."`
 * with the latest HTML content of that global template.
 */
export function syncGlobalTemplates(html: string): string {
  if (!html || !html.includes('data-global-template-id')) return html;
  const allTemplates = getTemplates();
  const globalTemplates = allTemplates.filter(t => t.type === 'global');
  let result = html;

  for (const tpl of globalTemplates) {
    // Regex matching any element with data-global-template-id="tpl.id"
    const regex = new RegExp(`(<([a-zA-Z0-9]+)[^>]*\\bdata-global-template-id=["']${tpl.id}["'][^>]*>)([\\s\\S]*?)(<\\/\\2>)`, 'gi');
    result = result.replace(regex, (match, openTag, tagName, inner, closeTag) => {
      if (tpl.html.includes(`data-global-template-id="${tpl.id}"`) || tpl.html.includes(`data-global-template-id='${tpl.id}'`)) {
        return tpl.html;
      }
      const masterMatch = tpl.html.match(/<([a-zA-Z0-9]+)[^>]*>([\s\S]*?)<\/\1>/i);
      const masterInner = masterMatch ? masterMatch[2] : tpl.html;
      return `<div class="global-template-instance" data-global-template-id="${tpl.id}">${masterInner}</div>`;
    });
  }

  return result;
}

/**
 * Strips builder-only helper UI (such as empty workspace dropzone buttons and hints)
 * from HTML before rendering on live websites or saving.
 */
export function cleanLiveContent(html: string): string {
  if (!html) return '';
  let res = html;

  // 1. Remove dropzone buttons row and hint text completely
  res = res.replace(/<div[^>]*\bclass=["'][^"']*\bdropzone-buttons-row\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
  res = res.replace(/<div[^>]*\bclass=["'][^"']*\b(dropzone-hint|dropzone-text)\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
  res = res.replace(/<button[^>]*\b(?:btn-trigger-add-block|btn-trigger-add-template|btnDropzoneAddBlock|btnDropzoneAddTemplate)\b[^>]*>[\s\S]*?<\/button>/gi, '');

  // 2. Remove empty dropzone container if it has no content
  res = res.replace(/<div[^>]*\b(?:class=["'][^"']*\bempty-workspace-dropzone\b[^"']*["']|id=["']emptyWorkspaceDropzone["'])[^>]*>\s*<\/div>/gi, '');

  // 3. For any remaining dropzones with real content, strip editor dashed border and padding so content displays cleanly
  res = res.replace(/(<div[^>]*\b(?:class=["'][^"']*\bempty-workspace-dropzone\b[^"']*["']|id=["']emptyWorkspaceDropzone["'])[^>]*)\bstyle=["'][^"']*["']/gi, '$1style=""');

  return res;
}

function normalizeNavHref(rawHref: string): string | null {
  const trimmed = (rawHref || '').trim();
  if (!trimmed || trimmed === '#' || /^(?:javascript|mailto|tel):/i.test(trimmed)) return null;
  if (/^https?:\/\//i.test(trimmed)) return null;
  const clean = trimmed.split('#')[0].split('?')[0].replace(/\/+$/, '') || '/';
  return clean.startsWith('/') ? clean : `/${clean}`;
}

function addActiveAttrsToAnchor(openTag: string): string {
  let updated = openTag;
  if (/\bclass=["'][^"']*["']/i.test(updated)) {
    updated = updated.replace(/\bclass=(["'])([^"']*)\1/i, (_m, q, cls) => {
      const cleaned = cls.replace(/\bis-active\b/g, '').replace(/\s+/g, ' ').trim();
      return `class=${q}${cleaned ? `${cleaned} is-active` : 'is-active'}${q}`;
    });
  } else {
    updated = updated.replace(/^<a\s+/i, '<a class="is-active" ');
  }
  if (!/\baria-current=/i.test(updated)) {
    updated = updated.replace(/>$/, ' aria-current="page">');
  }
  return updated;
}

const SLUG_PATH_ALIASES: Record<string, string> = {
  'tentang-kami': '/about',
  'about-us': '/about',
  'produk': '/products',
  'shop': '/products',
  'kontak': '/contact',
  'contact-us': '/contact',
  'home': '/',
  'index': '/',
};

function highlightNavSection(sectionHtml: string, effectivePath: string, activeSlug: string, skipSelectorRegex: RegExp | null): string {
  const aliasPath = SLUG_PATH_ALIASES[activeSlug] || '';
  const isHome = effectivePath === '/' || aliasPath === '/';
  const tags: Array<{ start: number; end: number; tag: string; cleanHref: string | null; isExact: boolean; isAlias: boolean; prefixLen: number }> = [];
  const anchorRe = /<a\b[^>]*\bhref=["']([^"']*)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(sectionHtml)) !== null) {
    const tag = match[0];
    if (skipSelectorRegex && skipSelectorRegex.test(tag)) continue;
    const cleanHref = normalizeNavHref(match[1]);
    if (!cleanHref) continue;

    const isExact = isHome
      ? cleanHref === '/' || cleanHref === '/#'
      : cleanHref === effectivePath || Boolean(activeSlug && (cleanHref === `/${activeSlug}` || cleanHref === activeSlug));
    const isAlias = !isExact && Boolean(aliasPath && cleanHref === aliasPath);
    const prefixLen = !isExact && !isAlias && !isHome && cleanHref !== '/' && effectivePath.startsWith(`${cleanHref}/`)
      ? cleanHref.length
      : 0;
    tags.push({
      start: match.index,
      end: match.index + tag.length,
      tag,
      cleanHref,
      isExact,
      isAlias,
      prefixLen,
    });
  }

  let bestPrefixLen = 0;
  let hasExact = false;
  let hasAlias = false;
  for (const t of tags) {
    if (t.isExact) hasExact = true;
    if (t.isAlias) hasAlias = true;
    if (t.prefixLen > bestPrefixLen) bestPrefixLen = t.prefixLen;
  }

  let out = '';
  let cursor = 0;
  for (const t of tags) {
    const shouldActivate = hasExact
      ? t.isExact
      : hasAlias
        ? t.isAlias
        : (bestPrefixLen > 0 && t.prefixLen === bestPrefixLen);
    if (!shouldActivate) continue;
    out += sectionHtml.slice(cursor, t.start) + addActiveAttrsToAnchor(t.tag);
    cursor = t.end;
  }
  out += sectionHtml.slice(cursor);
  return out;
}

/**
 * Resolves the active navigation link (`is-active` & `aria-current="page"`) inside
 * rendered template header HTML based on the current request path or editor activePage slug.
 */
export function applyActiveNavToTemplateHtml(
  html: string,
  currentPath: string,
  activePage?: string,
  navIndicatorStyle?: string
): string {
  if (!html) return '';
  const cleanReqPath = (currentPath || '/').split('#')[0].split('?')[0].replace(/\/+$/, '') || '/';
  const activeSlug = (activePage || '').trim().replace(/^\/+|\/+$/g, '');
  const effectivePath =
    (cleanReqPath === '/editor' || cleanReqPath === '/editor/') && activeSlug
      ? (activeSlug === 'home' || activeSlug === 'index' ? '/' : `/${activeSlug}`)
      : cleanReqPath;

  let res = html;
  if (navIndicatorStyle) {
    res = res.replace(/<header\b([^>]*class=["'][^"']*block-furnisite-navbar[^"']*["'][^>]*)>/i, (full, attrs) => {
      if (/\bdata-nav-indicator=/i.test(attrs)) return full;
      return `<header${attrs} data-nav-indicator="${navIndicatorStyle}">`;
    });
  }

  // Strip hardcoded inline border-bottom underlines and stale active classes/attributes
  res = res.replace(/\s*style=(["'])([^"']*)\1/gi, (full, q, styleVal) => {
    if (!/border-bottom/i.test(styleVal)) return full;
    const stripped = styleVal.replace(/border-bottom[^;]*;?/gi, '').trim();
    return stripped ? ` style=${q}${stripped}${q}` : '';
  });
  res = res.replace(/(<a\b[^>]*\bclass=(["']))([^"']*)\2/gi, (_m, prefix, q, cls) => {
    const cleaned = cls.replace(/\bis-active\b/g, '').replace(/\s+/g, ' ').trim();
    return `${prefix}${cleaned}${q}`;
  });
  res = res.replace(/\s+aria-current=["']page["']/gi, '');

  // Highlight links inside each <nav> block separately (desktop header nav vs pop drawer nav)
  let navMatched = false;
  res = res.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, (navBlock) => {
    navMatched = true;
    const isDrawerNav = /\bpop-drawer-nav\b|\bfurnisite-drawer\b/i.test(navBlock);
    return highlightNavSection(
      navBlock,
      effectivePath,
      activeSlug,
      isDrawerNav ? null : /\b(?:bfn-brand|furnisite-logo|bfn-icon-btn|pop-drawer)\b/i
    );
  });

  // Fallback for templates whose header links sit outside a <nav> element
  if (!navMatched) {
    res = highlightNavSection(res, effectivePath, activeSlug, /\b(?:bfn-brand|furnisite-logo|bfn-icon-btn|pop-drawer)\b/i);
  }
  return res;
}

