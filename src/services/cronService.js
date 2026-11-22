import cron   from 'node-cron';
import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import { toSqlDatetime, fromSqlDatetime } from '../utils/sqlDatetime.js';
import logger from '../utils/logger.js';
import { config, MAX_HP, MAX_HUNGER } from '../utils/permissions.js';
import { CONSTRUCTION_ALIVE_SQL } from '../utils/sql.js';
import { addItem }   from './inventoryService.js';
import { runBackup, getBackupCron } from './backupService.js';
import { pruneExpiredBatches, getBatchesExpiringSoon } from './laburoService.js';
import { pruneExpiredTrades } from './tradeConsentService.js';
import { pruneExpiredRobberies } from './robberyService.js';
import { expireStalePendingApplications } from './factionService.js';
import { notifyApplicationResult } from './factionNotificationService.js';
import { notifyDeath, notifyModmailChannel, buildDeathModmailNotice } from './modmailService.js';
import { pruneExpiredCharacters }            from './characterLifecycleService.js';
import { pruneOldAuditLog } from './auditLogService.js';
import { processTravelTicks } from './travelService.js';
import { flushDueProduction } from './productionService.js';
import { flushDueNpcProduction } from './npcProductionService.js';
import { processNpcHunger } from './npcHungerService.js';
import { processConstructionMaintenance } from './constructionMaintenanceService.js';
import { processDurabilityDecay } from './constructionDurabilityService.js';
import { processIdleEncounterRolls, processPendingPlacedEncounters } from './npcEncounterService.js';
import { pruneOldTerminalJobs } from './terminalJobService.js';
import { pruneOldBotJobs } from './botJobService.js';
import { pruneExpiredGrants } from './permissionService.js';
import { sendPlayerAlert } from './playerAlertService.js';
import { discordTimestamp } from '../utils/embeds.js';

const STARVATION_LOSS = config.game?.starvationHpLossPerDay ?? 4;
const WELLFED_REGEN   = config.game?.wellFedHpRegenPerDay   ?? 4;
const DAILY_CRON      = config.game?.dailyResetCron      ?? '0 0 * * *';

const ANNOUNCE_CH = config.channels?.announcements;
const LOGS_CH     = config.channels?.logs;

const runningJobs = new Set();

function guardedJob(name, fn) {
  return async () => {
    if (runningJobs.has(name)) {
      logger.warn(`[Cron] "${name}" seguía en marcha cuando tocaba disparar de nuevo — se salta esta vez.`);
      return;
    }
    runningJobs.add(name);
    try {
      await fn();
    } finally {
      runningJobs.delete(name);
    }
  };
}

const BACKUP_RECHECK_INTERVAL_MS = 60 * 1000;
let currentBackupCronExpr = null;
let currentBackupTask = null;

function armBackupJob(expr) {
  if (!cron.validate(expr)) {
    logger.error(`[Cron] Expresión de backup inválida: "${expr}" — se mantiene la anterior.`);
    return;
  }
  if (currentBackupTask) currentBackupTask.stop();
  currentBackupCronExpr = expr;
  currentBackupTask = cron.schedule(expr, guardedJob('backup', async () => {
    try {
      await runBackup();
    } catch (err) {
      logger.error(`[Backup] Falló el backup programado: ${err.message}. Revisa espacio en disco y permisos del directorio de datos cuanto antes.`);
    }
  }), { timezone: 'UTC' });
  logger.info(`[Cron] ✔ Job de backup (re)programado → "${expr}" (UTC)`);
}

async function scheduleBackupJob() {
  armBackupJob(await getBackupCron());
  setInterval(async () => {
    const latest = await getBackupCron();
    if (latest !== currentBackupCronExpr) armBackupJob(latest);
  }, BACKUP_RECHECK_INTERVAL_MS);
}

