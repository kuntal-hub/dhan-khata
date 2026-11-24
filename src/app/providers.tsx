"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Provider as ReduxProvider } from "react-redux";
import { ThemeProvider } from "next-themes";
import { IdleToaster } from "@/components/system/IdleToaster";
import { PwaRuntime } from "@/components/pwa/PwaRuntime";
import { Splash } from "@/components/system/Splash";
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
  if (!isClient) return <Splash label={translate("bn", "common.loading")} />;
  return <AppProviders>{children}</AppProviders>;
}

function AppProviders({ children }: { children: ReactNode }) {
  // One store per browser session (client-only app state).
  const [store] = useState(makeStore);
  return (
    <ReduxProvider store={store}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        <I18nProvider>
          <PwaRuntime>
            {children}
            <IdleToaster />
          </PwaRuntime>
        </I18nProvider>
      </ThemeProvider>
    </ReduxProvider>
  );
}
