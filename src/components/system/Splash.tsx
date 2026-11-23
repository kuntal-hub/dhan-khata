"use client";

import { Loader2 } from "lucide-react";

/** Full-screen loading indicator (no text: shown before the language is known). */
export function Splash({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="flex min-h-dvh flex-1 items-center justify-center"
    >
      <Loader2 className="text-primary size-8 animate-spin" aria-hidden />
    </div>
  );
}
