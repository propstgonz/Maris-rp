

















import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType } from 'discord.js';
import { listCategories, createAndRegisterCategory } from '../../services/modmailCategoryService.js';
import { requireRolepriest } from '../../utils/permissions.js';
import { COLORS } from '../../utils/embeds.js';
import logger from '../../utils/logger.js';
import { logAction } from '../../services/auditLogService.js';

const MAX_CHANNELS_PER_CATEGORY = 50;

export default {
  data: new SlashCommandBuilder()
    .setName('modmail-categoria')
    .setDescription('[Staff] Gestiona las categorías donde se crean los canales privados de personaje')
    .addSubcommand(sub =>
      sub
        .setName('crear')
        .setDescription('Crea y registra una categoría nueva para repartir canales privados')
        .addStringOption(opt =>
          opt.setName('nombre').setDescription('Nombre de la categoría en Discord').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('listar').setDescription('Lista las categorías registradas y cuántos canales tiene cada una')
    ),


  async execute(interaction) {
    if (!await requireRolepriest(interaction)) return;
    const sub = interaction.options.getSubcommand();
    return sub === 'listar' ? handleListar(interaction) : handleCrear(interaction);
  },
};

async function handleListar(interaction) {
  const rows = await listCategories();
  if (rows.length === 0) {
    return interaction.reply({
      content: 'Todavía no hay ninguna categoría de modmail registrada. Usa `/modmail-categoria crear` para dar de alta la primera.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { guild } = interaction;
  const lines = [];
  for (const row of rows) {
    const category = await guild.channels.fetch(row.discord_category_id).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) {
      lines.push(`❌ \`${row.discord_category_id}\` — ya no existe en Discord`);
      continue;
    }
    const count = guild.channels.cache.filter(c => c.parentId === category.id).size;
    lines.push(`**#${category.name}** — ${count}/${MAX_CHANNELS_PER_CATEGORY}${count >= MAX_CHANNELS_PER_CATEGORY ? ' 🔴 LLENA' : ''}`);
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.BLUE)
    .setTitle('📂 Categorías de modmail')
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Los canales nuevos van siempre a la primera con hueco, por orden de registro.' });

  return interaction.editReply({ embeds: [embed] });
}

async function handleCrear(interaction) {
  const nombre = interaction.options.getString('nombre', true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let category, clonedPermissions;
  try {
    ({ category, clonedPermissions } = await createAndRegisterCategory(interaction.guild, nombre));
  } catch (err) {
    return interaction.editReply(`❌ ${err.message}`);
  }

  logger.info(`[/modmail-categoria] ${interaction.user.tag} registró la categoría "#${category.name}" (${category.id})`);
  logAction({
    source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
    action: 'modmail.category_created', target: category.id, details: { name: category.name },
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.GREEN)
    .setTitle('📂 Categoría registrada')
    .setDescription(
      `**#${category.name}** ya está lista para recibir canales privados de personaje.` +
      (clonedPermissions
        ? ' Se clonaron los permisos de la última categoría registrada.'
        : ' ⚠️ No había ninguna categoría anterior de la que copiar permisos — revísalos a mano en Discord antes de que se use.')
    );

  return interaction.editReply({ embeds: [embed] });
}
