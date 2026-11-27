import fs from 'node:fs';
import path from 'node:path';

import { getDataFile } from '../core/tenantContext';
export interface FieldOption {
  label: string;
  value: string;
  isDefault?: boolean;
}

export interface ConditionalRule {
  fieldId: string;
  operator: 'is' | 'is_not' | 'contains' | 'not_contains' | 'greater_than' | 'less_than' | 'is_empty' | 'is_not_empty';
  value: string;
}

export interface ConditionalLogic {
  enabled: boolean;
  action: 'show' | 'hide';
  logicType: 'all' | 'any';
  rules: ConditionalRule[];
}

export type FormFieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'number'
  | 'email'
  | 'phone'
  | 'date'
  | 'time'
  | 'url'
  | 'address'
  | 'name'
  | 'hidden'
  | 'html'
  | 'section';

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
  defaultValue?: string;
  width?: '100%' | '50%' | '33.33%' | '25%' | '66.66%' | '75%' | string;
  options?: FieldOption[];
  content?: string; // For html or section break
  conditionalLogic?: ConditionalLogic;
}

export interface FormSubmitButton {
  text: string;
  align: 'left' | 'center' | 'right' | 'full';
  bgColor: string;
  textColor: string;
  borderRadius: string;
  size: 'sm' | 'md' | 'lg';
}

export interface GoogleSheetsConfig {
  enabled: boolean;
  sheetUrl: string; // Target Google Sheet URL or Apps Script Webhook URL
  tabName?: string; // Optional tab name, e.g. Sheet1
  webhookUrl?: string; // Direct Apps Script Webhook URL (if different)
}

export interface FormSpamProtection {
  method: 'method2'; // Server-side Honeypot trap + bot timing threshold
  honeypotEnabled: boolean;
  minSubmissionSeconds: number; // e.g. 2s minimum
}

export interface FormConfirmation {
  type: 'message' | 'redirect';
  message: string;
  redirectUrl?: string;
}

export interface FormStyling {
  theme: 'modern-dark' | 'clean-light' | 'bordered' | 'custom';
  // Form Container Background
  formBgColor?: string;
  formBgImage?: string;
  formBgSize?: 'cover' | 'contain' | 'auto';
  formBgPosition?: 'center' | 'top' | 'bottom';
  formBgRepeat?: 'no-repeat' | 'repeat';
  formBgOverlay?: string; // e.g. 'rgba(0, 0, 0, 0.5)'

  // Form Container Border & Outline
  formBorderWidth?: string; // e.g. '0px', '1px', '2px', '3px'
  formBorderStyle?: 'solid' | 'dashed' | 'dotted' | 'none';
  formBorderColor?: string; // e.g. '#28334a'
  formBorderRadius?: string; // e.g. '12px'
  formBoxShadow?: string;
  formPadding?: string;

  // Input & Field Elements Styling
  labelColor: string;
  inputBg: string;
  inputBorder: string;
  inputTextColor: string;
  borderRadius: string;

  // Title & Subtitle Styling
  titleColor?: string;
  titleSize?: string;
  descriptionColor?: string;
  descriptionSize?: string;
}

export interface FormSettings {
  title: string;
  showTitle?: boolean;
  titleColor?: string;
  titleSize?: string;
  titleAlign?: 'left' | 'center' | 'right';

  description?: string;
  showDescription?: boolean;
  descriptionColor?: string;
  descriptionSize?: string;

  submitButton: FormSubmitButton;
  googleSheets: GoogleSheetsConfig;
  spamProtection: FormSpamProtection;
  confirmation: FormConfirmation;
  styling: FormStyling;
}

export interface FormConfig {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  fields: FormField[];
  settings: FormSettings;
}

export interface FormsStore {
  forms: FormConfig[];
}


