"use client";

import dynamic from "next/dynamic";
import { GodownSwitcherButton } from "./GodownSwitcherButton";
import { useLazyMenu } from "./lazyMenu";

// The Radix menu + confirm dialog load on the first tap (spec §15 Home JS budget).
const GodownMenu = dynamic(() => import("./GodownMenu").then((m) => m.GodownMenu), {
  ssr: false,
  loading: () => <GodownSwitcherButton />,
});

/**
 * Header switcher "গোডাউন: রামপুর ▾" (spec §1.4 rule 3). Lists only godowns the user can
 * access; asks before discarding a dirty form; offers the read-only "All godowns" mode to the
 * owner (or a user with `consolidated` on ≥ 2 godowns).
 */
export function GodownSwitcher() {
  const menu = useLazyMenu();
  return menu.armed ? (
    <GodownMenu open={menu.open} onOpenChange={menu.setOpen} />
  ) : (
    <GodownSwitcherButton onClick={menu.arm} />
  );
}
