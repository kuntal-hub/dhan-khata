"use client";

import type { ComponentProps } from "react";
import { useT } from "@/i18n/I18nProvider";
import { useAppSelector } from "@/store";

/** The header avatar (first letter of the owner's name): opens the avatar menu. */
export function UserMenuButton(props: ComponentProps<"button">) {
  const t = useT();
  const name = useAppSelector((s) => s.session.userName) ?? "";
  const initial = [...name.trim()][0] ?? "";
  return (
    <button
      type="button"
      className="press flex size-11 items-center justify-center rounded-full"
      aria-label={t("menu.open")}
      aria-haspopup="menu"
      data-testid="user-menu"
      {...props}
    >
      <span className="bg-gold-100 text-forest ring-gold/40 flex size-9 items-center justify-center rounded-full text-base font-semibold ring-1">
        {initial}
      </span>
    </button>
  );
}
