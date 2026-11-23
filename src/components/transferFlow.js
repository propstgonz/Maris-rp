import { EmbedBuilder } from 'discord.js';
import { createRequest } from '../services/consentService.js';
import { listGrouped } from '../services/npcHoldingService.js';
import { listInventory } from '../services/goodsService.js';
import { getProperty } from '../services/propertyService.js';
import { UserFacingError } from '../utils/errors.js';
import { requireLivingCharacter } from '../utils/interactionContext.js';
import { COLORS, E, buildSuccessEmbed, clip, formatNumber } from '../utils/embeds.js';
import { confirmAction } from './confirm.js';
import { notifyRecipient, requestLine } from './consentFlow.js';

const SCAN_PAGE_SIZE = 100;

async function findInPages(fetchPage, predicate) {
  for (let page = 1; ; page++) {
    const { rows, total } = await fetchPage(page);
    const hit = rows.find(predicate);
    if (hit) return hit;
    if (page * SCAN_PAGE_SIZE >= total) return null;
  }
}

async function resolveTarget(interaction, user) {
  if (user.bot) throw new UserFacingError('Los bots no tienen personaje.');
  if (user.id === interaction.user.id) throw new UserFacingError('El destinatario tiene que ser otra persona.');
  return requireLivingCharacter(user.id, { self: false });
}

async function sendRequest(interaction, { sender, user, kind, fields, line, emoji }) {
  const target = await resolveTarget(interaction, user);
  const finish = await confirmAction(interaction, {
    embed: new EmbedBuilder()
      .setColor(COLORS.YELLOW)
      .setTitle(`${emoji} Confirmar traspaso`)
      .setDescription(
        `Vas a enviar **${line}** a **${clip(target.character_name, 100)}** (<@${user.id}>).\n` +
        'No se te quitará nada hasta que acepte. La solicitud caduca en 24 horas.'
      ),
    confirmLabel: 'Enviar',
  });
  if (!finish) return;

  const requestId = await createRequest({ kind, fromPlayerId: sender.id, toPlayerId: target.id, ...fields });
  const delivered = await notifyRecipient(interaction.client, {
    requestId, toDiscordId: user.id, fromName: sender.character_name, kind, line,
  });
  await finish({
    embeds: [buildSuccessEmbed(
      'Solicitud enviada',
      delivered
        ? `**${clip(target.character_name, 100)}** la verá en su MD.`
        : `No se pudo enviar el MD a <@${user.id}>. Puede resolverla con \`/solicitudes\`.`
    )],
  });
}

export async function transferNpcs(interaction, sender, user, name, count) {
  const group = await findInPages(
    page => listGrouped(sender.id, { page, pageSize: SCAN_PAGE_SIZE }),
    row => row.name === name,
  );
  if (!group) throw new UserFacingError(`No tienes ningún NPC llamado «${clip(name, 80)}».`);
  if (group.count < count) throw new UserFacingError(`Solo tienes ${group.count} NPC «${clip(name, 80)}».`);
  return sendRequest(interaction, {
    sender, user, kind: 'npc', fields: { npcName: name, npcCount: count },
    line: requestLine({ kind: 'npc', npc_name: name, npc_count: count }), emoji: E.npcs,
  });
}

export async function transferGoods(interaction, sender, user, itemId, quantity) {
  const stock = await findInPages(
    page => listInventory(sender.id, { page, pageSize: SCAN_PAGE_SIZE }),
    row => row.item_id === itemId,
  );
  if (!stock) throw new UserFacingError('No tienes ese bien.');
  if (stock.quantity < quantity) {
    throw new UserFacingError(`Solo tienes ${formatNumber(stock.quantity)} de ${clip(stock.display_name, 80)}.`);
  }
  return sendRequest(interaction, {
    sender, user, kind: 'item', fields: { itemId, quantity },
    line: requestLine({ kind: 'item', quantity, item_display_name: stock.display_name, item_id: itemId }), emoji: E.bienes,
  });
}

export async function transferProperty(interaction, sender, user, propertyId) {
  const property = await getProperty(propertyId);
  if (!property || property.owner_player_id !== sender.id) throw new UserFacingError('Esa propiedad no es tuya.');
  return sendRequest(interaction, {
    sender, user, kind: 'property', fields: { propertyId },
    line: requestLine({
      kind: 'property', property_id: propertyId, property_name: property.name,
      property_type_display_name: property.type_display_name,
    }),
    emoji: E.propiedades,
  });
}
