// @ts-check
/**
 * Serwist configurator mode (spec §3.3/§13): runs AFTER `next build`, so it can precache every
 * prerendered route (`.next/server/app/**\/*.html`) plus static assets, fonts and icons.
 */
import { serwist } from "@serwist/next/config";

export default serwist({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  globIgnores: ["public/swe-worker*"],
  maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
});
