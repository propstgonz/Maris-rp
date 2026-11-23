import { MessageFlags } from 'discord.js';
import { callerIsRolepriest } from './interactionContext.js';

export { confirmAction } from '../components/confirm.js';
export { paginate } from './paginate.js';

export function replyEphemeral(interaction) {
  return payload => interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

export function staffAutocomplete(handlers) {
  return async interaction => {
    if (!await callerIsRolepriest(interaction)) return interaction.respond([]);
    const focused = interaction.options.getFocused(true);
    const handler = handlers[focused.name];
    return interaction.respond(handler ? await handler(focused.value, interaction) : []);
  };
}

export function targetDiscordId(interaction, optionName = 'jugador') {
  return interaction.options.get(optionName)?.value ?? null;
}

export function includesText(text, ...values) {
  const needle = String(text ?? '').toLowerCase();
  return values.some(v => String(v ?? '').toLowerCase().includes(needle));
}

export function withDefined(entries) {
  return Object.fromEntries(Object.entries(entries).filter(([, v]) => v !== null && v !== undefined));
}
