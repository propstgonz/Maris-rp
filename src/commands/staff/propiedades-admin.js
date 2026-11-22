import { SlashCommandBuilder } from 'discord.js';
import { requireRolepriest } from '../../utils/permissions.js';
import { actorFrom, requireTargetCharacter } from '../../utils/interactionContext.js';
import { propertyTypeChoices } from '../../utils/autocomplete.js';
import { buildSuccessEmbed } from '../../utils/embeds.js';
import { confirmAction, paginate, replyEphemeral, staffAutocomplete, includesText, withDefined } from '../../utils/staffUi.js';
import { getProfile } from '../../services/profileService.js';
import { UserFacingError } from '../../utils/errors.js';
import {
  PROPERTY_CATEGORIES, listTypes, createType, editType, setTypeActive,
  grantProperty, revokeProperty, setLevel, adminTransferProperty, getProperty,
} from '../../services/propertyService.js';

const MAX_CHOICES = 25;
const MAX_NAME = 100;
const MAX_LEVEL = 1000;

const categoryLabel = value => PROPERTY_CATEGORIES.find(c => c.value === value)?.label ?? value;

const typeOption = opt => opt.setName('tipo').setDescription('Tipo de propiedad').setRequired(true).setAutocomplete(true);
const propertyOption = opt => opt.setName('propiedad').setDescription('ID de la propiedad').setRequired(true).setMinValue(1);
const categoryOption = required => opt => opt.setName('categoria').setDescription('Categoría').setRequired(required)
  .addChoices(...PROPERTY_CATEGORIES.map(c => ({ name: c.label, value: c.value })));
const emojiOption = opt => opt.setName('emoji').setDescription('Emoji').setMaxLength(32);
const descriptionOption = opt => opt.setName('descripcion').setDescription('Descripción').setMaxLength(2000);
const levelOption = required => opt => opt.setName('nivel').setDescription('Nivel').setRequired(required).setMinValue(1).setMaxValue(MAX_LEVEL);

async function describe(property) {
  const name = property.name ? ` «${property.name}»` : '';
  const { player } = await getProfile(property.owner_player_id);
  return `${property.emoji ?? '🏠'} **${property.type_display_name}**${name} (nivel ${property.level}) de <@${player.discord_id}>`;
}

async function requireProperty(propertyId) {
  const property = await getProperty(propertyId);
  if (!property) throw new UserFacingError('Esa propiedad no existe.');
  return property;
}

