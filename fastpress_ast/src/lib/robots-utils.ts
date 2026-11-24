export type RobotsDirectiveType = 'Allow' | 'Disallow';

export interface RobotsRule {
  id: string;
  type: RobotsDirectiveType;
  path: string;
  comment?: string;
}

export interface RobotsGroup {
  id: string;
  userAgents: string[];
  rules: RobotsRule[];
  crawlDelay?: number | null;
  comment?: string;
}

export interface RobotsConfig {
  mode: 'visual' | 'raw';
  headerComment: string;
  autoIncludeSitemap: boolean;
  customSitemaps: string[];
  host: string;
  groups: RobotsGroup[];
  rawText: string;
  updatedAt: string;
}

export interface RobotsDiagnostic {
  id: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  line?: number;
  fixAction?: 'add-sitemap' | 'disallow-studio' | 'allow-root' | 'fix-relative-sitemap';
}

export interface RobotsTestResult {
  allowed: boolean;
  matchedUserAgents: string[];
  matchedRule: {
    type: RobotsDirectiveType;
    pattern: string;
    lineNumber?: number;
    specificity: number;
  } | null;
  reason: string;
  normalizedTarget: string;
}

export interface KnownCrawlerOption {
  token: string;
  label: string;
  category: 'Search Engine' | 'AI / LLM' | 'Ads & Social';
  description: string;
}

export interface RobotsPreset {
  id: string;
  name: string;
  badge: string;
  description: string;
  buildConfig: () => RobotsConfig;
}

export const FASTPRESS_ADMIN_PATHS = [
  '/editor',
  '/edit-blog',
  '/edit-product',
  '/header-builder',
  '/footer-builder',
  '/form-builder',
  '/popup-editor',
  '/blog-layout-editor',
  '/product-layout-editor',
  '/template-editor',
  '/robots-editor',
  '/api/',
] as const;

export const KNOWN_CRAWLERS: KnownCrawlerOption[] = [
  { token: '*', label: 'All Crawlers (*)', category: 'Search Engine', description: 'Wildcard fallback for every robot' },
  { token: 'Googlebot', label: 'Googlebot', category: 'Search Engine', description: 'Google primary web search crawler' },
  { token: 'Googlebot-Image', label: 'Googlebot-Image', category: 'Search Engine', description: 'Google Images crawler' },
  { token: 'Googlebot-News', label: 'Googlebot-News', category: 'Search Engine', description: 'Google News crawler' },
  { token: 'Bingbot', label: 'Bingbot', category: 'Search Engine', description: 'Microsoft Bing search crawler' },
  { token: 'Applebot', label: 'Applebot', category: 'Search Engine', description: 'Apple Siri & Spotlight search' },
  { token: 'DuckDuckBot', label: 'DuckDuckBot', category: 'Search Engine', description: 'DuckDuckGo search crawler' },
  { token: 'Yandex', label: 'Yandex', category: 'Search Engine', description: 'Yandex search crawler' },
  { token: 'Baiduspider', label: 'Baiduspider', category: 'Search Engine', description: 'Baidu search crawler' },
  { token: 'GPTBot', label: 'GPTBot (OpenAI Training)', category: 'AI / LLM', description: 'OpenAI model training crawler' },
  { token: 'OAI-SearchBot', label: 'OAI-SearchBot', category: 'AI / LLM', description: 'OpenAI ChatGPT search indexing' },
  { token: 'ChatGPT-User', label: 'ChatGPT-User', category: 'AI / LLM', description: 'Live user-triggered browsing in ChatGPT' },
  { token: 'ClaudeBot', label: 'ClaudeBot (Anthropic)', category: 'AI / LLM', description: 'Anthropic web crawler' },
  { token: 'Google-Extended', label: 'Google-Extended', category: 'AI / LLM', description: 'Controls Gemini & Vertex AI grounding/training' },
  { token: 'PerplexityBot', label: 'PerplexityBot', category: 'AI / LLM', description: 'Perplexity AI search & indexing bot' },
  { token: 'CCBot', label: 'CCBot (Common Crawl)', category: 'AI / LLM', description: 'Common Crawl open dataset spider' },
  { token: 'Bytespider', label: 'Bytespider', category: 'AI / LLM', description: 'ByteDance AI & search crawler' },
  { token: 'Meta-ExternalAgent', label: 'Meta-ExternalAgent', category: 'AI / LLM', description: 'Meta AI training & product crawler' },
  { token: 'AdsBot-Google', label: 'AdsBot-Google', category: 'Ads & Social', description: 'Google Ads landing page quality checker' },
  { token: 'Twitterbot', label: 'Twitterbot / X', category: 'Ads & Social', description: 'X (Twitter) link card preview fetcher' },
  { token: 'facebookexternalhit', label: 'Facebook External Hit', category: 'Ads & Social', description: 'Meta Open Graph preview scraper' },
  { token: 'LinkedInBot', label: 'LinkedInBot', category: 'Ads & Social', description: 'LinkedIn post preview scraper' },
];

