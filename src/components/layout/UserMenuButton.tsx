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
      <span className="ring-card flex size-9 items-center justify-center rounded-full bg-linear-to-br from-[var(--gold-300)] to-[var(--gold-600)] text-base font-bold text-[#3b2a02] shadow-[0_4px_10px_-4px_rgb(183_128_10/0.8)] ring-2">
        {initial}
      </span>
    </button>
  );
}
