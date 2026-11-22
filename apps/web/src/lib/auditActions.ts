const FAMILY_ICON: Record<string, string> = {
  player: '👤',
  inventory: '🎒',
  item: '📦',
  terrain: '🌍',
  zona: '🧭',
  construction: '🏗️',
  effect: '✨',
  npc: '👹',
  nation: '🏳️',
  faccion: '🏳️',
  tile: '🗺️',
  combat: '⚔️',
  settings: '⚙️',
  terminal: '💻',
  staff: '📢',
  modmail: '📂',
  craft: '🔨',
  laburo: '💪',
  market: '🛒',
  travel: '🧭',
};

export const FAMILY_LABEL: Record<string, string> = {
  player: 'Jugadores',
  inventory: 'Inventarios',
  item: 'Ítems',
  terrain: 'Terrenos',
  zona: 'Zonas',
  construction: 'Construcciones (catálogo)',
  effect: 'Estados',
  npc: 'NPCs',
  nation: 'Facciones',
  faccion: 'Facciones',
  tile: 'Mapa y casillas',
  combat: 'Combate',
  settings: 'Ajustes',
  terminal: 'Terminal',
  staff: 'Staff',
  modmail: 'Modmail',
  craft: 'Crafteo',
  laburo: 'Laburo',
  market: 'Mercados',
  travel: 'Viajes',
};

