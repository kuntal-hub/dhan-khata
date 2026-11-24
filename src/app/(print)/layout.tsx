import type { ReactNode } from "react";
import { AuthGate } from "@/components/system/AuthGate";
import { ClientRuntime } from "@/components/system/ClientRuntime";
import { RoleGate } from "@/components/system/page";

// Client-gated app: see the note in src/app/layout.tsx.
export const instant = false;

/** Print/share views: same device runtime and gate, no app chrome. */
export default function PrintLayout({ children }: { children: ReactNode }) {
  return (
    <ClientRuntime>
      <AuthGate>
        <RoleGate>{children}</RoleGate>
      </AuthGate>
    </ClientRuntime>
  );
}
