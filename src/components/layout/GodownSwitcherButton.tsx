"use client";

import type { ComponentProps } from "react";
import { Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActiveGodown } from "@/client/hooks";
import { useT } from "@/i18n/I18nProvider";

/** "গোডাউন: রামপুর ▾": shared by the light placeholder and the loaded Radix menu trigger. */
export function GodownSwitcherButton(props: ComponentProps<"button">) {
  const t = useT();
  const { godown, consolidated } = useActiveGodown();
  const label = consolidated
    ? t("godown.allGodowns")
    : godown
      ? t("godown.switcher", { name: godown.name })
      : t("godown.choose");
  // At phone width the "গোডাউন:" prefix would leave room for only a letter or two of the
  // name; the warehouse icon already says what this is, so show just the name there.
  const short = !consolidated && godown ? godown.name : label;
  return (
    <Button
      variant="ghost"
      className="h-11 min-w-0 flex-1 shrink justify-start gap-2 px-2 text-base"
      aria-haspopup="menu"
      aria-label={label}
      data-testid="godown-switcher"
      {...props}
    >
      <Warehouse className="size-5 shrink-0" aria-hidden />
      <span className="truncate font-semibold sm:hidden">{short}</span>
      <span className="hidden truncate font-semibold sm:inline">{label}</span>
      <span aria-hidden>▾</span>
    </Button>
  );
}
