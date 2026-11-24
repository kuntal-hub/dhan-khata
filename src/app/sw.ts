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

// Web Push reminder digest (spec §9.13): show it; tapping opens the reminder centre.
self.addEventListener("push", (event) => {
  let data: { title?: string; body?: string; url?: string } = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? "ধান খাতা", {
      body: data.body ?? "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      lang: "bn",
      tag: "dk-digest",
      data: { url: data.url ?? "/reminders" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/reminders";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ("focus" in c) {
          void (c as WindowClient).navigate(url);
          return (c as WindowClient).focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

serwist.addEventListeners();
