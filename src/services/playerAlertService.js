import { queryOne, execute } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';

export const ALERT_TYPES = {
  fuelLow:            'alert_fuel_low',
  structureAttacked:  'alert_structure_attacked',
  citizenshipRequest: 'alert_citizenship_request',
  laburoExpiring:     'alert_laburo_expiring',
  playerAttacked:     'alert_player_attacked',
  revived:            'alert_revived',
  channelToDm:        'alert_channel_to_dm',
  travelStep:         'alert_travel_step',
  webEcho:            'alert_web_echo',
};

const SQL = {
  getPreferences: `
    SELECT alert_fuel_low, alert_structure_attacked, alert_citizenship_request, alert_laburo_expiring,
           alert_player_attacked, alert_revived, alert_channel_to_dm, alert_travel_step, alert_web_echo
    FROM ${T.players} WHERE discord_id = ?
  `,
  setFuelLow:            `UPDATE ${T.players} SET alert_fuel_low = ? WHERE discord_id = ?`,
  setStructureAttacked:  `UPDATE ${T.players} SET alert_structure_attacked = ? WHERE discord_id = ?`,
  setCitizenshipRequest: `UPDATE ${T.players} SET alert_citizenship_request = ? WHERE discord_id = ?`,
  setLaburoExpiring:     `UPDATE ${T.players} SET alert_laburo_expiring = ? WHERE discord_id = ?`,
  setPlayerAttacked:     `UPDATE ${T.players} SET alert_player_attacked = ? WHERE discord_id = ?`,
  setRevived:            `UPDATE ${T.players} SET alert_revived = ? WHERE discord_id = ?`,
  setChannelToDm:        `UPDATE ${T.players} SET alert_channel_to_dm = ? WHERE discord_id = ?`,
  setTravelStep:         `UPDATE ${T.players} SET alert_travel_step = ? WHERE discord_id = ?`,
  setWebEcho:            `UPDATE ${T.players} SET alert_web_echo = ? WHERE discord_id = ?`,
};

const SETTERS = {
  fuelLow: SQL.setFuelLow, structureAttacked: SQL.setStructureAttacked,
  citizenshipRequest: SQL.setCitizenshipRequest, laburoExpiring: SQL.setLaburoExpiring,
  playerAttacked: SQL.setPlayerAttacked, revived: SQL.setRevived,
  channelToDm: SQL.setChannelToDm, travelStep: SQL.setTravelStep,
  webEcho: SQL.setWebEcho,
};

export async function getAlertPreferences(discordId) {
  const row = await queryOne(SQL.getPreferences, [discordId]);
  if (!row) return null;
  return {
    fuelLow:            Boolean(row.alert_fuel_low),
    structureAttacked:  Boolean(row.alert_structure_attacked),
    citizenshipRequest: Boolean(row.alert_citizenship_request),
    laburoExpiring:     Boolean(row.alert_laburo_expiring),
    playerAttacked:     Boolean(row.alert_player_attacked),
    revived:            Boolean(row.alert_revived),
    channelToDm:        Boolean(row.alert_channel_to_dm),
    travelStep:         Boolean(row.alert_travel_step),
    webEcho:            Boolean(row.alert_web_echo),
  };
}

export async function setAlertPreference(discordId, type, enabled) {
  const sql = SETTERS[type];
  if (!sql) throw new Error(`Tipo de alerta desconocido: "${type}". Válidos: ${Object.keys(SETTERS).join(', ')}.`);
  await execute(sql, [enabled ? 1 : 0, discordId]);
}

export async function sendPlayerAlert(client, discordId, type, message, components = []) {
  const prefs = await getAlertPreferences(discordId);
  if (!prefs || !prefs[type]) return false;

  try {
    const user = await client.users.fetch(discordId);
    await user.send(components.length ? { content: message, components } : message);
    return true;
  } catch (err) {
    logger.warn(`[PlayerAlert] No se pudo mandar la alerta "${type}" a ${discordId}: ${err.message}`);
    return false;
  }
}
