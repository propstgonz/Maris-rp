import { icon } from '../lib/icons';
import { showConfirm, showToast } from './ui';
import { apiFetch } from './api';
import { initLiveUpdates } from './liveUpdates';

type Frequency = 'hourly' | 'daily' | 'weekly' | 'advanced';

interface ParsedCron {
  freq: Frequency;
  hours: number;
  hour: number;
  minute: number;
  weekday: number;
}

const DEFAULTS: ParsedCron = { freq: 'daily', hours: 6, hour: 23, minute: 30, weekday: 1 };

function parseCron(cronExpr: string): ParsedCron {
  const hourly = cronExpr.match(/^0 \*\/(\d{1,2}) \* \* \*$/);
  if (hourly) return { ...DEFAULTS, freq: 'hourly', hours: Number(hourly[1]) };

  const daily = cronExpr.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (daily) return { ...DEFAULTS, freq: 'daily', minute: Number(daily[1]), hour: Number(daily[2]) };

  const weekly = cronExpr.match(/^(\d{1,2}) (\d{1,2}) \* \* (\d)$/);
  if (weekly) return { ...DEFAULTS, freq: 'weekly', minute: Number(weekly[1]), hour: Number(weekly[2]), weekday: Number(weekly[3]) };

  return { ...DEFAULTS, freq: 'advanced' };
}

function buildCron(p: ParsedCron): string {
  if (p.freq === 'hourly') return `0 */${p.hours} * * *`;
  if (p.freq === 'daily') return `${p.minute} ${p.hour} * * *`;
  return `${p.minute} ${p.hour} * * ${p.weekday}`;
}

const WEEKDAY_LABELS: [string, string][] = [
  ['1', 'lunes'], ['2', 'martes'], ['3', 'miércoles'], ['4', 'jueves'],
  ['5', 'viernes'], ['6', 'sábado'], ['0', 'domingo'],
];

function describeCron(cronExpr: string): string {
  const p = parseCron(cronExpr);
  const time = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} UTC`;
  if (p.freq === 'hourly') return `Cada ${p.hours} hora${p.hours === 1 ? '' : 's'}.`;
  if (p.freq === 'daily') return `Todos los días a las ${time}.`;
  if (p.freq === 'weekly') {
    const label = WEEKDAY_LABELS.find(([v]) => v === String(p.weekday))?.[1] ?? '?';
    return `Los ${label} a las ${time}.`;
  }
  return `Expresión personalizada: \`${cronExpr}\``;
}

export function initBackups(root: HTMLElement) {
  const runBtn = root.querySelector<HTMLButtonElement>('[data-run-backup-btn]');
  const freqSelect = root.querySelector<HTMLSelectElement>('[data-backup-freq-select]');
  const hoursSelect = root.querySelector<HTMLSelectElement>('[data-backup-hours-select]');
  const weekdaySelect = root.querySelector<HTMLSelectElement>('[data-backup-weekday-select]');
  const timeInput = root.querySelector<HTMLInputElement>('[data-backup-time-input]');
  const cronInput = root.querySelector<HTMLInputElement>('[data-backup-cron-input]');
  const preview = root.querySelector<HTMLElement>('[data-backup-cron-preview]');
  const saveBtn = root.querySelector<HTMLButtonElement>('[data-save-schedule-btn]');

  const fieldGroups: Record<Frequency, HTMLElement | null> = {
    hourly: root.querySelector('[data-backup-hourly-fields]'),
    daily: root.querySelector('[data-backup-time-fields]'),
    weekly: root.querySelector('[data-backup-weekly-fields]'),
    advanced: root.querySelector('[data-backup-advanced-fields]'),
  };

  function currentState(): ParsedCron {
    return {
      freq: (freqSelect?.value as Frequency) ?? 'daily',
      hours: Number(hoursSelect?.value ?? DEFAULTS.hours),
      hour: Number((timeInput?.value ?? '23:30').split(':')[0]),
      minute: Number((timeInput?.value ?? '23:30').split(':')[1]),
      weekday: Number(weekdaySelect?.value ?? DEFAULTS.weekday),
    };
  }

  function syncVisibility() {
    const freq = (freqSelect?.value as Frequency) ?? 'daily';
    fieldGroups.hourly?.classList.toggle('hidden', freq !== 'hourly');
    fieldGroups.weekly?.classList.toggle('hidden', freq !== 'weekly');
    fieldGroups.daily?.classList.toggle('hidden', freq !== 'daily' && freq !== 'weekly');
    fieldGroups.advanced?.classList.toggle('hidden', freq !== 'advanced');
  }

  function syncPreview() {
    const freq = (freqSelect?.value as Frequency) ?? 'daily';
    const cronExpr = freq === 'advanced' ? (cronInput?.value.trim() ?? '') : buildCron(currentState());
    if (preview) preview.textContent = cronExpr ? describeCron(cronExpr) : '';
  }

  function applyParsed(p: ParsedCron) {
    if (freqSelect) freqSelect.value = p.freq;
    if (hoursSelect) hoursSelect.value = String(p.hours);
    if (weekdaySelect) weekdaySelect.value = String(p.weekday);
    if (timeInput) timeInput.value = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
    syncVisibility();
    syncPreview();
  }

  if (cronInput) applyParsed(parseCron(cronInput.value.trim()));

  [freqSelect, hoursSelect, weekdaySelect, timeInput].forEach(el => {
    el?.addEventListener('change', () => { syncVisibility(); syncPreview(); });
  });
  cronInput?.addEventListener('input', syncPreview);

  runBtn?.addEventListener('click', async () => {
    const ok = await showConfirm({
      title: 'Generar copia de seguridad',
      message: 'Empaqueta la base de datos y el bucket de imágenes ahora mismo, sin esperar al horario programado. Puede tardar un momento según el tamaño del bucket.',
      confirmLabel: 'Generar',
    });
    if (!ok) return;

    runBtn.disabled = true;
    runBtn.innerHTML = `${icon('refresh', { size: 15 })} Generando…`;
    try {
      await apiFetch('/api/backups/run', { method: 'POST' });
      showToast('Copia de seguridad generada.', 'success');
      location.reload();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error desconocido.', 'error');
      runBtn.disabled = false;
      runBtn.innerHTML = `${icon('play', { size: 15 })} Generar ahora`;
    }
  });

  saveBtn?.addEventListener('click', async () => {
    const freq = (freqSelect?.value as Frequency) ?? 'daily';
    const cronExpr = freq === 'advanced' ? (cronInput?.value.trim() ?? '') : buildCron(currentState());
    if (!cronExpr) {
      showToast('El horario no puede estar vacío.', 'error');
      return;
    }

    saveBtn.disabled = true;
    try {
      await apiFetch('/api/backups/schedule', { method: 'PUT', body: { cron: cronExpr } });
      showToast('Horario guardado — el bot lo aplica en menos de un minuto, sin reiniciar.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error desconocido.', 'error');
    } finally {
      saveBtn.disabled = false;
    }
  });

  initLiveUpdates('backups', async () => { location.reload(); });
}
