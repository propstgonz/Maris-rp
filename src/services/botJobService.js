import { queryOne, execute } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { UserFacingError } from '../utils/errors.js';
import { startGuardedInterval } from '../utils/guardedInterval.js';
import { markDeceased, finalizeGraceDeath, createCharacter } from './characterLifecycleService.js';
import { listPlayersWithChannel, postCharacterInfoCard } from './modmailService.js';
import { getPlayerByDiscordId } from './playerService.js';
import { createAndRegisterCategory } from './modmailCategoryService.js';
import { sendBroadcast } from './broadcastService.js';

const POLL_INTERVAL_MS = 1000;

const SQL = {
  insert: `
    INSERT INTO ${T.bot_jobs} (job_type, payload, requested_by_discord_id) VALUES (?, ?, ?)
  `,
  getById: `SELECT * FROM ${T.bot_jobs} WHERE id = ?`,
  getOldestPending: `SELECT * FROM ${T.bot_jobs} WHERE status = 'pending' ORDER BY id ASC LIMIT 1`,
  markDone: `UPDATE ${T.bot_jobs} SET status = 'done', result_text = ?, completed_at = NOW() WHERE id = ?`,
  markError: `UPDATE ${T.bot_jobs} SET status = 'error', result_text = ?, completed_at = NOW() WHERE id = ?`,
  pruneOld: `DELETE FROM ${T.bot_jobs} WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 DAY)`,
};

export async function enqueueJob(jobType, payload, requestedByDiscordId) {
  const result = await execute(SQL.insert, [jobType, JSON.stringify(payload ?? {}), requestedByDiscordId]);
  return result.lastInsertRowid;
}

export async function getJobResult(id) {
  const row = await queryOne(SQL.getById, [id]);
  if (!row) return null;
  return { ...row, payload: JSON.parse(row.payload) };
}

const DEFAULT_POLL_TIMEOUT_MS = 12_000;
const DEFAULT_POLL_INTERVAL_MS = 300;

export async function enqueueJobAndAwait(jobType, payload, requestedByDiscordId, { timeoutMs = DEFAULT_POLL_TIMEOUT_MS, intervalMs = DEFAULT_POLL_INTERVAL_MS } = {}) {
  const jobId = await enqueueJob(jobType, payload, requestedByDiscordId);

  const deadline = Date.now() + timeoutMs;
  let job = await getJobResult(jobId);
  while (job?.status === 'pending' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    job = await getJobResult(jobId);
  }

  if (!job || job.status === 'pending') {
    throw new UserFacingError('El bot está tardando más de lo normal en procesar esto — inténtalo de nuevo en un momento.');
  }
  if (job.status === 'error') {
    throw new UserFacingError(job.result_text);
  }
  return JSON.parse(job.result_text);
}