const SQL = {
  getAllLivingPlayers: `
    SELECT id, discord_id, username, character_name, modmail_channel_id,
           hp, hunger, coord_x, coord_y, is_immortal
    FROM ${T.players} WHERE is_alive = 1 AND character_created_at IS NOT NULL
  `,

  getActiveEffects: `
    SELECT hp_delta_per_day
    FROM ${T.player_effects}
    WHERE player_id = ?
      AND (expires_at IS NULL OR expires_at > NOW())
  `,

  updatePlayerStats: `
    UPDATE ${T.players}
    SET hp = ?, hunger = ?, updated_at = NOW()
    WHERE id = ?
  `,

  killById: `
    UPDATE ${T.players}
    SET is_alive = 0, hp = 0, died_at = NOW(), updated_at = NOW()
    WHERE id = ?
  `,

  expireEffects: `
    DELETE FROM ${T.player_effects}
    WHERE player_id = ?
      AND expires_at IS NOT NULL
      AND expires_at <= NOW()
  `,

  getOwnedTiles: `
    SELECT t.id, t.coord_x, t.coord_y, t.name AS tile_name, p.discord_id AS owner_discord_id
    FROM ${T.map_tiles} t
    JOIN ${T.players} p ON t.owner_player_id = p.id
    WHERE t.owner_player_id IS NOT NULL AND p.is_alive = 1
  `,

  getTileGenerators: `
    SELECT
      tg.generation_rate, i.name AS item_name, i.display_name,
      fc.id AS construction_id, fc.fuel_level, fc.name AS construction_name,
      fc.fuel_item_id, fc.fuel_consumption_rate, fi.name AS fuel_item_name,
      owner.discord_id AS built_by_discord_id
    FROM ${T.tile_resource_generators} tg
    JOIN ${T.items} i ON tg.item_id = i.id
    LEFT JOIN (
      SELECT c.id, c.tile_id, c.fuel_level, c.name, c.built_by_player_id, ct.grants_resource_item_id,
             ct.fuel_item_id, ct.fuel_consumption_rate
      FROM ${T.constructions} c
      JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
      WHERE (${CONSTRUCTION_ALIVE_SQL})
    ) fc ON fc.tile_id = tg.tile_id AND fc.grants_resource_item_id = tg.item_id
    LEFT JOIN ${T.items} fi ON fc.fuel_item_id = fi.id
    LEFT JOIN ${T.players} owner ON owner.id = fc.built_by_player_id
    WHERE tg.tile_id = ?
    GROUP BY tg.item_id
  `,

  getConstructionBonus: `
    SELECT COALESCE(SUM(resource_bonus), 0) AS total_bonus
    FROM ${T.constructions} WHERE tile_id = ?
  `,

  setSystemState: `
    INSERT INTO ${T.system_state} (\`key\`, value) VALUES (?, ?)
    ON DUPLICATE KEY UPDATE value = VALUES(value)
  `,
};

export function computeDailyOutcome({ hp, hunger, isImmortal, hpDeltaFromFx }) {
  const newHunger = Math.max(0, hunger - 1);

  const starvDmg = newHunger <= 0 ? STARVATION_LOSS : 0;

  const wellFedRegen = hunger >= MAX_HUNGER ? WELLFED_REGEN : 0;

  const rawHp = Math.max(0, Math.min(MAX_HP, hp + hpDeltaFromFx - starvDmg + wellFedRegen));

  const newHp = isImmortal && rawHp <= 0 ? 1 : rawHp;

  return { newHp, newHunger, starvDmg, wellFedRegen, died: newHp <= 0 };
}