export const GOOGLE_ROBOTS_MAX_BYTES = 512000; // 500 KiB

export function createUid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createDefaultRobotsConfig(): RobotsConfig {
  const config: RobotsConfig = {
    mode: 'visual',
    headerComment: '',
    autoIncludeSitemap: true,
    customSitemaps: [],
    host: '',
    groups: [
      {
        id: 'grp_default_all',
        userAgents: ['*'],
        rules: [
          { id: 'rule_allow_root', type: 'Allow', path: '/' },
          { id: 'rule_disallow_editor', type: 'Disallow', path: '/editor' },
          { id: 'rule_disallow_edit_blog', type: 'Disallow', path: '/edit-blog' },
          { id: 'rule_disallow_api', type: 'Disallow', path: '/api/' },
        ],
        crawlDelay: null,
      },
    ],
    rawText: '',
    updatedAt: new Date().toISOString(),
  };
  config.rawText = compileRobotsTxt(config, '{SITE_URL}');
  return config;
}

export const ROBOTS_PRESETS: RobotsPreset[] = [
  {
    id: 'fastpress-recommended',
    name: 'FastPress SEO Recommended',
    badge: 'Recommended',
    description: 'Allows public pages, blog, and products while blocking all FastPress studio & API endpoints.',
    buildConfig: () => ({
      mode: 'visual',
      headerComment: 'FastPress CMS SEO Robots Policy',
      autoIncludeSitemap: true,
      customSitemaps: [],
      host: '',
      groups: [
        {
          id: createUid('grp'),
          userAgents: ['*'],
          rules: [
            { id: createUid('rule'), type: 'Allow', path: '/' },
            ...FASTPRESS_ADMIN_PATHS.map((p) => ({
              id: createUid('rule'),
              type: 'Disallow' as const,
              path: p,
            })),
          ],
          crawlDelay: null,
        },
      ],
      rawText: '',
      updatedAt: new Date().toISOString(),
    }),
  },
  {
    id: 'block-ai-training',
    name: 'Allow Search, Block AI Scrapers',
    badge: 'AI Control',
    description: 'Keeps Google/Bing search indexing active while blocking major AI model training crawlers.',
    buildConfig: () => ({
      mode: 'visual',
      headerComment: 'Allow search engines; block AI model training crawlers',
      autoIncludeSitemap: true,
      customSitemaps: [],
      host: '',
      groups: [
        {
          id: createUid('grp'),
          userAgents: ['*'],
          rules: [
            { id: createUid('rule'), type: 'Allow', path: '/' },
            ...FASTPRESS_ADMIN_PATHS.map((p) => ({
              id: createUid('rule'),
              type: 'Disallow' as const,
              path: p,
            })),
          ],
          crawlDelay: null,
        },
        {
          id: createUid('grp'),
          userAgents: ['GPTBot', 'Google-Extended', 'ClaudeBot', 'CCBot', 'Bytespider', 'Meta-ExternalAgent'],
          comment: 'AI Training & Scraping Bots',
          rules: [{ id: createUid('rule'), type: 'Disallow', path: '/' }],
          crawlDelay: null,
        },
      ],
      rawText: '',
      updatedAt: new Date().toISOString(),
    }),
  },
  {
    id: 'ecommerce-clean',
    name: 'E-Commerce & Query Hygiene',
    badge: 'Crawl Budget',
    description: 'Blocks duplicate sorting/tracking query URLs and admin routes to preserve crawl budget.',
    buildConfig: () => ({
      mode: 'visual',
      headerComment: 'Crawl-budget optimized policy for Store & Blog',
      autoIncludeSitemap: true,
      customSitemaps: [],
      host: '',
      groups: [
        {
          id: createUid('grp'),
          userAgents: ['*'],
          rules: [
            { id: createUid('rule'), type: 'Allow', path: '/' },
            { id: createUid('rule'), type: 'Disallow', path: '/editor' },
            { id: createUid('rule'), type: 'Disallow', path: '/edit-blog' },
            { id: createUid('rule'), type: 'Disallow', path: '/edit-product' },
            { id: createUid('rule'), type: 'Disallow', path: '/api/' },
            { id: createUid('rule'), type: 'Disallow', path: '/*?sort=' },
            { id: createUid('rule'), type: 'Disallow', path: '/*?filter=' },
            { id: createUid('rule'), type: 'Disallow', path: '/*?utm_' },
          ],
          crawlDelay: null,
        },
      ],
      rawText: '',
      updatedAt: new Date().toISOString(),
    }),
  },
  {
    id: 'open-allow-all',
    name: 'Open / Allow Everything',
    badge: 'Minimal',
    description: 'Permissive policy allowing all crawlers access to the entire site.',
    buildConfig: () => ({
      mode: 'visual',
      headerComment: '',
      autoIncludeSitemap: true,
      customSitemaps: [],
      host: '',
      groups: [
        {
          id: createUid('grp'),
          userAgents: ['*'],
          rules: [{ id: createUid('rule'), type: 'Allow', path: '/' }],
          crawlDelay: null,
        },
      ],
      rawText: '',
      updatedAt: new Date().toISOString(),
    }),
  },
  {
    id: 'staging-block-all',
    name: 'Staging / Block All Crawlers',
    badge: 'Staging Only',
    description: 'Prevents search engines from indexing a staging or private development environment.',
    buildConfig: () => ({
      mode: 'visual',
      headerComment: 'STAGING ENVIRONMENT - DO NOT INDEX IN PRODUCTION',
      autoIncludeSitemap: false,
      customSitemaps: [],
      host: '',
      groups: [
        {
          id: createUid('grp'),
          userAgents: ['*'],
          rules: [{ id: createUid('rule'), type: 'Disallow', path: '/' }],
          crawlDelay: null,
        },
      ],
      rawText: '',
      updatedAt: new Date().toISOString(),
    }),
  },
];

