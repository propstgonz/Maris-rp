export const FAMILY_LABEL: Record<string, string> = {
  perfil: 'Perfil',
  personaje: 'Personaje',
  matrimonio: 'Matrimonio',
  consentimiento: 'Solicitudes',
  npcs: 'NPCs',
  bienes: 'Bienes',
  propiedades: 'Propiedades',
  magia: 'Magia',
  player: 'Jugadores',
  backup: 'Backups',
  settings: 'Ajustes',
  terminal: 'Terminal',
  staff: 'Staff',
  modmail: 'Modmail',
};

const CONSENT_KIND_LABEL: Record<string, string> = {
  item: 'un traspaso de bienes',
  npc: 'un traspaso de NPCs',
  property: 'un traspaso de propiedad',
  marriage: 'una propuesta de matrimonio',
};

const CONSENT_OUTCOME_LABEL: Record<string, string> = {
  aceptado: 'aceptó',
  rechazado: 'rechazó',
  cancelado: 'canceló',
};

const ACTION_PHRASE: Record<string, string> = {
  'perfil.foto': 'cambió la foto de',
  'perfil.identidad_editada': 'editó la identidad de',
  'perfil.menhir_elegido': 'eligió menhir para',
  'perfil.menhir_fijado': 'fijó el menhir de',
  'perfil.puntos_extra': 'concedió puntos extra a',
  'perfil.raza_fijada': 'fijó la raza de',
  'perfil.stat_asignada': 'asignó una estadística a',
  'perfil.stat_corregida': 'corrigió una estadística de',
  'personaje.creado': 'creó el personaje de',
  'personaje.muerte': 'registró la muerte de',
  'personaje.revivido': 'revivió a',
  'matrimonio.propuesto': 'propuso matrimonio a',
  'matrimonio.divorcio': 'registró un divorcio de',
  'matrimonio.anulado': 'anuló el matrimonio de',
  'npcs.alta': 'dio de alta NPCs a',
  'npcs.baja': 'dio de baja NPCs a',
  'npcs.traspaso': 'traspasó NPCs a',
  'bienes.alta': 'dio de alta bienes a',
  'bienes.baja': 'dio de baja bienes a',
  'bienes.traspaso': 'traspasó bienes a',
  'bienes.categoria_creada': 'creó una categoría de bienes',
  'bienes.tipo_creado': 'creó un tipo de bien',
  'bienes.tipo_editado': 'editó un tipo de bien',
  'bienes.tipo_activado': 'activó un tipo de bien',
  'bienes.tipo_desactivado': 'desactivó un tipo de bien',
  'propiedades.otorgada': 'otorgó una propiedad a',
  'propiedades.revocada': 'revocó una propiedad a',
  'propiedades.traspaso': 'traspasó una propiedad a',
  'propiedades.nivel': 'cambió el nivel de una propiedad de',
  'propiedades.tipo_creado': 'creó un tipo de propiedad',
  'propiedades.tipo_editado': 'editó un tipo de propiedad',
  'propiedades.tipo_activado': 'activó un tipo de propiedad',
  'propiedades.tipo_desactivado': 'desactivó un tipo de propiedad',
  'magia.escuela_gratuita': 'inició una escuela gratuita para',
  'magia.tirada': 'hizo una tirada de magia de',
  'magia.nivel': 'fijó el nivel de magia de',
  'player.kill': 'mató (permadeath) a',
  'settings.sync_channels': 'sincronizó los canales de personaje',
  'settings.newspaper_category': 'fijó la categoría de periódicos',
  'staff.printing_press_channel': 'abrió una imprenta para',
  'staff.broadcast': 'mandó un broadcast a todos los jugadores',
  'terminal.command': 'ejecutó un comando en el terminal',
  'terminal.sql': 'ejecutó una consulta SQL',
  'backup.run_now': 'lanzó un backup manual',
  'backup.set_schedule': 'cambió la programación de backups',
  'modmail.category_created': 'registró la categoría de modmail',
  'modmail.relink_channel': 'reenlazó el canal de modmail de',
};

export function actionFamily(action: string): string {
  return action.split('.')[0] ?? '';
}

export function actionPhrase(action: string): string {
  const consent = /^consentimiento\.(item|npc|property|marriage)_(aceptado|rechazado|cancelado)$/.exec(action);
  if (consent) return `${CONSENT_OUTCOME_LABEL[consent[2]!]} ${CONSENT_KIND_LABEL[consent[1]!]}`;
  return ACTION_PHRASE[action] ?? action.replace(/[._]/g, ' ');
}

export function summarizeDetails(details: unknown, maxKeys = 3): string {
  if (details == null) return '';
  if (typeof details !== 'object') return String(details).slice(0, 120);
  const entries = Object.entries(details as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length === 0) return '';
  const shown = entries.slice(0, maxKeys).map(([k, v]) => {
    const value = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return `${k}: ${value.length > 60 ? `${value.slice(0, 60)}…` : value}`;
  });
  if (entries.length > maxKeys) shown.push(`+${entries.length - maxKeys} más`);
  return shown.join(' · ');
}

export function relativeTime(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'hace un momento';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `hace ${days} d`;
  return date.toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' });
}
