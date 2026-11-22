

import { ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';
import { queryOne, execute } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { resolveEffectivePermission } from '../utils/permissions.js';
import { startGuardedInterval } from '../utils/guardedInterval.js';

const GUILD_ID = process.env.GUILD_ID;
const POLL_INTERVAL_MS = 1000;

const SQL = {
  insert: `
    INSERT INTO ${T.terminal_jobs} (command_line, requested_by_discord_id) VALUES (?, ?)
  `,
  getById: `SELECT * FROM ${T.terminal_jobs} WHERE id = ?`,
  getOldestPending: `SELECT * FROM ${T.terminal_jobs} WHERE status = 'pending' ORDER BY id ASC LIMIT 1`,
  markDone: `UPDATE ${T.terminal_jobs} SET status = 'done', result_text = ?, completed_at = NOW() WHERE id = ?`,
  markError: `UPDATE ${T.terminal_jobs} SET status = 'error', result_text = ?, completed_at = NOW() WHERE id = ?`,
  pruneOld: `DELETE FROM ${T.terminal_jobs} WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 DAY)`,
};

export async function enqueueCommand(commandLine, requestedByDiscordId) {
  const result = await execute(SQL.insert, [commandLine.trim(), requestedByDiscordId]);
  return result.lastInsertRowid;
}

export async function getJobResult(id) {
  return (await queryOne(SQL.getById, [id])) ?? null;
}

export function tokenize(line) {
  const tokens = [];

  const re = /(\S+?):"([^"]*)"|"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    tokens.push(m[1] !== undefined ? `${m[1]}:${m[2]}` : (m[3] ?? m[4]));
  }
  return tokens;
}

export function parseCommandArgs(line, commandJSON) {
  const tokens = tokenize(line);
  tokens.shift();

  const topLevelSubcommands = (commandJSON.options ?? []).filter(o => o.type === ApplicationCommandOptionType.Subcommand);
  let subcommandName = null;
  let optionSchema = commandJSON.options ?? [];

  if (topLevelSubcommands.length > 0) {
    subcommandName = tokens.shift() ?? null;
    const sub = topLevelSubcommands.find(o => o.name === subcommandName);
    if (!sub) {
      throw new Error(`Subcomando desconocido: "${subcommandName ?? ''}". Opciones: ${topLevelSubcommands.map(o => o.name).join(', ')}.`);
    }
    optionSchema = sub.options ?? [];
  }

  const rawOptions = new Map();
  for (const token of tokens) {
    const idx = token.indexOf(':');
    if (idx === -1) throw new Error(`No entiendo "${token}" — las opciones van como clave:valor.`);
    rawOptions.set(token.slice(0, idx), token.slice(idx + 1));
  }

  return { subcommandName, optionSchema, rawOptions };
}

function stripMention(raw) {
  const m = raw.match(/^<@!?(\d+)>$/);
  return m ? m[1] : raw;
}

function requireIfNeeded(name, value, required) {
  if (required && (value === null || value === undefined)) {
    throw new Error(`Falta la opción obligatoria "${name}".`);
  }
  return value;
}

