/**
 * Dhan Gola logo (requirement_v2 §15.1): a paddy sheaf — five grain heads curving upward on one
 * stalk, with two leaves — inside a rounded golden square. Variants: full colour (gold square,
 * deep-green emblem), ivory emblem on green, monochrome (currentColor).
 */
import { cn } from "@/lib/utils";

export type LogoVariant = "color" | "inverse" | "mono";

const GRAINS: Array<[number, number, number]> = [
  // cx, cy, rotation (deg)
  [35.6, 12.6, 18],
  [29.2, 19.4, -38],
  [38.6, 22.4, 42],
  [28.4, 28.6, -42],
  [37.4, 31.8, 46],
];

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
      <path
        d="M32.5 55 C32 44 31.6 33 34.6 15"
        fill="none"
        stroke={ink}
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path d="M32.4 54 C28 49 22.6 46 17.5 45.5 C22 43.5 27.8 45 32.2 49.5" fill={ink} />
      <path d="M32.6 51.5 C36.6 46.5 41.8 43.8 47 43.6 C42.6 41.2 36.8 43 32.8 47.4" fill={ink} />
      {GRAINS.map(([cx, cy, r]) => (
        <ellipse
          key={`${cx}-${cy}`}
          cx={cx}
          cy={cy}
          rx="3.1"
          ry="5.6"
          transform={`rotate(${r} ${cx} ${cy})`}
          fill={ink}
        />
      ))}
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
