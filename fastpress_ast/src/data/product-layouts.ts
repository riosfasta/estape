import fs from 'node:fs';
import path from 'node:path';
import { getProductCategoriesArray, type Product } from './products';
import { syncGlobalTemplates, cleanLiveContent } from './templates';

import { getDataFile } from '../core/tenantContext';
export interface ProductLayout {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  appliedProductSlugs: string[];
  html: string;
  css: string;
  projectData?: any;
  createdAt?: string;
  updatedAt?: string;
}


const DEFAULT_STANDARD_CSS = `/* Standard E-Commerce Product Layout */
.standard-product-layout {
  font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background-color: #090a0f;
  color: #e5e7eb;
  min-height: 80vh;
}
.standard-product-layout .layout-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 20px;
}
.standard-product-layout .product-breadcrumb-wrap {
  padding-top: 2rem;
  padding-bottom: 0.75rem;
}
.standard-product-layout .breadcrumb-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 0.85rem;
  color: #9ca3af;
}
.standard-product-layout .breadcrumb-list a {
  color: #cbd5e1;
  text-decoration: none;
  transition: color 0.15s ease;
}
.standard-product-layout .breadcrumb-list a:hover {
  color: #ff5e3a;
}
.standard-product-layout .breadcrumb-current {
  color: #ffffff;
  font-weight: 600;
}
.standard-product-layout .product-main-section {
  padding: 1.5rem 0 3.5rem;
}
.standard-product-layout .product-showcase-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
  gap: 3rem;
  align-items: start;
}
@media (max-width: 900px) {
  .standard-product-layout .product-showcase-grid {
    grid-template-columns: 1fr;
    gap: 2rem;
  }
}
.standard-product-layout .main-image-viewport {
  position: relative;
  border-radius: 16px;
  overflow: hidden;
  background: #11141c;
  border: 1px solid #1e2533;
  aspect-ratio: 4 / 5;
}
.standard-product-layout .main-image-viewport img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: opacity 0.2s ease, transform 0.35s ease;
}
.standard-product-layout .gallery-badges-overlay {
  position: absolute;
  top: 16px;
  left: 16px;
  right: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  pointer-events: none;
}
.standard-product-layout .badge-discount-tag {
  background: #ef4444;
  color: #fff;
  font-size: 0.72rem;
  font-weight: 800;
  padding: 4px 10px;
  border-radius: 6px;
  letter-spacing: 0.04em;
}
.standard-product-layout .badge-stock-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(15, 19, 29, 0.85);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(16, 185, 129, 0.35);
  color: #6ee7b7;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 5px 11px;
  border-radius: 9999px;
}
.standard-product-layout .badge-stock-pill.out-of-stock {
  border-color: rgba(239, 68, 68, 0.4);
  color: #fca5a5;
}
.standard-product-layout .badge-stock-pill.preorder {
  border-color: rgba(245, 158, 11, 0.4);
  color: #fcd34d;
}
.standard-product-layout .stock-pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}
.standard-product-layout .gallery-thumbs-reel {
  display: flex;
  gap: 10px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.standard-product-layout .gallery-thumb-btn {
  width: 74px;
  height: 88px;
  border-radius: 10px;
  overflow: hidden;
  padding: 0;
  background: #11141c;
  border: 2px solid #1e2533;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.15s ease;
}
.standard-product-layout .gallery-thumb-btn.active,
.standard-product-layout .gallery-thumb-btn:hover {
  border-color: #ff5e3a;
  transform: translateY(-2px);
}
.standard-product-layout .gallery-thumb-btn img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.standard-product-layout .info-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}
.standard-product-layout .product-category-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 9999px;
  background: rgba(255, 94, 58, 0.14);
  color: #ff7b5a;
  font-size: 0.74rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  text-decoration: none;
}
.standard-product-layout .sku-text {
  font-size: 0.78rem;
  color: #94a3b8;
}
.standard-product-layout .single-product-title {
  font-family: 'Montserrat', sans-serif;
  font-size: clamp(1.75rem, 2.6vw, 2.4rem);
  font-weight: 800;
  color: #ffffff;
  line-height: 1.2;
  margin: 0 0 8px 0;
}
.standard-product-layout .single-product-subtitle {
  font-size: 0.98rem;
  color: #94a3b8;
  line-height: 1.5;
  margin: 0 0 14px 0;
}
.standard-product-layout .rating-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  color: #cbd5e1;
  margin-bottom: 18px;
}
.standard-product-layout .stars-gold {
  color: #fbbf24;
  letter-spacing: 2px;
}
.standard-product-layout .pricing-card {
  background: #11141c;
  border: 1px solid #1f2633;
  border-radius: 12px;
  padding: 16px 18px;
  margin-bottom: 20px;
}
.standard-product-layout .price-display {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.standard-product-layout .main-price {
  font-size: 2rem;
  font-weight: 800;
  color: #ffffff;
}
.standard-product-layout .strike-price {
  font-size: 1.05rem;
  color: #64748b;
  text-decoration: line-through;
}
.standard-product-layout .savings-callout {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  color: #34d399;
  font-size: 0.82rem;
}
.standard-product-layout .variant-group {
  margin-bottom: 18px;
}
.standard-product-layout .variant-label-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 0.85rem;
}
.standard-product-layout .variant-label {
  color: #94a3b8;
}
.standard-product-layout .variant-selected-value {
  color: #ffffff;
}
.standard-product-layout .color-swatches-list {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.standard-product-layout .color-swatch-item {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 2px solid #2b3446;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 0.75rem;
  font-weight: 800;
  transition: transform 0.15s ease, border-color 0.15s ease;
}
.standard-product-layout .color-swatch-item .swatch-check {
  opacity: 0;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
}
.standard-product-layout .color-swatch-item.selected {
  border-color: #ff5e3a;
  transform: scale(1.08);
  box-shadow: 0 0 0 2px rgba(255, 94, 58, 0.35);
}
.standard-product-layout .color-swatch-item.selected .swatch-check {
  opacity: 1;
}
.standard-product-layout .size-chips-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.standard-product-layout .size-chip-btn {
  min-width: 48px;
  padding: 8px 14px;
  background: #11141c;
  color: #cbd5e1;
  border: 1px solid #232b3a;
  border-radius: 8px;
  font-weight: 700;
  font-size: 0.84rem;
  cursor: pointer;
  transition: all 0.15s ease;
}
.standard-product-layout .size-chip-btn.selected,
.standard-product-layout .size-chip-btn:hover {
  border-color: #ff5e3a;
  color: #ffffff;
}
.standard-product-layout .size-chip-btn.selected {
  background: #ff5e3a;
}
.standard-product-layout .quantity-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 20px;
}
.standard-product-layout .qty-stepper {
  display: inline-flex;
  align-items: center;
  border: 1px solid #232b3a;
  border-radius: 8px;
  background: #11141c;
  overflow: hidden;
}
.standard-product-layout .btn-qty {
  width: 36px;
  height: 36px;
  border: none;
  background: transparent;
  color: #e5e7eb;
  font-size: 1.1rem;
  cursor: pointer;
}
.standard-product-layout .btn-qty:hover {
  background: #1b2232;
}
.standard-product-layout .qty-number {
  width: 46px;
  text-align: center;
  background: transparent;
  border: none;
  color: #ffffff;
  font-weight: 700;
  font-size: 0.92rem;
}
.standard-product-layout .buy-action-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 22px;
}
.standard-product-layout .btn-primary-buy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  padding: 14px 22px;
  background: #ff5e3a;
  color: #ffffff;
  font-weight: 700;
  font-size: 1rem;
  border-radius: 10px;
  text-decoration: none;
  box-shadow: 0 8px 24px rgba(255, 94, 58, 0.3);
  transition: transform 0.15s ease, filter 0.15s ease;
}
.standard-product-layout .btn-primary-buy:hover {
  transform: translateY(-1px);
  filter: brightness(1.06);
}
.standard-product-layout .btn-secondary-inquire {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 12px 18px;
  background: #11141c;
  color: #e5e7eb;
  border: 1px solid #262f40;
  font-weight: 600;
  font-size: 0.9rem;
  border-radius: 10px;
  text-decoration: none;
  transition: border-color 0.15s ease, color 0.15s ease;
}
.standard-product-layout .btn-secondary-inquire:hover {
  border-color: #ff5e3a;
  color: #ffffff;
}
.standard-product-layout .trust-features-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid #1e2533;
}
.standard-product-layout .trust-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 0.8rem;
  color: #94a3b8;
}
.standard-product-layout .trust-item strong {
  display: block;
  color: #f3f4f6;
  font-size: 0.83rem;
}
.standard-product-layout .product-details-section {
  background: #0d1018;
  border-top: 1px solid #1e2533;
  border-bottom: 1px solid #1e2533;
  padding: 3rem 0;
}
.standard-product-layout .tabs-nav-bar {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid #1e2533;
  margin-bottom: 1.75rem;
  flex-wrap: wrap;
}
.standard-product-layout .tab-nav-btn {
  padding: 10px 16px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: #94a3b8;
  font-weight: 700;
  font-size: 0.9rem;
  cursor: pointer;
}
.standard-product-layout .tab-nav-btn.active {
  color: #ffffff;
  border-bottom-color: #ff5e3a;
}
.standard-product-layout .tab-pane {
  display: none;
}
.standard-product-layout .tab-pane.active {
  display: block;
}
.standard-product-layout .rich-desc-content {
  font-size: 1rem;
  line-height: 1.75;
  color: #cbd5e1;
}
.standard-product-layout .rich-desc-content h3,
.standard-product-layout .rich-desc-content h4 {
  color: #ffffff;
  margin: 1.25rem 0 0.6rem;
}
.standard-product-layout .rich-desc-content ul {
  padding-left: 1.25rem;
  margin: 0.75rem 0;
}
.standard-product-layout .rich-desc-content li {
  margin-bottom: 0.45rem;
}
.standard-product-layout .specs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
.standard-product-layout .specs-table th,
.standard-product-layout .specs-table td {
  padding: 12px 14px;
  border-bottom: 1px solid #1e2533;
  text-align: left;
}
.standard-product-layout .specs-table th {
  color: #94a3b8;
  font-weight: 700;
  width: 220px;
}
.standard-product-layout .specs-table td {
  color: #e5e7eb;
}
.standard-product-layout .product-tags-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid #1e2533;
}
.standard-product-layout .tag-pill {
  padding: 4px 10px;
  border-radius: 6px;
  background: #161b26;
  border: 1px solid #232b3a;
  color: #cbd5e1;
  font-size: 0.78rem;
}
.standard-product-layout .related-products-section {
  padding: 3.5rem 0 4.5rem;
}
.standard-product-layout .related-header {
  text-align: center;
  margin-bottom: 2rem;
}
.standard-product-layout .related-tag {
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #ff5e3a;
}
.standard-product-layout .related-heading {
  font-family: 'Montserrat', sans-serif;
  font-size: 1.75rem;
  font-weight: 800;
  color: #ffffff;
  margin: 6px 0 0;
}
.standard-product-layout .related-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 20px;
}
.standard-product-layout .related-card {
  background: #11141c;
  border: 1px solid #1e2533;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: transform 0.2s ease, border-color 0.2s ease;
}
.standard-product-layout .related-card:hover {
  transform: translateY(-4px);
  border-color: rgba(255, 94, 58, 0.45);
}
.standard-product-layout .related-thumb-link {
  position: relative;
  display: block;
  aspect-ratio: 4 / 5;
  overflow: hidden;
  background: #0d1018;
}
.standard-product-layout .related-thumb-link img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.standard-product-layout .related-cat-badge {
  position: absolute;
  top: 10px;
  left: 10px;
  padding: 3px 9px;
  border-radius: 9999px;
  background: rgba(9, 10, 15, 0.8);
  color: #ff7b5a;
  font-size: 0.7rem;
  font-weight: 700;
}
.standard-product-layout .related-body {
  padding: 16px;
}
.standard-product-layout .related-title {
  font-size: 1rem;
  font-weight: 700;
  color: #ffffff;
  margin: 0 0 8px 0;
}
.standard-product-layout .related-title a {
  color: inherit;
  text-decoration: none;
}
.standard-product-layout .related-price-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.standard-product-layout .rel-price {
  font-weight: 800;
  color: #ffffff;
}
.standard-product-layout .rel-compare {
  color: #64748b;
  text-decoration: line-through;
  font-size: 0.85rem;
}`;

