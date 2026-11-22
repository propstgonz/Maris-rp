const HANDLERS = {
  'combat.ranged_hit': (target, d) => d.killed
    ? `Has matado a **${d.targetName ?? 'tu objetivo'}** (-${d.damage} HP).`
    : d.immortalitySaved
      ? `Alcanzaste a **${d.targetName ?? 'tu objetivo'}** con -${d.damage} HP — es inmortal, se ha clampeado a 1 HP.`
      : `Alcanzaste a **${d.targetName ?? 'tu objetivo'}** con -${d.damage} HP (le quedan ${d.targetHpAfter}).`,

  'combat.melee_hit': (target, d) => d.selfInflicted
    ? (d.attackerKilled
      ? 'Fallaste el golpe y te has matado a ti mismo.'
      : `Fallaste el golpe y te has hecho daño (-${d.selfDamage} HP).`)
    : d.killed
      ? `Has matado a **${d.targetName ?? 'tu objetivo'}** (-${d.damage} HP).`
      : d.immortalitySaved
        ? `Alcanzaste a **${d.targetName ?? 'tu objetivo'}** con -${d.damage} HP — es inmortal, se ha clampeado a 1 HP.`
        : `Alcanzaste a **${d.targetName ?? 'tu objetivo'}** con -${d.damage} HP (le quedan ${d.targetHpAfter}).`,

  'combat.npc_hit': (target, d) => d.npcDied
    ? `Has derrotado a **${d.npcType}** (-${d.damage} HP).`
    : `Alcanzaste a **${d.npcType}** con -${d.damage} HP (le quedan ${d.npcHpAfter}).`,

  'combat.npc_counterattack_hit': (target, d) => d.playerKilled
    ? `El contraataque de **${d.npcType}** te ha matado (-${d.damage} HP).`
    : `**${d.npcType}** te ha contraatacado: -${d.damage} HP (te quedan ${d.playerHpAfter}).`,

  'tile.construction_attack': (target, d) => d.ruinedNow
    ? `**${d.constructionName ?? d.constructionType}** ha quedado en ruinas (-${d.damage} HP).`
    : `Alcanzaste **${d.constructionName ?? d.constructionType}** con -${d.damage} HP (le quedan ${d.healthAfter}).`,

  'travel.start': target => `Has empezado un viaje hacia ${target ?? 'tu destino'}.`,

  'travel.cancel': () => 'Has cancelado tu viaje.',

  'gather.attempt': (target, d) => d.hit
    ? `Recolectaste **${d.grantedQuantity}× ${d.grantedItemName}**${d.wasTarget ? '' : ' (no era lo que buscabas)'} en ${target ?? 'tu casilla'}.`
    : `No has conseguido nada recolectando en ${target ?? 'tu casilla'}.`,

  'craft.done': (target, d) => `Has crafteado **${d.quantity}× ${target}**.`,

  'laburo.earn': (target, d) => `Has ganado **${d.amount}** de Laburo.`,

  'tile.construction_build': (target, d) => `Has construido **${d.constructionType}** en ${target}.`,

  'tile.construction_destroy': (target, d) => `Has demolido **${d.constructionName ?? d.constructionType}** en ${target}.`,

  'tile.construction_repair': (target, d) => `Has reparado tu construcción de **${d.constructionType}** en ${target}.`,

  'tile.construction_refuel': (target, d) => `Has repostado **${d.added}× ${d.fuelItem}** en tu construcción de **${d.constructionType}** en ${target}.`,

  'tile.construction_use': (target, d) => d.hit
    ? `Usaste tu construcción de **${d.constructionType}** en ${target} — obtuviste **${d.yieldAmount}× ${d.resultItem}**.`
    : `Usaste tu construcción de **${d.constructionType}** en ${target} — sin resultado esta vez.`,

  'tile.item_grab': (target, d) => `Recogiste **${d.quantity}× ${d.itemName}** del suelo en ${target}.`,

  'tile.item_drop': (target, d) => `Dejaste **${d.quantity}× ${d.itemName}** en el suelo en ${target}.`,

  'item.consume': (target, d) => d.died
    ? `Consumiste **${d.itemName}**... y te ha matado.`
    : `Consumiste **${d.itemName}** (HP ${d.hpBefore}→${d.hpAfter}, Hambre ${d.hungerBefore}→${d.hungerAfter}).`,

  'npc.trade': (target, d) => `Comerciaste con **${d.npcType}** en ${target}.`,

  'npc.theft_success': (target, d) => `Le robaste ${d.item ? `**${d.item}**` : 'algo'} a **${d.npcType}** en ${target}.`,

  'player.robbery_proposed': (target, d) => `Has propuesto saquear a **${d.targetName ?? 'otro jugador'}**.`,

  'market.purchase': (target, d) => `Has comprado **${d.quantity}× ${d.item}** en ${target} por **${d.totalCost}** de Laburo.`,

  'tile.npc_recruit': (target, d) => `Has reclutado un **${d.npcType}** en ${target}.`,

  'laburo.trade': (target, d) => `Le diste **${d.quantity}** de Laburo a **${d.toCharacterName ?? 'otro jugador'}**.`,

  'trade.propose': (target, d) => `Has propuesto darle **${d.quantity}× ${d.item}** a **${d.toCharacterName ?? 'otro jugador'}**.`,

  'empire.collect': (target, d) => d.lines?.length
    ? `Has cobrado tu producción pendiente: ${d.lines.join(' · ')}.`
    : 'No tenías producción pendiente que cobrar.',
};

export function describeActivity(row) {
  const handler = HANDLERS[row.action];
  if (!handler) return null;
  try {
    return handler(row.target, row.details ?? {});
  } catch {
    return null;
  }
}

const TARGET_HANDLERS = {
  'combat.melee_hit': (target, d) => d.selfInflicted ? null : (d.killed
    ? 'Te han matado en combate cuerpo a cuerpo.'
    : `Te han atacado cuerpo a cuerpo: -${d.damage} HP (te quedan ${d.targetHpAfter}).`),

  'combat.ranged_hit': (target, d) => d.killed
    ? 'Te han matado a distancia.'
    : `Te han atacado a distancia: -${d.damage} HP (te quedan ${d.targetHpAfter}).`,
};

export function describeActivityForTarget(row) {
  const handler = TARGET_HANDLERS[row.action];
  if (!handler) return null;
  try {
    return handler(row.target, row.details ?? {});
  } catch {
    return null;
  }
}
