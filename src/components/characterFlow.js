import {
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags,
} from 'discord.js';
import { getOrCreatePlayer } from '../services/playerService.js';
import { buildCustomId } from '../utils/componentAuth.js';
import { UserFacingError } from '../utils/errors.js';

export const CHARACTER_NS = 'pj';

const FIELDS = [
  { id: 'nombre_completo', label: 'Nombre completo',            max: 100, required: true,  placeholder: 'Ej. Doña Muza Niyazova' },
  { id: 'pais_origen',     label: 'País o región de origen',    max: 56,  required: true,  placeholder: 'Ej. Galicia' },
  { id: 'nacionalidad',    label: 'Gentilicio',                 max: 56,  required: true,  placeholder: 'Ej. gallega' },
  { id: 'religion',        label: 'Religión (opcional)',        max: 56,  required: false, placeholder: 'Ej. ortodoxa' },
  { id: 'descripcion',     label: 'Descripción (opcional)',     max: 50,  required: false, placeholder: 'Hasta 50 caracteres' },
];

export function buildCharacterModal(discordId) {
  const modal = new ModalBuilder()
    .setCustomId(buildCustomId({ ns: CHARACTER_NS, action: 'create', owner: discordId }))
    .setTitle('Crea tu personaje');

  modal.addComponents(
    ...FIELDS.map(f =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(f.id)
          .setLabel(f.label)
          .setStyle(f.id === 'descripcion' ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setPlaceholder(f.placeholder)
          .setRequired(f.required)
          .setMaxLength(f.max)
      )
    )
  );

  return modal;
}

export async function handleCharacterComponent(interaction) {
  const read = (id) => interaction.fields.getTextInputValue(id).trim();

  const nombreCompleto = read('nombre_completo');
  const paisOrigen     = read('pais_origen');
  const nacionalidad   = read('nacionalidad');
  const religion       = read('religion')    || null;
  const descripcion    = read('descripcion') || null;

  if (!nombreCompleto || !paisOrigen || !nacionalidad) {
    throw new UserFacingError('El nombre completo, el país de origen y la nacionalidad no pueden estar vacíos.');
  }

  await getOrCreatePlayer(interaction.user.id, interaction.user.username);

  const { createCharacterAndBuildEmbed } = await import('../commands/player/personaje.js');
  const embed = await createCharacterAndBuildEmbed(interaction, {
    nombreCompleto, paisOrigen, nacionalidad, religion, descripcion,
    avatarFilename: null,
  });

  await interaction.reply({ embeds: [embed] });

  return interaction.followUp({
    content: 'Para ponerle foto a tu personaje, usa `/personaje foto`. Para fijar su género, usa `/personaje genero`.',
    flags: MessageFlags.Ephemeral,
  });
}
