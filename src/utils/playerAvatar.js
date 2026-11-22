import { buildAssetUrl } from './publicUrl.js';

const NO_AVATAR_SET = 'avatars/default.png';

export function getAvatarUrl(player, logContext = 'avatar') {
  if (!player?.avatar_filename) return null;
  if (player.avatar_filename === NO_AVATAR_SET) return null;
  return buildAssetUrl(player.avatar_filename, logContext);
}
