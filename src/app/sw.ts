/// <reference lib="esnext" />
/// <reference lib="webworker" />
/**
 * Service worker (Serwist, configurator mode — built by `serwist build` after `next build`).
 * - Precache: app shell, EVERY prerendered route, fonts, icons (cold offline start works).
 * - Navigations match the precached page regardless of the query string (`/party?id=…`,
 *   `/?source=pwa`), because all app routes are static.
 * - `/api/*` is NetworkOnly: the sync engine owns retries; API JSON is never cached here.
 * - No skipWaiting: a new version waits until the user taps "update" (spec §12.9).
 */
import { defaultCache } from "@serwist/next/worker";
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkOnly,
  Serwist,
  type PrecacheEntry,
  type RuntimeCaching,
  type SerwistGlobalConfig,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const runtimeCaching: RuntimeCaching[] = [
  {
    matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/api/"),
    handler: new NetworkOnly(),
  },
  {
    matcher: ({ request, sameOrigin }) =>
      sameOrigin && ["font", "image", "style", "script"].includes(request.destination),
    handler: new CacheFirst({
      cacheName: "dk-static",
      plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 365 * 24 * 3600 })],
    }),
  },
  ...defaultCache,
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    cleanupOutdatedCaches: true,
    // Static routes: any query string maps to the same precached page.
    ignoreURLParametersMatching: [/.*/],
  },
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching,
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

// Background Sync (Chromium only, a bonus): ask open pages to run the sync engine.
self.addEventListener("sync", (event) => {
  const e = event as ExtendableEvent & { tag?: string };
  if (e.tag !== "dk-sync") return;
  e.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const c of clients) c.postMessage("dk-sync");
    }),
  );
});

serwist.addEventListeners();