export default {
  permission: 'rolepriest',

  data: new SlashCommandBuilder()
    .setName('propiedades-admin')
    .setDescription('[Rolepriest] Gestiona el catálogo de propiedades y las de los jugadores')
    .addSubcommand(sub => sub
      .setName('tipo-crear')
      .setDescription('Crea un tipo de propiedad')
      .addStringOption(opt => opt.setName('nombre').setDescription('Nombre del tipo').setRequired(true).setMaxLength(191))
      .addStringOption(categoryOption(true))
      .addStringOption(emojiOption)
      .addStringOption(descriptionOption))
    .addSubcommand(sub => sub
      .setName('tipo-editar')
      .setDescription('Edita un tipo de propiedad')
      .addIntegerOption(typeOption)
      .addStringOption(opt => opt.setName('nombre').setDescription('Nombre nuevo').setMaxLength(191))
      .addStringOption(categoryOption(false))
      .addStringOption(emojiOption)
      .addStringOption(descriptionOption))
    .addSubcommand(sub => sub
      .setName('tipo-desactivar')
      .setDescription('Desactiva un tipo de propiedad')
      .addIntegerOption(typeOption))
    .addSubcommand(sub => sub
      .setName('tipo-activar')
      .setDescription('Reactiva un tipo de propiedad')
      .addIntegerOption(typeOption))
    .addSubcommand(sub => sub
      .setName('otorgar')
      .setDescription('Otorga una propiedad a un jugador')
      .addUserOption(opt => opt.setName('jugador').setDescription('Jugador que la recibe').setRequired(true))
      .addIntegerOption(typeOption)
      .addStringOption(opt => opt.setName('nombre').setDescription('Nombre de la propiedad').setMaxLength(191))
      .addIntegerOption(levelOption(false))
      .addStringOption(opt => opt.setName('ubicacion').setDescription('Ubicación').setMaxLength(100)))
    .addSubcommand(sub => sub
      .setName('revocar')
      .setDescription('Revoca una propiedad')
      .addIntegerOption(propertyOption))
    .addSubcommand(sub => sub
      .setName('nivel')
      .setDescription('Fija el nivel de una propiedad')
      .addIntegerOption(propertyOption)
      .addIntegerOption(levelOption(true)))
    .addSubcommand(sub => sub
      .setName('transferir')
      .setDescription('Pasa una propiedad a otro jugador')
      .addIntegerOption(propertyOption)
      .addUserOption(opt => opt.setName('destino').setDescription('Jugador que la recibe').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('catalogo')
      .setDescription('Lista todos los tipos de propiedad, activos o no')),

  autocomplete: staffAutocomplete({
    tipo: async (text, interaction) => {
      const sub = interaction.options.getSubcommand();
      if (sub === 'otorgar' || sub === 'tipo-desactivar') return propertyTypeChoices(text);
      const types = await listTypes({ includeInactive: true });
      return types
        .filter(t => (sub === 'tipo-activar' ? !t.is_active : true) && includesText(text, t.display_name, t.name))
        .slice(0, MAX_CHOICES)
        .map(t => ({ name: `${t.display_name}${t.is_active ? '' : ' (inactivo)'}`.slice(0, MAX_NAME), value: t.id }));
    },
  }),

  async execute(interaction) {
    if (!await requireRolepriest(interaction)) return;

    const sub = interaction.options.getSubcommand();
    const actor = actorFrom(interaction);
    const reply = replyEphemeral(interaction);
    const fields = () => withDefined({
      displayName: interaction.options.getString('nombre'),
      category: interaction.options.getString('categoria'),
      emoji: interaction.options.getString('emoji'),
      description: interaction.options.getString('descripcion'),
    });

    if (sub === 'tipo-crear') {
      const type = await createType(fields(), actor);
      return reply({ embeds: [buildSuccessEmbed('Tipo creado', `${type.emoji ?? '🏠'} **${type.display_name}** (${categoryLabel(type.category)}).`)] });
    }

    if (sub === 'tipo-editar') {
      const type = await editType(interaction.options.getInteger('tipo', true), fields(), actor);
      return reply({ embeds: [buildSuccessEmbed('Tipo editado', `${type.emoji ?? '🏠'} **${type.display_name}** (${categoryLabel(type.category)}).`)] });
    }

    if (sub === 'tipo-desactivar' || sub === 'tipo-activar') {
      const active = sub === 'tipo-activar';
      const type = await setTypeActive(interaction.options.getInteger('tipo', true), active, actor);
      return reply({ embeds: [buildSuccessEmbed(active ? 'Tipo activado' : 'Tipo desactivado', `${type.emoji ?? '🏠'} **${type.display_name}**.`)] });
    }

    if (sub === 'catalogo') {
      const types = await listTypes({ includeInactive: true });
      return paginate(interaction, {
        title: '🏠 Catálogo de propiedades',
        lines: types.map(t => `${t.emoji ?? '🏠'} **${t.display_name}** · ${categoryLabel(t.category)}${t.is_active ? '' : ' · inactivo'}`),
      });
    }

    if (sub === 'otorgar') {
      const player = await requireTargetCharacter(interaction);
      const property = await grantProperty(player.id, interaction.options.getInteger('tipo', true), {
        name: interaction.options.getString('nombre'),
        level: interaction.options.getInteger('nivel') ?? undefined,
        location: interaction.options.getString('ubicacion'),
      }, actor);
      return reply({
        embeds: [buildSuccessEmbed('Propiedad otorgada', `#${property.id} ${property.emoji ?? '🏠'} **${property.type_display_name}** (nivel ${property.level}) para <@${player.discord_id}>.`)],
      });
    }

    const propertyId = interaction.options.getInteger('propiedad', true);
    const property = await requireProperty(propertyId);

    if (sub === 'revocar') {
      const done = await confirmAction(interaction, `Revocar la propiedad #${propertyId}: ${await describe(property)}. No se puede deshacer.`);
      if (!done) return;
      await revokeProperty(propertyId, actor);
      return done({ embeds: [buildSuccessEmbed('Propiedad revocada', `#${propertyId} **${property.type_display_name}** ya no existe.`)] });
    }

    if (sub === 'nivel') {
      const level = interaction.options.getInteger('nivel', true);
      const updated = await setLevel(propertyId, level, actor);
      return reply({ embeds: [buildSuccessEmbed('Nivel fijado', `#${propertyId} **${updated.type_display_name}**: nivel **${updated.level}**.`)] });
    }

    const to = await requireTargetCharacter(interaction, 'destino');
    await adminTransferProperty(propertyId, to.id, actor);
    return reply({
      embeds: [buildSuccessEmbed('Propiedad transferida', `#${propertyId} **${property.type_display_name}** pasa a <@${to.discord_id}>.`)],
    });
  },
};