const DEFAULT_STANDARD_HTML = `<article class="single-product-article standard-product-layout" data-product-layout="standard-product-default">
  <div class="layout-container product-breadcrumb-wrap">
    <div data-product-element="breadcrumbs">
      <nav class="breadcrumb-nav" aria-label="Breadcrumb">
        <ol class="breadcrumb-list">
          <li><a href="/">Home</a></li>
          <li aria-hidden="true">/</li>
          <li><a href="/products">Products</a></li>
          <li aria-hidden="true">/</li>
          <li class="breadcrumb-current">Product Title</li>
        </ol>
      </nav>
    </div>
  </div>

  <section class="product-main-section">
    <div class="layout-container product-showcase-grid">
      <div class="product-gallery-col">
        <div data-product-element="gallery">
          <div class="main-image-viewport">
            <img id="mainProductImg" src="https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=80" alt="Product" class="main-img" />
          </div>
        </div>
      </div>

      <div class="product-info-col">
        <div class="info-top-row">
          <div data-product-element="categories" style="display: flex; flex-wrap: wrap; gap: 8px;">
            <span class="product-category-badge">Category</span>
          </div>
          <span class="sku-text" data-product-element="sku">SKU: SKU-001</span>
        </div>

        <h1 class="single-product-title" data-product-element="title">Product Title</h1>
        <p class="single-product-subtitle" data-product-element="subtitle">Product subtitle &amp; material highlight</p>

        <div class="rating-strip" data-product-element="rating">
          <div class="stars-gold">★★★★★</div>
          <span>4.9 • 100 Customer Reviews</span>
        </div>

        <div class="pricing-card" data-product-element="price">
          <div class="price-display">
            <span class="main-price">$34.00</span>
          </div>
        </div>

        <p data-product-element="description" style="color: #cbd5e1; line-height: 1.65; margin: 0 0 18px 0; font-size: 0.94rem;">
          Product summary goes here.
        </p>

        <div data-product-element="variants">
          <div class="variant-group">
            <div class="variant-label-row"><span class="variant-label">Size:</span><strong class="variant-selected-value">M</strong></div>
            <div class="size-chips-list">
              <button type="button" class="size-chip-btn selected">M</button>
              <button type="button" class="size-chip-btn">L</button>
            </div>
          </div>
        </div>

        <div class="buy-action-box" data-product-element="buy-buttons">
          <a href="#" class="btn-primary-buy" id="btnPrimaryBuy">Order Product Now</a>
        </div>

        <div class="trust-features-grid">
          <div class="trust-item">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff5e3a" stroke-width="2"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>
            <div><strong>Express Dispatch</strong><span>Ships within 24–48 hours</span></div>
          </div>
          <div class="trust-item">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff5e3a" stroke-width="2"><path d="M2.5 2v6h6M21.5 22v-6h-6"></path><path d="M22 11.5A10 10 0 0 0 3.2 7.2M2 12.5a10 10 0 0 0 18.8 4.2"></path></svg>
            <div><strong>Free 30-Day Returns</strong><span>Hassle-free size exchange</span></div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="product-details-section" id="tabSpecs">
    <div class="layout-container">
      <div class="tabs-nav-bar">
        <button type="button" class="tab-nav-btn active" data-tab-target="tab-overview">Overview &amp; Features</button>
        <button type="button" class="tab-nav-btn" data-tab-target="tab-specs">Technical Specs</button>
        <button type="button" class="tab-nav-btn" data-tab-target="tab-size-guide">Size Chart &amp; Fit</button>
        <button type="button" class="tab-nav-btn" data-tab-target="tab-shipping">Shipping &amp; Returns</button>
      </div>
      <div class="tabs-content-viewport">
        <div class="tab-pane active" id="tab-overview">
          <div data-product-element="content" class="rich-desc-content">
            <h3>Product Overview</h3>
            <p>Detailed product overview and fabric construction specifications appear here automatically for each product.</p>
          </div>
        </div>
        <div class="tab-pane" id="tab-specs">
          <table class="specs-table">
            <tbody>
              <tr><th>Material</th><td>Heavyweight Combed Cotton / Loopback French Terry</td></tr>
              <tr><th>Fit Profile</th><td>Relaxed Boxy Silhouette, Dropped Shoulder</td></tr>
              <tr><th>Care</th><td>Machine wash cold inside-out. Hang dry to maintain drape.</td></tr>
            </tbody>
          </table>
        </div>
        <div class="tab-pane" id="tab-size-guide">
          <table class="specs-table">
            <thead><tr><th>Size</th><th>Chest (cm)</th><th>Length (cm)</th><th>Shoulder (cm)</th></tr></thead>
            <tbody>
              <tr><td><strong>S</strong></td><td>54 cm</td><td>69 cm</td><td>50 cm</td></tr>
              <tr><td><strong>M</strong></td><td>57 cm</td><td>72 cm</td><td>52 cm</td></tr>
              <tr><td><strong>L</strong></td><td>60 cm</td><td>75 cm</td><td>54 cm</td></tr>
              <tr><td><strong>XL</strong></td><td>63 cm</td><td>78 cm</td><td>56 cm</td></tr>
            </tbody>
          </table>
        </div>
        <div class="tab-pane" id="tab-shipping">
          <div class="rich-desc-content">
            <h3>Shipping &amp; Returns</h3>
            <p>Orders ship within 1–2 business days with 30-day size exchange guarantee.</p>
          </div>
        </div>
      </div>

      <div data-product-element="tags" class="product-tags-row">
        <span class="tag-pill">#Apparel</span>
      </div>
    </div>
  </section>

  <div data-product-element="related"></div>
</article>`;

