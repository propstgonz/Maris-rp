const TIME_ZONE = 'Europe/Madrid';
const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/;

export function parseUtc(value: string): Date {
  const iso = value.replace(' ', 'T');
  return new Date(HAS_ZONE.test(iso) ? iso : `${iso}Z`);
}

const dateTimeFmt = new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeStyle: 'short', timeZone: TIME_ZONE });
const dateFmt = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeZone: TIME_ZONE });
const fullFmt = new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'medium', timeZone: TIME_ZONE });
const clockFmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TIME_ZONE });

export const formatDateTime = (value: string) => dateTimeFmt.format(parseUtc(value));
export const formatDate = (value: string) => dateFmt.format(parseUtc(value));
export const formatFull = (date: Date) => fullFmt.format(date);
export const formatClock = (date: Date) => clockFmt.format(date);