async function _processDailyPlayer(player) {
  return withTransaction(async () => {
    const effects = await query(SQL.getActiveEffects, [player.id]);
    const hpDeltaFromFx = effects.reduce((sum, e) => sum + (e.hp_delta_per_day ?? 0), 0);

    const { newHp, newHunger, starvDmg, wellFedRegen, died } = computeDailyOutcome({
      hp: player.hp, hunger: player.hunger, isImmortal: Boolean(player.is_immortal), hpDeltaFromFx,
    });

    await execute(SQL.expireEffects, [player.id]);

    if (died) {
      await execute(SQL.killById, [player.id]);
      return { died: true, prevHp: player.hp, prevHunger: player.hunger, hpDeltaFromFx, starvDmg, wellFedRegen };
    }

    await execute(SQL.updatePlayerStats, [newHp, newHunger, player.id]);
    return {
      died: false, newHp, newHunger,
      prevHp: player.hp, prevHunger: player.hunger, hpDeltaFromFx, starvDmg, wellFedRegen,
    };
  });
}

export async function runDailyReset() {
  logger.info('[Cron Daily] ▶ Iniciando reset diario…');

  const players = await query(SQL.getAllLivingPlayers);
  const deaths  = [];
  const errors  = [];
  let processed = 0;

  for (const player of players) {
    try {
      const result = await _processDailyPlayer(player);

      const causes = [];
      if (result.starvDmg > 0)    causes.push(`inanición -${result.starvDmg}`);
      if (result.wellFedRegen > 0) causes.push(`bien alimentado +${result.wellFedRegen}`);
      if (result.hpDeltaFromFx !== 0) causes.push(`efectos ${result.hpDeltaFromFx > 0 ? '+' : ''}${result.hpDeltaFromFx}`);

      if (result.died) {
        deaths.push(player);
        logger.info(
          `[Cron Daily] 💀 ${player.username} ha muerto de inanición ` +
          `(HP ${result.prevHp}→0${causes.length ? `, ${causes.join(', ')}` : ''}).`
        );
      } else if (result.newHp !== result.prevHp || result.newHunger !== result.prevHunger) {
        logger.info(
          `[Cron Daily] ${player.username}: HP ${result.prevHp}→${result.newHp}, ` +
          `Hambre ${result.prevHunger}→${result.newHunger}` +
          `${causes.length ? ` (${causes.join(', ')})` : ''}.`
        );
        processed++;
      } else {
        processed++;
      }
    } catch (err) {
      const msg = `Error procesando ${player.username}: ${err.message}`;
      errors.push(msg);
      logger.error(`[Cron Daily] ${msg}`);
    }
  }

  const ownedTiles = await query(SQL.getOwnedTiles);
  let tilesProcessed = 0;

  for (const tile of ownedTiles) {
    const generators = (await query(SQL.getTileGenerators, [tile.id])).filter(g => !g.construction_id);
    if (generators.length === 0) continue;

    const { total_bonus } = await queryOne(SQL.getConstructionBonus, [tile.id]);
    const bonusPerGenerator = (total_bonus ?? 0) / generators.length;
    const generated = [];

    for (const gen of generators) {
      const rate = gen.generation_rate + bonusPerGenerator;
      if (rate <= 0) continue;

      try {
        await addItem(tile.owner_discord_id, gen.item_name, rate);
        generated.push(`${gen.item_name} +${rate}`);
      } catch (err) {
        const msg = `Generación fallida: ${gen.item_name} en casilla ${tile.id} → ${err.message}`;
        errors.push(msg);
        logger.error(`[Cron Daily] ${msg}`);
      }
    }

    if (generated.length > 0) {
      logger.info(
        `[Cron Daily] 🏭 Casilla "${tile.tile_name}" (${tile.owner_discord_id}): ${generated.join(', ')}.`
      );
    }
    tilesProcessed++;
  }

  const npcHunger = await processNpcHunger();

  const constructionMaintenance = await processConstructionMaintenance();
  const constructionDurability = await processDurabilityDecay();

  await execute(SQL.setSystemState, ['last_daily_reset', toSqlDatetime()]);

  const aliveNow = players.length - deaths.length;

  logger.info(
    `[Cron Daily] ✔ Completado. ` +
    `Procesados: ${processed} · Muertos: ${deaths.length} · Vivos ahora: ${aliveNow} · ` +
    `Casillas: ${tilesProcessed} · Errores: ${errors.length} · ` +
    `NPCs: ${npcHunger.fed} comieron, ${npcHunger.hungry} con hambre, ${npcHunger.deserted} desertaron · ` +
    `Construcciones: ${constructionMaintenance.maintained} mantenidas, ${constructionMaintenance.unmaintained} sin mantener, ` +
    `${constructionMaintenance.damaged} dañadas, ${constructionMaintenance.ruined} en ruinas · ` +
    `Durabilidad: ${constructionDurability.updated} desgastadas, ${constructionDurability.errors} errores`
  );

  return { deaths, processed, tilesProcessed, errors, aliveNow, npcHunger, constructionMaintenance, constructionDurability };
}