const ACTION_PHRASE: Record<string, string> = {
  'player.kill': 'mató (permadeath) a',
  'player.revive': 'revivió a',
  'player.set_immortal': 'cambió la inmortalidad de',
  'player.set_avatar': 'cambió la foto de personaje de',
  'player.update_stats': 'editó los stats de',
  'player.update_identity': 'editó la identidad de',
  'player.apply_effect': 'aplicó un estado a',
  'player.remove_effect': 'quitó un estado a',
  'player.laburo': 'ajustó el Laburo de',
  'inventory.add': 'añadió un ítem al inventario de',
  'inventory.remove': 'quitó un ítem del inventario de',
  'inventory.edit': 'editó el inventario de',
  'item.create': 'creó el ítem',
  'item.update': 'editó el ítem',
  'item.delete': 'borró el ítem',
  'item.set_image': 'cambió la imagen del ítem',
  'item.add_recipe': 'añadió una receta a',
  'item.remove_recipe': 'quitó la receta de',
  'item.configure_weapon': 'configuró como arma',
  'item.configure_vehicle': 'configuró como vehículo',
  'itemCategory.create': 'creó la categoría de ítems',
  'itemCategory.update': 'editó la categoría de ítems',
  'itemCategory.delete': 'borró la categoría de ítems',
  'terrain.create': 'creó el terreno',
  'terrain.update': 'editó el terreno',
  'terrain.delete': 'borró el terreno',
  'construction.create': 'creó el tipo de construcción',
  'construction.update': 'editó el tipo de construcción',
  'construction.delete': 'borró el tipo de construcción',
  'construction.set_image': 'cambió la imagen de',
  'construction.update_ingredients': 'cambió los ingredientes de',
  'construction.configure_use': 'configuró el uso interactivo de',
  'effect.create': 'creó el estado',
  'effect.update': 'editó el estado',
  'effect.delete': 'borró el estado',
  'npc.create': 'creó el tipo de NPC',
  'npc.update': 'editó el tipo de NPC',
  'npc.delete': 'borró el tipo de NPC',
  'npc.set_image': 'cambió la imagen del NPC',
  'npc.update_drops': 'cambió el botín de',
  'npc.update_terrains': 'cambió los terrenos de',
  'npc.update_zones': 'cambió las zonas de',
  'npcGroup.update_zones': 'cambió las zonas del grupo',
  'zona.create': 'creó la zona',
  'zona.update': 'editó la zona',
  'zona.delete': 'eliminó la zona',
  'zona.update_resources': 'cambió los recursos de la zona',
  'zona.assign_range': 'asignó casillas a la zona',
  'zona.unassign_range': 'quitó la zona de un rango de casillas',
  'npc.place': 'colocó un NPC en',
  'npc.remove': 'retiró el NPC de',
  'npcGroup.create': 'creó el grupo de NPC',
  'npcGroup.update': 'editó el grupo de NPC',
  'npcGroup.update_members': 'cambió la composición de',
  'npcGroup.update_terrains': 'cambió los terrenos del grupo de NPC',
  'npcGroup.delete': 'borró el grupo de NPC',
  'npcGroup.place': 'colocó un grupo de NPC en',
  'nation.create': 'creó la facción',
  'nation.update': 'editó la facción',
  'nation.delete': 'borró la facción',
  'nation.set_owner': 'cambió el dueño de la facción',
  'nation.assign_range': 'asignó territorio a la facción',
  'nation.unassign_range': 'quitó territorio a la facción',
  'faccion.create': 'creó la facción',
  'faccion.update': 'editó la facción',
  'faccion.delete': 'borró la facción',
  'faccion.set_owner': 'cambió el dueño de la facción',
  'faccion.assign_range': 'asignó territorio a la facción',
  'faccion.unassign_range': 'quitó territorio a la facción',
  'faccion.set_rank_requirement': 'configuró un permiso de rango en la facción',
  'tile.create': 'creó la casilla',
  'tile.update': 'editó la casilla',
  'tile.delete': 'borró la casilla',
  'tile.bulk_update': 'editó en bloque las casillas',
  'tile.range_create': 'creó casillas en rectángulo',
  'tile.temperatures': 'recalculó las temperaturas del mapa',
  'tile.set_owner': 'cambió el dueño de la casilla',
  'tile.add_generator': 'añadió un generador de recursos en',
  'tile.construction_build': 'construyó en',
  'tile.construction_update': 'editó una construcción de',
  'tile.construction_repair': 'reparó una construcción de',
  'tile.construction_attack': 'atacó una construcción de',
  'tile.construction_destroy': 'demolió una construcción de',
  'tile.construction_remove': 'retiró una construcción de',
  'tile.item_drop': 'soltó un ítem en',
  'tile.item_grab': 'recogió un ítem de',
  'tile.player_teleport': 'teletransportó a un jugador a',
  'tile.player_move': 'se movió a',
  'tile.construction_production': 'recogió producción pasiva en',
  'combat.ranged_hit': 'atacó a distancia a',
  'combat.melee_hit': 'atacó cuerpo a cuerpo a',
  'combat.area_hit': 'alcanzó con un arma de área a',
  'combat.npc_hit': 'atacó al NPC',
  'combat.npc_counterattack_hit': 'recibió el contraataque del NPC',
  'settings.mechanics': 'cambió los ajustes de mecánicas',
  'settings.spawn': 'cambió la casilla de aparición',
  'settings.move_freedom': 'cambió la libertad de movimiento',
  'settings.laburo_day_amount': 'cambió el Laburo diario base',
  'settings.newspaper_category': 'cambió la categoría de periódicos',
  'settings.sync_channels': 'sincronizó los canales de personaje',
  'terminal.command': 'ejecutó un comando en el terminal',
  'terminal.sql': 'ejecutó una consulta SQL',
  'staff.broadcast': 'mandó un broadcast a todos los jugadores',
  'modmail.category_created': 'registró la categoría de modmail',
  'craft.done': 'crafteó',
  'laburo.earn': 'ganó Laburo',
  'market.purchase': 'compró en un mercado',
  'travel.start': 'empezó un viaje a',
  'travel.cancel': 'canceló su viaje',
};

export function actionFamily(action: string): string {
  return action.split('.')[0] ?? '';
}

export function actionIcon(action: string): string {
  return FAMILY_ICON[actionFamily(action)] ?? '•';
}

export function actionPhrase(action: string): string {
  return ACTION_PHRASE[action] ?? action.replace(/[._]/g, ' ');
}

export function summarizeDetails(details: unknown, maxKeys = 3): string {
  if (details == null) return '';
  if (typeof details !== 'object') return String(details).slice(0, 120);
  const entries = Object.entries(details as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length === 0) return '';
  const shown = entries.slice(0, maxKeys).map(([k, v]) => {
    const value = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return `${k}: ${value.length > 60 ? `${value.slice(0, 60)}…` : value}`;
  });
  if (entries.length > maxKeys) shown.push(`+${entries.length - maxKeys} más`);
  return shown.join(' · ');
}

export function relativeTime(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'hace un momento';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `hace ${days} d`;
  return date.toLocaleDateString('es-ES');
}
