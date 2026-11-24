"use client";

import type { ComponentProps } from "react";
import { UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/I18nProvider";

/** The header user-menu trigger: shared by the light placeholder and the loaded Radix menu. */
export function UserMenuButton(props: ComponentProps<"button">) {
  const t = useT();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-11"
      aria-label={t("shell.menu")}
      aria-haspopup="menu"
      data-testid="user-menu"
      {...props}
    >
      <UserRound className="size-5" aria-hidden />
    </Button>
  );
}
