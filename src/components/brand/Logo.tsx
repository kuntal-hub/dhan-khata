/**
 * Dhan Gola logo (requirement_v2 §15.1): a paddy sheaf — three stalks curving upward from one tie,
 * each with a head of slim grains — inside a rounded golden square. Variants: full colour (gold square,
 * deep-green emblem), ivory emblem on green, monochrome (currentColor).
 */
import { cn } from "@/lib/utils";
import { GRAINS, STALKS, stalkPath } from "./logoGeometry";

export type LogoVariant = "color" | "inverse" | "mono";

export function LogoMark({
  variant = "color",
  className,
  title,
}: {
  variant?: LogoVariant;
  className?: string;
  /** Accessible name; omit when a visible label is next to the mark. */
  title?: string;
}) {
  const square = variant === "color" ? "#C9A227" : variant === "inverse" ? "#1E4D3A" : "none";
  const ink = variant === "color" ? "#1E4D3A" : variant === "inverse" ? "#FAF6EC" : "currentColor";
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="15"
        fill={square}
        stroke={variant === "mono" ? "currentColor" : "none"}
        strokeWidth={variant === "mono" ? 3 : 0}
      />
      {STALKS.map((st, i) => (
        <path
          key={i}
          d={stalkPath(st)}
          fill="none"
          stroke={ink}
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      ))}
      {GRAINS.map(([cx, cy, r], i) => (
        <ellipse
          key={i}
          cx={cx}
          cy={cy}
          rx="1.55"
          ry="3.7"
          transform={`rotate(${r} ${cx} ${cy})`}
          fill={ink}
        />
      ))}
      <rect x="27.6" y="45.6" width="9" height="3.2" rx="1.6" fill={ink} />{" "}
    </svg>
  );
}

/** Mark + app name, for the login screen, header and receipts. */
export function Logo({
  name,
  tagline,
  className,
  size = "md",
}: {
  name: string;
  tagline?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const mark = size === "lg" ? "size-16" : size === "md" ? "size-10" : "size-8";
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <LogoMark className={mark} />
      <div className="flex min-w-0 flex-col">
        <span
          className={cn(
            "text-primary leading-tight font-semibold",
            size === "lg" ? "text-2xl" : "text-lg",
          )}
        >
          {name}
        </span>
        {tagline ? (
          <span className="text-muted-foreground text-sm leading-snug">{tagline}</span>
        ) : null}
      </div>
    </div>
  );
}
