export function chebyshevGridDistance(a, b) {
  const dx = Math.abs(a.coord_x - b.coord_x);
  const dy = Math.abs(a.coord_y - b.coord_y);
  return Math.max(dx, dy);
}