function cleanSingleLine(value: string): string {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

export function compileRobotsTxt(config: RobotsConfig, siteUrl?: string): string {
  const cleanSiteUrl = (siteUrl || '{SITE_URL}').replace(/\/+$/, '');

  if (config.mode === 'raw') {
    let raw = String(config.rawText || '').replace(/\r\n/g, '\n');
    if (siteUrl) {
      raw = raw.replace(/\{SITE_URL\}/g, cleanSiteUrl);
    }
    raw = raw.replace(/\s+$/, '');
    return raw ? `${raw}\n` : '';
  }

  const lines: string[] = [];

  if (config.headerComment && config.headerComment.trim()) {
    for (const line of config.headerComment.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) {
        lines.push(trimmed.startsWith('#') ? trimmed : `# ${trimmed}`);
      }
    }
    lines.push('');
  }

  const groups = Array.isArray(config.groups) ? config.groups : [];
  groups.forEach((group) => {
    const userAgents = (group.userAgents || []).map(cleanSingleLine).filter(Boolean);
    if (userAgents.length === 0) return;

    if (group.comment && group.comment.trim()) {
      for (const cLine of group.comment.split(/\r?\n/)) {
        const trimmed = cLine.trim();
        if (trimmed) {
          lines.push(trimmed.startsWith('#') ? trimmed : `# ${trimmed}`);
        }
      }
    }

    for (const ua of userAgents) {
      lines.push(`User-agent: ${ua}`);
    }

    const rules = Array.isArray(group.rules) ? group.rules : [];
    for (const rule of rules) {
      const type: RobotsDirectiveType = rule.type === 'Allow' ? 'Allow' : 'Disallow';
      const pathVal = cleanSingleLine(rule.path || '');
      if (type === 'Allow' && !pathVal) continue;

      if (rule.comment && rule.comment.trim()) {
        lines.push(`# ${cleanSingleLine(rule.comment)}`);
      }
      lines.push(pathVal ? `${type}: ${pathVal}` : `${type}:`);
    }

    if (group.crawlDelay !== null && group.crawlDelay !== undefined && !Number.isNaN(Number(group.crawlDelay)) && Number(group.crawlDelay) > 0) {
      lines.push(`Crawl-delay: ${Number(group.crawlDelay)}`);
    }

    lines.push('');
  });

  if (config.host && config.host.trim()) {
    lines.push(`Host: ${cleanSingleLine(config.host)}`);
    lines.push('');
  }

  const sitemaps: string[] = [];
  if (config.autoIncludeSitemap) {
    sitemaps.push(`${cleanSiteUrl}/sitemap.xml`);
  }
  if (Array.isArray(config.customSitemaps)) {
    for (const s of config.customSitemaps) {
      let clean = cleanSingleLine(s);
      if (!clean) continue;
      if (siteUrl) {
        clean = clean.replace(/\{SITE_URL\}/g, cleanSiteUrl);
      }
      if (!sitemaps.includes(clean)) {
        sitemaps.push(clean);
      }
    }
  }

  if (sitemaps.length > 0) {
    for (const sm of sitemaps) {
      lines.push(`Sitemap: ${sm}`);
    }
    lines.push('');
  }

  // Collapse consecutive blank lines to at most one blank line and keep trailing newline
  const normalized: string[] = [];
  for (const line of lines) {
    if (line === '' && (normalized.length === 0 || normalized[normalized.length - 1] === '')) {
      continue;
    }
    normalized.push(line);
  }
  while (normalized.length > 0 && normalized[normalized.length - 1] === '') {
    normalized.pop();
  }

  return normalized.length > 0 ? `${normalized.join('\n')}\n` : '';
}

