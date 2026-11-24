import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { getFormById, type FormConfig } from '../../../data/forms';

export const prerender = false;

const SUBMISSIONS_FILE = path.join(process.cwd(), 'src', 'data', 'form-submissions.json');

interface SubmissionRecord {
  id: string;
  formId: string;
  formName: string;
  submittedAt: string;
  ip?: string;
  userAgent?: string;
  fields: Record<string, any>;
  forwardedToGoogleSheets: boolean;
  googleSheetsStatus?: string;
  googleSheetTargetUrl?: string;
  googleSheetTargetName?: string;
  googleSheetTabName?: string;
}

function readLocalSubmissions(): SubmissionRecord[] {
  try {
    if (!fs.existsSync(SUBMISSIONS_FILE)) return [];
    const raw = fs.readFileSync(SUBMISSIONS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to read local submissions:', err);
    return [];
  }
}

function saveLocalSubmission(record: SubmissionRecord): void {
  try {
    const dir = path.dirname(SUBMISSIONS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    let list = readLocalSubmissions();
    list.unshift(record);
    // Keep last 500 submissions
    if (list.length > 500) {
      list = list.slice(0, 500);
    }
    fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to log submission locally:', err);
  }
}

export const GET: APIRoute = async ({ url }) => {
  const formId = url.searchParams.get('formId');
  const all = readLocalSubmissions();
  const submissions = formId ? all.filter((item) => item.formId === formId) : all;
  return new Response(JSON.stringify({ submissions }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};

export const POST: APIRoute = async ({ request }) => {
  try {
    let payload: Record<string, any> = {};
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      payload = await request.json();
    } else {
      const formData = await request.formData();
      formData.forEach((val, key) => {
        if (key.endsWith('[]')) {
          const cleanKey = key.slice(0, -2);
          if (!payload[cleanKey]) payload[cleanKey] = [];
          payload[cleanKey].push(val.toString());
        } else {
          payload[key] = val.toString();
        }
      });
    }

    const formId = payload._fp_form_id || payload.formId;
    if (!formId) {
      return new Response(JSON.stringify({ error: 'Missing form ID (_fp_form_id)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const form = getFormById(formId);
    if (!form) {
      return new Response(JSON.stringify({ error: 'Form configuration not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // -------------------------------------------------------------
    // Anti-Spam (Method 2) Protections:
    // 1. Honeypot check: _fp_hp_trap must be empty
    // -------------------------------------------------------------
    const hpTrap = payload._fp_hp_trap;
    if (hpTrap && typeof hpTrap === 'string' && hpTrap.trim().length > 0) {
      console.warn(`[AntiSpam Method 2] Honeypot triggered for form ${formId}. Silently discarding.`);
      // Return fake success so bots do not retry or learn
      return new Response(
        JSON.stringify({
          success: true,
          message: form.settings.confirmation.message || 'Thank you! Your message has been received.'
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // 2. Timestamp check: minimum submission time (bot speed test)
    const formTs = parseInt(payload._fp_form_ts, 10);
    const minSeconds = form.settings.spamProtection?.minSubmissionSeconds ?? 2;
    if (!isNaN(formTs)) {
      const elapsedMs = Date.now() - formTs;
      if (elapsedMs < minSeconds * 1000) {
        console.warn(`[AntiSpam Method 2] Form submitted too quickly (${elapsedMs}ms < ${minSeconds}s). Flagged as bot.`);
        return new Response(
          JSON.stringify({
            error: 'Submission was submitted too quickly. Please take a moment to review before submitting.'
          }),
          {
            status: 429,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
    }

    // -------------------------------------------------------------
    // Map submitted fields to readable labels
    // -------------------------------------------------------------
    const fieldMap: Record<string, string> = {};
    form.fields.forEach(f => {
      fieldMap[f.id] = f.label || f.id;
    });

    const cleanData: Record<string, any> = {};
    Object.keys(payload).forEach(k => {
      if (k.startsWith('_fp_') || k === 'formId') return;
      const readableLabel = fieldMap[k] || k;
      let val = payload[k];
      if (Array.isArray(val)) {
        val = val.join(', ');
      }
      cleanData[readableLabel] = val;
    });

    // -------------------------------------------------------------
    // Google Sheets Delivery
    // -------------------------------------------------------------
    let forwardedToGoogle = false;
    let googleStatus = 'Not configured';
    let googleSheetTargetUrl: string | undefined;
    let googleSheetTargetName: string | undefined;
    let googleSheetTabName: string | undefined;
    const gs = form.settings.googleSheets;

    const targetUrl = gs?.webhookUrl?.trim() || gs?.sheetUrl?.trim() || '';

    if (gs?.enabled && targetUrl) {
      try {
        // If it's a Google Apps Script Webhook URL (script.google.com)
        if (targetUrl.includes('script.google.com')) {
          const webhookPayload = {
            formId: form.id,
            formName: form.name,
            submittedAt: new Date().toISOString(),
            tabName: gs.tabName || 'Sheet1',
            sheetUrl: gs.sheetUrl?.includes('docs.google.com/spreadsheets') ? gs.sheetUrl.trim() : undefined,
            data: cleanData
          };

          const sheetResp = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(webhookPayload)
          });

          const respText = await sheetResp.text();
          let respJson: Record<string, any> | null = null;
          try {
            respJson = JSON.parse(respText);
          } catch {
            // Non-JSON response (e.g. HTML sign-in / error page when Web App access is restricted)
          }

          if (sheetResp.ok) {
            if (respJson && respJson.result === 'error') {
              forwardedToGoogle = false;
              googleStatus = `Apps Script error: ${respJson.error || 'Unknown error'}`;
              console.error('[Google Sheets] Apps Script returned error:', respJson.error);
            } else if (!respJson && respText.trim().startsWith('<')) {
              forwardedToGoogle = false;
              googleStatus = 'Apps Script returned HTML instead of JSON (set Web App "Who has access" to "Anyone" and redeploy)';
              console.error('[Google Sheets] Unexpected HTML response from Apps Script');
            } else {
              forwardedToGoogle = true;
              googleSheetTargetUrl = typeof respJson?.spreadsheetUrl === 'string'
                ? respJson.spreadsheetUrl
                : (gs.sheetUrl?.includes('docs.google.com/spreadsheets') ? gs.sheetUrl.trim() : undefined);
              googleSheetTargetName = typeof respJson?.spreadsheetName === 'string' ? respJson.spreadsheetName : undefined;
              googleSheetTabName = typeof respJson?.sheetName === 'string' ? respJson.sheetName : (gs.tabName || undefined);
              googleStatus = googleSheetTargetName
                ? `Delivered to "${googleSheetTargetName}" (${googleSheetTabName || 'Sheet1'})`
                : `Success (${sheetResp.status})`;
            }
          } else {
            googleStatus =
              sheetResp.status === 401 || sheetResp.status === 403
                ? `Webhook error HTTP ${sheetResp.status} (Set Apps Script Web App "Who has access" to "Anyone")`
                : `Webhook error HTTP ${sheetResp.status}`;
            console.error('[Google Sheets] Webhook responded with error:', sheetResp.status);
          }
        } else if (targetUrl.includes('docs.google.com/spreadsheets')) {
          // Direct sheet URL provided without webhook
          googleSheetTargetUrl = targetUrl;
          googleStatus = 'Direct Sheet URL provided. Use Google Apps Script Webhook URL for direct automated delivery.';
        }
      } catch (gsErr: any) {
        googleStatus = `Delivery failed: ${gsErr.message || gsErr}`;
        console.error('[Google Sheets Delivery Error]:', gsErr);
      }
    }

    // -------------------------------------------------------------
    // Save submission locally so data is never lost
    // -------------------------------------------------------------
    const submissionRecord: SubmissionRecord = {
      id: `sub-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      formId: form.id,
      formName: form.name,
      submittedAt: new Date().toISOString(),
      fields: cleanData,
      forwardedToGoogleSheets: forwardedToGoogle,
      googleSheetsStatus: googleStatus,
      googleSheetTargetUrl,
      googleSheetTargetName,
      googleSheetTabName
    };
    saveLocalSubmission(submissionRecord);

    return new Response(
      JSON.stringify({
        success: true,
        message: form.settings.confirmation.message || 'Thank you! Your message has been received.',
        redirectUrl: form.settings.confirmation.type === 'redirect' ? form.settings.confirmation.redirectUrl : undefined,
        forwardedToGoogleSheets: forwardedToGoogle,
        googleSheetsStatus: googleStatus,
        googleSheetTargetUrl
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (err: any) {
    console.error('Submission handling error:', err);
    return new Response(JSON.stringify({ error: err.message || 'An unexpected error occurred.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
