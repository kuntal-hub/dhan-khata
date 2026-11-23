/**
 * Browser-side PWA helpers: install prompt capture (spec §13), persistent storage request
 * (§12.9), iOS detection. Framework-free; React components subscribe to changes.
 */
import { META, getMeta, setMeta } from "../db/meta";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
let installed = false;

export function captureInstallPrompt(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

export function canPromptInstall(): boolean {
  return deferred !== null;
}

export function onInstallPromptChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  listeners.forEach((l) => l());
  await e.prompt();
  return (await e.userChoice).outcome === "accepted";
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export type StorageNotice = "pending" | "shown";

/**
 * Ask the browser to keep our data (installed PWAs are less likely to be evicted). When denied,
 * a one-time explanation is queued (meta flag) — shown once, never again.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!storage?.persist) return false;
  try {
    const granted = (await storage.persisted?.()) || (await storage.persist());
    if (!granted && (await getMeta<StorageNotice>(META.storageNoticeShown)) === undefined) {
      await setMeta(META.storageNoticeShown, "pending");
    }
    return granted;
  } catch {
    return false;
  }
}
