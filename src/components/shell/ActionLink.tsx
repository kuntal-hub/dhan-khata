"use client";

/**
 * The highlighted "add / edit" button of a page: a raised, section-coloured link that opens an
 * entry form, so the form is reachable right where the user is (client request; the floating +
 * stays on the dashboard). `tone="hero"` sits on a coloured section heading (white button),
 * `tone="accent"` on an ordinary page (filled in the section colour).
 */
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function ActionLink({
  href,
  label,
  icon: Icon,
  testId,
  tone = "accent",
  full = false,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  testId?: string;
  tone?: "hero" | "accent";
  /** Stretch to the parent's width (two or more buttons in a row). */
  full?: boolean;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className={cn(
        "press anim-pop flex h-11 min-w-0 items-center gap-1.5 rounded-xl px-3 text-[15px] font-bold active:translate-y-px",
        tone === "hero"
          ? "border border-white/60 bg-white text-(--sa) shadow-[0_2px_0_rgb(0_0_0/0.12),0_8px_18px_-8px_rgb(0_0_0/0.4)] hover:bg-white/95"
          : "border border-black/10 bg-[color-mix(in_oklab,var(--sa)_80%,black)] text-white shadow-[0_2px_0_rgb(0_0_0/0.18),0_8px_18px_-8px_color-mix(in_oklab,var(--sa)_80%,transparent)] hover:brightness-110",
        full ? "w-full justify-center sm:w-auto" : "shrink-0",
      )}
    >
      <Icon className="size-5 shrink-0" strokeWidth={2.5} aria-hidden />
      <span className={cn("truncate", full ? "min-w-0" : "max-w-[30vw] sm:max-w-none")}>
        {label}
      </span>
    </Link>
  );
}
