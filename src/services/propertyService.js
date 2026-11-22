import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import { slugify } from '../utils/text.js';
import { UserFacingError } from '../utils/errors.js';
import { logAction } from './auditLogService.js';

export const PROPERTY_CATEGORIES = [
  { value: 'vivienda',        label: 'Vivienda' },
  { value: 'ganaderia',       label: 'Ganadería' },
  { value: 'infraestructura', label: 'Infraestructura' },
  { value: 'ocio',            label: 'Ocio y bienestar' },
  { value: 'produccion',      label: 'Producción' },
  { value: 'extraccion',      label: 'Extracción' },
  { value: 'religion',        label: 'Religión' },
  { value: 'educacion',       label: 'Educación' },
  { value: 'naval',           label: 'Naval' },
  { value: 'terreno',         label: 'Terreno' },
];

const MAX_LEVEL = 1000;
const MAX_NAME = 191;
const MAX_LOCATION = 100;
const MAX_DESCRIPTION = 2000;
const MAX_EMOJI = 32;

const SQL = {
  listTypes:       `SELECT * FROM ${T.property_types} ORDER BY category, display_name`,
  listActiveTypes: `SELECT * FROM ${T.property_types} WHERE is_active = 1 ORDER BY category, display_name`,
  searchTypes: `
    SELECT * FROM ${T.property_types}
    WHERE is_active = 1 AND display_name LIKE ? ESCAPE '\\\\'
    ORDER BY display_name LIMIT `,
  getType:       `SELECT * FROM ${T.property_types} WHERE id = ?`,
  insertType: `
    INSERT INTO ${T.property_types} (name, display_name, category, emoji, description)
    VALUES (?, ?, ?, ?, ?)
  `,
  editType: `
    UPDATE ${T.property_types}
    SET display_name = ?, category = ?, emoji = ?, description = ?
    WHERE id = ?
  `,
  setTypeActive: `UPDATE ${T.property_types} SET is_active = ? WHERE id = ?`,
  lockLiving:    `SELECT id FROM ${T.players} WHERE id = ? AND is_alive = 1 FOR UPDATE`,
  countByOwner:  `SELECT COUNT(*) AS total FROM ${T.properties} WHERE owner_player_id = ?`,
  listByOwner: `
    SELECT p.id, t.display_name AS type_display_name, t.category, p.name, p.level, p.location, t.emoji
    FROM ${T.properties} p
    JOIN ${T.property_types} t ON t.id = p.property_type_id
    WHERE p.owner_player_id = ?
    ORDER BY t.category, t.display_name, p.id
    LIMIT `,
  get: `
    SELECT p.id, p.owner_player_id, p.property_type_id, t.display_name AS type_display_name,
           t.category, p.name, p.level, p.location, t.emoji, p.created_at
    FROM ${T.properties} p
    JOIN ${T.property_types} t ON t.id = p.property_type_id
    WHERE p.id = ?
  `,
  lock:     `SELECT id, owner_player_id FROM ${T.properties} WHERE id = ? FOR UPDATE`,
  insert: `
    INSERT INTO ${T.properties} (owner_player_id, property_type_id, name, level, location)
    VALUES (?, ?, ?, ?, ?)
  `,
  delete:   `DELETE FROM ${T.properties} WHERE id = ?`,
  setLevel: `UPDATE ${T.properties} SET level = ? WHERE id = ?`,
  transfer: `
    UPDATE ${T.properties} SET owner_player_id = ?
    WHERE id = ? AND owner_player_id = ?
  `,
};

function actorFields(actor) {
  return { source: actor.source, actorDiscordId: actor.discordId, actorUsername: actor.username };
}

function cleanText(value, max, label) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) throw new UserFacingError(`${label} no puede pasar de ${max} caracteres.`);
  return text;
}

function requireDisplayName(value) {
  const display = cleanText(value, MAX_NAME, 'El nombre');
  if (!display) throw new UserFacingError('El tipo necesita un nombre.');
  return display;
}

function requireCategory(category) {
  if (!PROPERTY_CATEGORIES.some(c => c.value === category)) {
    throw new UserFacingError('Esa categoría de propiedad no existe.');
  }
  return category;
}

function requireLevel(level) {
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
    throw new UserFacingError(`El nivel debe ser un entero entre 1 y ${MAX_LEVEL}.`);
  }
  return level;
}

async function requireLivingPlayer(playerId, message) {
  const row = await queryOne(SQL.lockLiving, [playerId]);
  if (!row) throw new UserFacingError(message);
}

export async function listTypes({ includeInactive = false } = {}) {
  return query(includeInactive ? SQL.listTypes : SQL.listActiveTypes);
}

export async function searchTypes(text, limit = 25) {
  const safeLimit = Math.min(Math.max(Math.trunc(Number(limit)) || 25, 1), 25);
  const like = `%${String(text ?? '').replace(/[\\%_]/g, c => `\\${c}`)}%`;
  return query(`${SQL.searchTypes}${safeLimit}`, [like]);
}

