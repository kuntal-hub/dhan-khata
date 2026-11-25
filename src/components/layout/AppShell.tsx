"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/brand/Logo";
import { FadeSlide } from "@/components/motion/Motion";
import { BottomBar, Sidebar } from "@/components/shell/Nav";
import { PrefsFollower } from "@/components/system/PrefsFollower";
import { RoleGate } from "@/components/system/page";
import { useActiveGodown } from "@/client/hooks";
import { useT } from "@/i18n/I18nProvider";
import { Banners } from "./Banners";
import { GodownSwitcher } from "./GodownSwitcher";
import { useLazyMenu } from "./lazyMenu";
import { SyncBadge } from "./SyncBadge";
import { UserMenuButton } from "./UserMenuButton";

// Search + bell (with the reminder query) load after start-up: keeps the Home JS small.
const HeaderTools = dynamic(() => import("./HeaderTools").then((mod) => mod.HeaderTools), {
  ssr: false,
  loading: () => null,
});

// Radix menu + logout code load on the first tap (keeps the start-up JS small).
const UserMenu = dynamic(() => import("./UserMenu").then((mod) => mod.UserMenu), {
  ssr: false,
  loading: () => <UserMenuButton />,
});

/**
 * App frame (requirement_v2 §11): 8-section sidebar (≥ 1024 px) or bottom bar + "সব বিভাগ"
 * (mobile); header with the Gola switcher, sync status and the avatar menu. Content fades in on
 * every page change and cross-fades when the Gola changes (≤ 250 ms, never blocking input).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  const menu = useLazyMenu();
  const path = usePathname();
  const { godownId, consolidated } = useActiveGodown();
  const golaKey = consolidated ? "ALL" : (godownId ?? "none");

  return (
    <>
      <div className="flex w-full flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="bg-background/90 sticky top-0 z-30 flex h-16 items-center gap-2 border-b px-3 backdrop-blur lg:px-6 print:hidden">
            <LogoMark
              className="hidden size-9 shrink-0 sm:block lg:hidden"
              title={t("common.appName")}
            />
            <GodownSwitcher />
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              <HeaderTools />
              <SyncBadge />
              {menu.armed ? (
                <UserMenu open={menu.open} onOpenChange={menu.setOpen} />
              ) : (
                <UserMenuButton onClick={menu.arm} />
              )}
            </div>
          </header>
          <main
            id="main"
            className="mx-auto flex w-full max-w-6xl min-w-0 flex-1 flex-col gap-4 px-3 pt-4 pb-28 sm:px-4 lg:px-8 lg:pb-10"
          >
            <PrefsFollower />
            <Banners />
            <FadeSlide k={`${golaKey}|${path}`} className="flex min-w-0 flex-1 flex-col gap-4">
              <RoleGate>{children}</RoleGate>
            </FadeSlide>
          </main>
        </div>
      </div>
      <BottomBar />
    </>
  );
}
