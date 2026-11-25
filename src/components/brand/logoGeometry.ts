/**
 * Dhan Gola mark geometry on a 64-unit grid: a paddy sheaf — three stalks curving upward from
 * one tie, each ending in a head of slim grains placed along the stalk's curve. Shared by the
 * React logo; `scripts/gen-icons.mjs` repeats the same numbers for the PNG icons.
 */
type P = [number, number];

/** Cubic Bézier stalks: [P0, P1, P2, P3]. */
export const STALKS: Array<[P, P, P, P]> = [
  [
    [32, 55],
    [32, 44],
    [31.5, 30],
    [32.5, 12.5],
  ],
  [
    [31, 55],
    [29, 44],
    [25, 33],
    [16.5, 22.5],
  ],
  [
    [33, 55],
    [35, 44],
    [39, 33],
    [47.5, 22.5],
  ],
];

const GRAIN_TS = [0.6, 0.7, 0.8, 0.9];

function at(s: [P, P, P, P], t: number): { x: number; y: number; dx: number; dy: number } {
  const [a, b, c, d] = s;
  const u = 1 - t;
  const x = u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0];
  const y = u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1];
  const dx = 3 * u * u * (b[0] - a[0]) + 6 * u * t * (c[0] - b[0]) + 3 * t * t * (d[0] - c[0]);
  const dy = 3 * u * u * (b[1] - a[1]) + 6 * u * t * (c[1] - b[1]) + 3 * t * t * (d[1] - c[1]);
  return { x, y, dx, dy };
}

/** Grains: [cx, cy, rotation°]. Alternating sides along each stalk, plus one at the tip. */
export const GRAINS: Array<[number, number, number]> = STALKS.flatMap((s) => {
  const out: Array<[number, number, number]> = [];
  GRAIN_TS.forEach((t, i) => {
    const p = at(s, t);
    const len = Math.hypot(p.dx, p.dy) || 1;
    const nx = -p.dy / len;
    const ny = p.dx / len;
    const side = i % 2 === 0 ? 1 : -1;
    const angle = (Math.atan2(p.dx, -p.dy) * 180) / Math.PI;
    out.push([
      +(p.x + nx * side * 2.5).toFixed(2),
      +(p.y + ny * side * 2.5).toFixed(2),
      +(angle + side * 30).toFixed(1),
    ]);
  });
  const tip = at(s, 1);
  out.push([
    +tip.x.toFixed(2),
    +tip.y.toFixed(2),
    +((Math.atan2(tip.dx, -tip.dy) * 180) / Math.PI).toFixed(1),
  ]);
  return out;
});

export function stalkPath(s: [P, P, P, P]): string {
  const [a, b, c, d] = s;
  return `M${a[0]} ${a[1]} C${b[0]} ${b[1]} ${c[0]} ${c[1]} ${d[0]} ${d[1]}`;
}
