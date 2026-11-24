import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { AuthGate } from "@/components/system/AuthGate";
import { ClientRuntime } from "@/components/system/ClientRuntime";
import { OnboardingGate } from "@/components/system/OnboardingGate";

/** Every app page: device runtime → unlocked session + first download → app frame. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ClientRuntime>
      <AuthGate>
        <OnboardingGate>
          <AppShell>{children}</AppShell>
        </OnboardingGate>
      </AuthGate>
    </ClientRuntime>
  );
}
