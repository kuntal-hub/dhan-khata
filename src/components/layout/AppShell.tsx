"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { PrefsFollower } from "@/components/system/PrefsFollower";
import { RoleGate } from "@/components/system/page";
import { Banners } from "./Banners";
import { GodownSwitcher } from "./GodownSwitcher";
import { useLazyMenu } from "./lazyMenu";
import { BottomTabs, Sidebar } from "./nav";
import { SyncBadge } from "./SyncBadge";
import { UserMenuButton } from "./UserMenuButton";

// Radix menu + logout code load on the first tap (spec §15 Home JS budget).
const UserMenu = dynamic(() => import("./UserMenu").then((m) => m.UserMenu), {
  ssr: false,
  loading: () => <UserMenuButton />,
});

/**
 * App frame: header (godown switcher, search, sync badge, user menu with 🌐 language and digit
 * toggles), banners, content, mobile bottom tabs / desktop sidebar (spec §11.2).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const menu = useLazyMenu();

  return (
    <div className="flex w-full flex-1 flex-col">
      <header className="bg-background/95 sticky top-0 z-30 flex h-14 items-center justify-between gap-1 border-b px-2 backdrop-blur print:hidden">
        <GodownSwitcher />
        <div className="flex shrink-0 items-center">
          <SyncBadge />
          {menu.armed ? (
            <UserMenu open={menu.open} onOpenChange={menu.setOpen} />
          ) : (
            <UserMenuButton onClick={menu.arm} />
          )}
        </div>
      </header>
      <div className="flex flex-1">
        <Sidebar />
        <main className="mx-auto flex w-full max-w-3xl min-w-0 flex-1 flex-col gap-3 p-3 pb-24 md:pb-6">
          <PrefsFollower />
          <Banners />
          <RoleGate>{children}</RoleGate>
        </main>
      </div>
      <BottomTabs />
    </div>
  );
}
