import fs from 'node:fs';
import path from 'node:path';

export interface FooterLink {
  id: string;
  label: string;
  url: string;
  target?: '_self' | '_blank';
}

export interface FooterColumn {
  id: string;
  title: string;
  links: FooterLink[];
}

export interface FooterSocialLink {
  name: string;
  href: string;
  enabled: boolean;
}

export interface FooterLogo {
  source: 'default' | 'custom';
  imageUrl: string;
  brandName: string;
  tagline: string;
  linkUrl: string;
}

export interface FooterAbout {
  enabled: boolean;
  description: string;
  email?: string;
  phone?: string;
  address?: string;
}

export interface FooterNewsletter {
  enabled: boolean;
  title: string;
  description: string;
  buttonText: string;
  placeholder: string;
  actionUrl?: string;
}

export interface FooterBottomBar {
  enabled: boolean;
  companyName: string;
  copyrightText: string;
  showYear: boolean;
  links: FooterLink[];
}

export interface FooterLayout {
  type: 'multi-column' | 'simple-inline' | 'centered' | 'columns-with-newsletter';
  containerType: 'boxed' | 'wide' | 'full';
  columnsCount: number;
  paddingTop: number;
  paddingBottom: number;
  showBackToTop: boolean;
}

export interface FooterStyling {
  bgColor: string;
  textColor: string;
  headingColor: string;
  mutedColor: string;
  accentColor: string;
  borderColor: string;
  fontFamily: string;
  fontSize: string;
}

export interface FooterCustomCode {
  enabled: boolean;
  desktopHtml: string;
  tabletHtml: string;
  mobileHtml: string;
  customCss: string;
  customJs: string;
}

export interface FooterConfig {
  id: string;
  name: string;
  isActive: boolean;
  builderType: 'visual' | 'custom-code';
  useTemplate?: boolean;
  selectedTemplateId?: string;
  layout: FooterLayout;
  styling: FooterStyling;
  logo: FooterLogo;
  about: FooterAbout;
  columns: FooterColumn[];
  newsletter: FooterNewsletter;
  social: {
    enabled: boolean;
    links: FooterSocialLink[];
  };
  bottomBar: FooterBottomBar;
  customCode: FooterCustomCode;
}

export interface FootersStore {
  activeFooterId: string;
  footers: FooterConfig[];
}

const FOOTERS_FILE = path.join(process.cwd(), 'src', 'data', 'footers.json');