export async function buildSyntheticInteraction(client, command, job) {
  const commandJSON = command.data.toJSON();
  const { subcommandName, optionSchema, rawOptions } = parseCommandArgs(job.command_line, commandJSON);

  const resolvedUsers = new Map();
  const resolvedChannels = new Map();
  for (const opt of optionSchema) {
    const raw = rawOptions.get(opt.name);
    if (raw === undefined) continue;
    if (opt.type === ApplicationCommandOptionType.User) {
      const user = await client.users.fetch(stripMention(raw)).catch(() => null);
      if (!user) throw new Error(`No se pudo resolver el usuario de Discord "${raw}" (opción "${opt.name}").`);
      resolvedUsers.set(opt.name, user);
    } else if (opt.type === ApplicationCommandOptionType.Channel) {
      const channel = await client.channels.fetch(stripMention(raw).replace(/[<#>]/g, '')).catch(() => null);
      if (!channel) throw new Error(`No se pudo resolver el canal "${raw}" (opción "${opt.name}").`);
      resolvedChannels.set(opt.name, channel);
    }
  }

  const outputBlocks = [];
  let replied = false, deferred = false;

  function payloadToText(payload) {
    if (typeof payload === 'string') return payload;
    const parts = [];
    if (payload?.content) parts.push(payload.content);
    for (const embed of payload?.embeds ?? []) {
      const data = embed instanceof EmbedBuilder ? embed.data : embed;
      const lines = [];
      if (data.title) lines.push(`**${data.title}**`);
      if (data.description) lines.push(data.description);
      for (const f of data.fields ?? []) lines.push(`${f.name}: ${f.value}`);
      if (lines.length > 0) parts.push(lines.join('\n'));
    }
    return parts.join('\n\n') || '(sin contenido de texto)';
  }

  const requestingUser = await client.users.fetch(job.requested_by_discord_id).catch(() => null);
  if (!requestingUser) throw new Error(`No se pudo resolver tu usuario de Discord (${job.requested_by_discord_id}) — ¿sigues en el servidor?`);

  const interaction = {
    client,
    user: requestingUser,

    guild: GUILD_ID ? client.guilds.cache.get(GUILD_ID) ?? null : null,
    commandName: command.data.name,

    options: {
      getSubcommand: () => subcommandName,
      getString:  (name, required = false) => requireIfNeeded(name, rawOptions.get(name) ?? null, required),
      getInteger: (name, required = false) => requireIfNeeded(name, rawOptions.has(name) ? parseInt(rawOptions.get(name), 10) : null, required),
      getNumber:  (name, required = false) => requireIfNeeded(name, rawOptions.has(name) ? parseFloat(rawOptions.get(name)) : null, required),
      getBoolean: (name, required = false) => requireIfNeeded(name, rawOptions.has(name) ? rawOptions.get(name).toLowerCase() === 'true' : null, required),
      getUser:    (name, required = false) => requireIfNeeded(name, resolvedUsers.get(name) ?? null, required),
      getChannel: (name, required = false) => requireIfNeeded(name, resolvedChannels.get(name) ?? null, required),

      getAttachment: (name, required = false) => {
        if (required) {
          throw new Error(`La opción "${name}" es un adjunto de fichero obligatorio — el terminal no admite adjuntos, así que este comando no se puede ejecutar desde aquí.`);
        }
        return null;
      },

      getFocused: () => {
        throw new Error('Este comando usa autocompletado (getFocused()), que el terminal no admite — no se puede ejecutar desde aquí.');
      },
    },
    get replied() { return replied; },
    get deferred() { return deferred; },
    async reply(payload) { replied = true; outputBlocks.push(payloadToText(payload)); return interaction; },
    async followUp(payload) { outputBlocks.push(payloadToText(payload)); return interaction; },
    async deferReply() { deferred = true; return interaction; },
    async editReply(payload) {
      const text = payloadToText(payload);
      if (outputBlocks.length > 0) outputBlocks[outputBlocks.length - 1] = text;
      else outputBlocks.push(text);
      return interaction;
    },
  };

  return { interaction, getOutput: () => outputBlocks.join('\n\n---\n\n') || '(el comando no respondió nada)' };
}

export async function processNextJob(client) {
  const job = await queryOne(SQL.getOldestPending);
  if (!job) return;

  try {
    const command = client.commands.get(job.command_line.split(/\s+/)[0]);
    if (!command) {
      throw new Error(`Comando desconocido: "${job.command_line.split(/\s+/)[0]}".`);
    }

    const { interaction, getOutput } = await buildSyntheticInteraction(client, command, job);

    const subcommandName = interaction.options.getSubcommand();
    const effectivePermission = command.category === 'staff'
      ? 'rolepriest'
      : resolveEffectivePermission(command, subcommandName);

    if (effectivePermission !== 'rolepriest') {
      const target = subcommandName ? `"/${command.data.name} ${subcommandName}"` : `"/${command.data.name}"`;
      throw new Error(`${target} no está disponible desde el terminal (solo subcomandos de Staff).`);
    }

    await command.execute(interaction);

    await execute(SQL.markDone, [getOutput(), job.id]);
    logger.info(`[Terminal] "${job.command_line}" (${job.requested_by_discord_id}) → ok`);
  } catch (err) {
    await execute(SQL.markError, [err.message, job.id]);
    logger.warn(`[Terminal] "${job.command_line}" (${job.requested_by_discord_id}) → error: ${err.message}`);
  }
}

export function startTerminalJobPoller(client) {
  startGuardedInterval(async () => {
    try {
      await processNextJob(client);
    } catch (err) {
      logger.error(`[Terminal] Error no capturado en el sondeo: ${err.message}`);
      console.error(err);
    }
  }, POLL_INTERVAL_MS);
  logger.info(`[Terminal] ✔ Sondeo de comandos del terminal web iniciado (cada ${POLL_INTERVAL_MS / 1000}s).`);
}

export async function pruneOldTerminalJobs() {
  return (await execute(SQL.pruneOld)).changes;
}
