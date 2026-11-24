import type { APIRoute } from 'astro';
import {
  getForms,
  getFormById,
  saveForm,
  deleteForm,
  duplicateForm,
  generateFormHtml,
  type FormConfig
} from '../../data/forms';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  try {
    const id = url.searchParams.get('id');
    const withHtml = url.searchParams.get('withHtml') === 'true';

    if (id) {
      const form = getFormById(id);
      if (!form) {
        return new Response(JSON.stringify({ error: 'Form not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(
        JSON.stringify({
          form,
          html: withHtml ? generateFormHtml(form) : undefined
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const forms = getForms();
    const result = forms.map(f => ({
      ...f,
      html: withHtml ? generateFormHtml(f) : undefined
    }));

    return new Response(JSON.stringify({ forms: result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'duplicate') {
      const { id } = body;
      if (!id) {
        return new Response(JSON.stringify({ error: 'Form ID is required for duplication' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      const res = duplicateForm(id);
      if (!res.success) {
        return new Response(JSON.stringify({ error: res.error }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ success: true, newForm: res.newForm }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Default action: save / update form
    const form: FormConfig = body.form || body;
    if (!form || !form.id || !form.name) {
      return new Response(JSON.stringify({ error: 'Invalid form data. Form ID and name are required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const updatedStore = saveForm(form);
    const html = generateFormHtml(form);

    return new Response(JSON.stringify({ success: true, form, html }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed to save form' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const DELETE: APIRoute = async ({ request, url }) => {
  try {
    let id = url.searchParams.get('id');
    if (!id) {
      try {
        const body = await request.json();
        id = body.id;
      } catch {}
    }

    if (!id) {
      return new Response(JSON.stringify({ error: 'Form ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const res = deleteForm(id);
    if (!res.success) {
      return new Response(JSON.stringify({ error: res.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: true, deletedId: id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed to delete form' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
