import { escapeHtml, escapeAttr } from '../scripts/html';

export interface FieldOption { value: string; label: string }
export interface FieldSpec {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'integer' | 'checkbox' | 'select' | 'textarea' | 'color';
  options?: FieldOption[];
  disabled?: boolean;
  dependsOn?: string;
  dependsOnValue?: string;
  maxLength?: number;
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: string;
  patternHint?: string;
  hint?: string;
  placeholder?: string;
  emptyMeans?: 'omit' | 'null';
}

function commonAttrs(f: FieldSpec): string {
  const parts: string[] = [];
  if (f.required) parts.push('required');
  if (f.placeholder) parts.push(`placeholder="${escapeAttr(f.placeholder)}"`);
  if (f.min !== undefined) parts.push(`min="${f.min}"`);
  if (f.max !== undefined) parts.push(`max="${f.max}"`);
  if (f.pattern) parts.push(`pattern="${escapeAttr(f.pattern)}"`);
  return parts.length ? ' ' + parts.join(' ') : '';
}

function labelOpen(f: FieldSpec, depAttr: string): string {
  return `<label data-field-key="${f.key}"${depAttr}>${escapeHtml(f.label)}${f.required ? ' *' : ''}`;
}

function hintHtml(f: FieldSpec): string {
  return f.hint ? `<span class="field-hint">${escapeHtml(f.hint)}</span>` : '';
}

export function fieldHtml(f: FieldSpec, value: unknown): string {
  const id = `f_${f.key}`;
  const depAttr = f.dependsOn
    ? ` data-depends-on="f_${f.dependsOn}"${f.dependsOnValue !== undefined ? ` data-depends-on-value="${escapeAttr(f.dependsOnValue)}"` : ''}`
    : '';
  if (f.type === 'checkbox') {
    return `<label class="field-check" data-field-key="${f.key}"${depAttr}><input type="checkbox" id="${id}" ${value ? 'checked' : ''}> ${escapeHtml(f.label)}</label>`;
  }
  if (f.type === 'select') {
    const opts = (f.options ?? []).map(o =>
      `<option value="${escapeAttr(o.value)}" ${String(o.value) === String(value ?? '') ? 'selected' : ''}>${escapeHtml(o.label)}</option>`
    ).join('');
    const staleValue = value != null && String(value) !== '' && !(f.options ?? []).some(o => String(o.value) === String(value));
    const staleWarning = staleValue ? `<span class="field-stale-warning">El valor guardado ("${escapeHtml(String(value))}") ya no está entre las opciones — al guardar se sustituirá por la primera.</span>` : '';
    return `${labelOpen(f, depAttr)}<select id="${id}"${f.required ? ' required' : ''}>${opts}</select>${hintHtml(f)}${staleWarning}</label>`;
  }
  if (f.type === 'textarea') {
    return `${labelOpen(f, depAttr)}<textarea id="${id}" rows="2"${commonAttrs(f)}>${escapeHtml(String(value ?? ''))}</textarea>${hintHtml(f)}</label>`;
  }
  if (f.type === 'color') {
    return `${labelOpen(f, depAttr)}<input type="color" id="${id}" value="${escapeAttr(String(value || '#888888'))}">${hintHtml(f)}</label>`;
  }
  if (f.type === 'number' || f.type === 'integer') {
    const v = value === null || value === undefined ? '' : String(value);
    const step = f.type === 'integer' ? '1' : 'any';
    return `${labelOpen(f, depAttr)}<input type="number" id="${id}" value="${escapeAttr(v)}" step="${step}"${commonAttrs(f)}>${hintHtml(f)}</label>`;
  }
  const maxLengthAttr = f.maxLength ? ` maxlength="${f.maxLength}"` : '';
  return `${labelOpen(f, depAttr)}<input type="text" id="${id}" value="${escapeAttr(String(value ?? ''))}" ${f.disabled ? 'disabled' : ''}${maxLengthAttr}${commonAttrs(f)}>${hintHtml(f)}</label>`;
}