async function announceDeaths(client, deaths) {
  if (!ANNOUNCE_CH || deaths.length === 0) return;

  const channel = client.channels.cache.get(ANNOUNCE_CH);
  if (!channel?.isTextBased()) return;

  for (const player of deaths) {
    const name = player.character_name ?? player.username;
    await channel
      .send(
        `💀 **${name}** ha fallecido de **inanición** en la casilla ` +
        `**(${player.coord_x}, ${player.coord_y})**.\n` +
        `*El hambre llegó a 0 y no quedaron fuerzas para seguir.*`
      )
      .catch(err => logger.warn(`[Cron] No se pudo anunciar muerte de ${name}: ${err.message}`));
  }
}

async function notifyDeathsPrivately(client, deaths) {
  for (const player of deaths) {
    await notifyDeath(client, player, 'inanición')
      .catch(err => logger.warn(`[Cron] No se pudo notificar por MD a ${player.discord_id}: ${err.message}`));

    if (player.modmail_channel_id) {
      await notifyModmailChannel(client, player.modmail_channel_id, buildDeathModmailNotice(player, 'inanición'))
        .catch(err => logger.warn(`[Cron] No se pudo avisar en el canal de modmail de ${player.discord_id}: ${err.message}`));
    }
  }
}

async function notifyFuelAlerts(client, fuelAlerts) {
  for (const alert of fuelAlerts) {
    const cuerpo = alert.kind === 'empty'
      ? `⛽ **${alert.constructionName}** se ha quedado sin combustible y HOY no ha producido ` +
        `**${alert.itemName}** (depósito: ${alert.fuelLevel}/${alert.fuelNeeded} ${alert.fuelItemName}).`
      : alert.daysLeft <= 0
        ? `⛽ A **${alert.constructionName}** le queda combustible para HOY como mucho ` +
          `(${alert.fuelLevel} ${alert.fuelItemName}, gasta ${alert.fuelNeeded}/día). ` +
          `Mañana dejará de producir **${alert.itemName}**.`
        : `⛽ A **${alert.constructionName}** le quedan **${alert.daysLeft} día${alert.daysLeft === 1 ? '' : 's'}** ` +
          `de combustible (${alert.fuelLevel} ${alert.fuelItemName}, gasta ${alert.fuelNeeded}/día) ` +
          `antes de dejar de producir **${alert.itemName}**.`;

    await sendPlayerAlert(
      client, alert.discordId, 'fuelLow',
      `${cuerpo} Usa \`/build repostar\` ${alert.kind === 'empty' ? 'para volver a ponerla en marcha' : 'para rellenarla'}.\n` +
      `-# Puedes desactivar este aviso con \`/personaje alertas combustible:false\`.`
    );
  }
}

async function notifyLaburoExpiring(client) {
  const batches = await getBatchesExpiringSoon(24);
  for (const batch of batches) {
    await sendPlayerAlert(
      client, batch.discord_id, 'laburoExpiring',
      `💪 Un lote de **${batch.quantity}** de Laburo caduca ${discordTimestamp(fromSqlDatetime(batch.expires_at), 'R')} — gástalo antes con \`/laburo trade\` o úsalo, o se pierde.\n` +
      `-# Puedes desactivar este aviso con \`/personaje alertas laburo:false\`.`
    );
  }
}

