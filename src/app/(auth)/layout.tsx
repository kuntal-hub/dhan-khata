import type { ReactNode } from "react";
import { ClientRuntime } from "@/components/system/ClientRuntime";

// Client-gated app: see the note in src/app/layout.tsx.
export const instant = false;

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <ClientRuntime>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 p-4">
        {children}
      </main>
    </ClientRuntime>
  );
}
