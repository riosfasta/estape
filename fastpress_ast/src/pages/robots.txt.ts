import type { APIRoute } from 'astro';
import { readRobotsConfig } from '../data/robots';
import { compileRobotsTxt } from '../lib/robots-utils';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const origin = url.origin || 'http://localhost:4321';
  const siteUrl = (process.env.SITE_URL || origin).replace(/\/+$/, '');

  const config = await readRobotsConfig();
  const content = compileRobotsTxt(config, siteUrl);

  return new Response(content, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=60, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