const handlers = {
  async 'player.kill'(client, payload) {
    const { discordId, reason } = payload;
    const updated = await markDeceased(client, discordId, reason, { permadeath: true });
    return JSON.stringify(updated);
  },
  async 'player.stats_death'(client, payload) {
    const { discordId, reason } = payload;
    const updated = await markDeceased(client, discordId, reason);
    return JSON.stringify(updated);
  },
  async 'player.finalize_grace'(client, payload) {
    const { discordId } = payload;
    const updated = await finalizeGraceDeath(discordId, client);
    return JSON.stringify(updated);
  },
  async 'channels.sync_identity_cards'(client) {
    const players = await listPlayersWithChannel();
    let posted = 0, skipped = 0, errors = 0;
    for (const p of players) {
      try {
        const full = await getPlayerByDiscordId(p.discord_id);
        if (!full) { skipped++; continue; }
        const didPost = await postCharacterInfoCard(client, p.modmail_channel_id, full);
        if (didPost) posted++; else skipped++;
      } catch (err) {
        errors++;
        logger.warn(`[BotJobs] channels.sync_identity_cards: fallo con ${p.discord_id}: ${err.message}`);
      }
    }
    return JSON.stringify({ total: players.length, posted, skipped, errors });
  },
  async 'character.create'(client, payload) {
    const { discordId, fullName, nationality, originCountry, religion, description, gender, avatarFilename } = payload;
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild) throw new Error('No se encontró el servidor (GUILD_ID) desde el proceso del bot.');
    const player = await createCharacter(client, guild, discordId, { fullName, nationality, originCountry, religion, description, gender, avatarFilename });
    return JSON.stringify(player);
  },
  async 'modmail.create_category'(client, payload) {
    const { name } = payload;
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild) throw new Error('No se encontró el servidor (GUILD_ID) desde el proceso del bot.');
    const { category, clonedPermissions } = await createAndRegisterCategory(guild, name);
    return JSON.stringify({ id: category.id, name: category.name, clonedPermissions });
  },
  async 'staff.broadcast'(client, payload) {
    const { message, imageUrls } = payload;
    const result = await sendBroadcast(client, message, imageUrls ?? []);
    return JSON.stringify(result);
  },
  async 'travel.web_started'(client, payload) {
    const { discordId, trip } = payload;
    const { notifyTravelStarted } = await import('./travelService.js');
    await notifyTravelStarted(client, discordId, trip);
    return JSON.stringify({ ok: true });
  },
  async 'combat.attack_player'(client, payload) {
    const { resolveAttack, resolveMeleeAttack } = await import('./combatService.js');
    const { logAction } = await import('./auditLogService.js');
    const { attackerDiscordId, targetDiscordId, weaponName } = payload;

    const result = weaponName
      ? await resolveAttack(client, attackerDiscordId, targetDiscordId, weaponName)
      : await resolveMeleeAttack(client, attackerDiscordId, targetDiscordId);

    if (result.hit || (!weaponName && result.outcomeRoll === 1)) {
      logAction({
        source: 'web', actorDiscordId: attackerDiscordId, actorUsername: result.attacker.username,
        action: weaponName ? 'combat.ranged_hit' : 'combat.melee_hit', target: targetDiscordId,
        details: result.hit
          ? { weapon: weaponName ?? undefined, damage: result.damage, targetHpAfter: result.targetHpAfter, killed: result.killed, immortalitySaved: result.immortalitySaved, targetName: result.target.character_name ?? result.target.username }
          : { selfInflicted: true, selfDamage: result.selfDamage, attackerHpAfter: result.attackerHpAfter, attackerKilled: result.attackerKilled, attackerImmortalitySaved: result.attackerImmortalitySaved },
      });
    }
    if (result.hit) {
      result.tileDefenders = await _applyTileDefenders(client, attackerDiscordId, result.attacker.username, result.target.coord_x, result.target.coord_y);
    }
    return JSON.stringify(result);
  },
  async 'combat.attack_npc'(client, payload) {
    const { resolveAttackOnNpc } = await import('./npcCombatService.js');
    const { resolveEncounterIfConcluded } = await import('./npcEncounterService.js');
    const { logAction } = await import('./auditLogService.js');
    const { attackerDiscordId, npcId, weaponName } = payload;

    const result = await resolveAttackOnNpc(client, attackerDiscordId, npcId, weaponName);

    if (result.hit) {
      logAction({
        source: 'web', actorDiscordId: attackerDiscordId, actorUsername: result.attacker.username,
        action: 'combat.npc_hit', target: `(${result.npc.coord_x},${result.npc.coord_y})`,
        details: { npcId, npcType: result.npc.type_display_name, weapon: weaponName, damage: result.damage, npcHpAfter: result.npcHpAfter, npcDied: result.npcDied, dropsCount: result.drops.length },
      });
    }
    if (result.npcCounterattack?.hit) {
      logAction({
        source: 'web', actorDiscordId: attackerDiscordId, actorUsername: result.attacker.username,
        action: 'combat.npc_counterattack_hit', target: attackerDiscordId,
        details: {
          npcId, npcType: result.npc.type_display_name,
          damage: result.npcCounterattack.damage, playerHpAfter: result.npcCounterattack.playerHpAfter,
          playerKilled: result.npcCounterattack.playerKilled, immortalitySaved: result.npcCounterattack.immortalitySaved,
        },
      });
    }
    if (result.npcDied) {
      await resolveEncounterIfConcluded(client, result.npc).catch(err =>
        logger.warn(`[BotJobs] combat.attack_npc: no se pudo resolver el encuentro tras la muerte del NPC #${npcId}: ${err.message}`)
      );
    }
    return JSON.stringify(result);
  },
  async 'combat.attack_construction'(client, payload) {
    const { resolveStructureAttack } = await import('./combatService.js');
    const { getConstructionTypeByName } = await import('./constructionTypeService.js');
    const { logAction } = await import('./auditLogService.js');
    const { attackerDiscordId, x, y, constructionTypeName, weaponName, constructionId } = payload;

    const constructionType = await getConstructionTypeByName(constructionTypeName);
    if (!constructionType) throw new Error(`No existe ningún tipo de construcción llamado "${constructionTypeName}".`);

    const result = await resolveStructureAttack(client, attackerDiscordId, x, y, constructionType, weaponName, constructionId);

    if (result.hit) {
      logAction({
        source: 'web', actorDiscordId: attackerDiscordId, actorUsername: result.attacker.username,
        action: 'tile.construction_attack', target: `(${x},${y})`,
        details: { constructionType: constructionTypeName, constructionName: result.construction.name, weapon: weaponName, damage: result.damage, healthBefore: result.healthBefore, healthAfter: result.healthAfter, ruinedNow: result.ruinedNow },
      });
    }
    if (result.hit) {
      result.tileDefenders = await _applyTileDefenders(client, attackerDiscordId, result.attacker.username, x, y);
    }
    return JSON.stringify(result);
  },
  async 'craft.web_craft'(client, payload) {
    const { craftItem } = await import('./craftService.js');
    const { logAction } = await import('./auditLogService.js');
    const { discordId, itemName, recipeId } = payload;
    const guild = client.guilds.cache.get(process.env.GUILD_ID) ?? null;
    const result = await craftItem(discordId, itemName, guild, recipeId);
    logAction({
      source: 'web', actorDiscordId: discordId, actorUsername: result.player?.username ?? discordId,
      action: 'craft.done', target: result.result.name,
      details: { recipeId: result.recipe.id, quantity: result.result.quantity },
    });
    return JSON.stringify(result);
  },
  async 'item.web_consume'(client, payload) {
    const { consumeItem } = await import('./consumeService.js');
    const { logAction } = await import('./auditLogService.js');
    const { discordId, itemName } = payload;
    const result = await consumeItem(client, discordId, itemName);
    logAction({
      source: 'web', actorDiscordId: discordId, actorUsername: discordId,
      action: 'item.consume', target: result.item.name,
      details: {
        itemName: result.item.display_name, hpBefore: result.hpBefore, hpAfter: result.hpAfter,
        hungerBefore: result.hungerBefore, hungerAfter: result.hungerAfter,
        died: result.died, immortalitySaved: result.immortalitySaved,
      },
    });
    return JSON.stringify(result);
  },
  async 'combat.web_flee'(client, payload) {
    const { attemptFlee } = await import('./npcEncounterService.js');
    const { discordId, username } = payload;
    const result = await attemptFlee(client, discordId, username, 'web');
    return JSON.stringify(result);
  },
  async 'npc.remove_resolve_encounter'(client, payload) {
    const { resolveEncounterIfConcluded } = await import('./npcEncounterService.js');
    await resolveEncounterIfConcluded(client, payload.npc);
    return JSON.stringify({ ok: true });
  },
  async 'trade.web_propose'(client, payload) {
    const { createPendingTrade } = await import('./tradeConsentService.js');
    const { getPlayerByDiscordId } = await import('./playerService.js');
    const { logAction } = await import('./auditLogService.js');
    const { fromDiscordId, toDiscordId, itemName, quantity, coord } = payload;

    const offer = await createPendingTrade(fromDiscordId, toDiscordId, itemName, quantity, coord);

    const from = await getPlayerByDiscordId(fromDiscordId);
    const to = await getPlayerByDiscordId(toDiscordId);
    logAction({
      source: 'web', actorDiscordId: fromDiscordId, actorUsername: from?.username ?? fromDiscordId,
      action: 'trade.propose', target: toDiscordId,
      details: { toCharacterName: to?.character_name ?? to?.username, item: offer.item.display_name, quantity },
    });

    const user = await client.users.fetch(toDiscordId).catch(() => null);
    if (user) await user.send(offer.payload).catch(() => {});
    if (to?.modmail_channel_id) {
      const channel = await client.channels.fetch(to.modmail_channel_id).catch(() => null);
      if (channel?.isTextBased()) await channel.send(offer.payload).catch(() => {});
    }

    return JSON.stringify({ id: offer.id, item: offer.item });
  },
};

