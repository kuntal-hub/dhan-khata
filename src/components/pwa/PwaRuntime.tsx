"use client";

import { SerwistProvider, useSerwist } from "@serwist/next/react";
import { useCallback, useEffect, type ReactNode } from "react";
import { captureInstallPrompt } from "@/client/pwa/browser";
import { actions, useAppDispatch, useAppSelector, useAppStore } from "@/store";

/** The service worker runs only in production builds (dev uses the network directly). */
const SW_DISABLED = process.env.NODE_ENV !== "production";

/**
 * Registers the service worker (Serwist) and watches for a waiting update. The update is
 * applied ONLY when the user taps it, and never while the outbox is sending or a form is dirty
 * (spec §12.9).
 */
export function PwaRuntime({ children }: { children: ReactNode }) {
  useEffect(() => captureInstallPrompt(), []);
  return (
    <SerwistProvider swUrl="/sw.js" disable={SW_DISABLED} reloadOnOnline={false}>
      <UpdateWatcher />
      {children}
    </SerwistProvider>
  );
}

function UpdateWatcher() {
  const { serwist } = useSerwist();
  const dispatch = useAppDispatch();
  useEffect(() => {
    if (!serwist) return;
    const onWaiting = () => dispatch(actions.sync.syncStatusChanged({ updateReady: true }));
    serwist.addEventListener("waiting", onWaiting);
    return () => serwist.removeEventListener("waiting", onWaiting);
  }, [serwist, dispatch]);
  return null;
}

/** Returns whether an update is waiting, and a function that applies it if it's safe now. */
export function useUpdateApp(): { updateReady: boolean; applyUpdate: () => boolean } {
  const { serwist } = useSerwist();
  const store = useAppStore();
  const updateReady = useAppSelector((s) => s.sync.updateReady);
  const applyUpdate = useCallback(() => {
    const s = store.getState();
    if (s.sync.running || s.ui.dirtyForms > 0) return false;
    if (!serwist) return false;
    serwist.addEventListener("controlling", () => window.location.reload());
    serwist.messageSkipWaiting();
    return true;
  }, [serwist, store]);
  return { updateReady, applyUpdate };
}
