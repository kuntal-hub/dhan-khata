"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Home, Languages, LogOut, Menu, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogoutBlockedError, logout } from "@/client/auth/session";
import { errorKey } from "@/client/errors";
import { useI18n } from "@/i18n/I18nProvider";
import { actions, useAppDispatch } from "@/store";
import { Banners } from "./Banners";
import { GodownSwitcher } from "./GodownSwitcher";
import { SyncBadge } from "./SyncBadge";

/** Mobile-first app frame: header (godown switcher, sync badge, menu), banners, content. */
export function AppShell({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const router = useRouter();
  const dispatch = useAppDispatch();

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
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <header className="bg-background/95 sticky top-0 z-30 flex items-center justify-between gap-1 border-b px-2 py-1 backdrop-blur">
        <GodownSwitcher />
        <div className="flex items-center">
          <SyncBadge />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-11" aria-label={t("shell.menu")}>
                <Menu className="size-5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuItem asChild className="min-h-11">
                <Link href="/">
                  <Home className="size-4" aria-hidden />
                  {t("nav.home")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="min-h-11">
                <Link href="/sync">
                  <RefreshCw className="size-4" aria-hidden />
                  {t("nav.sync")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="min-h-11"
                onSelect={() => setLang(lang === "bn" ? "en" : "bn")}
              >
                <Languages className="size-4" aria-hidden />
                {lang === "bn" ? t("lang.en") : t("lang.bn")}
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
      <div className="flex flex-1 flex-col gap-3 p-3">
        <Banners />
        {children}
      </div>
    </div>
  );
}
