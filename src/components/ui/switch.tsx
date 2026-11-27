"use client";

import { cn } from "@/lib/utils";

/**
 * On / off switch (`role="switch"`). The whole row is the tap target (≥ 48 px); `label` and
 * `hint` are already-translated text.
 */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  testId,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      data-testid={testId}
      className="press flex min-h-12 w-full items-center gap-3 rounded-xl text-left disabled:opacity-50"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-base font-medium">{label}</span>
        {hint ? <span className="text-muted-foreground text-sm">{hint}</span> : null}
      </span>
      <span
        aria-hidden
        className={cn(
          "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-200",
          checked ? "bg-primary border-primary" : "bg-muted border-border",
        )}
      >
        <span
          className={cn(
            "size-5 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.35)] transition-transform duration-200",
            checked ? "translate-x-6" : "translate-x-1",
          )}
        />
      </span>
    </button>
  );
}
