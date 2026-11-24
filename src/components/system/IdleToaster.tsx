"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const Toaster = dynamic(() => import("@/components/ui/sonner").then((m) => m.Toaster), {
  ssr: false,
});

/**
 * Mounts the toast host once the first render is done and the main thread is idle, so sonner
 * is not part of the Home route's startup JS (spec §15). Toasts always follow a user action,
 * which comes after this point. Modules on the Home path call `lazyToast` instead of
 * importing sonner directly.
 */
export function IdleToaster() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => setReady(true), { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(() => setReady(true), 300);
    return () => window.clearTimeout(id);
  }, []);
  return ready ? <Toaster position="top-center" /> : null;
}

/** `toast(message)` for modules on the Home path: loads sonner on first use. */
export function lazyToast(message: string): void {
  void import("sonner").then((m) => m.toast(message));
}
