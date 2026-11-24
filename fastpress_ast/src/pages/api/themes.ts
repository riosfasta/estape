import type { APIRoute } from 'astro';
import { getActiveThemeName, setActiveTheme, listThemes } from '../../core/theme';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const activeTheme = getActiveThemeName();
    const themes = listThemes();
    return new Response(
      JSON.stringify({
        success: true,
        activeTheme,
        themes,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { activeTheme } = body;

    if (!activeTheme || typeof activeTheme !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'Field "activeTheme" is required and must be a string.' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const success = setActiveTheme(activeTheme.trim());
    if (!success) {
      return new Response(
        JSON.stringify({ success: false, error: `Failed to set active theme to "${activeTheme}". Theme not found.` }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Theme switched to "${activeTheme}" successfully.`,
        activeTheme: activeTheme.trim(),
        themes: listThemes(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