export function wireFieldDependencies(container: ParentNode) {
  const dependents = container.querySelectorAll<HTMLElement>('[data-depends-on]');
  if (dependents.length === 0) return;
  const sync = () => {
    dependents.forEach(el => {
      const controllerId = el.dataset.dependsOn!;
      const controller = container.querySelector<HTMLInputElement | HTMLSelectElement>(`#${controllerId}`);
      if (!controller) { el.classList.toggle('hidden', false); return; }
      const expectedValue = el.dataset.dependsOnValue;
      const visible = expectedValue !== undefined ? controller.value === expectedValue : (controller as HTMLInputElement).checked;
      el.classList.toggle('hidden', !visible);
    });
  };
  const controllerIds = new Set([...dependents].map(el => el.dataset.dependsOn!));
  controllerIds.forEach(id => {
    const controller = container.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
    controller?.addEventListener('change', sync);
  });
  sync();
}

function isFieldVisible(f: FieldSpec, root: ParentNode): boolean {
  if (!f.dependsOn) return true;
  const controller = root.querySelector<HTMLInputElement | HTMLSelectElement>(`#f_${f.dependsOn}`);
  if (!controller) return true;
  return f.dependsOnValue !== undefined ? controller.value === f.dependsOnValue : (controller as HTMLInputElement).checked;
}

export function readField(f: { key: string; type?: string }, root: ParentNode = document): string | number | boolean | null {
  const el = root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#f_${f.key}`);
  if (!el) return null;
  if (f.type === 'checkbox') return (el as HTMLInputElement).checked;
  if (f.type === 'number' || f.type === 'integer') {
    const s = el.value.trim();
    return s === '' ? null : Number(s);
  }
  const s = el.value.trim();
  return s === '' ? null : s;
}

export interface FieldError { key: string; message: string }

export function validateFields(fields: FieldSpec[], root: ParentNode = document): FieldError[] {
  const errors: FieldError[] = [];
  for (const f of fields) {
    if (f.disabled || !isFieldVisible(f, root)) continue;
    const el = root.querySelector(`#f_${f.key}`);
    if (!el) continue;
    const value = readField(f, root);
    if (f.required && (value === null || value === '' || value === false)) {
      errors.push({ key: f.key, message: `${f.label} es obligatorio.` });
      continue;
    }
    if (value === null) continue;
    if ((f.type === 'number' || f.type === 'integer') && typeof value === 'number') {
      if (f.min !== undefined && value < f.min) errors.push({ key: f.key, message: `${f.label} debe ser al menos ${f.min}.` });
      else if (f.max !== undefined && value > f.max) errors.push({ key: f.key, message: `${f.label} no puede superar ${f.max}.` });
    }
    if (f.pattern && typeof value === 'string' && !new RegExp(`^(?:${f.pattern})$`).test(value)) {
      errors.push({ key: f.key, message: f.patternHint ?? `${f.label} tiene un formato no válido.` });
    }
  }
  return errors;
}

export function paintFieldErrors(errors: FieldError[], root: ParentNode = document) {
  clearFieldErrors(root);
  let first: HTMLElement | null = null;
  for (const err of errors) {
    const label = root.querySelector<HTMLElement>(`[data-field-key="${err.key}"]`);
    if (!label) continue;
    label.classList.add('field-invalid');
    const msg = document.createElement('span');
    msg.className = 'field-error-msg';
    msg.textContent = err.message;
    label.appendChild(msg);
    if (!first) first = label;
  }
  first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function clearFieldErrors(root: ParentNode = document) {
  root.querySelectorAll('.field-invalid').forEach(el => el.classList.remove('field-invalid'));
  root.querySelectorAll('.field-error-msg').forEach(el => el.remove());
}

export function buildPayload(fields: FieldSpec[], root: ParentNode = document): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.disabled || !isFieldVisible(f, root)) continue;
    const value = readField(f, root);
    if (value === null && f.emptyMeans === 'omit') continue;
    payload[f.key] = value;
  }
  return payload;
}
