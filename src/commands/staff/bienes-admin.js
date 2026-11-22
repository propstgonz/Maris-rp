import { SlashCommandBuilder } from 'discord.js';
import { requireRolepriest } from '../../utils/permissions.js';
import { actorFrom, requireTargetCharacter } from '../../utils/interactionContext.js';
import { goodsTypeChoices, ownGoodsChoices } from '../../utils/autocomplete.js';
import { buildSuccessEmbed } from '../../utils/embeds.js';
import { confirmAction, paginate, replyEphemeral, staffAutocomplete, targetDiscordId, includesText, withDefined } from '../../utils/staffUi.js';
import {
  listTypes, listCategories, createType, editType, setTypeActive, createCategory,
  addGoods, removeGoods, adminTransferGoods,
} from '../../services/goodsService.js';

const MAX_CHOICES = 25;
const MAX_NAME = 100;

const typeOption = (description = 'Tipo de bien') => opt => opt.setName('tipo').setDescription(description).setRequired(true).setAutocomplete(true);
const itemOption = opt => opt.setName('objeto').setDescription('Bien').setRequired(true).setAutocomplete(true);
const quantityOption = opt => opt.setName('cantidad').setDescription('Cantidad').setRequired(true).setMinValue(0.01);
const userOption = (name, description) => opt => opt.setName(name).setDescription(description).setRequired(true);
const categoryOption = opt => opt.setName('categoria').setDescription('Categoría').setAutocomplete(true);
const emojiOption = opt => opt.setName('emoji').setDescription('Emoji').setMaxLength(32);
const descriptionOption = opt => opt.setName('descripcion').setDescription('Descripción').setMaxLength(2000);

function typeChoices(types, text) {
  return types
    .filter(t => includesText(text, t.display_name, t.name))
    .slice(0, MAX_CHOICES)
    .map(t => ({ name: `${t.display_name}${t.is_active ? '' : ' (inactivo)'}`.slice(0, MAX_NAME), value: t.id }));
}

