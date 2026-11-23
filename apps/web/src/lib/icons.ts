const ICONS: Record<string, string> = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1v-9"/>',
  package: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z"/><path d="M3.8 7.3 12 12l8.2-4.7"/><path d="M12 12v9"/>',
  building: '<rect x="5" y="3.5" width="10" height="17" rx="1"/><path d="M15 9h4v11.5H9" fill="none"/><path d="M8 7.5h1M11 7.5h1M8 11h1M11 11h1M8 14.5h1M11 14.5h1M17 12.5h1M17 16h1"/>',
  skull: '<path d="M12 3.5c-4.4 0-7.5 3.2-7.5 7.2 0 2.6 1.3 4.4 2.6 5.6V19c0 .8.6 1.5 1.4 1.5h1v-2h1v2h2.2v-2h1v2h1c.8 0 1.4-.7 1.4-1.5v-2.7c1.3-1.2 2.6-3 2.6-5.6 0-4-3.1-7.2-7.5-7.2Z"/><circle cx="9.3" cy="11" r="1.4"/><circle cx="14.7" cy="11" r="1.4"/><path d="M11 14h2"/>',
  heart: '<path d="M12 20s-7.5-4.6-9.6-9.3C1.2 7.6 2.7 4.5 6 4c2-.3 3.7.7 6 2.9C14.3 4.7 16 3.7 18 4c3.3.5 4.8 3.6 3.6 6.7C19.5 15.4 12 20 12 20Z"/>',
  sparkles: '<path d="M11 3.5 12.3 8l4.5 1.3-4.5 1.3L11 15l-1.3-4.4L5.2 9.3l4.5-1.3Z"/><path d="M18 14.5l.8 2.3 2.3.8-2.3.8-.8 2.3-.8-2.3-2.3-.8 2.3-.8Z"/>',
  flag: '<path d="M6 3.5v17"/><path d="M6 4.5c1.7-1 3.6-1 5.3 0s3.6 1 5.3 0v8c-1.7 1-3.6 1-5.3 0s-3.6-1-5.3 0Z"/>',
  users: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 20v-1.3C3.5 16 6 14 9 14s5.5 2 5.5 4.7V20"/><circle cx="17" cy="9.5" r="2.4"/><path d="M15.8 14.3c2.4.3 4.2 2.1 4.2 4.4V20"/>',
  scroll: '<path d="M6.5 4h11v14.5a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M17.5 4a2 2 0 0 1 2 2v.5h-2"/><path d="M9 8.5h6M9 12h6M9 15.5h4"/>',
  folder: '<path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.3l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5Z"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9.5 10.5 12 7 14.5"/><path d="M12.5 15h4.5"/>',
  megaphone: '<path d="M3 10v4a1.5 1.5 0 0 0 1.5 1.5H6l7 4V4.5L6 8.5H4.5A1.5 1.5 0 0 0 3 10Z"/><path d="M9 15.5v3a1.5 1.5 0 0 1-3 0v-3"/><path d="M17.5 9.3a3 3 0 0 1 0 5.4"/>',
  book: '<path d="M12 6.2c-1.4-1.2-3.6-1.7-6-1.7-.6 0-1 .4-1 1v12c0 .6.4 1 1 1 2.4 0 4.6.5 6 1.7 1.4-1.2 3.6-1.7 6-1.7.6 0 1-.4 1-1v-12c0-.6-.4-1-1-1-2.4 0-4.6.5-6 1.7Z"/><path d="M12 6.2v13.8"/>',
  plus: '<path d="M12 4.5v15M4.5 12h15"/>',
  x: '<path d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.3 15.3 20 20"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  download: '<path d="M12 4v11M8 11.5l4 3.5 4-3.5"/><path d="M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  'chevron-left': '<path d="M15 5.5 8.5 12l6.5 6.5"/>',
  menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  'log-out': '<path d="M9.5 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3.5"/><path d="M16 16.5 20.5 12 16 7.5"/><path d="M20 12H9.5"/>',
  play: '<path d="M7 5.5v13l11-6.5Z"/>',
  save: '<path d="M5 3.5h11.5L19.5 6.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5Z"/><path d="M7.5 3.5V9h7V3.5"/><path d="M7 14h8v6.5H7Z"/>',
  refresh: '<path d="M4.5 12a7.5 7.5 0 0 1 12.6-5.5"/><path d="M17.5 3.5v3.5h-3.5"/><path d="M19.5 12a7.5 7.5 0 0 1-12.6 5.5"/><path d="M6.5 20.5V17H10"/>',
  'check-circle': '<circle cx="12" cy="12" r="8.5"/><path d="M8.3 12.3 11 15l5-6"/>',
  'alert-circle': '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5"/><circle cx="12" cy="15.7" r="0.15" fill="currentColor" stroke-width="1.6"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="8" r="0.15" fill="currentColor" stroke-width="1.6"/>',
};

export function icon(name: string, opts: { size?: number; className?: string } = {}): string {
  const { size = 18, className = '' } = opts;
  const inner = ICONS[name];
  if (!inner) return '';
  const classAttr = className ? ` class="${className}"` : '';
  return `<svg${classAttr} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
}

export function discordMark(opts: { size?: number; className?: string } = {}): string {
  const { size = 18, className = '' } = opts;
  const classAttr = className ? ` class="${className}"` : '';
  return `<svg${classAttr} width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.07.07 0 0 0-.075.035c-.211.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.035A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.076.076 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028z"/></svg>`;
}
