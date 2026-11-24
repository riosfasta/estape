import type { APIRoute } from 'astro';
import {
  readRobotsConfig,
  writeRobotsConfig,
  sanitizeRobotsConfig,
  discoverSiteRoutes,
} from '../../data/robots';
import {
  compileRobotsTxt,
  createDefaultRobotsConfig,
  lintRobotsTxt,
  parseRobotsTxt,
  testUrlAgainstRobots,
} from '../../lib/robots-utils';

export const prerender = false;

function resolveSiteUrl(url: URL): string {
  const origin = url.origin || 'http://localhost:4321';
  return (process.env.SITE_URL || origin).replace(/\/+$/, '');
}

export const GET: APIRoute = async ({ url }) => {
  try {
    const siteUrl = resolveSiteUrl(url);
    const [config, discoveredRoutes] = await Promise.all([
      readRobotsConfig(),
      discoverSiteRoutes(),
    ]);
    const compiled = compileRobotsTxt(config, siteUrl);
    const diagnostics = lintRobotsTxt(compiled, { siteUrl });

    return new Response(
      JSON.stringify({
        success: true,
        siteUrl,
        config,
        compiled,
        diagnostics,
        discoveredRoutes,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err?.message || 'Failed to read robots config' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

export const POST: APIRoute = async ({ request, url }) => {
  try {
    const siteUrl = resolveSiteUrl(url);
    const text = await request.text();
    let body: any = {};
    if (text && text.trim().length > 0) {
      body = JSON.parse(text);
    }

    const action = body.action || 'save';

    if (action === 'reset') {
      const defaults = createDefaultRobotsConfig();
      const saved = await writeRobotsConfig(defaults);
      const compiled = compileRobotsTxt(saved, siteUrl);
      const diagnostics = lintRobotsTxt(compiled, { siteUrl });

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Robots.txt reset to FastPress defaults.',
          siteUrl,
          config: saved,
          compiled,
          diagnostics,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (action === 'parse-raw') {
      const rawText = typeof body.rawText === 'string' ? body.rawText : '';
      const parsed = parseRobotsTxt(rawText, siteUrl);
      return new Response(
        JSON.stringify({
          success: true,
          parsed,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (action === 'test') {
      const target = typeof body.target === 'string' ? body.target : '/';
      const userAgent = typeof body.userAgent === 'string' ? body.userAgent : 'Googlebot';
      let robotsContent = typeof body.robotsText === 'string' ? body.robotsText : '';
      if (!robotsContent) {
        const current = await readRobotsConfig();
        robotsContent = compileRobotsTxt(current, siteUrl);
      }
      const result = testUrlAgainstRobots(robotsContent, userAgent, target);
      return new Response(
        JSON.stringify({
          success: true,
          result,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Default action: save configuration
    const candidate = body.config && typeof body.config === 'object' ? body.config : body;
    const sanitized = sanitizeRobotsConfig(candidate);

    if (sanitized.mode === 'visual' && sanitized.groups.length === 0 && !sanitized.autoIncludeSitemap && sanitized.customSitemaps.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Configuration must contain at least one User-agent group or Sitemap directive (or switch to Raw mode).',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const saved = await writeRobotsConfig(sanitized);
    const compiled = compileRobotsTxt(saved, siteUrl);
    const diagnostics = lintRobotsTxt(compiled, { siteUrl });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'robots.txt saved and published live!',
        siteUrl,
        config: saved,
        compiled,
        diagnostics,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err?.message || 'Failed to save robots.txt configuration' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
