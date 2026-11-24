import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { AuthGate } from "@/components/system/AuthGate";
import { ClientRuntime } from "@/components/system/ClientRuntime";

// Client-gated app: see the note in src/app/layout.tsx.
export const instant = false;

/** Every app page: device runtime → unlocked session + first download → app frame. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ClientRuntime>
      <AuthGate>
        <AppShell>{children}</AppShell>
      </AuthGate>
    </ClientRuntime>
  );
}