export const defaultSampleForms: FormConfig[] = [
  {
    id: 'form-contact-default',
    name: 'Contact & Inquiry Form',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fields: [
      {
        id: 'field_first_name',
        type: 'text',
        label: 'First Name',
        placeholder: 'John',
        required: true,
        width: '50%',
        description: ''
      },
      {
        id: 'field_last_name',
        type: 'text',
        label: 'Last Name',
        placeholder: 'Doe',
        required: true,
        width: '50%',
        description: ''
      },
      {
        id: 'field_email',
        type: 'email',
        label: 'Business Email',
        placeholder: 'john@example.com',
        required: true,
        width: '50%',
        description: 'We will never share your email.'
      },
      {
        id: 'field_phone',
        type: 'phone',
        label: 'Phone Number',
        placeholder: '+1 (555) 000-0000',
        required: false,
        width: '50%',
        description: 'Optional for phone callback'
      },
      {
        id: 'field_inquiry_type',
        type: 'select',
        label: 'Inquiry Type',
        required: true,
        width: '100%',
        options: [
          { label: 'General Inquiry', value: 'General Inquiry', isDefault: true },
          { label: 'Project Consultation', value: 'Project Consultation' },
          { label: 'Technical Support', value: 'Technical Support' },
          { label: 'Partnership', value: 'Partnership' }
        ],
        description: 'Select what best describes your need.'
      },
      {
        id: 'field_project_budget',
        type: 'radio',
        label: 'Estimated Project Budget',
        required: true,
        width: '100%',
        options: [
          { label: '< $2,500 USD', value: '< $2,500 USD' },
          { label: '$2,500 - $10,000 USD', value: '$2,500 - $10,000 USD', isDefault: true },
          { label: '$10,000+ USD', value: '$10,000+ USD' }
        ],
        description: 'Helps us tailor our proposal to your expectations.',
        conditionalLogic: {
          enabled: true,
          action: 'show',
          logicType: 'all',
          rules: [
            {
              fieldId: 'field_inquiry_type',
              operator: 'is',
              value: 'Project Consultation'
            }
          ]
        }
      },
      {
        id: 'field_message',
        type: 'textarea',
        label: 'Your Message',
        placeholder: 'Tell us about your project, timeline, and goals...',
        required: true,
        width: '100%',
        description: ''
      }
    ],
    settings: {
      title: 'Get In Touch',
      showTitle: true,
      titleColor: '#f3f4f6',
      titleSize: '1.45rem',
      titleAlign: 'left',
      description: 'Fill out the form below and our team will get back to you within 24 hours.',
      showDescription: true,
      descriptionColor: '#9ca3af',
      descriptionSize: '0.9rem',
      submitButton: {
        text: 'Send Message 🚀',
        align: 'left',
        bgColor: '#ff5e3a',
        textColor: '#ffffff',
        borderRadius: '8px',
        size: 'md'
      },
      googleSheets: {
        enabled: true,
        sheetUrl: '',
        tabName: 'Sheet1',
        webhookUrl: ''
      },
      spamProtection: {
        method: 'method2',
        honeypotEnabled: true,
        minSubmissionSeconds: 2
      },
      confirmation: {
        type: 'message',
        message: '🎉 Thank you! Your message has been sent successfully. We will reach out shortly.'
      },
      styling: {
        theme: 'modern-dark',
        labelColor: '#f3f4f6',
        inputBg: '#111827',
        inputBorder: '#374151',
        inputTextColor: '#ffffff',
        borderRadius: '8px'
      }
    }
  },
  {
    id: 'form-lead-gen',
    name: 'Quick Lead & Demo Request',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fields: [
      {
        id: 'lead_name',
        type: 'text',
        label: 'Full Name',
        placeholder: 'Alex Smith',
        required: true,
        width: '100%'
      },
      {
        id: 'lead_email',
        type: 'email',
        label: 'Work Email Address',
        placeholder: 'alex@company.com',
        required: true,
        width: '100%'
      },
      {
        id: 'lead_company_size',
        type: 'select',
        label: 'Company Size',
        required: true,
        width: '100%',
        options: [
          { label: '1 - 10 employees', value: '1 - 10 employees', isDefault: true },
          { label: '11 - 50 employees', value: '11 - 50 employees' },
          { label: '51 - 200 employees', value: '51 - 200 employees' },
          { label: '200+ enterprise', value: '200+ enterprise' }
        ]
      },
      {
        id: 'lead_demo_interest',
        type: 'checkbox',
        label: 'What would you like to see in the demo?',
        required: false,
        width: '100%',
        options: [
          { label: 'FastPress Visual Page Builder', value: 'FastPress Visual Page Builder' },
          { label: 'Google Sheets & CRM Integrations', value: 'Google Sheets & CRM Integrations' },
          { label: 'Enterprise Security & Performance', value: 'Enterprise Security & Performance' }
        ]
      }
    ],
    settings: {
      title: 'Schedule a Product Demo',
      description: 'See FastPress in action with a custom walkthrough.',
      submitButton: {
        text: 'Request Demo Now',
        align: 'full',
        bgColor: '#2563eb',
        textColor: '#ffffff',
        borderRadius: '8px',
        size: 'lg'
      },
      googleSheets: {
        enabled: true,
        sheetUrl: '',
        tabName: 'Sheet1',
        webhookUrl: ''
      },
      spamProtection: {
        method: 'method2',
        honeypotEnabled: true,
        minSubmissionSeconds: 2
      },
      confirmation: {
        type: 'message',
        message: 'Thank you! We have received your demo request and will email you with available times.'
      },
      styling: {
        theme: 'modern-dark',
        labelColor: '#f3f4f6',
        inputBg: '#1f2937',
        inputBorder: '#4b5563',
        inputTextColor: '#ffffff',
        borderRadius: '8px'
      }
    }
  }
];

