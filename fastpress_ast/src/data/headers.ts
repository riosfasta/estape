import fs from 'node:fs';
import path from 'node:path';

import { getDataFile } from '../core/tenantContext';
export interface DropdownItem {
  id: string;
  label: string;
  url: string;
  description?: string;
  badge?: string;
  icon?: string;
}

export interface MegaMenuItem {
  label: string;
  url: string;
  description?: string;
  badge?: string;
  icon?: string;
}

export interface MegaMenuColumn {
  title: string;
  items: MegaMenuItem[];
}

export interface MegaMenuFeaturedCard {
  title: string;
  description: string;
  buttonText: string;
  buttonUrl: string;
  imageUrl?: string;
  badge?: string;
}

export interface MegaMenuConfig {
  columns: MegaMenuColumn[];
  featuredCard?: MegaMenuFeaturedCard;
}

export interface MenuItem {
  id: string;
  label: string;
  url: string;
  target?: '_self' | '_blank';
  badge?: string;
  badgeColor?: string;
  type: 'link' | 'dropdown' | 'megamenu';
  dropdownItems?: DropdownItem[];
  megaMenu?: MegaMenuConfig;
}

export interface HeaderButton {
  id: string;
  label: string;
  url: string;
  variant: 'primary' | 'secondary' | 'outline' | 'ghost' | 'gradient';
  icon?: string;
  target?: '_self' | '_blank';
  size?: 'sm' | 'md' | 'lg';
  pill?: boolean;
}

export interface HeaderLayout {
  logoPosition: 'left' | 'center' | 'right';
  containerType: 'boxed' | 'wide' | 'full';
  height: number;
  shrunkHeight: number;
  paddingX: number;
}

export interface HeaderBehavior {
  sticky: boolean;
  shrinkOnScroll: boolean;
  shrinkOffset: number;
  glassmorphism: boolean;
  blurStrength: number;
  scrollShadow: 'none' | 'subtle' | 'medium' | 'prominent';
  hideOnScrollDown?: boolean;
}

export interface HeaderStyling {
  bgColor: string;
  scrolledBgColor: string;
  textColor: string;
  accentColor: string;
  borderColor: string;
  fontFamily: string;
  fontSize: string;
  textTransform: 'none' | 'uppercase' | 'capitalize';
  navIndicatorStyle?: 'underline' | 'overline' | 'none';
}

export interface HeaderLogo {
  type: 'text' | 'image' | 'svg';
  text: string;
  tagline?: string;
  imageUrl?: string;
  svgIcon?: string;
  linkUrl: string;
  scaleOnShrink: boolean;
}

export interface HeaderActions {
  showSearch: boolean;
  searchActionUrl: string;
  buttons: HeaderButton[];
}

export interface HeaderCustomCode {
  enabled: boolean;
  desktopHtml: string;
  tabletHtml: string;
  mobileHtml: string;
  customCss: string;
  customJs: string;
}

export interface HeaderConfig {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  source: 'preset' | 'custom';
  theme?: string;
  builderType?: 'visual' | 'custom-code';
  useTemplate?: boolean;
  selectedTemplateId?: string;
  customCode?: HeaderCustomCode;
  layout: HeaderLayout;
  behavior: HeaderBehavior;
  styling: HeaderStyling;
  logo: HeaderLogo;
  menu: MenuItem[];
  actions: HeaderActions;
  updatedAt?: string;
}

export interface HeadersDataStore {
  activeHeaderId: string;
  activeHeaderIds?: Record<string, string>;
  headers: HeaderConfig[];
}


