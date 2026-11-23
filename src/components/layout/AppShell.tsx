"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Hash, Languages, LogOut, RefreshCw, Search, Settings, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Banners } from "./Banners";
import { GodownSwitcher } from "./GodownSwitcher";
import { BottomTabs, Sidebar } from "./nav";
import { SyncBadge } from "./SyncBadge";

/**
 * App frame: header (godown switcher, search, sync badge, user menu with 🌐 language and digit
 * toggles), banners, content, mobile bottom tabs / desktop sidebar (spec §11.2).
 */
export function AppShell({ children }: { children: ReactNode }) {
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
    <div className="flex w-full flex-1 flex-col">
      <header className="bg-background/95 sticky top-0 z-30 flex h-14 items-center justify-between gap-1 border-b px-2 backdrop-blur print:hidden">
        <GodownSwitcher />
        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label={t("common.search")}
            onClick={() => toast(t("common.comingSoon"))}
          >
            <Search className="size-5" aria-hidden />
          </Button>
          <SyncBadge />
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label={t("shell.menu")}
                data-testid="user-menu"
              >
                <UserRound className="size-5" aria-hidden />
              </Button>
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
        </div>
      </header>
      <div className="flex flex-1">
        <Sidebar />
        <main className="mx-auto flex w-full max-w-3xl min-w-0 flex-1 flex-col gap-3 p-3 pb-24 md:pb-6">
          <Banners />
          {children}
        </main>
      </div>
      <BottomTabs />
    </div>
  );
}
