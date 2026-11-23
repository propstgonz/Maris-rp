export const RETRY_DAYS = 28;
export const FREE_SCHOOL_MIN_AUTISMO = 6;
export const MAX_RANK = 5;

export function attemptModifier(effective, school) {
  return Number(effective.autismo) + Number(effective[school.secondary_stat]) / Number(school.secondary_divisor);
}

export function isSuccess(total, threshold) {
  return Number(total) >= Number(threshold);
}

export function thresholdLabel(threshold) {
  const value = Number(threshold);
  return Number.isInteger(value) ? `${value} o más` : `más de ${Math.floor(value)}`;
}

export function mentorQualifies(mentorRank, targetRank) {
  return Number(mentorRank) >= Number(targetRank);
}

export function canClaimFreeSchool(effective, playerRow) {
  return Number(effective.autismo) >= FREE_SCHOOL_MIN_AUTISMO && !playerRow?.free_school_claimed_at;
}
