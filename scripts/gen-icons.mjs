/**
 * Generates the PWA icons from the Dhan Gola logo (requirement_v2 §15.1): a deep-green paddy
 * sheaf inside a rounded Paddy Gold square. Outputs (committed under public/icons):
 *   icon-192.png, icon-512.png (rounded square), maskable-512.png (full bleed, safe zone),
 *   apple-touch-icon.png (180, no transparency), favicon-32.png, logo.svg (full colour),
 *   logo-mono.svg (monochrome).
 * Run: pnpm icons
 */
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const GREEN = "#1E4D3A";
const GOLD = "#C9A227";
const IVORY = "#FAF6EC";

// Same geometry as src/components/brand/logoGeometry.ts (64-unit grid).
const STALKS = [
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
function at([a, b, c, d], t) {
  const u = 1 - t;
  return {
    x: u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
    y: u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
    dx: 3 * u * u * (b[0] - a[0]) + 6 * u * t * (c[0] - b[0]) + 3 * t * t * (d[0] - c[0]),
    dy: 3 * u * u * (b[1] - a[1]) + 6 * u * t * (c[1] - b[1]) + 3 * t * t * (d[1] - c[1]),
  };
}
const GRAINS = STALKS.flatMap((s) => {
  const out = [];
  [0.6, 0.7, 0.8, 0.9].forEach((t, i) => {
    const p = at(s, t);
    const len = Math.hypot(p.dx, p.dy) || 1;
    const side = i % 2 === 0 ? 1 : -1;
    const angle = (Math.atan2(p.dx, -p.dy) * 180) / Math.PI;
    out.push([
      p.x + (-p.dy / len) * side * 2.5,
      p.y + (p.dx / len) * side * 2.5,
      angle + side * 30,
    ]);
  });
  const tip = at(s, 1);
  out.push([tip.x, tip.y, (Math.atan2(tip.dx, -tip.dy) * 180) / Math.PI]);
  return out;
});

function emblem(ink) {
  const stalks = STALKS.map(
    ([a, b, c, d]) =>
      `<path d="M${a[0]} ${a[1]} C${b[0]} ${b[1]} ${c[0]} ${c[1]} ${d[0]} ${d[1]}" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>`,
  ).join("");
  const grains = GRAINS.map(
    ([cx, cy, r]) =>
      `<ellipse cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" rx="1.55" ry="3.7" transform="rotate(${r.toFixed(1)} ${cx.toFixed(2)} ${cy.toFixed(2)})" fill="${ink}"/>`,
  ).join("");
  return `${stalks}${grains}<rect x="27.6" y="45.6" width="9" height="3.2" rx="1.6" fill="${ink}"/>`;
}
/** Rounded gold square with the emblem; `full` = full-bleed square (maskable / apple). */
function svg(size, { full = false, safe = 1, bg = GOLD, ink = GREEN, square = true } = {}) {
  const k = safe;
  const off = (64 - 64 * k) / 2;
  const body = square
    ? full
      ? `<rect width="64" height="64" fill="${bg}"/>`
      : `<rect x="2" y="2" width="60" height="60" rx="15" fill="${bg}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${body}<g transform="translate(${off} ${off}) scale(${k})">${emblem(ink)}</g></svg>`;
}

mkdirSync("public/icons", { recursive: true });
const png = (s, file) => sharp(Buffer.from(s)).png().toFile(`public/icons/${file}`);

await png(svg(192), "icon-192.png");
await png(svg(512), "icon-512.png");
// Maskable: art inside the central 80 % safe zone on a full-bleed square.
await png(svg(512, { full: true, safe: 0.72 }), "maskable-512.png");
await png(svg(180, { full: true, safe: 0.86 }), "apple-touch-icon.png");
await png(svg(32), "favicon-32.png");
writeFileSync("public/icons/logo.svg", svg(512));
writeFileSync("public/icons/logo-inverse.svg", svg(512, { bg: GREEN, ink: IVORY }));
writeFileSync("public/icons/logo-mono.svg", svg(512, { square: false, ink: "#000000" }));
console.log("icons written to public/icons");