export interface ParsedRobotsData {
  headerComment: string;
  autoIncludeSitemap: boolean;
  customSitemaps: string[];
  host: string;
  groups: RobotsGroup[];
  unparsedLines: { line: number; text: string }[];
}

function splitDirectiveLine(rawLine: string): { key: string; value: string; inlineComment: string } | null {
  const hashIdx = rawLine.indexOf('#');
  const codePart = hashIdx >= 0 ? rawLine.slice(0, hashIdx) : rawLine;
  const inlineComment = hashIdx >= 0 ? rawLine.slice(hashIdx + 1).trim() : '';
  const trimmed = codePart.trim();
  if (!trimmed) return null;

  const colonIdx = trimmed.indexOf(':');
  if (colonIdx === -1) return null;

  return {
    key: trimmed.slice(0, colonIdx).trim().toLowerCase(),
    value: trimmed.slice(colonIdx + 1).trim(),
    inlineComment,
  };
}

export function parseRobotsTxt(raw: string, currentSiteUrl?: string): ParsedRobotsData {
  const cleanRaw = String(raw || '').replace(/^\uFEFF/, '');
  const rawLines = cleanRaw.split(/\r?\n/);
  const cleanOrigin = (currentSiteUrl || '').replace(/\/+$/, '');

  const headerComments: string[] = [];
  const groups: RobotsGroup[] = [];
  const customSitemaps: string[] = [];
  let autoIncludeSitemap = false;
  let host = '';
  const unparsedLines: { line: number; text: string }[] = [];

  let currentGroup: RobotsGroup | null = null;
  let groupHasDirectives = false;
  let seenFirstGroup = false;
  let pendingComments: string[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      if (!seenFirstGroup && pendingComments.length > 0) {
        headerComments.push(...pendingComments);
        pendingComments = [];
      }
      continue;
    }

    if (trimmed.startsWith('#')) {
      const commentBody = trimmed.replace(/^#+\s?/, '');
      if (!seenFirstGroup) {
        pendingComments.push(commentBody);
      } else {
        pendingComments.push(commentBody);
      }
      continue;
    }

    const parsed = splitDirectiveLine(rawLine);
    if (!parsed) {
      unparsedLines.push({ line: i + 1, text: trimmed });
      continue;
    }

    const { key, value, inlineComment } = parsed;

    if (key === 'user-agent') {
      seenFirstGroup = true;
      if (!currentGroup || groupHasDirectives) {
        currentGroup = {
          id: createUid('grp'),
          userAgents: [],
          rules: [],
          crawlDelay: null,
          comment: pendingComments.length > 0 ? pendingComments.join('\n') : undefined,
        };
        pendingComments = [];
        groups.push(currentGroup);
        groupHasDirectives = false;
      }
      if (value) {
        currentGroup.userAgents.push(value);
      }
      continue;
    }

    if (key === 'allow' || key === 'disallow') {
      if (!currentGroup) {
        unparsedLines.push({ line: i + 1, text: trimmed });
        pendingComments = [];
        continue;
      }
      groupHasDirectives = true;
      const ruleCommentParts = [...pendingComments];
      if (inlineComment) ruleCommentParts.push(inlineComment);
      pendingComments = [];

      currentGroup.rules.push({
        id: createUid('rule'),
        type: key === 'allow' ? 'Allow' : 'Disallow',
        path: value,
        comment: ruleCommentParts.length > 0 ? ruleCommentParts.join(' — ') : undefined,
      });
      continue;
    }

    if (key === 'crawl-delay') {
      if (!currentGroup) {
        unparsedLines.push({ line: i + 1, text: trimmed });
        pendingComments = [];
        continue;
      }
      groupHasDirectives = true;
      pendingComments = [];
      const num = Number(value);
      if (!Number.isNaN(num) && num >= 0) {
        currentGroup.crawlDelay = num;
      } else {
        unparsedLines.push({ line: i + 1, text: trimmed });
      }
      continue;
    }

    if (key === 'sitemap') {
      pendingComments = [];
      const isAutoSitemap =
        value === '{SITE_URL}/sitemap.xml' ||
        (cleanOrigin && value.toLowerCase() === `${cleanOrigin}/sitemap.xml`.toLowerCase());
      if (isAutoSitemap) {
        autoIncludeSitemap = true;
      } else if (value && !customSitemaps.includes(value)) {
        customSitemaps.push(value);
      }
      continue;
    }

    if (key === 'host') {
      pendingComments = [];
      host = value;
      continue;
    }

    pendingComments = [];
    unparsedLines.push({ line: i + 1, text: trimmed });
  }

  if (!seenFirstGroup && pendingComments.length > 0) {
    headerComments.push(...pendingComments);
  }

  return {
    headerComment: headerComments.join('\n').trim(),
    autoIncludeSitemap,
    customSitemaps,
    host,
    groups,
    unparsedLines,
  };
}

