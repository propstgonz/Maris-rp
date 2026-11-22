import { UserFacingError } from './errors.js';

const MAX_CUSTOM_ID_LENGTH = 100;

export const PUBLIC_OWNER = '*';

export const DEFAULT_COMPONENT_TTL_MS = 15 * 60_000;

export function buildCustomId({ ns, action, owner = '', ctx = '' }) {
  if (!ns || !action) throw new Error('buildCustomId: "ns" y "action" son obligatorios.');
  if (!owner) throw new Error(`buildCustomId: falta "owner" en ${ns}:${action} — usa PUBLIC_OWNER si de verdad es público.`);

  for (const [name, value] of Object.entries({ ns, action, owner, ctx })) {
    if (String(value).includes(':')) {
      throw new Error(`buildCustomId: "${name}" no puede contener ':' (rompe el parseo posicional). Valor: "${value}"`);
    }
  }

  const customId = `${ns}:${action}:${owner}:${ctx}`;
  if (customId.length > MAX_CUSTOM_ID_LENGTH) {
    throw new Error(
      `buildCustomId: "${customId}" mide ${customId.length} caracteres y Discord admite ${MAX_CUSTOM_ID_LENGTH} como máximo. ` +
      'Acorta el "ctx" (guarda el dato en la BD y referencia su id en vez de meterlo entero aquí).'
    );
  }
  return customId;
}

export function parseCustomId(customId) {
  if (typeof customId !== 'string') return null;

  const parts = customId.split(':');
  if (parts.length !== 4) return null;
  const [ns, action, owner, ctx] = parts;
  if (!ns || !action || !owner) return null;
  return { ns, action, owner, ctx };
}

export function assertComponentAccess(interaction, parsed, { ttlMs = DEFAULT_COMPONENT_TTL_MS } = {}) {
  if (parsed.owner !== PUBLIC_OWNER && parsed.owner !== interaction.user.id) {
    throw new UserFacingError('Este menú no es tuyo — lanza tú el comando para tener el tuyo propio.');
  }

  const createdAt = interaction.message?.createdTimestamp;
  if (createdAt && Date.now() - createdAt > ttlMs) {
    throw new UserFacingError('Este menú ha caducado — vuelve a lanzar el comando.');
  }
}
