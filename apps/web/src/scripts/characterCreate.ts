import { fieldHtml, wireFieldDependencies, validateFields, paintFieldErrors, clearFieldErrors, buildPayload, type FieldSpec } from '../lib/formFields';
import { apiFetch, ApiError } from './api';

const FIELDS: FieldSpec[] = [
  { key: 'fullName', label: 'Nombre completo', type: 'text', required: true, maxLength: 100, placeholder: 'Ej. Doña Muza Niyazova' },
  { key: 'originCountry', label: 'País o región de origen', type: 'text', required: true, maxLength: 56, placeholder: 'Ej. Galicia' },
  { key: 'nationality', label: 'Gentilicio', type: 'text', required: true, maxLength: 56, placeholder: 'Ej. gallega' },
  { key: 'gender', label: 'Género (opcional)', type: 'select', options: [{ value: '', label: '(sin especificar)' }, { value: 'hombre', label: 'Hombre' }, { value: 'mujer', label: 'Mujer' }], emptyMeans: 'omit' },
  { key: 'religion', label: 'Religión (opcional)', type: 'text', maxLength: 56, placeholder: 'Ej. ortodoxa', emptyMeans: 'omit' },
  { key: 'description', label: 'Descripción (opcional, máx. 50)', type: 'textarea', maxLength: 50, emptyMeans: 'omit' },
];

export function initCharacterCreate(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>('[data-character-create-form]');
  const fieldsContainer = root.querySelector<HTMLElement>('[data-character-create-fields]');
  const status = root.querySelector<HTMLElement>('[data-character-create-status]');
  const photoInput = root.querySelector<HTMLInputElement>('[data-character-create-photo]');
  if (!form || !fieldsContainer || !status) return;

  fieldsContainer.innerHTML = FIELDS.map(f => fieldHtml(f, '')).join('');
  wireFieldDependencies(form);

  form.addEventListener('submit', async evt => {
    evt.preventDefault();
    clearFieldErrors(form);
    const errors = validateFields(FIELDS, form);
    if (errors.length > 0) {
      paintFieldErrors(errors, form);
      status.textContent = `Revisa los campos marcados (${errors.length}).`;
      return;
    }

    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    status.textContent = 'Creando tu personaje…';
    if (submitBtn) submitBtn.disabled = true;
    try {
      const formData = new FormData();
      for (const [key, value] of Object.entries(buildPayload(FIELDS, form))) {
        if (value !== null && value !== undefined) formData.append(key, String(value));
      }
      const photo = photoInput?.files?.[0];
      if (photo) formData.append('imagen', photo);

      await apiFetch('/api/game/character', { method: 'POST', body: formData });
      status.textContent = '¡Personaje creado! Cargando el mundo…';
      window.location.reload();
    } catch (err) {
      status.textContent = err instanceof ApiError ? err.message : 'Error desconocido.';
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}