export const defaultSampleFooters: FooterConfig[] = [
  {
    id: 'footer-saas-pro',
    name: 'SaaS Pro (Multi-Column + Newsletter) ★',
    isActive: true,
    builderType: 'visual',
    layout: {
      type: 'columns-with-newsletter',
      containerType: 'boxed',
      columnsCount: 3,
      paddingTop: 72,
      paddingBottom: 36,
      showBackToTop: true,
    },
    styling: {
      bgColor: '#0f1219',
      textColor: '#94a3b8',
      headingColor: '#f8fafc',
      mutedColor: '#64748b',
      accentColor: '#ff5e3a',
      borderColor: 'rgba(255, 255, 255, 0.08)',
      fontFamily: 'Plus Jakarta Sans',
      fontSize: '0.88rem',
    },
    logo: {
      source: 'default',
      imageUrl: '',
      brandName: 'Better SaaS',
      tagline: 'Modern Web Platform',
      linkUrl: '/',
    },
    about: {
      enabled: true,
      description: 'The modern visual website builder and CMS for high-performance Astro web applications.',
      email: 'hello@bettercorp.com',
      phone: '+1 (555) 234-5678',
      address: '742 Evergreen Terrace, Tech District',
    },
    columns: [
      {
        id: 'col-prod',
        title: 'Platform',
        links: [
          { id: 'l1', label: 'Visual Builder', url: '/editor' },
          { id: 'l2', label: 'Header Builder', url: '/header-builder' },
          { id: 'l3', label: 'Footer Builder', url: '/footer-builder' },
          { id: 'l4', label: 'Blog Engine', url: '/blog' },
        ],
      },
      {
        id: 'col-res',
        title: 'Resources',
        links: [
          { id: 'l5', label: 'Documentation', url: '/blog' },
          { id: 'l6', label: 'Changelog', url: '/blog' },
          { id: 'l7', label: 'Tutorials', url: '/blog' },
          { id: 'l8', label: 'Community', url: '/#' },
        ],
      },
      {
        id: 'col-comp',
        title: 'Company',
        links: [
          { id: 'l9', label: 'About Us', url: '/tentang-kami' },
          { id: 'l10', label: 'Our Work', url: '/#work' },
          { id: 'l11', label: 'Services', url: '/#services' },
          { id: 'l12', label: 'Contact', url: '/#contact' },
        ],
      },
    ],
    newsletter: {
      enabled: true,
      title: 'Stay in the Loop',
      description: 'Subscribe for the latest news, product updates, and design insights.',
      buttonText: 'Subscribe',
      placeholder: 'Enter your email address...',
      actionUrl: '#',
    },
    social: {
      enabled: true,
      links: [
        { name: 'Facebook', href: 'https://facebook.com', enabled: true },
        { name: 'Twitter', href: 'https://twitter.com', enabled: true },
        { name: 'LinkedIn', href: 'https://linkedin.com', enabled: true },
        { name: 'Instagram', href: 'https://instagram.com', enabled: true },
        { name: 'GitHub', href: 'https://github.com', enabled: true },
      ],
    },
    bottomBar: {
      enabled: true,
      companyName: 'Better Corp Inc.',
      copyrightText: 'All Rights Reserved.',
      showYear: true,
      links: [
        { id: 'bl1', label: 'Privacy Policy', url: '/#' },
        { id: 'bl2', label: 'Terms of Service', url: '/#' },
        { id: 'bl3', label: 'Security', url: '/#' },
      ],
    },
    customCode: {
      enabled: false,
      desktopHtml: '',
      tabletHtml: '',
      mobileHtml: '',
      customCss: '',
      customJs: '',
    },
  },
  {
    id: 'footer-minimal-clean',
    name: 'Minimal Clean (Single-Line Bar)',
    isActive: false,
    builderType: 'visual',
    layout: {
      type: 'simple-inline',
      containerType: 'boxed',
      columnsCount: 0,
      paddingTop: 36,
      paddingBottom: 36,
      showBackToTop: true,
    },
    styling: {
      bgColor: '#11141a',
      textColor: '#94a3b8',
      headingColor: '#f1f5f9',
      mutedColor: '#64748b',
      accentColor: '#ff5e3a',
      borderColor: 'rgba(255, 255, 255, 0.06)',
      fontFamily: 'Plus Jakarta Sans',
      fontSize: '0.86rem',
    },
    logo: {
      source: 'default',
      imageUrl: '',
      brandName: 'Better SaaS',
      tagline: '',
      linkUrl: '/',
    },
    about: {
      enabled: false,
      description: '',
    },
    columns: [],
    newsletter: {
      enabled: false,
      title: '',
      description: '',
      buttonText: '',
      placeholder: '',
    },
    social: {
      enabled: true,
      links: [
        { name: 'Facebook', href: 'https://facebook.com', enabled: true },
        { name: 'Twitter', href: 'https://twitter.com', enabled: true },
        { name: 'LinkedIn', href: 'https://linkedin.com', enabled: true },
        { name: 'Instagram', href: 'https://instagram.com', enabled: true },
      ],
    },
    bottomBar: {
      enabled: true,
      companyName: 'Better Corp Inc.',
      copyrightText: 'All Rights Reserved.',
      showYear: true,
      links: [
        { id: 'b1', label: 'Home', url: '/' },
        { id: 'b2', label: 'About', url: '/tentang-kami' },
        { id: 'b3', label: 'Blog', url: '/blog' },
        { id: 'b4', label: 'Contact', url: '/#contact' },
      ],
    },
    customCode: {
      enabled: false,
      desktopHtml: '',
      tabletHtml: '',
      mobileHtml: '',
      customCss: '',
      customJs: '',
    },
  },
  {
    id: 'footer-corporate-4col',
    name: 'Corporate 4-Column Grid',
    isActive: false,
    builderType: 'visual',
    layout: {
      type: 'multi-column',
      containerType: 'boxed',
      columnsCount: 4,
      paddingTop: 64,
      paddingBottom: 32,
      showBackToTop: true,
    },
    styling: {
      bgColor: '#0b0e14',
      textColor: '#a1a1aa',
      headingColor: '#ffffff',
      mutedColor: '#71717a',
      accentColor: '#3b82f6',
      borderColor: 'rgba(255, 255, 255, 0.08)',
      fontFamily: 'Montserrat',
      fontSize: '0.88rem',
    },
    logo: {
      source: 'default',
      imageUrl: '',
      brandName: 'Better SaaS',
      tagline: 'Enterprise Cloud Solutions',
      linkUrl: '/',
    },
    about: {
      enabled: true,
      description: 'Leading global provider of cloud platform infrastructure and modern digital experiences.',
      email: 'enterprise@bettercorp.com',
      phone: '+1 (800) 555-0199',
    },
    columns: [
      {
        id: 'col-sol',
        title: 'Solutions',
        links: [
          { id: 'c1', label: 'Cloud Hosting', url: '/#' },
          { id: 'c2', label: 'Data Security', url: '/#' },
          { id: 'c3', label: 'CI/CD Automation', url: '/#' },
          { id: 'c4', label: 'AI Optimization', url: '/#' },
        ],
      },
      {
        id: 'col-dev',
        title: 'Developers',
        links: [
          { id: 'c5', label: 'API Reference', url: '/#' },
          { id: 'c6', label: 'GitHub SDKs', url: '/#' },
          { id: 'c7', label: 'Integrations', url: '/#' },
          { id: 'c8', label: 'Status Page', url: '/#' },
        ],
      },
      {
        id: 'col-leg',
        title: 'Legal & Trust',
        links: [
          { id: 'c9', label: 'GDPR Compliance', url: '/#' },
          { id: 'c10', label: 'Privacy Policy', url: '/#' },
          { id: 'c11', label: 'Terms of Use', url: '/#' },
          { id: 'c12', label: 'Cookie Settings', url: '/#' },
        ],
      },
    ],
    newsletter: {
      enabled: false,
      title: '',
      description: '',
      buttonText: '',
      placeholder: '',
    },
    social: {
      enabled: true,
      links: [
        { name: 'Twitter', href: 'https://twitter.com', enabled: true },
        { name: 'LinkedIn', href: 'https://linkedin.com', enabled: true },
        { name: 'GitHub', href: 'https://github.com', enabled: true },
      ],
    },
    bottomBar: {
      enabled: true,
      companyName: 'Better Corp Inc.',
      copyrightText: 'All Rights Reserved. Registered Trademark.',
      showYear: true,
      links: [
        { id: 'l1', label: 'Security Whitepaper', url: '/#' },
        { id: 'l2', label: 'Compliance Reports', url: '/#' },
      ],
    },
    customCode: {
      enabled: false,
      desktopHtml: '',
      tabletHtml: '',
      mobileHtml: '',
      customCss: '',
      customJs: '',
    },
  },
  {
    id: 'footer-custom-script',
    name: 'Custom HTML / CSS / JS Footer (Device Responsive)',
    isActive: false,
    builderType: 'custom-code',
    layout: {
      type: 'multi-column',
      containerType: 'boxed',
      columnsCount: 3,
      paddingTop: 60,
      paddingBottom: 30,
      showBackToTop: true,
    },
    styling: {
      bgColor: '#0f172a',
      textColor: '#94a3b8',
      headingColor: '#f8fafc',
      mutedColor: '#64748b',
      accentColor: '#38bdf8',
      borderColor: 'rgba(255, 255, 255, 0.08)',
      fontFamily: 'Plus Jakarta Sans',
      fontSize: '0.88rem',
    },
    logo: {
      source: 'default',
      imageUrl: '',
      brandName: 'Better SaaS',
      tagline: 'Custom Layout',
      linkUrl: '/',
    },
    about: {
      enabled: false,
      description: '',
    },
    columns: [],
    newsletter: {
      enabled: false,
      title: '',
      description: '',
      buttonText: '',
      placeholder: '',
    },
    social: {
      enabled: false,
      links: [],
    },
    bottomBar: {
      enabled: false,
      companyName: 'Better Corp Inc.',
      copyrightText: '',
      showYear: true,
      links: [],
    },
    customCode: {
      enabled: true,
      desktopHtml: `<div class="custom-footer-inner" style="display: flex; justify-content: space-between; align-items: center; max-width: 1200px; margin: 0 auto; padding: 40px 20px;">
  <div>
    <h3 style="margin: 0 0 6px 0; color: #fff; font-size: 1.25rem;">Better SaaS Platform</h3>
    <p style="margin: 0; color: #94a3b8; font-size: 0.88rem;">Engineered for high performance, accessibility and speed.</p>
  </div>
  <div style="display: flex; gap: 20px;">
    <a href="/" style="color: #38bdf8; text-decoration: none;">Home</a>
    <a href="/blog" style="color: #38bdf8; text-decoration: none;">Blog</a>
    <a href="/editor" style="color: #38bdf8; text-decoration: none;">Page Builder</a>
    <a href="/header-builder" style="color: #38bdf8; text-decoration: none;">Header</a>
    <a href="/footer-builder" style="color: #38bdf8; text-decoration: none;">Footer</a>
  </div>
</div>`,
      tabletHtml: `<div class="custom-footer-inner" style="display: flex; flex-direction: column; gap: 20px; align-items: center; text-align: center; max-width: 768px; margin: 0 auto; padding: 30px 20px;">
  <div>
    <h3 style="margin: 0 0 6px 0; color: #fff; font-size: 1.15rem;">Better SaaS Platform</h3>
    <p style="margin: 0; color: #94a3b8; font-size: 0.84rem;">Engineered for high performance, accessibility and speed.</p>
  </div>
  <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 16px;">
    <a href="/" style="color: #38bdf8; text-decoration: none;">Home</a>
    <a href="/blog" style="color: #38bdf8; text-decoration: none;">Blog</a>
    <a href="/editor" style="color: #38bdf8; text-decoration: none;">Page Builder</a>
  </div>
</div>`,
      mobileHtml: `<div class="custom-footer-inner" style="display: flex; flex-direction: column; gap: 18px; align-items: center; text-align: center; padding: 24px 16px;">
  <h3 style="margin: 0; color: #fff; font-size: 1.1rem;">Better SaaS</h3>
  <div style="display: flex; flex-direction: column; gap: 10px;">
    <a href="/" style="color: #38bdf8; text-decoration: none;">Home</a>
    <a href="/blog" style="color: #38bdf8; text-decoration: none;">Blog</a>
    <a href="/editor" style="color: #38bdf8; text-decoration: none;">Builder</a>
  </div>
  <p style="margin: 10px 0 0 0; color: #64748b; font-size: 0.75rem;">&copy; 2026 Better Corp Inc.</p>
</div>`,
      customCss: `/* Custom responsive styling */
.custom-footer-inner a:hover {
  text-decoration: underline !important;
  color: #ff5e3a !important;
}`,
      customJs: `console.log("Custom footer script initialized");`,
    },
  },
];

