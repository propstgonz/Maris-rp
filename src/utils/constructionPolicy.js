export function checkConstructionPolicy(policy, { builtByPlayerId, tileFactionId }, actor) {
  if (actor.isRolepriest) return true;

  switch (policy) {
    case 'any':        return true;
    case 'owner':       return builtByPlayerId != null && actor.playerId === builtByPlayerId;
    case 'faccion':     return tileFactionId != null && actor.factionId != null && actor.factionId === tileFactionId;
    case 'rolepriest':  return false;
    default:            return true;
  }
}

export function describeConstructionPolicy(policy) {
  switch (policy) {
    case 'owner':      return 'solo quien la construyó';
    case 'faccion':    return 'solo jugadores de la misma facción que esta casilla';
    case 'rolepriest': return 'solo un Rolepriest';
    default:           return policy;
  }
}