const MINIMAL_EDITORIAL_CSS = `/* Minimal Editorial Product Layout */
.editorial-product-layout {
  font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
  background-color: #090a0f;
  color: #f3f4f6;
  padding-bottom: 4rem;
}
.editorial-product-layout .layout-container {
  max-width: 980px;
  margin: 0 auto;
  padding: 0 20px;
}
.editorial-product-layout .editorial-header {
  text-align: center;
  padding: 2.5rem 0 1.75rem;
}
.editorial-product-layout .single-product-title {
  font-family: 'Montserrat', sans-serif;
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 800;
  margin: 0.75rem 0 0.5rem;
  color: #ffffff;
}
.editorial-product-layout .single-product-subtitle {
  color: #94a3b8;
  font-size: 1.05rem;
  margin: 0 0 1rem;
}
.editorial-product-layout .editorial-hero-media {
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid #1e2533;
  margin-bottom: 2rem;
  background: #11141c;
}
.editorial-product-layout .editorial-hero-media img {
  width: 100%;
  max-height: 540px;
  object-fit: cover;
  display: block;
}
.editorial-product-layout .editorial-purchase-bar {
  background: #11141c;
  border: 1px solid #232b3a;
  border-radius: 16px;
  padding: 1.75rem;
  margin-bottom: 2.5rem;
}
.editorial-product-layout .product-category-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 9999px;
  background: rgba(255, 94, 58, 0.14);
  color: #ff7b5a;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  text-decoration: none;
}
.editorial-product-layout .main-price {
  font-size: 1.85rem;
  font-weight: 800;
  color: #fff;
}
.editorial-product-layout .strike-price {
  color: #64748b;
  text-decoration: line-through;
  margin-left: 8px;
}
.editorial-product-layout .btn-primary-buy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 14px 20px;
  border-radius: 10px;
  background: #ff5e3a;
  color: #fff;
  font-weight: 700;
  text-decoration: none;
}
.editorial-product-layout .rich-desc-content {
  font-size: 1.04rem;
  line-height: 1.8;
  color: #cbd5e1;
}`;

