"use client";

/**
 * Motion layer for the start-up path (requirement_v2 §15.3): CSS keyframes (tw-animate-css) and
 * requestAnimationFrame, so the Home route stays light. Rules: only transform/opacity, ≤ 220 ms
 * (count-up 700 ms), never block input; `prefers-reduced-motion` → instant (global CSS rule +
 * `prefersReducedMotion()` here). The `motion` package was tried and removed: it added 47 KB to
 * the start-up JS (DECISIONS D19).
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/** Fade + 8 px slide-in, 200 ms, re-played whenever `k` changes (page, tab, Gola). */
export function FadeSlide({
  children,
  k,
  className,
}: {
  children: ReactNode;
  k: string;
  className?: string;
}) {
  return (
    <div
      key={k}
      className={cn("animate-in fade-in slide-in-from-bottom-2 duration-200 ease-out", className)}
    >
      {children}
    </div>
  );
}

/** Cross-fade (≤ 250 ms) when the Gola changes. */
export function CrossFade({
  children,
  k,
  className,
}: {
  children: ReactNode;
  k: string;
  className?: string;
}) {
  return (
    <div key={k} className={cn("animate-in fade-in duration-200", className)}>
      {children}
    </div>
  );
}

/** Staggered fade-up entrance: 35 ms stagger for the first 8 items, then none. */
export function StaggerItem({
  i,
  children,
  className,
}: {
  i: number;
  children: ReactNode;
  className?: string;
}) {
  const style: CSSProperties = {
    animationDelay: `${Math.min(i, 8) * 35}ms`,
    animationFillMode: "both",
  };
  return (
    <div
      className={cn("animate-in fade-in slide-in-from-bottom-2 duration-200 ease-out", className)}
      style={style}
    >
      {children}
    </div>
  );
}

/**
 * Count-up for big numbers (700 ms) on first render and when `value` changes. Exact at the end:
 * frames interpolate integer paise/grams with bigint math (display only). Reduced motion →
 * the final value at once.
 */
export function useCountUp(value: bigint, durationMs = 700): bigint {
  const [shown, setShown] = useState<bigint>(0n);
  const from = useRef<bigint>(0n);
  useEffect(() => {
    const a = from.current;
    let raf = 0;
    if (prefersReducedMotion() || a === value) {
      raf = requestAnimationFrame(() => setShown(value));
      from.current = value;
      return () => cancelAnimationFrame(raf);
    }
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      const bps = BigInt(Math.round(eased * 10_000)); // float-ok: animation progress, not money
      setShown(p >= 1 ? value : a + ((value - a) * bps) / 10_000n);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);
  return shown;
}
