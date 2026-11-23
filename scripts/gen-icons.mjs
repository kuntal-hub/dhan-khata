/**
 * Generates the PWA icons (192/512, maskable 512, Apple touch 180) from one SVG with sharp.
 * Run: node scripts/gen-icons.mjs  (outputs are committed under public/icons)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const GREEN = "#2F7D32";
const GOLD = "#F2C14E";

/** A paddy panicle: curved stalk with grains. `pad` shrinks the art for the maskable safe zone. */
function svg(size, { pad = 0, rounded = true } = {}) {
  const s = 512;
  const inner = s - pad * 2;
  const k = inner / s;
  const grains = [];
  const pts = [
    [256, 120, -20],
    [226, 150, -40],
    [286, 150, 0],
    [214, 192, -45],
    [298, 192, 5],
    [206, 236, -50],
    [306, 236, 10],
    [204, 280, -55],
    [308, 280, 15],
    [210, 322, -60],
  ];
  for (const [x, y, rot] of pts) {
    grains.push(
      `<ellipse cx="${x}" cy="${y}" rx="20" ry="36" fill="${GOLD}" transform="rotate(${rot} ${x} ${y})"/>`,
    );
  }
  const art = `
    <path d="M256 140 C 250 260, 262 340, 248 420" stroke="${GOLD}" stroke-width="14" fill="none" stroke-linecap="round"/>
    <path d="M250 360 C 200 330, 170 340, 150 380" stroke="${GOLD}" stroke-width="12" fill="none" stroke-linecap="round"/>
    <path d="M252 380 C 300 350, 340 360, 362 400" stroke="${GOLD}" stroke-width="12" fill="none" stroke-linecap="round"/>
    ${grains.join("\n")}`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" rx="${rounded ? 96 : 0}" fill="${GREEN}"/>
  <g transform="translate(${pad} ${pad}) scale(${k})">${art}</g>
</svg>`);
}

mkdirSync("public/icons", { recursive: true });
const jobs = [
  ["public/icons/icon-192.png", 192, {}],
  ["public/icons/icon-512.png", 512, {}],
  ["public/icons/maskable-512.png", 512, { pad: 72, rounded: false }],
  ["public/icons/apple-touch-icon.png", 180, { rounded: false }],
];
for (const [file, size, opts] of jobs) {
  await sharp(svg(size, opts)).resize(size, size).png().toFile(file);
  console.log(`wrote ${file}`);
}
writeFileSync("public/icons/icon.svg", svg(512));
