import { SlashCommandBuilder } from 'discord.js';
import { requireRolepriest } from '../../utils/permissions.js';
import { actorFrom, requireTargetCharacter } from '../../utils/interactionContext.js';
import { ownNpcNameChoices } from '../../utils/autocomplete.js';
import { buildSuccessEmbed } from '../../utils/embeds.js';
import { confirmAction, replyEphemeral, staffAutocomplete, targetDiscordId } from '../../utils/staffUi.js';
import { addNpcs, removeNpcs, adminTransferNpcs } from '../../services/npcHoldingService.js';

const playerOption = (name, description) => opt => opt.setName(name).setDescription(description).setRequired(true);
const nameOption = autocomplete => opt => opt.setName('nombre').setDescription('Nombre del NPC').setRequired(true).setMaxLength(80).setAutocomplete(autocomplete);
const countOption = opt => opt.setName('cantidad').setDescription('Cuántos NPC').setRequired(true).setMinValue(1).setMaxValue(50);

export default {
  permission: 'rolepriest',

  data: new SlashCommandBuilder()
    .setName('npcs-admin')
    .setDescription('[Rolepriest] Gestiona los NPC de un jugador')
    .addSubcommand(sub => sub
      .setName('alta')
      .setDescription('Da de alta NPC a un jugador')
      .addUserOption(playerOption('jugador', 'Jugador que los recibe'))
      .addStringOption(nameOption(false))
      .addIntegerOption(countOption))
    .addSubcommand(sub => sub
      .setName('baja')
      .setDescription('Da de baja NPC de un jugador')
      .addUserOption(playerOption('jugador', 'Jugador que los pierde'))
      .addStringOption(nameOption(true))
      .addIntegerOption(countOption))
    .addSubcommand(sub => sub
      .setName('transferir')
      .setDescription('Pasa NPC de un jugador a otro')
      .addUserOption(playerOption('origen', 'Jugador que los entrega'))
      .addUserOption(playerOption('destino', 'Jugador que los recibe'))
      .addStringOption(nameOption(true))
      .addIntegerOption(countOption)),

  autocomplete: staffAutocomplete({
    nombre: (text, interaction) => {
      const owner = targetDiscordId(interaction, interaction.options.getSubcommand() === 'transferir' ? 'origen' : 'jugador');
      return owner ? ownNpcNameChoices(owner, text) : [];
    },
  }),

  async execute(interaction) {
    if (!await requireRolepriest(interaction)) return;

    const sub = interaction.options.getSubcommand();
    const actor = actorFrom(interaction);
    const name = interaction.options.getString('nombre', true);
    const count = interaction.options.getInteger('cantidad', true);

    if (sub === 'alta') {
      const player = await requireTargetCharacter(interaction);
      const total = await addNpcs(player.id, name, count, actor);
      return replyEphemeral(interaction)({
        embeds: [buildSuccessEmbed('NPC dados de alta', `<@${player.discord_id}> recibe **${count}** × ${name}. Ahora tiene **${total}**.`)],
      });
    }

    if (sub === 'baja') {
      const player = await requireTargetCharacter(interaction);
      const done = await confirmAction(interaction, `Dar de baja **${count}** × ${name} de <@${player.discord_id}>. No se puede deshacer.`);
      if (!done) return;
      const total = await removeNpcs(player.id, name, count, actor);
      return done({ embeds: [buildSuccessEmbed('NPC dados de baja', `<@${player.discord_id}> conserva **${total}** × ${name}.`)] });
    }

    const from = await requireTargetCharacter(interaction, 'origen');
    const to = await requireTargetCharacter(interaction, 'destino');
    await adminTransferNpcs(from.id, to.id, name, count, actor);
    return replyEphemeral(interaction)({
      embeds: [buildSuccessEmbed('NPC transferidos', `**${count}** × ${name} pasan de <@${from.discord_id}> a <@${to.discord_id}>.`)],
    });
  },
};