export async function createType({ name, displayName, category, emoji, description }, actor) {
  const display = requireDisplayName(displayName);
  requireCategory(category);
  const slug = slugify(cleanText(name, MAX_NAME, 'El identificador') ?? display);

  let result;
  try {
    result = await execute(SQL.insertType, [
      slug, display, category,
      cleanText(emoji, MAX_EMOJI, 'El emoji'),
      cleanText(description, MAX_DESCRIPTION, 'La descripción'),
    ]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new UserFacingError('Ya existe un tipo de propiedad con ese nombre.');
    throw err;
  }
  const type = await queryOne(SQL.getType, [result.lastInsertRowid]);
  await logAction({
    ...actorFields(actor), action: 'propiedades.tipo_creado',
    target: display, details: { typeId: type.id, category },
  });
  return type;
}

export async function editType(id, fields, actor) {
  const current = await queryOne(SQL.getType, [id]);
  if (!current) throw new UserFacingError('Ese tipo de propiedad no existe.');
  const merged = {
    displayName: current.display_name, category: current.category,
    emoji: current.emoji, description: current.description,
    ...fields,
  };

  const display = requireDisplayName(merged.displayName);
  requireCategory(merged.category);
  await execute(SQL.editType, [
    display, merged.category,
    cleanText(merged.emoji, MAX_EMOJI, 'El emoji'),
    cleanText(merged.description, MAX_DESCRIPTION, 'La descripción'),
    id,
  ]);
  const type = await queryOne(SQL.getType, [id]);
  await logAction({
    ...actorFields(actor), action: 'propiedades.tipo_creado',
    target: display, details: { typeId: id, edited: Object.keys(fields) },
  });
  return type;
}

export async function setTypeActive(id, isActive, actor) {
  const { changes } = await execute(SQL.setTypeActive, [isActive ? 1 : 0, id]);
  if (changes !== 1) throw new UserFacingError('Ese tipo de propiedad no existe.');
  const type = await queryOne(SQL.getType, [id]);
  await logAction({
    ...actorFields(actor), action: 'propiedades.tipo_creado',
    target: type.display_name, details: { typeId: id, isActive: Boolean(isActive) },
  });
  return type;
}

export async function listProperties(ownerId, { page = 1, pageSize = 10 } = {}) {
  const size = Math.min(Math.max(Math.trunc(Number(pageSize)) || 10, 1), 100);
  const offset = (Math.max(Math.trunc(Number(page)) || 1, 1) - 1) * size;
  const [rows, count] = await Promise.all([
    query(`${SQL.listByOwner}${size} OFFSET ${offset}`, [ownerId]),
    queryOne(SQL.countByOwner, [ownerId]),
  ]);
  return { rows, total: Number(count.total) };
}

export async function getProperty(propertyId) {
  return (await queryOne(SQL.get, [propertyId])) ?? null;
}

export async function grantProperty(ownerId, typeId, { name, level = 1, location } = {}, actor) {
  requireLevel(level);
  const cleanName = cleanText(name, MAX_NAME, 'El nombre');
  const cleanLocation = cleanText(location, MAX_LOCATION, 'La ubicación');

  const property = await withTransaction(async () => {
    await requireLivingPlayer(ownerId, 'Ese personaje no existe o ha muerto.');
    const type = await queryOne(SQL.getType, [typeId]);
    if (!type) throw new UserFacingError('Ese tipo de propiedad no existe.');
    if (!type.is_active) throw new UserFacingError('Ese tipo de propiedad está desactivado.');
    const { lastInsertRowid } = await execute(SQL.insert, [ownerId, typeId, cleanName, level, cleanLocation]);
    return getProperty(lastInsertRowid);
  });

  await logAction({
    ...actorFields(actor), action: 'propiedades.otorgada',
    target: String(ownerId), details: { propertyId: property.id, type: property.type_display_name, level },
  });
  return property;
}

export async function revokeProperty(propertyId, actor) {
  const property = await withTransaction(async () => {
    if (!(await queryOne(SQL.lock, [propertyId]))) throw new UserFacingError('Esa propiedad no existe.');
    const full = await getProperty(propertyId);
    const { changes } = await execute(SQL.delete, [propertyId]);
    if (changes !== 1) throw new UserFacingError('Esa propiedad no existe.');
    return full;
  });

  await logAction({
    ...actorFields(actor), action: 'propiedades.revocada',
    target: String(property.owner_player_id), details: { propertyId, type: property.type_display_name },
  });
  return property;
}

export async function setLevel(propertyId, level, actor) {
  requireLevel(level);
  const { changes } = await execute(SQL.setLevel, [level, propertyId]);
  if (changes !== 1) throw new UserFacingError('Esa propiedad no existe.');
  const property = await getProperty(propertyId);
  await logAction({
    ...actorFields(actor), action: 'propiedades.nivel',
    target: String(property.owner_player_id), details: { propertyId, type: property.type_display_name, level },
  });
  return property;
}

export async function transferPropertyInTx(fromId, toId, propertyId) {
  if (fromId === toId) throw new UserFacingError('El destinatario tiene que ser otro personaje.');
  await requireLivingPlayer(toId, 'El destinatario no existe o ha muerto.');
  const { changes } = await execute(SQL.transfer, [toId, propertyId, fromId]);
  if (changes !== 1) throw new UserFacingError('Esa propiedad ya no es tuya.');
}

export async function adminTransferProperty(propertyId, toId, actor) {
  const fromId = await withTransaction(async () => {
    const row = await queryOne(SQL.lock, [propertyId]);
    if (!row) throw new UserFacingError('Esa propiedad no existe.');
    await transferPropertyInTx(row.owner_player_id, toId, propertyId);
    return row.owner_player_id;
  });

  await logAction({
    ...actorFields(actor), action: 'propiedades.traspaso',
    target: String(toId), details: { propertyId, fromPlayerId: fromId, toPlayerId: toId, admin: true },
  });
  return getProperty(propertyId);
}
