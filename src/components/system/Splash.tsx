"use client";

import { LogoMark } from "@/components/brand/Logo";

/** Full-screen loading indicator (no text: shown before the language is known). */
export function Splash({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="flex min-h-dvh flex-1 items-center justify-center"
    >
      <span className="relative flex size-24 items-center justify-center" aria-hidden>
        <span className="border-primary/15 border-t-primary absolute inset-0 animate-spin rounded-full border-[3px]" />
        <LogoMark className="anim-pop size-14 drop-shadow-[0_8px_16px_rgb(227_168_23/0.4)]" />
      </span>
    </div>
  );
}
