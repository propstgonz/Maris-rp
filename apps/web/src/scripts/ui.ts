import { icon } from '../lib/icons';

const TOAST_ICONS: Record<string, string> = { success: 'check-circle', error: 'alert-circle', info: 'info' };

export function showToast(message: string, type: 'success' | 'error' | 'info' = 'info', onClick?: () => void) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = icon(TOAST_ICONS[type] ?? 'info', { size: 18, className: 'toast-icon' });
  const text = document.createElement('span');
  text.textContent = message;
  toast.appendChild(text);
  if (onClick) {
    toast.classList.add('toast-clickable');
    toast.addEventListener('click', onClick);
  }
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 250);
  }, 4500);
}

export function openModal(panelEl: HTMLElement) {
  panelEl.classList.add('open');
  document.getElementById('modalBackdrop')?.classList.add('open');
}

export function closeAllModals() {
  document.querySelectorAll('.form-panel.open').forEach(p => p.classList.remove('open'));
  document.getElementById('modalBackdrop')?.classList.remove('open');
}

export function initModalDismiss() {
  document.getElementById('modalBackdrop')?.addEventListener('click', closeAllModals);
  document.addEventListener('keydown', evt => {
    if (evt.key === 'Escape' && document.getElementById('modalBackdrop')?.classList.contains('open')) closeAllModals();
  });
}

export function showPrompt(opts: {
  title: string;
  message: string;
  confirmLabel?: string;
  defaultValue?: string;
  type?: 'text' | 'number';
  min?: number;
  max?: number;
  step?: number;
}): Promise<string | null> {
  const { title, message, confirmLabel = 'Aceptar', defaultValue = '', type = 'text', min, max, step } = opts;
  return new Promise(resolve => {
    const backdrop = document.getElementById('confirmBackdrop');
    if (!backdrop) { resolve(window.prompt(message, defaultValue)); return; }

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';
    const h3 = document.createElement('h3');
    h3.textContent = title;
    const p = document.createElement('p');
    p.textContent = message;
    const input = document.createElement('input');
    input.type = type;
    input.className = 'prompt-input';
    input.value = defaultValue;
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    if (step !== undefined) input.step = String(step);
    const actions = document.createElement('div');
    actions.className = 'confirm-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = 'Cancelar';
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'btn-primary';
    okBtn.textContent = confirmLabel;
    actions.append(cancelBtn, okBtn);
    dialog.append(h3, p, input, actions);
    backdrop.replaceChildren(dialog);
    backdrop.classList.add('open');
    input.focus();
    input.select();

    function onKey(evt: KeyboardEvent) {
      if (evt.key === 'Escape') finish(null);
      if (evt.key === 'Enter' && document.activeElement === input) { evt.preventDefault(); finish(input.value); }
    }
    function onBackdropClick(evt: MouseEvent) { if (evt.target === backdrop) finish(null); }
    function finish(result: string | null) {
      backdrop!.classList.remove('open');
      document.removeEventListener('keydown', onKey);
      backdrop!.removeEventListener('click', onBackdropClick);
      resolve(result);
    }

    cancelBtn.onclick = () => finish(null);
    okBtn.onclick = () => finish(input.value);
    backdrop.addEventListener('click', onBackdropClick);
    document.addEventListener('keydown', onKey);
  });
}

export function showConfirm(opts: { title: string; message: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  const { title, message, confirmLabel = 'Confirmar', danger = false } = opts;
  return new Promise(resolve => {
    const backdrop = document.getElementById('confirmBackdrop');
    if (!backdrop) { resolve(window.confirm(message)); return; }

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';
    const h3 = document.createElement('h3');
    h3.textContent = title;
    const p = document.createElement('p');
    p.textContent = message;
    const actions = document.createElement('div');
    actions.className = 'confirm-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = 'Cancelar';
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = `btn-primary ${danger ? 'btn-danger' : ''}`;
    okBtn.textContent = confirmLabel;
    actions.append(cancelBtn, okBtn);
    dialog.append(h3, p, actions);
    backdrop.replaceChildren(dialog);
    backdrop.classList.add('open');

    function onKey(evt: KeyboardEvent) { if (evt.key === 'Escape') finish(false); }
    function onBackdropClick(evt: MouseEvent) { if (evt.target === backdrop) finish(false); }
    function finish(result: boolean) {
      backdrop!.classList.remove('open');
      document.removeEventListener('keydown', onKey);
      backdrop!.removeEventListener('click', onBackdropClick);
      resolve(result);
    }

    cancelBtn.onclick = () => finish(false);
    okBtn.onclick = () => finish(true);
    backdrop.addEventListener('click', onBackdropClick);
    document.addEventListener('keydown', onKey);
  });
}
