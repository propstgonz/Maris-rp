import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import * as profileService from '../../services/profileService.js';
import { getCharacterHistory } from '../../services/characterLifecycleService.js';
import { startCharacterCreation } from '../../components/characterFlow.js';
import { actorFrom, callerIsRolepriest, requireLivingCharacter } from '../../utils/interactionContext.js';
import { UserFacingError } from '../../utils/errors.js';
import { COLORS, buildSuccessEmbed, clip, formatDate } from '../../utils/embeds.js';
import { buildAssetUrl } from '../../utils/publicUrl.js';
import { config } from '../../utils/permissions.js';
import {
  ALLOWED_IMAGE_TYPES_LABEL, MAX_IMAGE_SIZE_BYTES, validateImageAttachment, downloadAndSaveImage,
} from '../../utils/imageUpload.js';

const AVATARS_WRITE_PATH = (config.images?.avatarsHostPath ?? '/app/avatars').replace(/\/$/, '');
const HISTORY_LIMIT = 25;

async function setPhoto(interaction) {
  const player = await requireLivingCharacter(interaction.user.id);
  const attachment = interaction.options.getAttachment('imagen', true);
  const validation = validateImageAttachment(attachment, MAX_IMAGE_SIZE_BYTES);
  if (!validation.ok) throw new UserFacingError(validation.error);
  if (typeof profileService.setAvatar !== 'function') {
    throw new UserFacingError('Cambiar la foto todavía no está disponible.');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { filename } = await downloadAndSaveImage(attachment, validation.ext, AVATARS_WRITE_PATH, `player_${interaction.user.id}`);
  const relative = `avatars/${filename}`;
  await profileService.setAvatar(player.id, relative, actorFrom(interaction));

  const embed = buildSuccessEmbed('Foto actualizada');
  const url = buildAssetUrl(relative, '/personaje foto');
  if (url) embed.setThumbnail(url);
  return interaction.editReply({ embeds: [embed] });
}

async function showHistory(interaction) {
  const user = interaction.options.getUser('jugador') ?? interaction.user;
  if (user.id !== interaction.user.id && !await callerIsRolepriest(interaction)) {
    throw new UserFacingError('Solo puedes consultar tu propio historial.');
  }
  const history = await getCharacterHistory(user.id);
  const embed = new EmbedBuilder().setColor(COLORS.BLUE).setTitle('📜 Historial de personajes');
  embed.setDescription(history.length === 0
    ? 'Todavía no hay personajes en el historial.'
    : history.slice(0, HISTORY_LIMIT).map(h => `• **${clip(h.character_name, 100)}** — ${formatDate(h.created_at)}`).join('\n'));
  if (history.length > HISTORY_LIMIT) embed.setFooter({ text: `Mostrando los ${HISTORY_LIMIT} más recientes de ${history.length}` });
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

export default {
  data: new SlashCommandBuilder()
    .setName('personaje')
    .setDescription('Crea y gestiona tu personaje')
    .addSubcommand(sub => sub
      .setName('crear')
      .setDescription('Crea tu personaje: nombre, edad, género y raza'))
    .addSubcommand(sub => sub
      .setName('foto')
      .setDescription('Cambia la foto de tu personaje')
      .addAttachmentOption(opt => opt
        .setName('imagen')
        .setDescription(`Imagen (${ALLOWED_IMAGE_TYPES_LABEL} · máx. 2 MB)`)
        .setRequired(true)))
    .addSubcommand(sub => sub
      .setName('historial')
      .setDescription('Nombres de los personajes que has tenido')
      .addUserOption(opt => opt.setName('jugador').setDescription('[Rolepriest] Ver el de otro jugador').setRequired(false))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'crear') return startCharacterCreation(interaction);
    if (sub === 'foto') return setPhoto(interaction);
    return showHistory(interaction);
  },
};
