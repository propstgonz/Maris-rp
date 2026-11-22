


















import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import {
  getTileWithDetails,
  createTile,
  createTileRange,
  updateTile,
  setTileOwner,
  addResourceGenerator,
} from '../../services/mapService.js';
import { addPointOfInterest, removePointOfInterest } from '../../services/poiService.js';
import {
  getWorldTemperatureRange, setWorldTemperatureRange, regenerateWholeMapTemperatures,
} from '../../services/temperatureService.js';
import { formatTemperature, TEMP_ABSOLUTE_MIN, TEMP_ABSOLUTE_MAX } from '../../utils/temperature.js';
import { getOrCreatePlayer, getPlayerByDiscordId, getSpawnCoords, setSpawnCoords }  from '../../services/playerService.js';
import { requireRolepriest }   from '../../utils/permissions.js';
import { buildTileInfoEmbed, COLORS } from '../../utils/embeds.js';
import { handleTerrainTypeAutocomplete } from '../../utils/autocomplete.js';
import logger                  from '../../utils/logger.js';
import { logAction }            from '../../services/auditLogService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('map')
    .setDescription('[Rolepriest] Gestiona el mapa del mundo')


    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Crea una nueva casilla en el Grid')
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y').setRequired(true))
        .addStringOption(opt => opt.setName('nombre').setDescription('Nombre de la casilla').setRequired(true))
        .addStringOption(opt => opt.setName('tipo').setDescription('Tipo de terreno').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('descripcion').setDescription('Descripción narrativa (máx. 200)').setRequired(false).setMaxLength(200))
        .addStringOption(opt => opt.setName('recurso').setDescription('Recurso natural presente (ej: piedra, madera)').setRequired(false))
    )


    .addSubcommand(sub =>
      sub
        .setName('create-range')
        .setDescription('Crea de golpe todas las casillas que falten en un rectángulo de coordenadas')
        .addIntegerOption(opt => opt.setName('x1').setDescription('Coordenada X de una esquina').setRequired(true).setMinValue(0).setMaxValue(9999))
        .addIntegerOption(opt => opt.setName('y1').setDescription('Coordenada Y de una esquina').setRequired(true).setMinValue(0).setMaxValue(9999))
        .addIntegerOption(opt => opt.setName('x2').setDescription('Coordenada X de la esquina opuesta').setRequired(true).setMinValue(0).setMaxValue(9999))
        .addIntegerOption(opt => opt.setName('y2').setDescription('Coordenada Y de la esquina opuesta').setRequired(true).setMinValue(0).setMaxValue(9999))
        .addStringOption(opt => opt.setName('nombre').setDescription('Nombre para todas las casillas nuevas').setRequired(true))
        .addStringOption(opt => opt.setName('tipo').setDescription('Tipo de terreno').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('descripcion').setDescription('Descripción narrativa (máx. 200)').setRequired(false).setMaxLength(200))
        .addStringOption(opt => opt.setName('recurso').setDescription('Recurso natural presente (ej: piedra, madera)').setRequired(false))
    )


    .addSubcommand(sub =>
      sub
        .setName('edit')
        .setDescription('Edita propiedades de una casilla existente')
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y').setRequired(true))
        .addStringOption(opt => opt.setName('nombre').setDescription('Nuevo nombre').setRequired(false))
        .addStringOption(opt => opt.setName('tipo').setDescription('Nuevo tipo de terreno').setRequired(false).setAutocomplete(true))
        .addStringOption(opt => opt.setName('descripcion').setDescription('Nueva descripción (máx. 200)').setRequired(false).setMaxLength(200))
        .addStringOption(opt => opt.setName('recurso').setDescription('Nuevo recurso natural (vacío para quitarlo, escribe "ninguno")').setRequired(false))
    )


    .addSubcommand(sub =>
      sub
        .setName('setowner')
        .setDescription('Asigna o elimina el propietario de una casilla')
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y').setRequired(true))
        .addUserOption(opt => opt.setName('jugador').setDescription('Nuevo propietario (omitir para liberar la casilla)').setRequired(false))
    )


    .addSubcommand(sub =>
      sub
        .setName('addgenerator')
        .setDescription('Añade o actualiza un generador de recursos en una casilla')
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y').setRequired(true))
        .addStringOption(opt => opt.setName('item').setDescription('Nombre del ítem a generar (ej: hierro, madera)').setRequired(true))
        .addNumberOption(opt => opt.setName('tasa').setDescription('Unidades generadas por día').setRequired(true).setMinValue(0.1))
    )


    .addSubcommand(sub =>
      sub
        .setName('setspawn')
        .setDescription('Cambia la casilla donde aparecen los personajes nuevos (sin argumentos: consulta la actual)')
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X (≥ 0)').setRequired(false).setMinValue(0))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y (≥ 0)').setRequired(false).setMinValue(0))
    )


    .addSubcommand(sub =>
      sub
        .setName('poi-add')
        .setDescription('Añade un lugar de interés a una casilla (una taberna, un templo, una ruina...)')
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y').setRequired(true))
        .addStringOption(opt => opt.setName('nombre').setDescription('Nombre del lugar').setRequired(true).setMaxLength(191))
        .addStringOption(opt => opt.setName('descripcion').setDescription('Descripción narrativa (máx. 500)').setRequired(false).setMaxLength(500))
        .addStringOption(opt => opt.setName('emoji').setDescription('Emoji para identificarlo (por defecto 📍)').setRequired(false))
    )


    .addSubcommand(sub =>
      sub
        .setName('poi-remove')
        .setDescription('Quita un lugar de interés de una casilla')
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y').setRequired(true))
        .addStringOption(opt => opt.setName('nombre').setDescription('Nombre exacto del lugar a quitar').setRequired(true))
    )


    .addSubcommand(sub =>
      sub
        .setName('temperaturas')
        .setDescription('Recalcula la temperatura de todas las casillas a partir del rango de cada zona')
        .addNumberOption(opt => opt.setName('base_min').setDescription('Temperatura mínima de las casillas SIN zona').setRequired(false).setMinValue(TEMP_ABSOLUTE_MIN).setMaxValue(TEMP_ABSOLUTE_MAX))
        .addNumberOption(opt => opt.setName('base_max').setDescription('Temperatura máxima de las casillas SIN zona').setRequired(false).setMinValue(TEMP_ABSOLUTE_MIN).setMaxValue(TEMP_ABSOLUTE_MAX))
        .addBooleanOption(opt => opt.setName('nueva_semilla').setDescription('Sortea un clima nuevo en vez de reproducir el mismo reparto').setRequired(false))
    ),


  async autocomplete(interaction) {
    await handleTerrainTypeAutocomplete(interaction);
  },


  async execute(interaction) {
    if (!await requireRolepriest(interaction)) return;

    const sub = interaction.options.getSubcommand();




    if (sub === 'create') {
      const x           = interaction.options.getInteger('x', true);
      const y           = interaction.options.getInteger('y', true);
      const nombre      = interaction.options.getString('nombre', true).trim();
      const tipo        = interaction.options.getString('tipo', true);
      const descripcion = interaction.options.getString('descripcion') ?? '';
      const recurso     = interaction.options.getString('recurso') ?? null;

      let tile;
      try {
        tile = await createTile(x, y, nombre, tipo, descripcion);
        if (recurso) await updateTile(x, y, { resource_type: recurso });
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/map create] ${interaction.user.tag} creó casilla "${nombre}" @ (${x},${y})`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'tile.create', target: `(${x},${y})`, details: { nombre, tipo } });

      const tileDetail = await getTileWithDetails(x, y);
      return interaction.reply({
        content: `✅ Casilla creada correctamente.`,
        embeds:  [buildTileInfoEmbed(tileDetail)],
      });
    }




    if (sub === 'create-range') {
      const x1          = interaction.options.getInteger('x1', true);
      const y1          = interaction.options.getInteger('y1', true);
      const x2          = interaction.options.getInteger('x2', true);
      const y2          = interaction.options.getInteger('y2', true);
      const nombre      = interaction.options.getString('nombre', true).trim();
      const tipo        = interaction.options.getString('tipo', true);
      const descripcion = interaction.options.getString('descripcion') ?? '';
      const recurso     = interaction.options.getString('recurso') ?? null;

      let result;
      try {
        result = await createTileRange(x1, y1, x2, y2, nombre, tipo, descripcion, recurso);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(
        `[/map create-range] ${interaction.user.tag}: ${result.created} casilla(s) nueva(s) "${nombre}" (${tipo}) ` +
        `en (${result.minX},${result.minY})-(${result.maxX},${result.maxY})`
      );
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'tile.range_create', target: `(${result.minX},${result.minY})-(${result.maxX},${result.maxY})`, details: { nombre, tipo, created: result.created, skipped: result.skipped } });

      return interaction.reply({
        content:
          `✅ **${result.created}** casilla(s) nueva(s) creada(s) en el rango **(${result.minX}, ${result.minY})–(${result.maxX}, ${result.maxY})**` +
          (result.skipped > 0 ? ` *(${result.skipped} ya existían, no se tocaron)*` : '') + '.',
      });
    }




    if (sub === 'edit') {
      const x           = interaction.options.getInteger('x', true);
      const y           = interaction.options.getInteger('y', true);
      const nombre      = interaction.options.getString('nombre')      ?? undefined;
      const tipo        = interaction.options.getString('tipo')        ?? undefined;
      const descripcion = interaction.options.getString('descripcion') ?? undefined;
      const recursoRaw  = interaction.options.getString('recurso')     ?? undefined;
      const recurso     = recursoRaw?.toLowerCase() === 'ninguno' ? null : recursoRaw;

      if (!nombre && !tipo && !descripcion && recursoRaw === undefined) {
        return interaction.reply({
          content: '❌ Debes especificar al menos un campo a editar: `nombre`, `tipo`, `descripcion` o `recurso`.',
          flags: MessageFlags.Ephemeral,
        });
      }

      let tile;
      try {
        tile = await updateTile(x, y, { name: nombre, terrainType: tipo, description: descripcion, resource_type: recurso });
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/map edit] ${interaction.user.tag} editó casilla @ (${x},${y})`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'tile.update', target: `(${x},${y})` });

      const tileDetail = await getTileWithDetails(x, y);
      return interaction.reply({
        content: `✅ Casilla actualizada.`,
        embeds:  [buildTileInfoEmbed(tileDetail)],
      });
    }




    if (sub === 'setowner') {
      const x          = interaction.options.getInteger('x', true);
      const y          = interaction.options.getInteger('y', true);
      const targetUser = interaction.options.getUser('jugador') ?? null;

      if (targetUser) {
        await getOrCreatePlayer(targetUser.id, targetUser.username);
      }

      let tile;
      try {
        tile = await setTileOwner(x, y, targetUser?.id ?? null);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      const ownerMsg = targetUser
        ? `Propietario asignado: **${targetUser.username}**`
        : `Casilla liberada (territorio neutral)`;

      logger.info(`[/map setowner] ${interaction.user.tag} → ${ownerMsg} @ (${x},${y})`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'tile.set_owner', target: `(${x},${y})`, details: { owner: targetUser?.id ?? null } });

      const tileDetail = await getTileWithDetails(x, y);
      return interaction.reply({
        content: `✅ ${ownerMsg}.`,
        embeds:  [buildTileInfoEmbed(tileDetail)],
      });
    }




    if (sub === 'addgenerator') {
      const x        = interaction.options.getInteger('x', true);
      const y        = interaction.options.getInteger('y', true);
      const itemName = interaction.options.getString('item', true).toLowerCase().trim();
      const tasa     = interaction.options.getNumber('tasa', true);

      let genResult;
      try {
        genResult = await addResourceGenerator(x, y, itemName, tasa);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/map addgenerator] ${interaction.user.tag}: ${itemName} × ${tasa}/día @ (${x},${y})`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'tile.add_generator', target: `(${x},${y})`, details: { itemName, tasa } });

      const tileDetail = await getTileWithDetails(x, y);
      return interaction.reply({
        content: `✅ Generador añadido: **${genResult.item.display_name}** × **${tasa}**/día en **(${x}, ${y})**.`,
        embeds: [buildTileInfoEmbed(tileDetail)],
      });
    }




    if (sub === 'setspawn') {
      const x = interaction.options.getInteger('x');
      const y = interaction.options.getInteger('y');


      if (x === null && y === null) {
        const current = await getSpawnCoords();
        return interaction.reply({
          content: `📍 Los personajes nuevos aparecen ahora mismo en **(${current.x}, ${current.y})**.`,
        });
      }
      if (x === null || y === null) {
        return interaction.reply({
          content: '❌ Si vas a cambiarla, indica tanto `x` como `y` (o ninguno de los dos, para solo consultar la actual).',
          flags: MessageFlags.Ephemeral,
        });
      }

      try {
        await setSpawnCoords(x, y);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/map setspawn] ${interaction.user.tag} cambió la aparición a (${x},${y})`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'settings.spawn', details: { x, y } });

      return interaction.reply({
        content: `✅ Los personajes nuevos aparecerán ahora en **(${x}, ${y})**. No afecta a los jugadores ya existentes.`,
      });
    }




    if (sub === 'poi-add') {
      const x           = interaction.options.getInteger('x', true);
      const y           = interaction.options.getInteger('y', true);
      const nombre      = interaction.options.getString('nombre', true).trim();
      const descripcion = interaction.options.getString('descripcion');
      const emoji       = interaction.options.getString('emoji') ?? '📍';

      const tileDetail = await getTileWithDetails(x, y);
      if (!tileDetail) {
        return interaction.reply({ content: `❌ No existe ninguna casilla en (${x}, ${y}).`, flags: MessageFlags.Ephemeral });
      }

      const author = await getPlayerByDiscordId(interaction.user.id);

      try {
        await addPointOfInterest(tileDetail.id, { name: nombre, description: descripcion, emoji }, author?.id ?? null);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/map poi-add] ${interaction.user.tag} añadió "${nombre}" @ (${x},${y})`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'tile.poi_add', target: `(${x},${y})`, details: { nombre } });

      const updatedTile = await getTileWithDetails(x, y);
      return interaction.reply({
        content: `✅ **${nombre}** añadido a **(${x}, ${y})**.`,
        embeds: [buildTileInfoEmbed(updatedTile)],
      });
    }




    if (sub === 'temperaturas') {
      const baseMin = interaction.options.getNumber('base_min');
      const baseMax = interaction.options.getNumber('base_max');
      const reroll = interaction.options.getBoolean('nueva_semilla') ?? false;

      await interaction.deferReply();

      const current = await getWorldTemperatureRange();
      let world = current;
      if (baseMin !== null || baseMax !== null) {
        try {
          world = await setWorldTemperatureRange(baseMin ?? current.tempMin, baseMax ?? current.tempMax);
        } catch (err) {
          return interaction.editReply({ content: `❌ ${err.message}` });
        }
      }

      const affected = await regenerateWholeMapTemperatures({ reroll });

      logger.info(`[/map temperaturas] ${interaction.user.tag} recalculó ${affected} casilla(s)${reroll ? ' con semilla nueva' : ''}`);
      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'tile.temperatures', target: null,
        details: { tilesAffected: affected, reroll, baseMin: world.tempMin, baseMax: world.tempMax },
      });

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(COLORS.BLUE)
          .setTitle('🌡️ Temperaturas recalculadas')
          .setDescription(
            `**${affected}** casilla(s) actualizadas.\n` +
            `Casillas sin zona: de **${formatTemperature(world.tempMin)}** a **${formatTemperature(world.tempMax)}**.\n` +
            (reroll ? 'Semilla nueva: el reparto del clima ha cambiado en todo el mapa.' : 'Misma semilla: el reparto del clima se mantiene.')
          )
          .setTimestamp()],
      });
    }

    if (sub === 'poi-remove') {
      const x      = interaction.options.getInteger('x', true);
      const y      = interaction.options.getInteger('y', true);
      const nombre = interaction.options.getString('nombre', true).trim();

      const tileDetail = await getTileWithDetails(x, y);
      if (!tileDetail) {
        return interaction.reply({ content: `❌ No existe ninguna casilla en (${x}, ${y}).`, flags: MessageFlags.Ephemeral });
      }

      try {
        await removePointOfInterest(tileDetail.id, nombre);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/map poi-remove] ${interaction.user.tag} quitó "${nombre}" @ (${x},${y})`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'tile.poi_remove', target: `(${x},${y})`, details: { nombre } });

      const updatedTile = await getTileWithDetails(x, y);
      return interaction.reply({
        content: `✅ **${nombre}** eliminado de **(${x}, ${y})**.`,
        embeds: [buildTileInfoEmbed(updatedTile)],
      });
    }
  },
};
