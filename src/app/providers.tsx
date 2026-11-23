"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Provider as ReduxProvider } from "react-redux";
import { ThemeProvider } from "next-themes";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { I18nProvider } from "@/i18n/I18nProvider";
import { translate } from "@/i18n/translate";
import { makeStore } from "@/store";

const noopSubscribe = () => () => {};

/**
 * Local-first client gate. Every screen renders from IndexedDB on the device, never from the
 * server, so the prerendered (and service-worker-precached) HTML is just a static splash; the
 * real app mounts on the client. This keeps prerender deterministic (Cache Components) and
 * makes a cold offline start independent of any server response.
 */
export function Providers({ children }: { children: ReactNode }) {
  const isClient = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  if (!isClient) return <Splash />;
  return <AppProviders>{children}</AppProviders>;
}

function AppProviders({ children }: { children: ReactNode }) {
  // One store per browser session (client-only app state).
  const [store] = useState(makeStore);
  return (
    <ReduxProvider store={store}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        <I18nProvider>
          {children}
          <Toaster position="top-center" />
        </I18nProvider>
      </ThemeProvider>
    </ReduxProvider>
  );
}

function Splash() {
  return (
    <div
      role="status"
      aria-label={translate("bn", "common.loading")}
      className="flex min-h-dvh flex-1 items-center justify-center"
    >
      <Loader2 className="text-primary size-8 animate-spin" aria-hidden />
    </div>
  );
}