interface CompiledMatcherGroup {
  userAgents: string[];
  rules: {
    type: RobotsDirectiveType;
    pattern: string;
    lineNumber: number;
    regex: RegExp;
  }[];
}

function buildPatternRegex(pattern: string): RegExp {
  const hasEndAnchor = pattern.endsWith('$');
  const body = hasEndAnchor ? pattern.slice(0, -1) : pattern;
  let regexStr = '^';
  for (const ch of body) {
    if (ch === '*') {
      regexStr += '.*';
    } else {
      regexStr += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  if (hasEndAnchor) {
    regexStr += '$';
  }
  return new RegExp(regexStr);
}

function extractMatcherGroups(robotsTxt: string): CompiledMatcherGroup[] {
  const lines = String(robotsTxt || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const groups: CompiledMatcherGroup[] = [];
  let current: CompiledMatcherGroup | null = null;
  let hasRules = false;

  for (let i = 0; i < lines.length; i++) {
    const parsed = splitDirectiveLine(lines[i]);
    if (!parsed) continue;
    const { key, value } = parsed;

    if (key === 'user-agent') {
      if (!current || hasRules) {
        current = { userAgents: [], rules: [] };
        groups.push(current);
        hasRules = false;
      }
      if (value) current.userAgents.push(value);
    } else if (key === 'allow' || key === 'disallow') {
      if (!current) continue;
      hasRules = true;
      if (key === 'disallow' && value === '') {
        // Empty Disallow in RFC 9309 means allow all (matches nothing)
        continue;
      }
      if (key === 'allow' && value === '') {
        continue;
      }
      current.rules.push({
        type: key === 'allow' ? 'Allow' : 'Disallow',
        pattern: value,
        lineNumber: i + 1,
        regex: buildPatternRegex(value),
      });
    } else if (key === 'crawl-delay') {
      if (current) hasRules = true;
    }
  }

  return groups;
}

export function normalizeTargetPath(targetUrlOrPath: string): string {
  const raw = String(targetUrlOrPath || '').trim();
  if (!raw) return '/';
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      return `${parsed.pathname || '/'}${parsed.search || ''}`;
    } catch {
      return '/';
    }
  }
  const withoutHash = raw.split('#')[0];
  return withoutHash.startsWith('/') ? withoutHash : `/${withoutHash}`;
}

export function testUrlAgainstRobots(
  robotsTxt: string,
  userAgent: string,
  targetUrlOrPath: string
): RobotsTestResult {
  const normalizedTarget = normalizeTargetPath(targetUrlOrPath);
  const botQuery = (userAgent || '*').trim().toLowerCase();
  const groups = extractMatcherGroups(robotsTxt);

  // Extract product token if full UA string was supplied, otherwise match token directly
  let bestSpecificLength = 0;
  const specificMatchedGroups: CompiledMatcherGroup[] = [];
  const wildcardGroups: CompiledMatcherGroup[] = [];

  for (const grp of groups) {
    let grpBestLen = 0;
    let isWildcard = false;

    for (const ua of grp.userAgents) {
      const token = ua.trim().toLowerCase();
      if (!token) continue;
      if (token === '*') {
        isWildcard = true;
        continue;
      }
      if (botQuery !== '*' && (botQuery === token || botQuery.includes(token) || token.includes(botQuery))) {
        // RFC 9309: longest matching user-agent product token wins
        const matchLen = Math.min(botQuery.length, token.length);
        if (matchLen > grpBestLen) {
          grpBestLen = matchLen;
        }
      }
    }

    if (grpBestLen > 0) {
      if (grpBestLen > bestSpecificLength) {
        bestSpecificLength = grpBestLen;
        specificMatchedGroups.length = 0;
        specificMatchedGroups.push(grp);
      } else if (grpBestLen === bestSpecificLength) {
        specificMatchedGroups.push(grp);
      }
    } else if (isWildcard) {
      wildcardGroups.push(grp);
    }
  }

  const activeGroups = bestSpecificLength > 0 ? specificMatchedGroups : wildcardGroups;
  const matchedUserAgents = Array.from(
    new Set(activeGroups.flatMap((g) => g.userAgents))
  );

  if (activeGroups.length === 0) {
    return {
      allowed: true,
      matchedUserAgents: [],
      matchedRule: null,
      normalizedTarget,
      reason: `No matching User-agent group found for "${userAgent || '*'}". Crawlers are allowed by default.`,
    };
  }

  // RFC 9309: Longest matching path pattern wins; on tie, Allow beats Disallow
  let winningRule: {
    type: RobotsDirectiveType;
    pattern: string;
    lineNumber: number;
    specificity: number;
  } | null = null;

  for (const grp of activeGroups) {
    for (const rule of grp.rules) {
      if (rule.regex.test(normalizedTarget)) {
        const specificity = rule.pattern.length;
        if (
          !winningRule ||
          specificity > winningRule.specificity ||
          (specificity === winningRule.specificity && rule.type === 'Allow' && winningRule.type === 'Disallow')
        ) {
          winningRule = {
            type: rule.type,
            pattern: rule.pattern,
            lineNumber: rule.lineNumber,
            specificity,
          };
        }
      }
    }
  }

  if (!winningRule) {
    return {
      allowed: true,
      matchedUserAgents,
      matchedRule: null,
      normalizedTarget,
      reason: `Matched group [${matchedUserAgents.join(', ')}], but no Allow/Disallow rule matched "${normalizedTarget}". Default is Allowed.`,
    };
  }

  const allowed = winningRule.type === 'Allow';
  return {
    allowed,
    matchedUserAgents,
    matchedRule: winningRule,
    normalizedTarget,
    reason: `${allowed ? 'Allowed' : 'Blocked'} by line ${winningRule.lineNumber} ("${winningRule.type}: ${winningRule.pattern}", specificity ${winningRule.specificity}) under User-agent [${matchedUserAgents.join(', ')}].`,
  };
}

export function lintRobotsTxt(robotsTxt: string, options?: { siteUrl?: string }): RobotsDiagnostic[] {
  const diagnostics: RobotsDiagnostic[] = [];
  const text = String(robotsTxt || '');

  // 1. Empty check
  if (!text.trim()) {
    diagnostics.push({
      id: 'empty-robots',
      severity: 'warning',
      title: 'robots.txt is currently empty',
      detail: 'An empty robots.txt allows all crawlers everywhere and omits your Sitemap URL.',
      fixAction: 'add-sitemap',
    });
    return diagnostics;
  }

  // 2. Google 500 KiB file size check
  const byteSize = new TextEncoder().encode(text).length;
  if (byteSize > GOOGLE_ROBOTS_MAX_BYTES) {
    diagnostics.push({
      id: 'file-size-limit',
      severity: 'error',
      title: `Exceeds Google's 500 KiB limit (${(byteSize / 1024).toFixed(1)} KiB)`,
      detail: 'Google ignores content past 500 KiB (512,000 bytes). Trim redundant rules or use wildcard patterns.',
    });
  }

  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const allowedKeys = new Set(['user-agent', 'allow', 'disallow', 'sitemap', 'crawl-delay', 'host']);
  let seenUserAgent = false;
  let currentGroupHasDirectives = false;
  let currentGroupAgents: string[] = [];
  let currentGroupRules: { type: string; value: string; line: number }[] = [];
  let sitemapCount = 0;
  let hasCrawlDelay = false;

  const flushGroupChecks = () => {
    if (currentGroupAgents.length === 0) return;

    // Duplicate or conflicting exact rules within group
    const seenExact = new Map<string, { type: string; line: number }>();
    for (const r of currentGroupRules) {
      const existing = seenExact.get(r.value);
      if (existing) {
        if (existing.type === r.type) {
          diagnostics.push({
            id: `dup-rule-${r.line}`,
            severity: 'warning',
            title: `Duplicate directive on line ${r.line}`,
            detail: `"${r.type}: ${r.value}" repeats line ${existing.line} in the same group.`,
            line: r.line,
          });
        } else {
          diagnostics.push({
            id: `conflict-rule-${r.line}`,
            severity: 'warning',
            title: `Conflicting Allow & Disallow for "${r.value}"`,
            detail: `Line ${existing.line} and line ${r.line} specify opposite directives for the exact same path. Per RFC 9309, Allow takes precedence on an exact length tie.`,
            line: r.line,
          });
        }
      } else {
        seenExact.set(r.value, { type: r.type, line: r.line });
      }
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const hashIdx = rawLine.indexOf('#');
    const codePart = (hashIdx >= 0 ? rawLine.slice(0, hashIdx) : rawLine).trim();
    const colonIdx = codePart.indexOf(':');

    if (colonIdx === -1) {
      diagnostics.push({
        id: `syntax-missing-colon-${lineNum}`,
        severity: 'error',
        title: `Syntax error on line ${lineNum}`,
        detail: `Expected "Directive: value" format, got "${codePart}". Prefix comments with "#".`,
        line: lineNum,
      });
      continue;
    }

    const key = codePart.slice(0, colonIdx).trim().toLowerCase();
    const value = codePart.slice(colonIdx + 1).trim();

    if (!allowedKeys.has(key)) {
      diagnostics.push({
        id: `unknown-directive-${lineNum}`,
        severity: 'warning',
        title: `Unrecognized directive "${key}" on line ${lineNum}`,
        detail: 'Search engines ignore non-standard directives (note: Noindex in robots.txt is deprecated by Google).',
        line: lineNum,
      });
      continue;
    }

    if (key === 'user-agent') {
      if (!value) {
        diagnostics.push({
          id: `empty-ua-${lineNum}`,
          severity: 'error',
          title: `Empty User-agent on line ${lineNum}`,
          detail: 'Specify a crawler name such as "*" or "Googlebot".',
          line: lineNum,
        });
      }
      if (currentGroupHasDirectives) {
        flushGroupChecks();
        currentGroupAgents = [];
        currentGroupRules = [];
        currentGroupHasDirectives = false;
      }
      seenUserAgent = true;
      if (value) currentGroupAgents.push(value);
      continue;
    }

    if (key === 'allow' || key === 'disallow') {
      if (!seenUserAgent) {
        diagnostics.push({
          id: `orphan-rule-${lineNum}`,
          severity: 'error',
          title: `${key} before any User-agent on line ${lineNum}`,
          detail: 'Allow/Disallow rules must appear inside a User-agent group.',
          line: lineNum,
        });
        continue;
      }
      currentGroupHasDirectives = true;

      if (key === 'allow' && !value) {
        diagnostics.push({
          id: `empty-allow-${lineNum}`,
          severity: 'warning',
          title: `Empty Allow directive on line ${lineNum}`,
          detail: 'An empty Allow directive has no effect; use "Allow: /" to explicitly permit crawling.',
          line: lineNum,
        });
      } else if (value && !value.startsWith('/') && !value.startsWith('*')) {
        diagnostics.push({
          id: `path-leading-slash-${lineNum}`,
          severity: 'error',
          title: `Path must start with "/" on line ${lineNum}`,
          detail: `"${value}" is not a valid path pattern. Paths in robots.txt must begin with "/".`,
          line: lineNum,
        });
      }

      if (value) {
        currentGroupRules.push({ type: key, value, line: lineNum });
      }
      continue;
    }

    if (key === 'crawl-delay') {
      if (!seenUserAgent) {
        diagnostics.push({
          id: `orphan-delay-${lineNum}`,
          severity: 'error',
          title: `Crawl-delay before any User-agent on line ${lineNum}`,
          detail: 'Crawl-delay must belong to a User-agent group.',
          line: lineNum,
        });
      } else {
        currentGroupHasDirectives = true;
        hasCrawlDelay = true;
        const num = Number(value);
        if (!value || Number.isNaN(num) || num < 0) {
          diagnostics.push({
            id: `invalid-delay-${lineNum}`,
            severity: 'error',
            title: `Invalid Crawl-delay "${value}" on line ${lineNum}`,
            detail: 'Crawl-delay must be a non-negative number of seconds.',
            line: lineNum,
          });
        }
      }
      continue;
    }

    if (key === 'sitemap') {
      sitemapCount++;
      const isValidToken = value.startsWith('{SITE_URL}/');
      if (!value || (!/^https?:\/\/\S+/i.test(value) && !isValidToken)) {
        diagnostics.push({
          id: `relative-sitemap-${lineNum}`,
          severity: 'error',
          title: `Sitemap must be an absolute URL on line ${lineNum}`,
          detail: `"${value || '(empty)'}" is invalid. Sitemap directives require a full https:// or http:// URL.`,
          line: lineNum,
          fixAction: 'fix-relative-sitemap',
        });
      }
      continue;
    }
  }

  flushGroupChecks();

  // Semantic SEO checks via our own RFC 9309 simulator
  const checkBots = ['Googlebot', '*'];
  for (const bot of checkBots) {
    const rootRes = testUrlAgainstRobots(text, bot, '/');
    if (!rootRes.allowed) {
      diagnostics.push({
        id: `blocks-root-${bot}`,
        severity: 'error',
        title: `Entire website is blocked for ${bot === '*' ? 'all crawlers (*)' : bot}`,
        detail: `The root path "/" is disallowed (${rootRes.matchedRule?.pattern || '/'}). Search engines will de-index your site unless this is intentional for staging.`,
        line: rootRes.matchedRule?.lineNumber,
        fixAction: 'allow-root',
      });
      break;
    }
  }

  const sitemapAccess = testUrlAgainstRobots(text, 'Googlebot', '/sitemap.xml');
  if (!sitemapAccess.allowed) {
    diagnostics.push({
      id: 'blocks-sitemap',
      severity: 'error',
      title: 'Googlebot is blocked from /sitemap.xml',
      detail: `Rule "${sitemapAccess.matchedRule?.pattern}" blocks Googlebot from reading your XML sitemap.`,
      line: sitemapAccess.matchedRule?.lineNumber,
    });
  }

  // Warn if CSS/JS or uploads might be blocked for Googlebot
  const assetChecks = [
    { path: '/_astro/app.css', label: 'Astro stylesheets (/_astro/)' },
    { path: '/uploads/sample.webp', label: 'Uploaded media (/uploads/)' },
  ];
  for (const asset of assetChecks) {
    const res = testUrlAgainstRobots(text, 'Googlebot', asset.path);
    if (!res.allowed && res.matchedRule?.pattern !== '/') {
      diagnostics.push({
        id: `blocks-asset-${asset.path}`,
        severity: 'warning',
        title: `Googlebot may be blocked from ${asset.label}`,
        detail: `Rule "${res.matchedRule?.pattern}" blocks "${asset.path}". Blocking CSS, JS, or images harms Google rendering and Core Web Vitals.`,
        line: res.matchedRule?.lineNumber,
      });
    }
  }

  // Warn if CMS studio or API routes are exposed to Googlebot
  const exposedAdminRoutes = ['/editor', '/edit-blog', '/api/pages'].filter((p) => {
    const res = testUrlAgainstRobots(text, 'Googlebot', p);
    return res.allowed;
  });
  if (exposedAdminRoutes.length > 0 && testUrlAgainstRobots(text, 'Googlebot', '/').allowed) {
    diagnostics.push({
      id: 'exposed-admin-routes',
      severity: 'warning',
      title: `CMS editor/API routes are crawlable (${exposedAdminRoutes.join(', ')})`,
      detail: 'Disallow FastPress studio & API routes so search engines focus crawl budget on your public content.',
      fixAction: 'disallow-studio',
    });
  }

  if (sitemapCount === 0) {
    diagnostics.push({
      id: 'missing-sitemap',
      severity: 'warning',
      title: 'No Sitemap directive found',
      detail: `Adding "Sitemap: ${(options?.siteUrl || 'https://yourdomain.com').replace(/\/+$/, '')}/sitemap.xml" helps search engines discover new pages and blog posts faster.`,
      fixAction: 'add-sitemap',
    });
  }

  if (hasCrawlDelay) {
    diagnostics.push({
      id: 'crawl-delay-info',
      severity: 'info',
      title: 'Googlebot ignores Crawl-delay',
      detail: 'Bing and Yandex honor Crawl-delay, whereas Googlebot ignores it entirely (manage Google crawl rate in Search Console).',
    });
  }

  return diagnostics;
}
