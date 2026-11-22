import { PRINTING_PRESS_NS, handlePrintingPressComponent } from './printingPressFlow.js';

export const COMPONENT_HANDLERS = {
  [PRINTING_PRESS_NS]: { handle: handlePrintingPressComponent, ttlMs: 24 * 60 * 60_000 },
};
