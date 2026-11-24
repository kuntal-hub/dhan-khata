"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Hash, Languages, LogOut, RefreshCw, Settings } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogoutBlockedError, logout } from "@/client/auth/session";
import { errorKey } from "@/client/errors";
import { useI18n } from "@/i18n/I18nProvider";
import { actions, useAppDispatch, useAppSelector } from "@/store";
import type { LazyMenuProps } from "./lazyMenu";
import { UserMenuButton } from "./UserMenuButton";

/** The header user menu (🌐 language, digits, sync, settings, logout). Loaded on first tap. */
export function UserMenu({ open, onOpenChange }: LazyMenuProps) {
  const { t, lang, setLang, digits, setDigits } = useI18n();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const userName = useAppSelector((s) => s.session.userName);

  const doLogout = async () => {
    try {
      await logout();
      dispatch(actions.session.signedOut());
      dispatch(actions.activeGodown.godownCleared());
      router.replace("/login");
    } catch (e) {
      if (e instanceof LogoutBlockedError) {
        toast.error(t("auth.logoutBlocked", { count: e.pending }), {
          action: { label: t("sync.title"), onClick: () => router.push("/sync") },
        });
      } else toast.error(t(errorKey(e)));
    }
  };

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <UserMenuButton />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {userName ? <DropdownMenuLabel>{userName}</DropdownMenuLabel> : null}
        <DropdownMenuItem
          className="min-h-11"
          data-testid="toggle-language"
          onSelect={() => setLang(lang === "bn" ? "en" : "bn")}
        >
          <Languages className="size-4" aria-hidden />
          {lang === "bn" ? t("lang.en") : t("lang.bn")}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-11"
          data-testid="toggle-digits"
          onSelect={() => setDigits(digits === "bn" ? "en" : "bn")}
        >
          <Hash className="size-4" aria-hidden />
          {digits === "bn" ? t("lang.digitsEn") : t("lang.digitsBn")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="min-h-11">
          <Link href="/sync">
            <RefreshCw className="size-4" aria-hidden />
            {t("nav.sync")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="min-h-11">
          <Link href="/settings">
            <Settings className="size-4" aria-hidden />
            {t("nav.settings")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11" onSelect={() => void doLogout()}>
          <LogOut className="size-4" aria-hidden />
          {t("auth.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
