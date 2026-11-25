import type { ReactNode } from "react";
import { ClientRuntime } from "@/components/system/ClientRuntime";

// Client-gated app: see the note in src/app/layout.tsx.
export const instant = false;

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <ClientRuntime>
      <div className="relative flex w-full flex-1 flex-col">
        <div
          aria-hidden
          className="hero accent-forest pointer-events-none absolute inset-x-0 top-0 h-60 rounded-b-[2.5rem]"
        />
        <main className="anim-rise relative mx-auto flex w-full max-w-md flex-1 flex-col gap-5 p-4 pt-8">
          {children}
        </main>
      </div>
    </ClientRuntime>
  );
}
