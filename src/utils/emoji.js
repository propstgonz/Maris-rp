const CUSTOM_EMOJI = /^<a?:[A-Za-z0-9_]{2,32}:\d{15,25}>$/;
const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[#-9]️?⃣/u;

const segmenter = new Intl.Segmenter('es', { granularity: 'grapheme' });

export function componentEmoji(raw, fallback = null) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return fallback;
  if (CUSTOM_EMOJI.test(value)) return value;

  for (const { segment } of segmenter.segment(value)) {
    if (PICTOGRAPHIC.test(segment)) return segment;
  }
  return fallback;
}
