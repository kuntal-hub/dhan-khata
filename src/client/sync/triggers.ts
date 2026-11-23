/**
 * Sync triggers (spec §12.6): app start, `online`, tab visible, every 60 s while visible and
 * online, 2 s after any local write (debounced, also from other tabs), manual button, and
 * Background Sync (Chromium only, a bonus: the service worker posts "dk-sync" to the page).
 */
import { onLocalWrite } from "../repo/notify";
import type { SyncEngine } from "./engine";

export const WRITE_DEBOUNCE_MS = 2_000;
export const PERIODIC_MS = 60_000;

export function installSyncTriggers(engine: SyncEngine): () => void {
  const sync = () => void engine.syncNow();
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const onWrite = () => {
    void engine.refreshCounts();
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(sync, WRITE_DEBOUNCE_MS);
    registerBackgroundSync();
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") sync();
  };
  const onSwMessage = (e: MessageEvent) => {
    if (e.data === "dk-sync") sync();
  };

  const offWrite = onLocalWrite(onWrite);
  window.addEventListener("online", sync);
  document.addEventListener("visibilitychange", onVisible);
  navigator.serviceWorker?.addEventListener("message", onSwMessage);
  const interval = setInterval(() => {
    if (document.visibilityState === "visible" && engine.status.online) sync();
  }, PERIODIC_MS);

  sync(); // app start

  return () => {
    offWrite();
    window.removeEventListener("online", sync);
    document.removeEventListener("visibilitychange", onVisible);
    navigator.serviceWorker?.removeEventListener("message", onSwMessage);
    clearInterval(interval);
    if (debounce) clearTimeout(debounce);
  };
}

interface SyncManagerLike {
  register(tag: string): Promise<void>;
}

function registerBackgroundSync(): void {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
  void navigator.serviceWorker.ready
    .then((reg) =>
      (reg as ServiceWorkerRegistration & { sync?: SyncManagerLike }).sync?.register("dk-sync"),
    )
    .catch(() => {});
}
