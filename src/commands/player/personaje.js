import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getOrCreatePlayer }   from '../../services/playerService.js';
import {
  createCharacter,
  updateCharacterIdentity,
  surrenderCharacter,
  getCharacterHistory,
  getCharacterCreationCooldownHours,
  setCharacterCreationCooldownHours,
}                               from '../../services/characterLifecycleService.js';
import { requireCharacter, requireRolepriest, resolveGuild } from '../../utils/permissions.js';
import { COLORS }              from '../../utils/embeds.js';
import { buildAssetUrl }       from '../../utils/publicUrl.js';
import {
  validateImageAttachment,
  downloadAndSaveImage,
  ALLOWED_IMAGE_TYPES_LABEL,
}                               from '../../utils/imageUpload.js';
import { config }              from '../../utils/permissions.js';
import { originPhrase, genderLabel, GENDER_CHOICES } from '../../utils/text.js';
import { buildCharacterModal } from '../../components/characterFlow.js';
import FICHA      from '../../subcommands/personaje/stats.js';
import INVENTARIO from '../../subcommands/personaje/inventario.js';
import FOTO       from '../../subcommands/personaje/setavatar.js';
import ALERTAS    from '../../subcommands/personaje/alertas.js';
import GENERO     from '../../subcommands/personaje/genero.js';
import logger                  from '../../utils/logger.js';

const AVATARS_WRITE_PATH = (config.images?.avatarsHostPath ?? '/app/avatars')
  .replace(/\/$/, '');