export function readFormsData(): FormsStore {
  try {
    if (!fs.existsSync(getDataFile('forms.json'))) {
      const initialStore: FormsStore = { forms: defaultSampleForms };
      writeFormsData(initialStore);
      return initialStore;
    }
    const raw = fs.readFileSync(getDataFile('forms.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.forms)) {
      return { forms: defaultSampleForms };
    }
    return parsed;
  } catch (err) {
    console.error('Error reading forms.json:', err);
    return { forms: defaultSampleForms };
  }
}

export function writeFormsData(data: FormsStore): void {
  try {
    const dir = path.dirname(getDataFile('forms.json'));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(getDataFile('forms.json'), JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write forms.json:', err);
  }
}

export function getForms(): FormConfig[] {
  return readFormsData().forms;
}

export function getFormById(id: string): FormConfig | undefined {
  const store = readFormsData();
  return store.forms.find(f => f.id === id);
}

export function saveForm(form: FormConfig): FormsStore {
  const store = readFormsData();
  form.updatedAt = new Date().toISOString();
  if (!form.createdAt) {
    form.createdAt = form.updatedAt;
  }
  const idx = store.forms.findIndex(f => f.id === form.id);
  if (idx >= 0) {
    store.forms[idx] = form;
  } else {
    store.forms.push(form);
  }
  writeFormsData(store);
  return store;
}

export function deleteForm(id: string): { success: boolean; error?: string } {
  const store = readFormsData();
  const initialLength = store.forms.length;
  store.forms = store.forms.filter(f => f.id !== id);
  if (store.forms.length === initialLength) {
    return { success: false, error: 'Form not found.' };
  }
  writeFormsData(store);
  return { success: true };
}

export function duplicateForm(id: string): { success: boolean; newForm?: FormConfig; error?: string } {
  const store = readFormsData();
  const target = store.forms.find(f => f.id === id);
  if (!target) {
    return { success: false, error: 'Form to duplicate not found.' };
  }
  const newId = `form-${Date.now()}`;
  const duplicated: FormConfig = JSON.parse(JSON.stringify(target));
  duplicated.id = newId;
  duplicated.name = `${target.name} (Copy)`;
  duplicated.createdAt = new Date().toISOString();
  duplicated.updatedAt = duplicated.createdAt;
  store.forms.push(duplicated);
  writeFormsData(store);
  return { success: true, newForm: duplicated };
}

function escapeHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generates semantic HTML markup for embedding a form in pages and GrapesJS
 */
export function generateFormHtml(form: FormConfig): string {
  const { id, name, fields, settings } = form;
  const isDark = settings?.styling?.theme !== 'clean-light';
  const styling = settings?.styling || ({} as any);

  const formBgColor = styling.formBgColor || (isDark ? '#0f131d' : '#ffffff');
  const formBgImage = styling.formBgImage?.trim() || '';
  const formBgSize = styling.formBgSize || 'cover';
  const formBgPos = styling.formBgPosition || 'center';
  const formBgRepeat = styling.formBgRepeat || 'no-repeat';
  const formBgOverlay = styling.formBgOverlay || '';

  const formBorderWidth = styling.formBorderWidth !== undefined ? styling.formBorderWidth : '1px';
  const formBorderStyle = styling.formBorderStyle || 'solid';
  const formBorderColor = styling.formBorderColor || (isDark ? '#28334a' : '#d1d5db');
  const formBorderRadius = styling.formBorderRadius || '14px';
  const formBoxShadow = styling.formBoxShadow || '0 10px 25px -5px rgba(0, 0, 0, 0.3)';
  const formPadding = styling.formPadding || '32px';

  let bgCss = `background-color: ${formBgColor};`;
  if (formBgImage) {
    if (formBgOverlay) {
      bgCss = `background: linear-gradient(${formBgOverlay}, ${formBgOverlay}), url('${formBgImage}') ${formBgPos} / ${formBgSize} ${formBgRepeat} ${formBgColor};`;
    } else {
      bgCss = `background: url('${formBgImage}') ${formBgPos} / ${formBgSize} ${formBgRepeat} ${formBgColor};`;
    }
  }

  const borderCss = `border: ${formBorderWidth} ${formBorderStyle} ${formBorderColor}; border-radius: ${formBorderRadius}; box-shadow: ${formBoxShadow}; padding: ${formPadding};`;

  const labelColor = styling.labelColor || (isDark ? '#e5e7eb' : '#1f2937');
  const inputBg = styling.inputBg || (isDark ? '#111827' : '#ffffff');
  const inputBorder = styling.inputBorder || (isDark ? '#374151' : '#d1d5db');
  const inputTextColor = styling.inputTextColor || (isDark ? '#f9fafb' : '#111827');
  const borderRadius = styling.borderRadius || '8px';
  const btnBg = settings?.submitButton?.bgColor || '#2563eb';
  const btnColor = settings?.submitButton?.textColor || '#ffffff';
  const btnRadius = settings?.submitButton?.borderRadius || borderRadius;
  const btnAlign = settings?.submitButton?.align || 'left';

  let alignStyle = 'display: flex; justify-content: flex-start;';
  if (btnAlign === 'center') alignStyle = 'display: flex; justify-content: center;';
  if (btnAlign === 'right') alignStyle = 'display: flex; justify-content: flex-end;';
  if (btnAlign === 'full') alignStyle = 'display: block;';

  const fieldsHtml = fields.map(field => {
    const width = field.width || '100%';
    const condAttr = field.conditionalLogic?.enabled
      ? `data-conditional='${JSON.stringify(field.conditionalLogic).replace(/'/g, '&#39;')}'`
      : '';
    const reqMark = field.required ? '<span style="color:#ef4444; margin-left:3px;">*</span>' : '';
    const descHtml = field.description
      ? `<div style="font-size:0.75rem; color:#9ca3af; margin-top:4px; line-height:1.4;">${field.description}</div>`
      : '';

    let inputControl = '';
    const baseInputStyle = `width: 100%; box-sizing: border-box; background: ${inputBg}; border: 1px solid ${inputBorder}; color: ${inputTextColor}; border-radius: ${borderRadius}; padding: 10px 14px; font-size: 0.92rem; outline: none; transition: border-color 0.15s, box-shadow 0.15s;`;

    switch (field.type) {
      case 'textarea':
        inputControl = `<textarea id="${field.id}" name="${field.id}" data-label="${escapeHtml(field.label)}" ${field.required ? 'required' : ''} placeholder="${escapeHtml(field.placeholder || '')}" rows="4" style="${baseInputStyle} resize: vertical;">${escapeHtml(field.defaultValue || '')}</textarea>`;
        break;

      case 'select':
        const optionsHtml = (field.options || []).map(opt => {
          const optVal = opt.value || opt.label || '';
          const optLabel = opt.label || opt.value || '';
          const sel = opt.isDefault || optVal === field.defaultValue ? 'selected' : '';
          return `<option value="${escapeHtml(optVal)}" ${sel}>${escapeHtml(optLabel)}</option>`;
        }).join('');
        inputControl = `<select id="${field.id}" name="${field.id}" data-label="${escapeHtml(field.label)}" ${field.required ? 'required' : ''} style="${baseInputStyle}">
          <option value="" disabled ${!field.defaultValue ? 'selected' : ''}>${escapeHtml(field.placeholder || '-- Please Select --')}</option>
          ${optionsHtml}
        </select>`;
        break;

      case 'radio':
        inputControl = `<div style="display:flex; flex-direction:column; gap:8px; margin-top:6px;">` +
          (field.options || []).map((opt) => {
            const optVal = opt.value || opt.label || '';
            const optLabel = opt.label || opt.value || '';
            const chk = opt.isDefault || optVal === field.defaultValue ? 'checked' : '';
            return `<label style="display:inline-flex; align-items:center; gap:8px; cursor:pointer; font-size:0.9rem; color:${labelColor};">
              <input type="radio" name="${field.id}" data-label="${escapeHtml(field.label)}" value="${escapeHtml(optVal)}" ${chk} ${field.required ? 'required' : ''} style="accent-color:${btnBg}; width:16px; height:16px; cursor:pointer;" />
              <span>${escapeHtml(optLabel)}</span>
            </label>`;
          }).join('') +
          `</div>`;
        break;

      case 'checkbox':
        inputControl = `<div style="display:flex; flex-direction:column; gap:8px; margin-top:6px;">` +
          (field.options || []).map((opt) => {
            const optVal = opt.value || opt.label || '';
            const optLabel = opt.label || opt.value || '';
            const chk = opt.isDefault ? 'checked' : '';
            return `<label style="display:inline-flex; align-items:center; gap:8px; cursor:pointer; font-size:0.9rem; color:${labelColor};">
              <input type="checkbox" name="${field.id}[]" data-label="${escapeHtml(field.label)}" value="${escapeHtml(optVal)}" ${chk} style="accent-color:${btnBg}; width:16px; height:16px; cursor:pointer;" />
              <span>${escapeHtml(optLabel)}</span>
            </label>`;
          }).join('') +
          `</div>`;
        break;

      case 'section':
        return `<div class="fp-form-field-wrapper fp-section-break" style="width: 100%; box-sizing: border-box; padding: 16px 8px 8px 8px; border-bottom: 1px solid ${inputBorder}; margin-bottom: 12px;" ${condAttr}>
          <h4 style="margin:0 0 4px 0; font-size:1.1rem; font-weight:700; color:${labelColor};">${field.label}</h4>
          ${field.description ? `<p style="margin:0; font-size:0.82rem; color:#9ca3af;">${field.description}</p>` : ''}
        </div>`;

      case 'html':
        return `<div class="fp-form-field-wrapper fp-html-block" style="width: ${width}; box-sizing: border-box; padding: 8px;" ${condAttr}>
          ${field.content || field.defaultValue || ''}
        </div>`;

      case 'hidden':
        return `<input type="hidden" name="${field.id}" value="${field.defaultValue || ''}" />`;

      case 'date':
      case 'time':
      case 'number':
      case 'email':
      case 'phone':
      case 'url':
      case 'text':
      default:
        const inputType = field.type === 'phone' ? 'tel' : field.type;
        inputControl = `<input type="${inputType}" id="${field.id}" name="${field.id}" data-label="${field.label}" ${field.required ? 'required' : ''} placeholder="${field.placeholder || ''}" value="${field.defaultValue || ''}" style="${baseInputStyle}" />`;
        break;
    }

    return `<div class="fp-form-field-wrapper" data-field-id="${field.id}" data-field-type="${field.type}" style="width: ${width}; box-sizing: border-box; padding: 8px; transition: all 0.25s ease;" ${condAttr}>
      <label for="${field.id}" style="display:block; font-size:0.88rem; font-weight:600; color:${labelColor}; margin-bottom:6px;">
        ${field.label}${reqMark}
      </label>
      ${inputControl}
      ${descHtml}
    </div>`;
  }).join('');

  const showTitle = settings.showTitle !== false && !!settings.title;
  const showDesc = settings.showDescription !== false && !!settings.description;
  const titleColor = settings.titleColor || styling.titleColor || (isDark ? '#f3f4f6' : '#111827');
  const titleSize = settings.titleSize || styling.titleSize || '1.45rem';
  const descColor = settings.descriptionColor || styling.descriptionColor || (isDark ? '#9ca3af' : '#4b5563');
  const descSize = settings.descriptionSize || styling.descriptionSize || '0.9rem';
  const headerAlign = settings.titleAlign || 'left';

  let headerHtml = '';
  if (showTitle || showDesc) {
    headerHtml = `<div class="fp-form-header" style="margin-bottom: 20px; text-align: ${headerAlign};">
    ${showTitle ? `<h3 style="margin: 0 0 6px 0; font-size: ${titleSize}; font-weight: 800; color: ${titleColor}; letter-spacing: -0.02em;">${settings.title}</h3>` : ''}
    ${showDesc ? `<p style="margin: 0; font-size: ${descSize}; color: ${descColor}; line-height: 1.5;">${settings.description}</p>` : ''}
  </div>`;
  }

  return `<div class="fp-form-embed" data-form-id="${id}" style="box-sizing: border-box; width: 100%; max-width: 780px; margin: 0 auto; ${bgCss} ${borderCss}">
  <style>
    .fp-form-embed .fp-form-field-wrapper { box-sizing: border-box; }
    @media (max-width: 640px) {
      .fp-form-embed .fp-form-field-wrapper { width: 100% !important; }
    }
  </style>
  ${headerHtml}

  <form class="fp-ajax-form" method="POST" action="/api/forms/submit" data-form-id="${id}" novalidate style="margin: 0;">
    <!-- Anti-Spam Method 2 (Honeypot trap + Timestamp verification) -->
    <div style="display: none !important; position: absolute; left: -9999px;" aria-hidden="true">
      <input type="text" name="_fp_hp_trap" tabindex="-1" autocomplete="off" />
      <input type="hidden" name="_fp_form_id" value="${id}" />
      <input type="hidden" name="_fp_form_ts" class="_fp_form_ts" value="" />
    </div>

    <!-- Fields Container Grid -->
    <div class="fp-form-fields-grid" style="display: flex; flex-wrap: wrap; margin: -8px;">
      ${fieldsHtml}
    </div>

    <!-- Submit Action Row -->
    <div class="fp-form-actions" style="margin-top: 20px; ${alignStyle}">
      <button type="submit" class="fp-submit-btn" style="display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-weight: 700; font-size: 0.95rem; padding: 12px 28px; border: none; border-radius: ${btnRadius}; background: ${btnBg}; color: ${btnColor}; cursor: pointer; transition: transform 0.15s, opacity 0.15s; ${btnAlign === 'full' ? 'width: 100%;' : ''}">
        <span class="fp-btn-text">${settings.submitButton.text}</span>
        <span class="fp-btn-spinner" style="display: none;">⏳ Sending...</span>
      </button>
    </div>

    <!-- Response Alerts Container -->
    <div class="fp-form-alert" style="display: none; margin-top: 16px; padding: 14px 18px; border-radius: 8px; font-size: 0.92rem; font-weight: 500; line-height: 1.5;"></div>
  </form>
</div>`;
}
