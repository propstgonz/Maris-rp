export const PERMISSION_ACTIONS = {
  'construction.use':           'Usar la construcción',
  'construction.refuel':        'Repostar la construcción',
  'construction.repair':        'Reparar la construcción',
  'construction.destroy':       'Destruir la construcción',
  'construction.market_manage': 'Gestionar el mercado',
  'construction.storage_deposit':  'Depositar en el almacén',
  'construction.storage_withdraw': 'Retirar del almacén',
  'faction.kick':                'Expulsar jugadores de la facción',
  'faction.promote':             'Ascender/descender rangos',
  'faction.rank_manage':         'Gestionar los rangos y permisos de la facción',
  'faction.storage_deposit':     'Depositar en el almacén de la facción',
  'faction.storage_withdraw':    'Retirar del almacén de la facción',
  'faction.npc_recruit':         'Reclutar NPCs en una oficina de reclutamiento',
};

export const PERMISSION_ACTION_NAMES = Object.keys(PERMISSION_ACTIONS);

export function isValidPermissionAction(action) {
  return PERMISSION_ACTION_NAMES.includes(action);
}
