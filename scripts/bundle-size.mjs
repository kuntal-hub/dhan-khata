/**
 * Home route JS budget (spec §15: < 250 KB gzipped). Run after `pnpm build`:
 *   pnpm check:bundle
 * Sums the gzipped size of every JS file the browser loads for "/": the Next runtime
 * (rootMainFiles) + the chunks of the root layout, the (app) layout and the Home page, taken from
 * Turbopack's client reference manifest. Lazily loaded chunks (reports, charts, exceljs,
 * html-to-image) are not part of it.
 */
import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const BUDGET = 250 * 1024;
const next = path.resolve(".next");
const manifestPath = path.join(next, "server/app/(app)/page_client-reference-manifest.js");
if (!existsSync(manifestPath)) {
  console.error("Run `pnpm build` first (manifest not found).");
  process.exit(2);
}
const src = readFileSync(manifestPath, "utf8");
const m = /"entryJSFiles":(\{.*?\})\s*[,}]/s.exec(src);
if (!m) {
  console.error("entryJSFiles not found in the client reference manifest");
  process.exit(2);
}
const entry = JSON.parse(m[1]);
const build = JSON.parse(readFileSync(path.join(next, "build-manifest.json"), "utf8"));
const files = new Set(build.rootMainFiles ?? []);
for (const key of [
  "[project]/src/app/layout",
  "[project]/src/app/(app)/layout",
  "[project]/src/app/(app)/page",
]) {
  for (const f of entry[key] ?? []) files.add(f);
}
let total = 0;
const rows = [];
for (const f of files) {
  const p = path.join(next, f);
  if (!existsSync(p) || !f.endsWith(".js")) continue;
  const gz = gzipSync(readFileSync(p), { level: 9 }).length;
  total += gz;
  rows.push([f, gz]);
}
rows.sort((a, b) => b[1] - a[1]);
const why = process.argv.includes("--why");
const SIGS = {
  zod: "ZodError",
  dexie: "Dexie",
  "react-dom": "__reactProps",
  radix: "data-radix",
  vaul: "vaul",
  "bn-dict": "ধান খাতা",
  "date-fns": "formatDistance",
  redux: "createSlice",
  sonner: "data-sonner",
};
for (const [f, gz] of why ? rows : rows.slice(0, 8)) {
  const libs = why
    ? Object.entries(SIGS)
        .filter(([, s]) => readFileSync(path.join(next, f), "utf8").includes(s))
        .map(([k]) => k)
        .join(",")
    : "";
  console.log(`${(gz / 1024).toFixed(1).padStart(7)} KB  ${f}  ${libs}`);
}
const kb = (total / 1024).toFixed(1);
console.log(`Home route JS (gzipped): ${kb} KB in ${rows.length} files — budget 250 KB`);
process.exit(total <= BUDGET ? 0 : 1);