export default {
  data: new SlashCommandBuilder()
    .setName('personaje')
    .setDescription('Gestiona tu personaje de rol')

    .addSubcommand(sub =>
      sub
        .setName('crear')
        .setDescription('Crea tu personaje (nombre, país, nacionalidad; religión/género/descripción/foto opcionales)')
        .addStringOption(opt =>
          opt
            .setName('nombre_completo')
            .setDescription('Nombre completo. Si omites las tres obligatorias, se abre un formulario')
            .setRequired(false)
            .setMaxLength(100)
        )
        .addStringOption(opt =>
          opt
            .setName('pais_origen')
            .setDescription('País o región de origen de tu personaje (ej. Galicia)')
            .setRequired(false)
            .setMaxLength(56)
        )
        .addStringOption(opt =>
          opt
            .setName('nacionalidad')
            .setDescription('Gentilicio de tu personaje (ej. gallega)')
            .setRequired(false)
            .setMaxLength(56)
        )
        .addStringOption(opt =>
          opt
            .setName('religion')
            .setDescription('Creencia/religión de tu personaje (opcional)')
            .setRequired(false)
            .setMaxLength(56)
        )
        .addStringOption(opt =>
          opt
            .setName('descripcion')
            .setDescription('Descripción corta de tu personaje, hasta 50 carácteres (opcional)')
            .setRequired(false)
            .setMaxLength(50)
        )
        .addStringOption(opt =>
          opt
            .setName('genero')
            .setDescription('Género de tu personaje (opcional — también se puede fijar luego con /personaje genero)')
            .setRequired(false)
            .addChoices(...GENDER_CHOICES)
        )
        .addAttachmentOption(opt =>
          opt
            .setName('foto')
            .setDescription(`Foto de tu personaje (${ALLOWED_IMAGE_TYPES_LABEL} · máx. 2 MB, opcional)`)
            .setRequired(false)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('rendirse')
        .setDescription('Renuncia AHORA a tu personaje muerto (en vez de esperar 7 días) para poder crear uno nuevo')
        .addStringOption(opt =>
          opt
            .setName('confirmar')
            .setDescription('Escribe RENDIRSE para confirmar — es irreversible')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('editar')
        .setDescription('[Staff] Corrige nombre, país, nacionalidad, religión, género, descripción y/o foto de un personaje')
        .addUserOption(opt =>
          opt.setName('jugador').setDescription('Jugador cuyo personaje editar').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('nombre_completo').setDescription('Nuevo nombre completo').setRequired(false).setMaxLength(100)
        )
        .addStringOption(opt =>
          opt.setName('pais_origen').setDescription('Nuevo país o región de origen').setRequired(false).setMaxLength(56)
        )
        .addStringOption(opt =>
          opt.setName('nacionalidad').setDescription('Nuevo gentilicio').setRequired(false).setMaxLength(56)
        )
        .addStringOption(opt =>
          opt.setName('religion').setDescription('Nueva creencia/religión').setRequired(false).setMaxLength(56)
        )
        .addStringOption(opt =>
          opt.setName('descripcion').setDescription('Nueva descripción, hasta 50 carácteres').setRequired(false).setMaxLength(50)
        )
        .addStringOption(opt =>
          opt.setName('genero').setDescription('Nuevo género').setRequired(false).addChoices(...GENDER_CHOICES)
        )
        .addAttachmentOption(opt =>
          opt.setName('foto').setDescription(`Nueva foto (${ALLOWED_IMAGE_TYPES_LABEL} · máx. 2 MB)`).setRequired(false)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('historial')
        .setDescription('[Staff] Nombres de personaje que ha tenido un usuario a lo largo del tiempo')
        .addUserOption(opt =>
          opt.setName('jugador').setDescription('Usuario de Discord a consultar').setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('cooldown')
        .setDescription('[Staff] Horas de espera entre quedarse sin personaje y poder crear uno nuevo')
        .addNumberOption(opt =>
          opt.setName('horas').setDescription('Nuevo valor en horas (0 = sin espera). Omite para solo consultar el actual.').setRequired(false).setMinValue(0)
        )
    )

    .addSubcommand(FICHA.build)
    .addSubcommand(INVENTARIO.build)
    .addSubcommand(FOTO.build)
    .addSubcommand(ALERTAS.build)
    .addSubcommand(GENERO.build),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    const ABSORBED = { ficha: FICHA, inventario: INVENTARIO, foto: FOTO, alertas: ALERTAS, genero: GENERO };
    if (ABSORBED[sub]) return ABSORBED[sub].execute(interaction);

    if (sub === 'crear') {
      const rawNombre = interaction.options.getString('nombre_completo')?.trim();
      const rawPais   = interaction.options.getString('pais_origen')?.trim();
      const rawNac    = interaction.options.getString('nacionalidad')?.trim();
      const religion       = interaction.options.getString('religion')?.trim()    || null;
      const descripcion    = interaction.options.getString('descripcion')?.trim() || null;
      const genero         = interaction.options.getString('genero');
      const foto           = interaction.options.getAttachment('foto') ?? null;

      if (!rawNombre && !rawPais && !rawNac && !foto) {
        return interaction.showModal(buildCharacterModal(interaction.user.id));
      }

      const nombreCompleto = rawNombre ?? '';
      const paisOrigen     = rawPais ?? '';
      const nacionalidad   = rawNac ?? '';

      if (!nombreCompleto || !paisOrigen || !nacionalidad) {
        return interaction.reply({
          content: foto
            ? '❌ Con una foto adjunta hay que dar también nombre completo, país de origen y nacionalidad (los modales de Discord no admiten imágenes).'
            : '❌ El nombre completo, el país de origen y la nacionalidad no pueden estar vacíos.',
          flags: MessageFlags.Ephemeral,
        });
      }

      await getOrCreatePlayer(interaction.user.id, interaction.user.username);

      let avatarFilename = null;
      if (foto) {
        const validation = validateImageAttachment(foto);
        if (!validation.ok) {
          return interaction.reply({ content: `❌ ${validation.error}`, flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
          const { filename } = await downloadAndSaveImage(
            foto, validation.ext, AVATARS_WRITE_PATH, `player_${interaction.user.id}`
          );
          avatarFilename = `avatars/${filename}`;
        } catch (err) {
          return interaction.editReply({ content: `❌ Error al guardar la foto: ${err.message}` });
        }
      }

      let embed;
      try {
        embed = await createCharacterAndBuildEmbed(interaction, {
          nombreCompleto, paisOrigen, nacionalidad, religion, descripcion, genero, avatarFilename,
        });
      } catch (err) {
        const payload = { content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral };
        return foto ? interaction.editReply(payload) : interaction.reply(payload);
      }

      const payload = { embeds: [embed] };
      if (foto) {
        await interaction.deleteReply().catch(() => {});
        return interaction.followUp(payload);
      }
      return interaction.reply(payload);
    }

    if (sub === 'rendirse') {
      if (!await requireCharacter(interaction)) return;

      const confirmacion = interaction.options.getString('confirmar', true).trim().toUpperCase();
      if (confirmacion !== 'RENDIRSE') {
        return interaction.reply({
          content: '❌ Confirmación incorrecta. Escribe exactamente `RENDIRSE` (en mayúsculas) en `confirmar` si de verdad quieres renunciar a tu personaje.',
          flags: MessageFlags.Ephemeral,
        });
      }

      let player;
      try {
        player = await surrenderCharacter(interaction.user.id, interaction.client);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/personaje rendirse] ${interaction.user.tag} renunció a "${player.character_name}"`);

      const embed = new EmbedBuilder()
        .setColor(COLORS.GREY)
        .setTitle(`🏳️ Has renunciado a ${player.character_name ?? player.username}`)
        .setDescription(
          'Tu personaje y todos sus datos (inventario, efectos) se han borrado. ' +
          'Su nombre queda para siempre en tu historial (`/personaje historial`).\n\n' +
          'Ya puedes usar `/personaje crear` para empezar una historia nueva cuando quieras.'
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'editar') {
      if (!await requireRolepriest(interaction)) return;

      const targetUser     = interaction.options.getUser('jugador', true);
      const nombreCompleto = interaction.options.getString('nombre_completo')?.trim() || undefined;
      const paisOrigen     = interaction.options.getString('pais_origen')?.trim()     || undefined;
      const nacionalidad   = interaction.options.getString('nacionalidad')?.trim()    || undefined;
      const religion       = interaction.options.getString('religion')?.trim()        || undefined;
      const descripcion    = interaction.options.getString('descripcion')?.trim()     || undefined;
      const genero         = interaction.options.getString('genero') ?? undefined;
      const foto           = interaction.options.getAttachment('foto') ?? null;

      if (!nombreCompleto && !paisOrigen && !nacionalidad && !religion && !descripcion && !genero && !foto) {
        return interaction.reply({
          content: '❌ Especifica al menos un campo a editar: `nombre_completo`, `pais_origen`, `nacionalidad`, `religion`, `descripcion`, `genero` o `foto`.',
          flags: MessageFlags.Ephemeral,
        });
      }

      let avatarFilename;
      if (foto) {
        const validation = validateImageAttachment(foto);
        if (!validation.ok) {
          return interaction.reply({ content: `❌ ${validation.error}`, flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
          const { filename } = await downloadAndSaveImage(
            foto, validation.ext, AVATARS_WRITE_PATH, `player_${targetUser.id}`
          );
          avatarFilename = `avatars/${filename}`;
        } catch (err) {
          return interaction.editReply({ content: `❌ Error al guardar la foto: ${err.message}` });
        }
      }

      let player;
      try {
        player = await updateCharacterIdentity(targetUser.id, {
          fullName:      nombreCompleto,
          nationality:   nacionalidad,
          originCountry: paisOrigen,
          religion,
          description:   descripcion,
          gender:        genero,
          avatarFilename,
        });
      } catch (err) {
        const payload = { content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral };
        return foto ? interaction.editReply(payload) : interaction.reply(payload);
      }

      logger.info(`[/personaje editar] ${interaction.user.tag} → ${targetUser.tag}: "${player.character_name}"`);

      const embed = new EmbedBuilder()
        .setColor(COLORS.BLUE)
        .setTitle(`✏️ Personaje editado: ${player.character_name}`)
        .addFields(
          { name: '👤 Jugador', value: `<@${targetUser.id}>`,                                     inline: true },
          { name: '🌍 Origen',  value: originPhrase(player.nationality, player.origin_country),    inline: true }
        );
      if (player.religion)    embed.addFields({ name: '🙏 Religión',    value: player.religion,               inline: true });
      if (player.gender)      embed.addFields({ name: '⚧️ Género',      value: genderLabel(player.gender),    inline: true });
      if (player.description) embed.addFields({ name: '📝 Descripción', value: player.description,            inline: false });
      embed
        .setFooter({ text: `Editado por ${interaction.user.tag}` })
        .setTimestamp();

      const avatarUrl = buildAssetUrl(player.avatar_filename, '/personaje editar');
      if (avatarUrl) embed.setThumbnail(avatarUrl);

      const payload = { embeds: [embed] };
      if (foto) {
        await interaction.deleteReply().catch(() => {});
        return interaction.followUp(payload);
      }
      return interaction.reply(payload);
    }

    if (sub === 'historial') {
      if (!await requireRolepriest(interaction)) return;

      const targetUser = interaction.options.getUser('jugador', true);
      const history = await getCharacterHistory(targetUser.id);

      const embed = new EmbedBuilder()
        .setColor(COLORS.BLUE)
        .setTitle(`📜 Historial de personajes de ${targetUser.tag}`)
        .setTimestamp();

      if (history.length === 0) {
        embed.setDescription('*Este usuario nunca ha creado un personaje.*');
      } else {
        embed.setDescription(
          history
            .map((h, i) => `${i === 0 ? '🟢' : '⚪'} **${h.character_name}** — ${h.created_at}`)
            .join('\n')
        );
        embed.setFooter({ text: `${history.length} personaje${history.length !== 1 ? 's' : ''} en total` });
      }

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'cooldown') {
      if (!await requireRolepriest(interaction)) return;

      const horas = interaction.options.getNumber('horas');

      if (horas !== null) {
        try {
          await setCharacterCreationCooldownHours(horas);
        } catch (err) {
          return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
        }
        logger.info(`[/personaje cooldown] ${interaction.user.tag} fijó el cooldown de creación a ${horas}h`);
      }

      const actual = await getCharacterCreationCooldownHours();
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.BLUE)
            .setTitle('⏳ Cooldown de creación de personaje')
            .setDescription(
              actual > 0
                ? `Ahora mismo hay que esperar **${actual}h** desde que un jugador se queda sin personaje (permadeath, rendirse, o gracia de 7 días vencida) hasta poder usar \`/personaje crear\` de nuevo.`
                : 'Ahora mismo está **desactivado** — se puede crear un personaje nuevo al instante en cuanto el anterior termina.'
            )
            .setFooter({ text: horas !== null ? `Cambiado por ${interaction.user.tag}` : 'Solo consulta — nada cambiado' })
            .setTimestamp(),
        ],
      });
    }
  },
};

export async function createCharacterAndBuildEmbed(interaction, {
  nombreCompleto, paisOrigen, nacionalidad, religion, descripcion, genero = null, avatarFilename,
}) {
  await createCharacter(interaction.client, resolveGuild(interaction), interaction.user.id, {
    fullName:      nombreCompleto,
    nationality:   nacionalidad,
    originCountry: paisOrigen,
    religion,
    description:   descripcion,
    gender:        genero,
    avatarFilename,
  });

  logger.info(`[/personaje crear] ${interaction.user.tag} → "${nombreCompleto}" (${nacionalidad}, ${paisOrigen})`);

  const embed = new EmbedBuilder()
    .setColor(COLORS.GREEN)
    .setTitle(`✅ Personaje creado: ${nombreCompleto}`)
    .setDescription(
      `Bienvenido a **${nombreCompleto}**, ${originPhrase(nacionalidad, paisOrigen)}.\n` +
      `A partir de ahora puedes usar el resto de comandos del bot.`
    )
    .addFields(
      { name: '👤 Jugador', value: `<@${interaction.user.id}>`,       inline: true },
      { name: '🌍 Origen',  value: `${paisOrigen} (${nacionalidad})`, inline: true }
    );
  if (religion)    embed.addFields({ name: '🙏 Religión',    value: religion,           inline: true });
  if (genero)      embed.addFields({ name: '⚧️ Género',      value: genderLabel(genero), inline: true });
  if (descripcion) embed.addFields({ name: '📝 Descripción', value: descripcion,        inline: false });
  embed
    .setFooter({ text: 'Usa /ayuda para la guía rápida — o escríbeme por MD para rolear directamente con Staff' })
    .setTimestamp();

  const avatarUrl = avatarFilename ? buildAssetUrl(avatarFilename, '/personaje crear') : null;
  if (avatarUrl) embed.setThumbnail(avatarUrl);

  return embed;
}