async function sendDailySummary(client, stats) {
  if (!LOGS_CH) return;

  const channel = client.channels.cache.get(LOGS_CH);
  if (!channel?.isTextBased()) return;

  const lines = [
    `📅 **Reset diario completado** — ${discordTimestamp(new Date(), 'f')}`,
    `👥 Jugadores procesados: **${stats.processed}**`,
    `💀 Muertes: **${stats.deaths.length}**`,
    `❤️ Usuarios vivos actualmente: **${stats.aliveNow}**`,
    `🏭 Casillas con generación: **${stats.tilesProcessed}**`,
  ];

  if (stats.errors.length > 0) {
    lines.push(`⚠️ Errores (${stats.errors.length}): revisa los logs del servidor.`);
  }

  await channel
    .send(lines.join('\n'))
    .catch(err => logger.warn(`[Cron] No se pudo enviar resumen diario: ${err.message}`));
}

export async function startCronJobs(client) {
  runBackup().catch(err => {
    logger.error(`[Backup] Falló el backup de arranque: ${err.message}. Revisa espacio en disco y permisos del directorio de datos cuanto antes.`);
  });

  await scheduleBackupJob();

  if (!cron.validate(DAILY_CRON)) {
    logger.error(`[Cron] Expresión diaria inválida: "${DAILY_CRON}". Jobs no iniciados.`);
    return;
  }

  cron.schedule(DAILY_CRON, guardedJob('daily', async () => {
    try {
      const stats = await runDailyReset();
      await announceDeaths(client, stats.deaths);
      await notifyDeathsPrivately(client, stats.deaths);
      await notifyLaburoExpiring(client);
      await sendDailySummary(client, stats);
    } catch (err) {
      logger.error(`[Cron Daily] Error no capturado: ${err.message}`);
      console.error(err);
    }
  }), { timezone: 'UTC' });

  logger.info(`[Cron] ✔ Job diario registrado → "${DAILY_CRON}" (UTC)`);

  cron.schedule('0 * * * *', guardedJob('laburoPrune', async () => {
    try {
      const removed = await pruneExpiredBatches();
      if (removed > 0) {
        logger.info(`[Cron] 🗑️ ${removed} lote(s) de Laburo caducado(s) eliminado(s).`);
      }
    } catch (err) {
      logger.error(`[Cron Laburo] Error no capturado: ${err.message}`);
      console.error(err);
    }
  }), { timezone: 'UTC' });

  logger.info('[Cron] ✔ Job de limpieza de lotes de Laburo registrado → "0 * * * *" (UTC, cada hora)');

  cron.schedule('*/15 * * * *', guardedJob('permissionGrantsPrune', async () => {
    try {
      const removed = await pruneExpiredGrants();
      if (removed > 0) {
        logger.info(`[Cron] 🗑️ ${removed} cesión(es) de permiso caducada(s) eliminada(s).`);
      }
    } catch (err) {
      logger.error(`[Cron Permisos] Error no capturado: ${err.message}`);
      console.error(err);
    }
  }), { timezone: 'UTC' });

  logger.info('[Cron] ✔ Job de limpieza de cesiones de permiso registrado → "*/15 * * * *" (UTC, cada 15 min)');

  cron.schedule('*/5 * * * *', guardedJob('tradePrune', async () => {
    try {
      const removed = await pruneExpiredTrades();
      if (removed > 0) {
        logger.info(`[Cron] 🗑️ ${removed} oferta(s) de trade caducada(s) marcada(s).`);
      }
    } catch (err) {
      logger.error(`[Cron Trade] Error no capturado: ${err.message}`);
      console.error(err);
    }
  }), { timezone: 'UTC' });

  logger.info('[Cron] ✔ Job de limpieza de ofertas de trade registrado → "*/5 * * * *" (UTC, cada 5 min)');

  cron.schedule('*/5 * * * *', guardedJob('robberyPrune', async () => {
    try {
      const resolved = await pruneExpiredRobberies(client);
      if (resolved > 0) {
        logger.info(`[Cron] 🏴‍☠️ ${resolved} propuesta(s) de saqueo caducada(s) resuelta(s) como ataque.`);
      }
    } catch (err) {
      logger.error(`[Cron Robbery] Error no capturado: ${err.message}`);
      console.error(err);
    }
  }), { timezone: 'UTC' });

  logger.info('[Cron] ✔ Job de limpieza de propuestas de saqueo registrado → "*/5 * * * *" (UTC, cada 5 min)');

  cron.schedule('0 * * * *', guardedJob('factionExpire', async () => {
    try {
      const expired = await expireStalePendingApplications(24);
      for (const { player, faction } of expired) {
        if (player && faction) {
          await notifyApplicationResult(client, player, faction, 'expired');
        }
      }
      if (expired.length > 0) {
        logger.info(`[Cron] ⌛ ${expired.length} solicitud(es) de nación caducada(s) sin respuesta.`);
      }
    } catch (err) {
      logger.error(`[Cron Naciones] Error no capturado: ${err.message}`);
      console.error(err);
    }
  }), { timezone: 'UTC' });

  logger.info('[Cron] ✔ Job de solicitudes de nación caducadas registrado → "0 * * * *" (UTC, cada hora)');

  cron.schedule('30 0 * * *', guardedJob('characterPrune', async () => {
    try {
      const cleaned = await pruneExpiredCharacters(client);
      if (cleaned > 0) {
        logger.info(`[Cron] 🗑️ ${cleaned} personaje(s) expirado(s) limpiado(s).`);
      }
    } catch (err) {
      logger.error(`[Cron Personajes] Error no capturado: ${err.message}`);
      console.error(err);
    }
  }), { timezone: 'UTC' });

  logger.info('[Cron] ✔ Job de limpieza de personajes expirados registrado → "30 0 * * *" (UTC)');

  cron.schedule('0 1 * * *', guardedJob('auditPrune', async () => {
    try {
      const removed = await pruneOldAuditLog(30);
      if (removed > 0) {
        logger.info(`[Cron] 🗑️ ${removed} entrada(s) del registro de acciones (más de 30 días) eliminada(s).`);
      }
    } catch (err) {
      logger.error(`[Cron Registro] Error no capturado: ${err.message}`);
      console.error(err);
    }
  }), { timezone: 'UTC' });

  logger.info('[Cron] ✔ Job de purga del registro de acciones registrado → "0 1 * * *" (UTC)');

  cron.schedule('5 1 * * *', guardedJob('terminalPrune', async () => {
    try {
      const removed = await pruneOldTerminalJobs();
      if (removed > 0) {
        logger.info(`[Cron] 🗑️ ${removed} trabajo(s) del terminal web (más de 1 día) eliminado(s).`);
      }
    } catch (err) {
      logger.error(`[Cron Terminal] Error no capturado: ${err.message}`);
      console.error(err);
    }
  }), { timezone: 'UTC' });

  logger.info('[Cron] ✔ Job de purga de trabajos del terminal web registrado → "5 1 * * *" (UTC)');

  cron.schedule('6 1 * * *', guardedJob('botJobsPrune', async () => {
    try {
      const removed = await pruneOldBotJobs();
      if (removed > 0) {
        logger.info(`[Cron] 🗑️ ${removed} job(s) de bot_jobs (más de 1 día) eliminado(s).`);
      }
    } catch (err) {
      logger.error(`[Cron BotJobs] Error no capturado: ${err.message}`);
      console.error(err);
    }
  }), { timezone: 'UTC' });

  logger.info('[Cron] ✔ Job de purga de bot_jobs registrado → "6 1 * * *" (UTC)');

  cron.schedule('*/15 * * * *', guardedJob('travel', async () => {
    try {
      const results = await processTravelTicks(client);
      const arrivals = results.filter(r => r.arrived).length;
      const blocked  = results.filter(r => r.stoppedReason).length;
      if (results.length > 0) {
        logger.info(`[Cron] 🚶 ${results.length} viaje(s) avanzado(s) — ${arrivals} llegada(s), ${blocked} bloqueado(s) a mitad de camino.`);
      }
    } catch (err) {
      logger.error(`[Cron Viajes] Error no capturado: ${err.message}`);
      console.error(err);
    }
  }), { timezone: 'UTC' });

  logger.info('[Cron] ✔ Job de viajes en curso registrado → "*/15 * * * *" (UTC, cada 15 min)');

  cron.schedule('*/15 * * * *', guardedJob('production', async () => {
    try {
      const { produced, fuelAlerts } = await flushDueProduction();
      if (produced.length > 0) {
        logger.info(`[Cron] 🏭 ${produced.length} construcción(es) liquidada(s): ${produced.map(p => `${p.itemName} +${p.quantity}`).join(', ')}.`);
      }
      await notifyFuelAlerts(client, fuelAlerts);
    } catch (err) {
      logger.error(`[Cron Producción] Error no capturado: ${err.message}`);
      console.error(err);
    }
  }), { timezone: 'UTC' });

  logger.info('[Cron] ✔ Job de producción pendiente registrado → "*/15 * * * *" (UTC, cada 15 min)');

  cron.schedule('*/15 * * * *', guardedJob('npcProduction', async () => {
    try {
      const { produced } = await flushDueNpcProduction();
      if (produced.length > 0) {
        logger.info(`[Cron] 👤 ${produced.length} NPC(s) reclutado(s) liquidado(s).`);
      }
    } catch (err) {
      logger.error(`[Cron NPC Producción] Error no capturado: ${err.message}`);
      console.error(err);
    }
  }), { timezone: 'UTC' });

  logger.info('[Cron] ✔ Job de producción de NPCs reclutados registrado → "*/15 * * * *" (UTC, cada 15 min)');

  cron.schedule('0 * * * *', guardedJob('npcIdleEncounters', async () => {
    try {
      const results = await processIdleEncounterRolls(client);
      if (results.length > 0) {
        const aggressive = results.filter(r => r.aggressive).length;
        logger.info(`[Cron] 👹 ${results.length} encuentro(s) pasivo(s) de NPC — ${aggressive} agresivo(s) (viaje pausado).`);
      }
    } catch (err) {
      logger.error(`[Cron Encuentros NPC Pasivos] Error no capturado: ${err.message}`);
      console.error(err);
    }
  }), { timezone: 'UTC' });

  logger.info('[Cron] ✔ Job de ronda pasiva de encuentros de NPC registrado → "0 * * * *" (UTC, cada hora)');

  cron.schedule('*/1 * * * *', guardedJob('npcPlacedEncounters', async () => {
    try {
      const results = await processPendingPlacedEncounters(client);
      if (results.length > 0) {
        const aggressive = results.filter(r => r.aggressive).length;
        logger.info(`[Cron] 👹 ${results.length} NPC(s) colocado(s) a mano avisado(s) — ${aggressive} agresivo(s) (viaje pausado).`);
      }
    } catch (err) {
      logger.error(`[Cron Encuentros NPC Colocados] Error no capturado: ${err.message}`);
      console.error(err);
    }
  }), { timezone: 'UTC' });

  logger.info('[Cron] ✔ Job de NPCs colocados a mano pendientes de aviso registrado → "*/1 * * * *" (UTC, cada minuto)');
}