const MINIMAL_EDITORIAL_HTML = `<article class="single-product-article editorial-product-layout" data-product-layout="minimal-editorial-showcase">
  <header class="layout-container editorial-header">
    <div data-product-element="breadcrumbs" style="display: flex; justify-content: center;"></div>
    <div data-product-element="categories" style="display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; margin-top: 12px;">
      <span class="product-category-badge">Collection</span>
    </div>
    <h1 class="single-product-title" data-product-element="title">Product Title</h1>
    <p class="single-product-subtitle" data-product-element="subtitle">Limited Apparel Release</p>
  </header>

  <div class="layout-container">
    <div class="editorial-hero-media" data-product-element="gallery">
      <img id="mainProductImg" src="https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=900&q=80" alt="Product" class="main-img" />
    </div>

    <div class="editorial-purchase-bar">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px;">
        <div data-product-element="price"><span class="main-price">$49.00</span></div>
        <div data-product-element="sku" style="font-size: 0.82rem; color: #94a3b8;">SKU: DROP-001</div>
      </div>
      <div data-product-element="variants" style="margin-bottom: 16px;"></div>
      <div data-product-element="buy-buttons">
        <a href="#" class="btn-primary-buy" id="btnPrimaryBuy">Order Now</a>
      </div>
    </div>

    <div data-product-element="content" class="rich-desc-content">
      <h3>Design Story</h3>
      <p>Product story and garment construction details appear here.</p>
    </div>

    <div data-product-element="tags" style="margin-top: 24px; display: flex; gap: 8px; flex-wrap: wrap;"></div>
  </div>

  <div data-product-element="related" style="margin-top: 40px;"></div>
</article>`;