export const defaultSampleHeaders: HeaderConfig[] = [
  {
    id: 'sample-saas-sticky-mega',
    name: 'SaaS Pro (Sticky + Shrink + Mega Menu)',
    description: 'Modern high-converting SaaS header with left logo, shrink on scroll, rich 3-column mega menu, dropdowns, and dual action buttons.',
    isDefault: true,
    source: 'preset',
    layout: {
      logoPosition: 'left',
      containerType: 'boxed',
      height: 80,
      shrunkHeight: 58,
      paddingX: 24,
    },
    behavior: {
      sticky: true,
      shrinkOnScroll: true,
      shrinkOffset: 45,
      glassmorphism: true,
      blurStrength: 16,
      scrollShadow: 'medium',
      hideOnScrollDown: false,
    },
    styling: {
      bgColor: 'rgba(21, 24, 30, 0.94)',
      scrolledBgColor: 'rgba(15, 18, 24, 0.98)',
      textColor: '#f3f4f6',
      accentColor: '#ff5e3a',
      borderColor: 'rgba(255, 255, 255, 0.08)',
      fontFamily: 'Plus Jakarta Sans',
      fontSize: '0.86rem',
      textTransform: 'none',
    },
    logo: {
      type: 'text',
      text: 'Better SaaS',
      tagline: 'Modern Platform',
      linkUrl: '/',
      scaleOnShrink: true,
    },
    menu: [
      {
        id: 'nav-home',
        label: 'Home',
        url: '/',
        type: 'link',
        target: '_self',
      },
      {
        id: 'nav-solutions',
        label: 'Solutions',
        url: '#solutions',
        type: 'megamenu',
        badge: 'New',
        badgeColor: '#ff5e3a',
        megaMenu: {
          columns: [
            {
              title: 'Product Features',
              items: [
                {
                  label: 'Visual Page Builder',
                  url: '/editor',
                  description: 'Drag & drop blocks to craft pixel-perfect landing pages.',
                  badge: 'v2.4',
                  icon: '⚡',
                },
                {
                  label: 'Popup System',
                  url: '/popup-editor',
                  description: 'Trigger targeted popups and convert site visitors.',
                  icon: '🎯',
                },
                {
                  label: 'Blog Layout Engine',
                  url: '/blog-layout-editor',
                  description: 'Custom magazine and editorial layouts for your posts.',
                  icon: '📰',
                },
              ],
            },
            {
              title: 'Insights & Strategy',
              items: [
                {
                  label: 'Branding & Identity Guide',
                  url: '/blog/branding-identity-modern-age',
                  description: 'Membangun identitas visual abadi di era digital.',
                  badge: 'Popular',
                  icon: '💎',
                },
                {
                  label: 'Online Marketing Growth',
                  url: '/blog/online-marketing-strategies-growth',
                  description: 'Strategi pertumbuhan terukur untuk bisnis modern.',
                  icon: '📈',
                },
                {
                  label: 'Graphic Design Hierarchy',
                  url: '/blog/graphic-design-principles-conversion',
                  description: 'Prinsip tata letak visual yang mendongkrak konversi.',
                  icon: '🎨',
                },
              ],
            },
          ],
          featuredCard: {
            title: 'Explore FastPress CMS',
            description: 'Discover how modern agencies scale web production 10x faster with Astro.',
            buttonText: 'Read All Articles',
            buttonUrl: '/blog',
            imageUrl: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=600&q=80',
            badge: 'Featured',
          },
        },
      },
      {
        id: 'nav-company',
        label: 'Company',
        url: '#company',
        type: 'dropdown',
        dropdownItems: [
          {
            id: 'drop-about',
            label: 'About Better',
            url: '/tentang-kami',
            description: 'Our mission, team, and story.',
            icon: '🏢',
          },
          {
            id: 'drop-blog',
            label: 'Blog & Articles',
            url: '/blog',
            description: 'Latest news, engineering, and design updates.',
            badge: '5 Posts',
            icon: '✍️',
          },
          {
            id: 'drop-portfolio',
            label: 'Our Work & Portfolio',
            url: '/#work',
            description: 'Recent client showcases and success stories.',
            icon: '🏆',
          },
          {
            id: 'drop-services',
            label: 'Services & Pricing',
            url: '/#services',
            description: 'Custom web development and marketing tiers.',
            icon: '🛠️',
          },
        ],
      },
      {
        id: 'nav-pricing',
        label: 'Services',
        url: '/#services',
        type: 'link',
        target: '_self',
      },
      {
        id: 'nav-contact',
        label: 'Contact',
        url: '/#contact',
        type: 'link',
        target: '_self',
      },
    ],
    actions: {
      showSearch: true,
      searchActionUrl: '/blog',
      buttons: [
        {
          id: 'btn-login',
          label: 'Sign In',
          url: '/editor',
          variant: 'ghost',
          target: '_self',
          size: 'sm',
          pill: false,
        },
        {
          id: 'btn-cta',
          label: 'Get Started',
          url: '/editor',
          variant: 'primary',
          icon: 'arrow',
          target: '_self',
          size: 'sm',
          pill: true,
        },
      ],
    },
  },
  {
    id: 'sample-centered-luxury',
    name: 'Centered Brand (Luxury Centered Logo + Dropdowns)',
    description: 'Symmetrical, balanced luxury layout with centered logo typography, balanced navigation items on both sides, and elegant pill action button.',
    isDefault: false,
    source: 'preset',
    layout: {
      logoPosition: 'center',
      containerType: 'wide',
      height: 76,
      shrunkHeight: 62,
      paddingX: 32,
    },
    behavior: {
      sticky: true,
      shrinkOnScroll: true,
      shrinkOffset: 50,
      glassmorphism: true,
      blurStrength: 14,
      scrollShadow: 'subtle',
      hideOnScrollDown: false,
    },
    styling: {
      bgColor: '#11141a',
      scrolledBgColor: 'rgba(17, 20, 26, 0.98)',
      textColor: '#ffffff',
      accentColor: '#e5a93c',
      borderColor: 'rgba(229, 169, 60, 0.2)',
      fontFamily: 'Montserrat',
      fontSize: '0.82rem',
      textTransform: 'uppercase',
    },
    logo: {
      type: 'text',
      text: 'ATELIER BETTER',
      tagline: 'HAUTE DESIGN & DIGITAL',
      linkUrl: '/',
      scaleOnShrink: true,
    },
    menu: [
      {
        id: 'cen-home',
        label: 'Home',
        url: '/',
        type: 'link',
        target: '_self',
      },
      {
        id: 'cen-about',
        label: 'Tentang Kami',
        url: '/tentang-kami',
        type: 'link',
        target: '_self',
      },
      {
        id: 'cen-collections',
        label: 'Editorial',
        url: '/blog',
        type: 'dropdown',
        badge: 'New',
        dropdownItems: [
          {
            id: 'drop-ed-all',
            label: 'All Articles',
            url: '/blog',
            description: 'Read all insights and publications.',
          },
          {
            id: 'drop-ed-1',
            label: 'Branding & Identitas',
            url: '/blog/branding-identity-modern-age',
            description: 'Membangun identitas visual abadi.',
          },
          {
            id: 'drop-ed-2',
            label: 'Graphic Design Hierarchy',
            url: '/blog/graphic-design-principles-conversion',
            description: 'Prinsip tata letak & konversi.',
          },
        ],
      },
      {
        id: 'cen-work',
        label: 'Portfolio',
        url: '/#work',
        type: 'link',
        target: '_self',
      },
      {
        id: 'cen-contact',
        label: 'Contact',
        url: '/#contact',
        type: 'link',
        target: '_self',
      },
    ],
    actions: {
      showSearch: true,
      searchActionUrl: '/blog',
      buttons: [
        {
          id: 'btn-cen-book',
          label: 'Book Consultation',
          url: '/#contact',
          variant: 'outline',
          icon: 'sparkle',
          target: '_self',
          size: 'sm',
          pill: true,
        },
      ],
    },
  },
  {
    id: 'sample-right-logo-enterprise',
    name: 'Right Logo & Split Nav (Creative Right Branding)',
    description: 'Bold creative header with logo anchored on the right, multi-button combo on the left, and standard/dropdown menu positioned intuitively.',
    isDefault: false,
    source: 'preset',
    layout: {
      logoPosition: 'right',
      containerType: 'boxed',
      height: 84,
      shrunkHeight: 60,
      paddingX: 24,
    },
    behavior: {
      sticky: true,
      shrinkOnScroll: true,
      shrinkOffset: 40,
      glassmorphism: true,
      blurStrength: 18,
      scrollShadow: 'prominent',
      hideOnScrollDown: false,
    },
    styling: {
      bgColor: '#161922',
      scrolledBgColor: 'rgba(15, 17, 23, 0.98)',
      textColor: '#e5e7eb',
      accentColor: '#3b82f6',
      borderColor: 'rgba(255, 255, 255, 0.1)',
      fontFamily: 'Plus Jakarta Sans',
      fontSize: '0.88rem',
      textTransform: 'none',
    },
    logo: {
      type: 'text',
      text: 'Enterprise Core',
      tagline: 'Better Cloud Systems',
      linkUrl: '/',
      scaleOnShrink: true,
    },
    menu: [
      {
        id: 'rt-home',
        label: 'Home',
        url: '/',
        type: 'link',
      },
      {
        id: 'rt-resources',
        label: 'Knowledge Hub',
        url: '/blog',
        type: 'dropdown',
        badge: 'Live',
        dropdownItems: [
          {
            id: 'rt-blog',
            label: 'Engineering Blog',
            url: '/blog',
            description: 'Case studies, architecture, and marketing.',
          },
          {
            id: 'rt-post-growth',
            label: 'Growth Strategies',
            url: '/blog/online-marketing-strategies-growth',
            description: 'Scale business with measurable analytics.',
          },
          {
            id: 'rt-about',
            label: 'About Company',
            url: '/tentang-kami',
            description: 'Learn about our corporate values.',
          },
        ],
      },
      {
        id: 'rt-tools',
        label: 'App Studio',
        url: '/editor',
        type: 'link',
      },
      {
        id: 'rt-contact',
        label: 'Support',
        url: '/#contact',
        type: 'link',
      },
    ],
    actions: {
      showSearch: true,
      searchActionUrl: '/blog',
      buttons: [
        {
          id: 'btn-rt-portal',
          label: 'Client Portal',
          url: '/editor',
          variant: 'outline',
          size: 'sm',
          pill: false,
        },
        {
          id: 'btn-rt-demo',
          label: 'Request Demo',
          url: '/#contact',
          variant: 'primary',
          icon: 'arrow',
          size: 'sm',
          pill: false,
        },
      ],
    },
  },
  {
    id: 'sample-ecommerce-mega',
    name: 'Modern E-Commerce (Mega Menu + Promo Banner)',
    description: 'Feature-packed retail & marketplace header with categorized mega menu, promotional product card, and action button combo.',
    isDefault: false,
    source: 'preset',
    layout: {
      logoPosition: 'left',
      containerType: 'wide',
      height: 82,
      shrunkHeight: 58,
      paddingX: 28,
    },
    behavior: {
      sticky: true,
      shrinkOnScroll: true,
      shrinkOffset: 35,
      glassmorphism: true,
      blurStrength: 20,
      scrollShadow: 'medium',
    },
    styling: {
      bgColor: '#10141e',
      scrolledBgColor: 'rgba(16, 20, 30, 0.98)',
      textColor: '#f9fafb',
      accentColor: '#10b981',
      borderColor: 'rgba(16, 185, 129, 0.15)',
      fontFamily: 'Montserrat',
      fontSize: '0.85rem',
      textTransform: 'none',
    },
    logo: {
      type: 'text',
      text: 'Better Store',
      tagline: 'Digital Goods & Templates',
      linkUrl: '/',
      scaleOnShrink: true,
    },
    menu: [
      {
        id: 'ecom-home',
        label: 'Home',
        url: '/',
        type: 'link',
      },
      {
        id: 'ecom-catalog',
        label: 'Browse Catalog',
        url: '#shop',
        type: 'megamenu',
        badge: 'Sale 20%',
        megaMenu: {
          columns: [
            {
              title: 'Design Templates',
              items: [
                {
                  label: 'FastPress Website Kits',
                  url: '/editor',
                  description: 'Turnkey ready responsive web templates.',
                  badge: 'Hot',
                  icon: '⚡',
                },
                {
                  label: 'Editorial Magazine Kits',
                  url: '/blog-layout-editor',
                  description: 'Stunning magazine layouts for blogs.',
                  icon: '📑',
                },
                {
                  label: 'High-Converting Popups',
                  url: '/popup-editor',
                  description: 'Lead generation and newsletter modals.',
                  icon: '🎁',
                },
              ],
            },
            {
              title: 'Articles & Guides',
              items: [
                {
                  label: 'Visual Identity Guide',
                  url: '/blog/branding-identity-modern-age',
                  description: 'Learn modern brand positioning.',
                  icon: '📖',
                },
                {
                  label: 'Conversion Graphic Design',
                  url: '/blog/graphic-design-principles-conversion',
                  description: 'Layouts that maximize purchases.',
                  icon: '🛍️',
                },
              ],
            },
          ],
          featuredCard: {
            title: 'Holiday Design Bundle',
            description: 'Get all layout packs, templates, and popup kits for one low price.',
            buttonText: 'Shop All Bundles',
            buttonUrl: '/blog',
            imageUrl: 'https://images.unsplash.com/photo-1556742049-0a67c5574f73?auto=format&fit=crop&w=600&q=80',
            badge: 'Limited Deal',
          },
        },
      },
      {
        id: 'ecom-about',
        label: 'About Store',
        url: '/tentang-kami',
        type: 'link',
      },
      {
        id: 'ecom-blog',
        label: 'Blog',
        url: '/blog',
        type: 'link',
      },
    ],
    actions: {
      showSearch: true,
      searchActionUrl: '/blog',
      buttons: [
        {
          id: 'btn-ecom-help',
          label: 'Customer Care',
          url: '/#contact',
          variant: 'ghost',
          size: 'sm',
          pill: false,
        },
        {
          id: 'btn-ecom-shop',
          label: 'Explore Catalog',
          url: '/blog',
          variant: 'primary',
          icon: 'cart',
          size: 'sm',
          pill: true,
        },
      ],
    },
  },
  {
    id: 'sample-minimal-clean',
    name: 'Minimalist Clean (Standard Menu + Smooth Border)',
    description: 'Clean, distraction-free aesthetic with left logo, standard links, simple dropdown, and single accent CTA button.',
    isDefault: false,
    source: 'preset',
    layout: {
      logoPosition: 'left',
      containerType: 'boxed',
      height: 72,
      shrunkHeight: 56,
      paddingX: 20,
    },
    behavior: {
      sticky: true,
      shrinkOnScroll: true,
      shrinkOffset: 30,
      glassmorphism: true,
      blurStrength: 12,
      scrollShadow: 'subtle',
    },
    styling: {
      bgColor: '#0d1117',
      scrolledBgColor: 'rgba(13, 17, 23, 0.96)',
      textColor: '#d1d5db',
      accentColor: '#6366f1',
      borderColor: 'rgba(255, 255, 255, 0.08)',
      fontFamily: 'Plus Jakarta Sans',
      fontSize: '0.88rem',
      textTransform: 'none',
    },
    logo: {
      type: 'text',
      text: 'Better Studio',
      tagline: 'Simple. Fast. Modern.',
      linkUrl: '/',
      scaleOnShrink: false,
    },
    menu: [
      {
        id: 'min-home',
        label: 'Home',
        url: '/',
        type: 'link',
      },
      {
        id: 'min-about',
        label: 'About',
        url: '/tentang-kami',
        type: 'link',
      },
      {
        id: 'min-blog',
        label: 'Blog',
        url: '/blog',
        type: 'dropdown',
        dropdownItems: [
          {
            id: 'min-drop-all',
            label: 'All Posts',
            url: '/blog',
            description: 'Explore full article feed',
          },
          {
            id: 'min-drop-branding',
            label: 'Branding Guide',
            url: '/blog/branding-identity-modern-age',
            description: 'Visual identity fundamentals',
          },
        ],
      },
      {
        id: 'min-contact',
        label: 'Contact',
        url: '/#contact',
        type: 'link',
      },
    ],
    actions: {
      showSearch: false,
      searchActionUrl: '',
      buttons: [
        {
          id: 'btn-min-talk',
          label: 'Let\'s Talk',
          url: '/#contact',
          variant: 'primary',
          icon: 'arrow',
          size: 'sm',
          pill: true,
        },
      ],
    },
  },
  {
    id: 'sample-custom-code-multidevice',
    name: 'Custom HTML/CSS/JS (Multi-Device)',
    description: 'Fully custom navbar with dedicated Desktop, Tablet, and Mobile HTML layouts, scoped CSS, and interactive JavaScript.',
    isDefault: false,
    source: 'preset',
    builderType: 'custom-code',
    customCode: {
      enabled: true,
      desktopHtml: `<nav class="custom-nav-desktop">
  <div class="custom-nav-container">
    <a href="/" class="custom-nav-brand">
      <span class="custom-brand-dot"></span>
      <span class="custom-brand-title">Better Custom</span>
      <span class="custom-badge-tag">Desktop</span>
    </a>
    <ul class="custom-desktop-links">
      <li><a href="/" class="custom-link is-active">Home</a></li>
      <li class="custom-has-dropdown">
        <a href="/#services" class="custom-link">Products ▾</a>
        <div class="custom-dropdown-menu">
          <a href="/tentang-kami">Company Overview</a>
          <a href="/blog">Latest Articles</a>
          <a href="/editor">Page Builder CMS</a>
        </div>
      </li>
      <li><a href="/tentang-kami" class="custom-link">About</a></li>
      <li><a href="/blog" class="custom-link">Blog</a></li>
      <li><a href="/#contact" class="custom-link">Contact</a></li>
    </ul>
    <div class="custom-desktop-actions">
      <a href="/blog" class="custom-btn-outline">Search</a>
      <a href="/editor" class="custom-btn-gradient">Get Started →</a>
    </div>
  </div>
</nav>`,
      tabletHtml: `<nav class="custom-nav-tablet">
  <div class="custom-nav-container">
    <a href="/" class="custom-nav-brand">
      <span class="custom-brand-dot"></span>
      <span class="custom-brand-title">Better Custom</span>
      <span class="custom-badge-tag">Tablet</span>
    </a>
    <div class="custom-tablet-actions">
      <a href="/editor" class="custom-btn-gradient" style="padding: 6px 14px; font-size: 0.8rem;">Launch App</a>
      <button type="button" class="custom-drawer-trigger" id="tabletNavToggle" aria-label="Toggle Tablet Menu">
        <span></span><span></span><span></span>
      </button>
    </div>
  </div>
  <div class="custom-tablet-drawer" id="tabletNavDrawer">
    <a href="/">🏠 Home</a>
    <a href="/tentang-kami">🏢 About Us</a>
    <a href="/blog">📰 Blog & Insights</a>
    <a href="/#services">⚡ Products & Services</a>
    <a href="/#contact">📞 Contact Team</a>
  </div>
</nav>`,
      mobileHtml: `<nav class="custom-nav-mobile">
  <div class="custom-nav-container">
    <a href="/" class="custom-nav-brand">
      <span class="custom-brand-dot"></span>
      <span class="custom-brand-title">Better</span>
      <span class="custom-badge-tag">Mobile</span>
    </a>
    <div class="custom-mobile-quick-actions">
      <a href="/blog" class="custom-icon-btn" aria-label="Search">🔍</a>
      <button type="button" class="custom-drawer-trigger" id="mobileNavToggle" aria-label="Toggle Mobile Menu">
        <span></span><span></span><span></span>
      </button>
    </div>
  </div>
  <div class="custom-mobile-drawer" id="mobileNavDrawer">
    <div class="custom-mobile-links">
      <a href="/" class="custom-mobile-link"><span>Home</span><span>→</span></a>
      <a href="/tentang-kami" class="custom-mobile-link"><span>About Us</span><span>→</span></a>
      <a href="/blog" class="custom-mobile-link"><span>Articles & News</span><span>→</span></a>
      <a href="/#services" class="custom-mobile-link"><span>Services & Solutions</span><span>→</span></a>
      <a href="/#contact" class="custom-mobile-link"><span>Get in Touch</span><span>→</span></a>
    </div>
    <div class="custom-mobile-footer-action">
      <a href="/editor" class="custom-btn-gradient" style="display: block; text-align: center; width: 100%;">Open Studio Editor</a>
    </div>
  </div>
</nav>`,
      customCss: `/* Custom Multi-Device Header CSS */
.custom-nav-desktop, .custom-nav-tablet, .custom-nav-mobile {
  width: 100%;
  background: rgba(15, 18, 25, 0.95);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-family: inherit;
  color: #fff;
}
.custom-nav-container {
  max-width: 1200px;
  margin: 0 auto;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
}
.custom-nav-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: #fff;
  font-weight: 700;
  font-size: 1.1rem;
}
.custom-brand-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ff5e3a;
  box-shadow: 0 0 10px #ff5e3a;
}
.custom-badge-tag {
  font-size: 0.65rem;
  background: rgba(255, 94, 58, 0.15);
  color: #ff5e3a;
  border: 1px solid rgba(255, 94, 58, 0.3);
  padding: 2px 6px;
  border-radius: 9999px;
  font-weight: 700;
  letter-spacing: 0.5px;
}
.custom-desktop-links {
  display: flex;
  align-items: center;
  gap: 24px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.custom-link {
  color: rgba(255, 255, 255, 0.8);
  text-decoration: none;
  font-size: 0.88rem;
  font-weight: 500;
  transition: color 0.15s;
}
.custom-link:hover, .custom-link.is-active {
  color: #ff5e3a;
}
.custom-has-dropdown {
  position: relative;
}
.custom-dropdown-menu {
  display: none;
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 180px;
  background: #141720;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 8px;
  box-shadow: 0 10px 25px rgba(0,0,0,0.5);
}
.custom-has-dropdown:hover .custom-dropdown-menu {
  display: flex;
  flex-direction: column;
}
.custom-dropdown-menu a {
  padding: 8px 12px;
  color: #d1d5db;
  text-decoration: none;
  font-size: 0.82rem;
  border-radius: 4px;
}
.custom-dropdown-menu a:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
}
.custom-desktop-actions, .custom-tablet-actions, .custom-mobile-quick-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.custom-btn-outline {
  padding: 7px 14px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #fff;
  text-decoration: none;
  font-size: 0.82rem;
  font-weight: 600;
}
.custom-btn-gradient {
  padding: 7px 16px;
  border-radius: 6px;
  background: linear-gradient(135deg, #ff5e3a, #ff9068);
  color: #fff;
  text-decoration: none;
  font-size: 0.82rem;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(255, 94, 58, 0.3);
}
.custom-drawer-trigger {
  width: 38px;
  height: 38px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 4px;
  padding: 0;
}
.custom-drawer-trigger span {
  display: block;
  width: 18px;
  height: 2px;
  background: #fff;
  border-radius: 1px;
}
.custom-icon-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  text-decoration: none;
  font-size: 0.9rem;
}
.custom-tablet-drawer, .custom-mobile-drawer {
  display: none;
  background: #11141b;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding: 16px 20px;
}
.custom-tablet-drawer.is-open, .custom-mobile-drawer.is-open {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.custom-tablet-drawer a, .custom-mobile-link {
  color: #e5e7eb;
  text-decoration: none;
  padding: 6px 0;
  font-size: 0.9rem;
  font-weight: 500;
  display: flex;
  justify-content: space-between;
}
.custom-mobile-footer-action {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}`,
      customJs: `// Custom Interactive JavaScript
(function() {
  const tBtn = document.getElementById('tabletNavToggle');
  const tDrawer = document.getElementById('tabletNavDrawer');
  if (tBtn && tDrawer) {
    tBtn.onclick = function(e) {
      e.stopPropagation();
      tDrawer.classList.toggle('is-open');
    };
  }

  const mBtn = document.getElementById('mobileNavToggle');
  const mDrawer = document.getElementById('mobileNavDrawer');
  if (mBtn && mDrawer) {
    mBtn.onclick = function(e) {
      e.stopPropagation();
      mDrawer.classList.toggle('is-open');
    };
  }
})();`
    },
    layout: {
      logoPosition: 'left',
      containerType: 'wide',
      height: 72,
      shrunkHeight: 56,
      paddingX: 20,
    },
    behavior: {
      sticky: true,
      shrinkOnScroll: false,
      shrinkOffset: 40,
      glassmorphism: true,
      blurStrength: 16,
      scrollShadow: 'medium',
    },
    styling: {
      bgColor: 'rgba(15, 18, 25, 0.95)',
      scrolledBgColor: 'rgba(12, 15, 22, 0.98)',
      textColor: '#ffffff',
      accentColor: '#ff5e3a',
      borderColor: 'rgba(255, 255, 255, 0.08)',
      fontFamily: 'Plus Jakarta Sans',
      fontSize: '0.86rem',
      textTransform: 'none',
    },
    logo: {
      type: 'text',
      text: 'Better Custom',
      tagline: 'Multi-Device',
      linkUrl: '/',
      scaleOnShrink: false,
    },
    menu: [],
    actions: {
      showSearch: false,
      searchActionUrl: '',
      buttons: [],
    },
  },
];

