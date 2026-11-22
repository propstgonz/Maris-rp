export function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'ahora mismo';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

export function formatTemperature(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return 'sin registrar';
  return `${Number(value).toFixed(1)} °C`;
}

const TEMPERATURE_BANDS: { limit: number; label: string }[] = [
  { limit: -15, label: 'Gélido' },
  { limit: -2, label: 'Helado' },
  { limit: 10, label: 'Frío' },
  { limit: 22, label: 'Templado' },
  { limit: 32, label: 'Cálido' },
  { limit: 42, label: 'Sofocante' },
];

export function describeTemperature(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return 'Sin registrar';
  return TEMPERATURE_BANDS.find(band => Number(value) < band.limit)?.label ?? 'Abrasador';
}

export function formatTemperatureRange(min: number | null | undefined, max: number | null | undefined): string {
  if (min == null || max == null) return 'sin definir';
  return `${formatTemperature(min)} a ${formatTemperature(max)}`;
}
