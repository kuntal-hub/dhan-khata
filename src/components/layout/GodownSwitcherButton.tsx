"use client";

import type { ComponentProps } from "react";
import { ChevronDown, Layers } from "lucide-react";
import { golaColourClass } from "@/components/gola/colours";
import { useActiveGodown } from "@/client/hooks";
import { useT } from "@/i18n/I18nProvider";

/**
 * Header Gola switcher trigger "গোলা: গোলা ১ ▾" with the Gola's colour chip (requirement_v2
 * §2.3). Shared by the light placeholder and the loaded menu trigger.
 */
export function GodownSwitcherButton(props: ComponentProps<"button">) {
  const t = useT();
  const { godown, consolidated } = useActiveGodown();
  const label = consolidated
    ? t("gola.all")
    : godown
      ? t("gola.switcher", { name: godown.name })
      : t("gola.word");
  const short = consolidated ? t("gola.allShort") : godown ? godown.name : t("gola.word");
  return (
    <button
      type="button"
      className="press bg-card hover:bg-muted shadow-card flex h-11 max-w-[46vw] min-w-0 items-center gap-2 rounded-full border px-3 text-[15px] sm:max-w-sm"
      aria-haspopup="menu"
      aria-label={label}
      data-testid="godown-switcher"
      {...props}
    >
      {consolidated ? (
        <Layers className="text-primary size-4 shrink-0" aria-hidden />
      ) : (
        <span
          className={`size-3 shrink-0 rounded-full transition-colors duration-300 ${golaColourClass(godown?.colour)}`}
          aria-hidden
        />
      )}
      <span className="truncate font-semibold sm:hidden">{short}</span>
      <span className="hidden truncate font-semibold sm:inline">{label}</span>
      <ChevronDown className="text-muted-foreground size-4 shrink-0" aria-hidden />
    </button>
  );
}
