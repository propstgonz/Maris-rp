import { PROFILE_NS } from './playerViews.js';
import { handleProfileComponent, handlePaginationComponent } from './playerFlow.js';
import { CONSENT_NS, CONSENT_TTL_MS, handleConsentComponent } from './consentFlow.js';
import { PAGINATION_NS } from '../utils/paginate.js';

export const COMPONENT_HANDLERS = {
  [PROFILE_NS]: { handle: handleProfileComponent },
  [PAGINATION_NS]: { handle: handlePaginationComponent },
  [CONSENT_NS]: { handle: handleConsentComponent, ttlMs: CONSENT_TTL_MS },
};