async function _applyTileDefenders(client, attackerDiscordId, attackerUsername, x, y) {
  const { resolveTileDefenders } = await import('./npcCombatService.js');
  const { logAction } = await import('./auditLogService.js');

  const defenses = await resolveTileDefenders(client, attackerDiscordId, x, y).catch(err => {
    logger.warn(`[BotJobs] No se pudo resolver la defensa automática de (${x},${y}): ${err.message}`);
    return [];
  });

  for (const { npc, counter } of defenses) {
    if (!counter.hit) continue;
    logAction({
      source: 'web', actorDiscordId: attackerDiscordId, actorUsername: attackerUsername,
      action: 'combat.npc_counterattack_hit', target: attackerDiscordId,
      details: {
        npcId: npc.id, npcType: npc.type_display_name,
        damage: counter.damage, playerHpAfter: counter.playerHpAfter,
        playerKilled: counter.playerKilled, immortalitySaved: counter.immortalitySaved,
      },
    });
  }

  return defenses;
}

export async function processNextJob(client) {
  const job = await queryOne(SQL.getOldestPending);
  if (!job) return;

  try {
    const handler = handlers[job.job_type];
    if (!handler) throw new Error(`Tipo de job desconocido: "${job.job_type}".`);

    const payload = JSON.parse(job.payload);
    const resultText = await handler(client, payload);

    await execute(SQL.markDone, [resultText, job.id]);
    logger.info(`[BotJobs] "${job.job_type}" #${job.id} (${job.requested_by_discord_id}) → ok`);
  } catch (err) {
    await execute(SQL.markError, [err.message, job.id]);
    logger.warn(`[BotJobs] "${job.job_type}" #${job.id} (${job.requested_by_discord_id}) → error: ${err.message}`);
  }
}

export function startBotJobPoller(client) {
  startGuardedInterval(async () => {
    try {
      await processNextJob(client);
    } catch (err) {
      logger.error(`[BotJobs] Error no capturado en el sondeo: ${err.message}`);
      console.error(err);
    }
  }, POLL_INTERVAL_MS);
  logger.info(`[BotJobs] ✔ Sondeo de bot_jobs iniciado (cada ${POLL_INTERVAL_MS / 1000}s).`);
}

export async function pruneOldBotJobs() {
  return (await execute(SQL.pruneOld)).changes;
}
