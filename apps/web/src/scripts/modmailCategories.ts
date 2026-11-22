import { apiFetch } from './api';
import { initLiveUpdates } from './liveUpdates';

export function initModmailCategories(root: HTMLElement) {
  initLiveUpdates('modmail', async () => { window.location.reload(); });

  const form = root.querySelector<HTMLFormElement>('[data-create-category-form]');
  if (!form) return;
  const status = form.querySelector<HTMLElement>('[data-create-category-status]')!;
  const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const nameInput = form.querySelector<HTMLInputElement>('input[name="name"]')!;

  form.addEventListener('submit', async evt => {
    evt.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;

    submitBtn.disabled = true;
    status.textContent = 'Creando en Discord…';
    try {
      await apiFetch('/api/modmail-categories', { method: 'POST', body: { name } });
      status.textContent = '✅ Categoría creada — recargando…';
      window.location.reload();
    } catch (err) {
      status.textContent = `❌ ${err instanceof Error ? err.message : 'Error desconocido.'}`;
      submitBtn.disabled = false;
    }
  });
}
