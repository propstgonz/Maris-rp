import { escapeHtml } from './html';
import { icon } from '../lib/icons';
import { fieldHtml, wireFieldDependencies, validateFields, paintFieldErrors, clearFieldErrors, buildPayload, type FieldSpec } from '../lib/formFields';
import { openModal, closeAllModals, showConfirm, showToast } from './ui';
import { apiFetch, ApiError } from './api';

export interface SectionFormOptions {
  form: HTMLFormElement;
  container: ParentNode;
  status: HTMLElement;
  fields: FieldSpec[];
  successLabel: string;
  submit: (payload: Record<string, unknown>) => Promise<string | void>;
}

export function wireSectionForm({ form, container, status, fields, successLabel, submit }: SectionFormOptions) {
  form.addEventListener('submit', async evt => {
    evt.preventDefault();
    clearFieldErrors(container);
    const errors = validateFields(fields, container);
    if (errors.length > 0) {
      paintFieldErrors(errors, container);
      status.textContent = `❌ Revisa los campos marcados (${errors.length}).`;
      return;
    }
    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    status.textContent = 'Guardando…';
    if (submitBtn) submitBtn.disabled = true;
    try {
      const suffix = await submit(buildPayload(fields, container));
      status.textContent = `✅ ${successLabel}.${suffix ?? ''}`;
    } catch (err) {
      status.textContent = `❌ ${err instanceof Error ? err.message : 'Error desconocido.'}`;
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

export interface CatalogFormOptions {
  title: string;
  fields: FieldSpec[];
  values: Record<string, unknown>;
  onSubmit: (payload: Record<string, unknown>) => Promise<string | void>;
  isCreate?: boolean;
}

export function openCatalogForm(panel: HTMLElement, { title, fields, values, onSubmit, isCreate = true }: CatalogFormOptions) {
  panel.innerHTML = `
    <div class="form-header"><h3>${escapeHtml(title)}</h3><button type="button" class="btn-icon modal-close" aria-label="Cerrar">${icon('x', { size: 15 })}</button></div>
    <form>
      ${fields.map(f => fieldHtml(f, values[f.key])).join('')}
      <button type="submit" class="btn-primary">Guardar</button>
      <p class="hint form-status" role="status"></p>
    </form>`;
  panel.querySelector<HTMLButtonElement>('.modal-close')!.onclick = () => closeAllModals();
  wireFieldDependencies(panel);
  wireSectionForm({
    form: panel.querySelector('form')!,
    container: panel,
    status: panel.querySelector<HTMLElement>('.form-status')!,
    fields,
    successLabel: 'Guardado',
    submit: async payload => {
      const suffix = await onSubmit(payload);
      if (isCreate) closeAllModals();
      return suffix;
    },
  });
  openModal(panel);
}

export async function deleteCatalogRow(
  apiPath: string,
  row: { name: string; display_name?: string; label?: string },
  onDone: () => void | Promise<void>
) {
  const label = row.display_name ?? row.label ?? row.name;
  const ok = await showConfirm({
    title: 'Borrar del catálogo',
    message: `¿Seguro que quieres borrar "${label}"? Esto no se puede deshacer.`,
    confirmLabel: 'Borrar',
    danger: true,
  });
  if (!ok) return;
  try {
    await apiFetch(`/api/${apiPath}/${encodeURIComponent(row.name)}`, { method: 'DELETE' });
    showToast(`"${label}" eliminado.`, 'success');
    await onDone();
  } catch (err) {
    showToast(err instanceof ApiError ? err.message : 'Error desconocido.', 'error');
  }
}