export const defaultProductLayouts: ProductLayout[] = [
  {
    id: 'standard-product-default',
    name: 'Standard Product Layout (Default)',
    description: '2-column e-commerce showcase with interactive gallery, variant swatches, specs tabs, and related products.',
    isDefault: true,
    appliedProductSlugs: [],
    html: DEFAULT_STANDARD_HTML,
    css: DEFAULT_STANDARD_CSS,
  },
  {
    id: 'minimal-editorial-showcase',
    name: 'Minimal Editorial Lookbook',
    description: 'Centered editorial lookbook layout ideal for featured drops and limited capsule releases.',
    isDefault: false,
    appliedProductSlugs: [],
    html: MINIMAL_EDITORIAL_HTML,
    css: MINIMAL_EDITORIAL_CSS,
  },
];

export function getProductLayouts(): ProductLayout[] {
  try {
    if (fs.existsSync(getDataFile('product-layouts.json'))) {
      const raw = fs.readFileSync(getDataFile('product-layouts.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}
  return defaultProductLayouts;
}

export function getProductLayoutById(id: string): ProductLayout {
  const layouts = getProductLayouts();
  return layouts.find((l) => l.id === id) || layouts.find((l) => l.isDefault) || layouts[0];
}

export function getProductLayoutForProduct(product: Product): ProductLayout {
  const layouts = getProductLayouts();
  if (product.layoutId) {
    const byId = layouts.find((l) => l.id === product.layoutId);
    if (byId) return byId;
  }
  const bySlug = layouts.find((l) => Array.isArray(l.appliedProductSlugs) && l.appliedProductSlugs.includes(product.slug));
  if (bySlug) return bySlug;
  return layouts.find((l) => l.isDefault) || layouts[0];
}

export function writeProductLayoutsSync(layouts: ProductLayout[]): void {
  fs.writeFileSync(getDataFile('product-layouts.json'), JSON.stringify(layouts, null, 2), 'utf-8');
}

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Finds and replaces inner HTML (or strips an element) matching `attrName="attrValue"`
 * while tracking nested matching tags so inner nested <div>s never terminate early.
 */
function replaceAttrElement(
  html: string,
  attrName: string,
  attrValue: string,
  replacer: (inner: string, openTag: string, tagName: string) => string
): string {
  const escapedVal = attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const openRegex = new RegExp(`<([a-zA-Z][a-zA-Z0-9-]*)\\b[^>]*\\b${attrName}=["']${escapedVal}["'][^>]*>`, 'gi');

  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = openRegex.exec(html)) !== null) {
    const matchStart = match.index;
    const openTag = match[0];
    const tagName = match[1].toLowerCase();
    const afterOpen = matchStart + openTag.length;

    if (matchStart < lastIndex) continue;

    if (openTag.endsWith('/>') || VOID_TAGS.has(tagName)) {
      result += html.slice(lastIndex, matchStart) + replacer('', openTag, tagName);
      lastIndex = afterOpen;
      continue;
    }

    const tagTokenRegex = new RegExp(`<\\/?${tagName}(?=[\\s>/])[^>]*>`, 'gi');
    tagTokenRegex.lastIndex = afterOpen;
    let depth = 1;
    let closeStart = -1;
    let closeEnd = -1;
    let tok: RegExpExecArray | null;

    while ((tok = tagTokenRegex.exec(html)) !== null) {
      const tokenStr = tok[0];
      if (tokenStr.startsWith('</')) {
        depth--;
        if (depth === 0) {
          closeStart = tok.index;
          closeEnd = tok.index + tokenStr.length;
          break;
        }
      } else if (!tokenStr.endsWith('/>')) {
        depth++;
      }
    }

    if (closeStart === -1) {
      break;
    }

    const innerHtml = html.slice(afterOpen, closeStart);
    const replacementInner = replacer(innerHtml, openTag, tagName);
    const closeTag = html.slice(closeStart, closeEnd);

    result += html.slice(lastIndex, matchStart) + openTag + replacementInner + closeTag;
    lastIndex = closeEnd;
    openRegex.lastIndex = closeEnd;
  }

  result += html.slice(lastIndex);
  return result;
}

export function buildPrimaryBuyUrl(product: Product): string {
  const buyBtn = product.buyButton || { type: 'custom_url', url: '#', label: 'Order Now' };
  if (buyBtn.type === 'whatsapp') {
    const rawNumber = String(buyBtn.whatsappNumber || '6281234567890').replace(/[^0-9]/g, '');
    const defaultMsg = `Hi! I would like to order "${product.title}" (${product.currency || '$'}${Number(product.price || 0).toFixed(2)}). Please let me know how to proceed.`;
    return `https://wa.me/${rawNumber}?text=${encodeURIComponent(buyBtn.whatsappMessage || defaultMsg)}`;
  }
  return buyBtn.url || '#';
}

export function buildSecondaryInquiryUrl(product: Product): string {
  const sec = product.secondaryButton;
  if (sec?.type === 'custom_url' && sec.url) return sec.url;
  const rawNumber = String(sec?.whatsappNumber || product.buyButton?.whatsappNumber || '6281234567890').replace(/[^0-9]/g, '');
  const msg = sec?.whatsappMessage || `Hi, I have a question about "${product.title}" (SKU: ${product.sku || product.id}).`;
  return `https://wa.me/${rawNumber}?text=${encodeURIComponent(msg)}`;
}

export function renderProductLayout(
  layout: ProductLayout,
  product: Product,
  allProducts: Product[] = []
): { html: string; css: string } {
  let outputHtml = (layout.html || '').replace(/^<body[^>]*>/i, '').replace(/<\/body>$/i, '').trim();

  const categories = getProductCategoriesArray(product);
  const price = Number(product.price || 0);
  const compareAt = Number(product.compareAtPrice || 0);
  const hasDiscount = compareAt > price;
  const discountPercent = hasDiscount ? Math.round(((compareAt - price) / compareAt) * 100) : 0;
  const savingsAmount = hasDiscount ? (compareAt - price).toFixed(2) : '0.00';
  const currency = product.currency || '$';

  const productTitle = product.title || 'Untitled Product';
  const productSubtitle = product.subtitle || '';
  const productDescription = product.description || '';
  const productImage = product.image || 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=80';
  const galleryImages = Array.from(new Set([productImage, ...(Array.isArray(product.gallery) ? product.gallery : [])].filter(Boolean)));
  const rating = Number(product.rating || 5);
  const reviewsCount = Number(product.reviewsCount || 0);
  const sku = product.sku || product.id;

  const stockLabel =
    product.stockStatus === 'out_of_stock'
      ? 'Out of Stock'
      : product.stockStatus === 'preorder'
        ? 'Pre-Order Open'
        : 'In Stock (Ready to Ship)';
  const stockClass =
    product.stockStatus === 'out_of_stock'
      ? 'out-of-stock'
      : product.stockStatus === 'preorder'
        ? 'preorder'
        : 'in-stock';

  const primaryBuyUrl = buildPrimaryBuyUrl(product);
  const secondaryBuyUrl = buildSecondaryInquiryUrl(product);
  const buyBgStyle = product.buyButton?.buttonBg
    ? `background: ${escapeHtml(product.buyButton.buttonBg)}; color: ${escapeHtml(product.buyButton.buttonColor || '#ffffff')};`
    : '';

  // 1. Breadcrumbs
  const primaryCat = categories[0] || 'Products';
  const breadcrumbHtml = `
    <nav class="breadcrumb-nav" aria-label="Breadcrumb">
      <ol class="breadcrumb-list">
        <li><a href="/">Home</a></li>
        <li aria-hidden="true">/</li>
        <li><a href="/products">Products</a></li>
        <li aria-hidden="true">/</li>
        <li><a href="/products?category=${encodeURIComponent(primaryCat)}">${escapeHtml(primaryCat)}</a></li>
        <li aria-hidden="true">/</li>
        <li class="breadcrumb-current" aria-current="page">${escapeHtml(productTitle)}</li>
      </ol>
    </nav>
  `;
  outputHtml = replaceAttrElement(outputHtml, 'data-product-element', 'breadcrumbs', () => breadcrumbHtml);

  // 2. Categories badges
  const categoriesHtml = categories
    .map(
      (cat) =>
        `<a href="/products?category=${encodeURIComponent(cat)}" class="product-category-badge">${escapeHtml(cat)}</a>`
    )
    .join('');
  outputHtml = replaceAttrElement(outputHtml, 'data-product-element', 'categories', () => categoriesHtml);

  // 3. SKU & Stock badge
  outputHtml = replaceAttrElement(outputHtml, 'data-product-element', 'sku', () => `SKU: <strong>${escapeHtml(sku)}</strong>`);
  outputHtml = replaceAttrElement(outputHtml, 'data-product-element', 'stock-badge', () => (
    `<span class="badge-stock-pill ${stockClass}"><span class="stock-pulse"></span>${escapeHtml(stockLabel)}</span>`
  ));

  // 4. Title, Subtitle, Description
  outputHtml = replaceAttrElement(outputHtml, 'data-product-element', 'title', () => escapeHtml(productTitle));
  outputHtml = replaceAttrElement(outputHtml, 'data-product-element', 'subtitle', () => escapeHtml(productSubtitle));
  outputHtml = replaceAttrElement(outputHtml, 'data-product-element', 'description', () => escapeHtml(productDescription));

  // 5. Rating
  const fullStars = Math.max(1, Math.min(5, Math.round(rating)));
  const ratingHtml = `
    <div class="stars-gold" aria-label="Rated ${rating.toFixed(1)} out of 5">${'★'.repeat(fullStars)}</div>
    <span class="rating-score">${rating.toFixed(1)}</span>
    <span class="rating-sep">&bull;</span>
    <span class="reviews-link">${reviewsCount} Customer Reviews</span>
  `;
  outputHtml = replaceAttrElement(outputHtml, 'data-product-element', 'rating', () => ratingHtml);

  // 6. Pricing block
  const priceHtml = `
    <div class="price-display">
      <span class="main-price">${escapeHtml(currency)}${price.toFixed(2)}</span>
      ${hasDiscount ? `<span class="strike-price">${escapeHtml(currency)}${compareAt.toFixed(2)}</span>` : ''}
    </div>
    ${hasDiscount ? `<div class="savings-callout">Special Price: You save <strong>${escapeHtml(currency)}${savingsAmount} (${discountPercent}% OFF)</strong></div>` : ''}
  `;
  outputHtml = replaceAttrElement(outputHtml, 'data-product-element', 'price', () => priceHtml);

  // 7. Single featured image (<img data-product-element="image"> or wrapper)
  outputHtml = outputHtml.replace(
    /(<img\b[^>]*\bdata-product-element=["']image["'][^>]*?)(\/?>)/gi,
    (_m, p1, p2) => {
      const cleaned = p1.replace(/\bsrc=["'][^"']*["']/gi, '').replace(/\balt=["'][^"']*["']/gi, '');
      return `${cleaned} src="${escapeHtml(productImage)}" alt="${escapeHtml(productTitle)}" fetchpriority="high" loading="eager"${p2}`;
    }
  );
  outputHtml = replaceAttrElement(outputHtml, 'data-product-element', 'image', (inner, _open, tagName) => {
    if (tagName === 'img') return inner;
    return `<img src="${escapeHtml(productImage)}" alt="${escapeHtml(productTitle)}" fetchpriority="high" loading="eager" style="width:100%;height:100%;object-fit:cover;display:block;" />`;
  });

  // 8. Interactive Gallery
  const galleryHtml = `
    <div class="main-image-viewport">
      <img id="mainProductImg" src="${escapeHtml(productImage)}" alt="${escapeHtml(productTitle)}" class="main-img" fetchpriority="high" loading="eager" />
      <div class="gallery-badges-overlay">
        ${hasDiscount ? `<span class="badge-discount-tag">SAVE ${discountPercent}%</span>` : '<span></span>'}
        <span class="badge-stock-pill ${stockClass}">
          <span class="stock-pulse"></span>
          ${escapeHtml(stockLabel)}
        </span>
      </div>
    </div>
    ${
      galleryImages.length > 1
        ? `<div class="gallery-thumbs-reel" id="galleryThumbsReel">
            ${galleryImages
              .map(
                (img, idx) => `
                  <button type="button" class="gallery-thumb-btn ${idx === 0 ? 'active' : ''}" data-src="${escapeHtml(img)}" aria-label="View product image ${idx + 1}">
                    <img src="${escapeHtml(img)}" alt="${escapeHtml(productTitle)} angle ${idx + 1}" loading="lazy" />
                  </button>`
              )
              .join('')}
          </div>`
        : ''
    }
  `;
  outputHtml = replaceAttrElement(outputHtml, 'data-product-element', 'gallery', () => galleryHtml);

  // 9. Interactive Variants (Colors, Sizes, Quantity Stepper)
  const colors = Array.isArray(product.colors) ? product.colors : [];
  const sizes = Array.isArray(product.sizes) ? product.sizes : [];
  const variantsHtml = `
    ${
      colors.length > 0
        ? `<div class="variant-group">
            <div class="variant-label-row">
              <span class="variant-label">Color:</span>
              <strong id="selectedColorName" class="variant-selected-value">${escapeHtml(colors[0].name)}</strong>
            </div>
            <div class="color-swatches-list">
              ${colors
                .map(
                  (c, idx) =>
                    `<button type="button" class="color-swatch-item ${idx === 0 ? 'selected' : ''}" data-color-name="${escapeHtml(c.name)}" title="${escapeHtml(c.name)}" aria-label="${escapeHtml(c.name)}" style="background-color: ${escapeHtml(c.hex)};"><span class="swatch-check" aria-hidden="true">&#10003;</span></button>`
                )
                .join('')}
            </div>
          </div>`
        : ''
    }
    ${
      sizes.length > 0
        ? `<div class="variant-group">
            <div class="variant-label-row">
              <span class="variant-label">Size:</span>
              <strong id="selectedSizeName" class="variant-selected-value">${escapeHtml(sizes[0])}</strong>
            </div>
            <div class="size-chips-list">
              ${sizes
                .map(
                  (sz, idx) =>
                    `<button type="button" class="size-chip-btn ${idx === 0 ? 'selected' : ''}" data-size="${escapeHtml(sz)}">${escapeHtml(sz)}</button>`
                )
                .join('')}
            </div>
          </div>`
        : ''
    }
    <div class="quantity-row">
      <label for="inputQty" class="variant-label">Quantity:</label>
      <div class="qty-stepper">
        <button type="button" class="btn-qty" id="btnQtyMinus" aria-label="Decrease quantity">&minus;</button>
        <input type="number" id="inputQty" class="qty-number" value="1" min="1" max="99" readonly />
        <button type="button" class="btn-qty" id="btnQtyPlus" aria-label="Increase quantity">+</button>
      </div>
    </div>
  `;
  outputHtml = replaceAttrElement(outputHtml, 'data-product-element', 'variants', () => variantsHtml);

  // 10. CTA Buy Buttons
  const secondaryEnabled = product.secondaryButton ? product.secondaryButton.enabled !== false : true;
  const secondaryLabel = product.secondaryButton?.label || 'Chat / Ask About Fit';
  const buyButtonsHtml = `
    <a href="${escapeHtml(primaryBuyUrl)}" id="btnPrimaryBuy" target="${escapeHtml(product.buyButton?.target || '_blank')}" rel="noopener noreferrer" class="btn-primary-buy" ${buyBgStyle ? `style="${buyBgStyle}"` : ''}>
      <span>${escapeHtml(product.buyButton?.label || 'Order Product Now')}</span>
    </a>
    ${
      secondaryEnabled
        ? `<a href="${escapeHtml(secondaryBuyUrl)}" target="_blank" rel="noopener noreferrer" class="btn-secondary-inquire">
            <span>${escapeHtml(secondaryLabel)}</span>
          </a>`
        : ''
    }
  `;
  outputHtml = replaceAttrElement(outputHtml, 'data-product-element', 'buy-buttons', () => buyButtonsHtml);

  // 11. Detailed Content / Specs
  const richContent = cleanLiveContent(product.content || `<p>${escapeHtml(productDescription)}</p>`);
  outputHtml = replaceAttrElement(outputHtml, 'data-product-element', 'content', () => richContent);

  // 12. Tags
  const tags = Array.isArray(product.tags) ? product.tags : [];
  const tagsHtml =
    tags.length > 0
      ? `<span style="font-size:0.75rem;font-weight:700;color:#94a3b8;text-transform:uppercase;">Tags:</span>${tags
          .map((t) => `<span class="tag-pill">#${escapeHtml(t)}</span>`)
          .join('')}`
      : '';
  outputHtml = replaceAttrElement(outputHtml, 'data-product-element', 'tags', () => tagsHtml);

  // 13. Related Products Section
  let relatedSectionHtml = '';
  if (product.showRelated !== false) {
    const relatedLimit = Math.max(1, Number(product.relatedLimit) || 4);
    const relatedCategory = (product.relatedCategory || 'auto').trim().toLowerCase();
    const orderBy = (product.relatedOrderBy || 'featured').trim();

    let candidates = allProducts.filter((p) => p.id !== product.id && p.slug !== product.slug && p.status !== 'draft');
    if (relatedCategory === 'auto') {
      const currentCats = categories.map((c) => c.toLowerCase());
      const sameCat = candidates.filter((p) =>
        getProductCategoriesArray(p).some((c) => currentCats.includes(c.toLowerCase()))
      );
      const others = candidates.filter((p) => !sameCat.some((s) => s.id === p.id));
      candidates = [...sameCat, ...others];
    } else if (relatedCategory !== 'all') {
      const filtered = candidates.filter((p) =>
        getProductCategoriesArray(p).some((c) => c.toLowerCase() === relatedCategory)
      );
      if (filtered.length > 0) candidates = filtered;
    }

    if (orderBy === 'price-asc') {
      candidates.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
    } else if (orderBy === 'price-desc') {
      candidates.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
    } else if (orderBy === 'rating') {
      candidates.sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0));
    } else if (orderBy === 'title-asc') {
      candidates.sort((a, b) => a.title.localeCompare(b.title));
    } else {
      candidates.sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)));
    }

    const chosenRelated = candidates.slice(0, relatedLimit);
    if (chosenRelated.length > 0) {
      relatedSectionHtml = `
        <section class="related-products-section">
          <div class="layout-container">
            <div class="related-header">
              <span class="related-tag">${escapeHtml(product.relatedTagline || 'COMPLETE THE LOOK')}</span>
              <h2 class="related-heading">${escapeHtml(product.relatedTitle || 'You May Also Like')}</h2>
            </div>
            <div class="related-grid">
              ${chosenRelated
                .map((rel) => {
                  const relCat = getProductCategoriesArray(rel)[0] || 'Apparel';
                  const relPrice = Number(rel.price || 0);
                  const relCompare = Number(rel.compareAtPrice || 0);
                  return `
                    <article class="related-card">
                      <a href="/products/${escapeHtml(rel.slug)}" class="related-thumb-link">
                        <img src="${escapeHtml(rel.image)}" alt="${escapeHtml(rel.title)}" loading="lazy" />
                        <span class="related-cat-badge">${escapeHtml(relCat)}</span>
                      </a>
                      <div class="related-body">
                        <h3 class="related-title"><a href="/products/${escapeHtml(rel.slug)}">${escapeHtml(rel.title)}</a></h3>
                        <div class="related-price-row">
                          <span class="rel-price">${escapeHtml(rel.currency || '$')}${relPrice.toFixed(2)}</span>
                          ${relCompare > relPrice ? `<span class="rel-compare">${escapeHtml(rel.currency || '$')}${relCompare.toFixed(2)}</span>` : ''}
                        </div>
                      </div>
                    </article>
                  `;
                })
                .join('')}
            </div>
          </div>
        </section>
      `;
    }
  }
  outputHtml = replaceAttrElement(outputHtml, 'data-product-element', 'related', () => relatedSectionHtml);

  // 14. Token replacements fallback
  outputHtml = outputHtml
    .replace(/\{\{product\.title\}\}/g, escapeHtml(productTitle))
    .replace(/\{\{product\.subtitle\}\}/g, escapeHtml(productSubtitle))
    .replace(/\{\{product\.description\}\}/g, escapeHtml(productDescription))
    .replace(/\{\{product\.content\}\}/g, richContent)
    .replace(/\{\{product\.price\}\}/g, `${escapeHtml(currency)}${price.toFixed(2)}`)
    .replace(/\{\{product\.compareAtPrice\}\}/g, hasDiscount ? `${escapeHtml(currency)}${compareAt.toFixed(2)}` : '')
    .replace(/\{\{product\.sku\}\}/g, escapeHtml(sku))
    .replace(/\{\{product\.category\}\}/g, escapeHtml(primaryCat))
    .replace(/\{\{product\.image\}\}/g, escapeHtml(productImage))
    .replace(/\{\{product\.buyLabel\}\}/g, escapeHtml(product.buyButton?.label || 'Order Now'))
    .replace(/\{\{product\.buyUrl\}\}/g, escapeHtml(primaryBuyUrl));

  const combinedCss = `${layout.css || ''}\n${product.css || ''}`;

  return {
    html: cleanLiveContent(syncGlobalTemplates(outputHtml)),
    css: combinedCss,
  };
}
