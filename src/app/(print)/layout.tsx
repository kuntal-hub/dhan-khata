import type { ReactNode } from "react";
import { AuthGate } from "@/components/system/AuthGate";
import { ClientRuntime } from "@/components/system/ClientRuntime";

/** Print/share views: same device runtime and gate, no app chrome. */
export default function PrintLayout({ children }: { children: ReactNode }) {
  return (
    <ClientRuntime>
      <AuthGate>{children}</AuthGate>
    </ClientRuntime>
  );
}