export function readFootersData(): FootersStore {
  try {
    if (!fs.existsSync(FOOTERS_FILE)) {
      writeFootersData({
        activeFooterId: defaultSampleFooters[0].id,
        footers: defaultSampleFooters,
      });
      return {
        activeFooterId: defaultSampleFooters[0].id,
        footers: defaultSampleFooters,
      };
    }
    const raw = fs.readFileSync(FOOTERS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (!data.footers || !Array.isArray(data.footers) || data.footers.length === 0) {
      data.footers = defaultSampleFooters;
      data.activeFooterId = defaultSampleFooters[0].id;
      writeFootersData(data);
    }
    return data;
  } catch (e) {
    return {
      activeFooterId: defaultSampleFooters[0].id,
      footers: defaultSampleFooters,
    };
  }
}

export function writeFootersData(data: FootersStore): void {
  try {
    const dir = path.dirname(FOOTERS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(FOOTERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to write footers.json:', e);
  }
}

export function getFooters(): FooterConfig[] {
  return readFootersData().footers;
}

export function getActiveFooter(): FooterConfig {
  const store = readFootersData();
  const active = store.footers.find(f => f.id === store.activeFooterId);
  return active || store.footers[0] || defaultSampleFooters[0];
}

export function getFooterById(id: string): FooterConfig | undefined {
  const store = readFootersData();
  return store.footers.find(f => f.id === id);
}

export function saveFooter(footer: FooterConfig): FootersStore {
  const store = readFootersData();
  const idx = store.footers.findIndex(f => f.id === footer.id);
  if (idx >= 0) {
    store.footers[idx] = footer;
  } else {
    store.footers.push(footer);
  }
  if (footer.isActive) {
    store.activeFooterId = footer.id;
    store.footers.forEach(f => {
      f.isActive = f.id === footer.id;
    });
  }
  writeFootersData(store);
  return store;
}

export function setActiveFooter(id: string): FootersStore {
  const store = readFootersData();
  const target = store.footers.find(f => f.id === id);
  if (target) {
    store.activeFooterId = id;
    store.footers.forEach(f => {
      f.isActive = f.id === id;
    });
    writeFootersData(store);
  }
  return store;
}

export function deleteFooter(id: string): { success: boolean; error?: string } {
  const store = readFootersData();
  if (store.footers.length <= 1) {
    return { success: false, error: 'Cannot delete the only remaining footer.' };
  }

  const targetIdx = store.footers.findIndex(f => f.id === id);
  if (targetIdx === -1) {
    return { success: false, error: 'Footer not found.' };
  }

  store.footers.splice(targetIdx, 1);
  if (store.activeFooterId === id) {
    store.activeFooterId = store.footers[0].id;
    store.footers[0].isActive = true;
  }
  writeFootersData(store);
  return { success: true };
}

export function duplicateFooter(id: string): FooterConfig | null {
  const store = readFootersData();
  const source = store.footers.find(f => f.id === id);
  if (!source) return null;

  const newId = `footer-${Date.now()}`;
  const copy: FooterConfig = JSON.parse(JSON.stringify(source));
  copy.id = newId;
  copy.name = `${source.name} (Copy)`;
  copy.isActive = false;

  store.footers.push(copy);
  writeFootersData(store);
  return copy;
}