export default {
  permission: 'rolepriest',

  data: new SlashCommandBuilder()
    .setName('bienes-admin')
    .setDescription('[Rolepriest] Gestiona el catálogo de bienes y los inventarios')
    .addSubcommand(sub => sub
      .setName('tipo-crear')
      .setDescription('Crea un tipo de bien')
      .addStringOption(opt => opt.setName('nombre').setDescription('Nombre del bien').setRequired(true).setMaxLength(191))
      .addStringOption(categoryOption)
      .addStringOption(emojiOption)
      .addStringOption(descriptionOption))
    .addSubcommand(sub => sub
      .setName('tipo-editar')
      .setDescription('Edita un tipo de bien')
      .addIntegerOption(typeOption())
      .addStringOption(opt => opt.setName('nombre').setDescription('Nombre nuevo').setMaxLength(191))
      .addStringOption(categoryOption)
      .addStringOption(emojiOption)
      .addStringOption(descriptionOption))
    .addSubcommand(sub => sub
      .setName('tipo-desactivar')
      .setDescription('Desactiva un tipo de bien')
      .addIntegerOption(typeOption()))
    .addSubcommand(sub => sub
      .setName('tipo-activar')
      .setDescription('Reactiva un tipo de bien')
      .addIntegerOption(typeOption()))
    .addSubcommand(sub => sub
      .setName('categoria-crear')
      .setDescription('Crea una categoría de bienes')
      .addStringOption(opt => opt.setName('nombre').setDescription('Nombre de la categoría').setRequired(true).setMaxLength(191))
      .addStringOption(emojiOption)
      .addStringOption(descriptionOption))
    .addSubcommand(sub => sub
      .setName('dar')
      .setDescription('Da bienes a un jugador')
      .addUserOption(userOption('jugador', 'Jugador que los recibe'))
      .addIntegerOption(itemOption)
      .addNumberOption(quantityOption))
    .addSubcommand(sub => sub
      .setName('quitar')
      .setDescription('Quita bienes a un jugador')
      .addUserOption(userOption('jugador', 'Jugador que los pierde'))
      .addIntegerOption(itemOption)
      .addNumberOption(quantityOption))
    .addSubcommand(sub => sub
      .setName('transferir')
      .setDescription('Pasa bienes de un jugador a otro')
      .addUserOption(userOption('origen', 'Jugador que los entrega'))
      .addUserOption(userOption('destino', 'Jugador que los recibe'))
      .addIntegerOption(itemOption)
      .addNumberOption(quantityOption))
    .addSubcommand(sub => sub
      .setName('catalogo')
      .setDescription('Lista todos los tipos de bien, activos o no')),

  autocomplete: staffAutocomplete({
    categoria: async text => (await listCategories())
      .filter(c => includesText(text, c.display_name, c.name))
      .slice(0, MAX_CHOICES)
      .map(c => ({ name: c.display_name.slice(0, MAX_NAME), value: c.display_name })),
    tipo: async (text, interaction) => {
      const types = await listTypes({ includeInactive: true });
      return typeChoices(interaction.options.getSubcommand() === 'tipo-activar' ? types.filter(t => !t.is_active) : types, text);
    },
    objeto: (text, interaction) => {
      const sub = interaction.options.getSubcommand();
      if (sub === 'dar') return goodsTypeChoices(text);
      const owner = targetDiscordId(interaction, sub === 'transferir' ? 'origen' : 'jugador');
      return owner ? ownGoodsChoices(owner, text) : [];
    },
  }),

  async execute(interaction) {
    if (!await requireRolepriest(interaction)) return;

    const sub = interaction.options.getSubcommand();
    const actor = actorFrom(interaction);
    const reply = replyEphemeral(interaction);
    const fields = () => withDefined({
      displayName: interaction.options.getString('nombre'),
      categoryName: interaction.options.getString('categoria'),
      emoji: interaction.options.getString('emoji'),
      description: interaction.options.getString('descripcion'),
    });

    if (sub === 'tipo-crear') {
      const type = await createType(fields(), actor);
      return reply({ embeds: [buildSuccessEmbed('Bien creado', `${type.emoji} **${type.display_name}** (${type.category ?? 'sin categoría'}).`)] });
    }

    if (sub === 'tipo-editar') {
      const type = await editType(interaction.options.getInteger('tipo', true), fields(), actor);
      return reply({ embeds: [buildSuccessEmbed('Bien editado', `${type.emoji} **${type.display_name}** (${type.category ?? 'sin categoría'}).`)] });
    }

    if (sub === 'tipo-desactivar' || sub === 'tipo-activar') {
      const active = sub === 'tipo-activar';
      const type = await setTypeActive(interaction.options.getInteger('tipo', true), active, actor);
      return reply({ embeds: [buildSuccessEmbed(active ? 'Bien activado' : 'Bien desactivado', `${type.emoji} **${type.display_name}**.`)] });
    }

    if (sub === 'categoria-crear') {
      const category = await createCategory(fields(), actor);
      return reply({ embeds: [buildSuccessEmbed('Categoría creada', `${category.emoji} **${category.displayName}**.`)] });
    }

    if (sub === 'catalogo') {
      const types = await listTypes({ includeInactive: true });
      return paginate(interaction, {
        title: '📦 Catálogo de bienes',
        lines: types.map(t => `${t.emoji} **${t.display_name}** · ${t.category ?? 'sin categoría'}${t.is_active ? '' : ' · inactivo'}`),
      });
    }

    const itemId = interaction.options.getInteger('objeto', true);
    const quantity = interaction.options.getNumber('cantidad', true);

    if (sub === 'dar') {
      const player = await requireTargetCharacter(interaction);
      const total = await addGoods(player.id, itemId, quantity, actor);
      return reply({ embeds: [buildSuccessEmbed('Bienes entregados', `<@${player.discord_id}> recibe **${quantity}**. Ahora tiene **${total}**.`)] });
    }

    if (sub === 'quitar') {
      const player = await requireTargetCharacter(interaction);
      const type = (await listTypes({ includeInactive: true })).find(t => t.id === itemId);
      const done = await confirmAction(interaction, `Quitar **${quantity}** × ${type?.display_name ?? `bien #${itemId}`} a <@${player.discord_id}>. No se puede deshacer.`);
      if (!done) return;
      const left = await removeGoods(player.id, itemId, quantity, actor);
      return done({ embeds: [buildSuccessEmbed('Bienes retirados', `<@${player.discord_id}> conserva **${left}**.`)] });
    }

    const from = await requireTargetCharacter(interaction, 'origen');
    const to = await requireTargetCharacter(interaction, 'destino');
    const moved = await adminTransferGoods(from.id, to.id, itemId, quantity, actor);
    return reply({
      embeds: [buildSuccessEmbed('Bienes transferidos', `**${moved.quantity}** × ${moved.displayName} pasan de <@${from.discord_id}> a <@${to.discord_id}>.`)],
    });
  },
};
