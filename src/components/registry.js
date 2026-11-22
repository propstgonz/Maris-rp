import { CRAFT_NS, handleCraftComponent } from './craftFlow.js';
import { INVENTORY_NS, handleInventoryComponent } from './inventoryFlow.js';
import { ATTACK_NS, handleAttackComponent } from './attackFlow.js';
import { ALERTS_NS, handleAlertsComponent } from './alertsFlow.js';
import { FACTION_NS, handleFactionComponent } from './factionFlow.js';
import { TRADE_NS, handleTradeComponent } from './tradeFlow.js';
import { BUILD_NS, handleBuildComponent } from './buildFlow.js';
import { CHARACTER_NS, handleCharacterComponent } from './characterFlow.js';
import { HUB_NS, handleHubComponent } from './hubFlow.js';
import { EMPIRE_NS, handleEmpireComponent } from './empireFlow.js';
import { PRINTING_PRESS_NS, handlePrintingPressComponent } from './printingPressFlow.js';

export const COMPONENT_HANDLERS = {
  [HUB_NS]: { handle: handleHubComponent, ttlMs: 30 * 60_000 },
  [CRAFT_NS]: { handle: handleCraftComponent },
  [INVENTORY_NS]: { handle: handleInventoryComponent },
  [BUILD_NS]: { handle: handleBuildComponent },
  [FACTION_NS]: { handle: handleFactionComponent },
  [TRADE_NS]: { handle: handleTradeComponent },

  [ATTACK_NS]: {
    handle: handleAttackComponent,
    ttlMs: parsed => (parsed.action === 'counter' ? 3 * 60_000 : 15 * 60_000),
  },

  [ALERTS_NS]: { handle: handleAlertsComponent, ttlMs: 60 * 60_000 },

  [CHARACTER_NS]: { handle: handleCharacterComponent },

  [EMPIRE_NS]: { handle: handleEmpireComponent, ttlMs: 30 * 60_000 },
  [PRINTING_PRESS_NS]: { handle: handlePrintingPressComponent, ttlMs: 24 * 60 * 60_000 },
};