export function readHeadersData(): HeadersDataStore {
  try {
    if (!fs.existsSync(getDataFile('headers.json'))) {
      const initial: HeadersDataStore = {
        activeHeaderId: defaultSampleHeaders[0].id,
        headers: defaultSampleHeaders,
      };
      fs.writeFileSync(getDataFile('headers.json'), JSON.stringify(initial, null, 2), 'utf-8');
      return initial;
    }
    const raw = fs.readFileSync(getDataFile('headers.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.headers || !Array.isArray(parsed.headers) || parsed.headers.length === 0) {
      parsed.headers = defaultSampleHeaders;
      parsed.activeHeaderId = defaultSampleHeaders[0].id;
    }
    return parsed;
  } catch (e) {
    return {
      activeHeaderId: defaultSampleHeaders[0].id,
      headers: defaultSampleHeaders,
    };
  }
}

export function writeHeadersData(data: HeadersDataStore): void {
  fs.writeFileSync(getDataFile('headers.json'), JSON.stringify(data, null, 2), 'utf-8');
}

export function getHeaders(): HeaderConfig[] {
  const store = readHeadersData();
  return store.headers;
}

export function getActiveHeader(): HeaderConfig {
  const store = readHeadersData();
  const found = store.headers.find(h => h.id === store.activeHeaderId);
  return found || store.headers[0] || defaultSampleHeaders[0];
}

export function getActiveHeaderForTheme(themeName = 'default'): HeaderConfig {
  const store = readHeadersData();
  const target = (themeName || 'default').toLowerCase();
  const mappedId = store.activeHeaderIds?.[target];
  if (mappedId) {
    const mapped = store.headers.find(h => h.id === mappedId);
    if (mapped) return mapped;
  }
  const active = store.headers.find(h => h.id === store.activeHeaderId);
  if (active && ((!active.theme && target === 'default') || (active.theme && active.theme.toLowerCase() === target))) {
    return active;
  }
  const themed = store.headers.find(h => h.theme && h.theme.toLowerCase() === target);
  if (themed) return themed;
  const unthemedDefault =
    store.headers.find(h => h.isDefault && !h.theme) ||
    store.headers.find(h => !h.theme);
  return unthemedDefault || defaultSampleHeaders[0];
}

export function getHeaderById(id: string): HeaderConfig | undefined {
  const store = readHeadersData();
  return store.headers.find(h => h.id === id);
}

export function saveHeader(header: HeaderConfig): HeadersDataStore {
  const store = readHeadersData();
  const existingIndex = store.headers.findIndex(h => h.id === header.id);
  const updatedHeader: HeaderConfig = {
    ...header,
    updatedAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    store.headers[existingIndex] = updatedHeader;
  } else {
    store.headers.push(updatedHeader);
  }

  writeHeadersData(store);
  return store;
}

export function setActiveHeader(id: string, themeName?: string): HeadersDataStore {
  const store = readHeadersData();
  if (store.headers.some(h => h.id === id)) {
    const target = themeName ? themeName.trim().toLowerCase() : '';
    if (target) {
      if (!store.activeHeaderIds) store.activeHeaderIds = {};
      store.activeHeaderIds[target] = id;
    }
    const targetHeader = store.headers.find(h => h.id === id);
    if (!target || (targetHeader?.theme && targetHeader.theme.toLowerCase() === target) || target === 'furnisite') {
      store.activeHeaderId = id;
    }
    if (!target) {
      store.activeHeaderId = id;
      store.headers = store.headers.map(h => ({
        ...h,
        isDefault: h.id === id,
      }));
    }
    writeHeadersData(store);
  }
  return store;
}

export function deleteHeader(id: string): { success: boolean; error?: string } {
  const store = readHeadersData();
  if (store.headers.length <= 1) {
    return { success: false, error: 'Cannot delete the only remaining header.' };
  }
  const filtered = store.headers.filter(h => h.id !== id);
  if (store.activeHeaderId === id) {
    store.activeHeaderId = filtered[0].id;
    filtered[0].isDefault = true;
  }
  store.headers = filtered;
  writeHeadersData(store);
  return { success: true };
}

export function duplicateHeader(id: string): HeaderConfig | null {
  const store = readHeadersData();
  const original = store.headers.find(h => h.id === id);
  if (!original) return null;

  const newId = `header-custom-${Date.now()}`;
  const copy: HeaderConfig = JSON.parse(JSON.stringify(original));
  copy.id = newId;
  copy.name = `${original.name} (Copy)`;
  copy.isDefault = false;
  copy.source = 'custom';
  copy.updatedAt = new Date().toISOString();

  store.headers.push(copy);
  writeHeadersData(store);
  return copy;
}
