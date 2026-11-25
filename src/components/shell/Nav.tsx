"use client";

/**
 * 8-section navigation (requirement_v2 §11):
 *  - desktop / tablet ≥ 1024 px: collapsible left sidebar with all 8 sections (icon + label);
 *  - mobile: bottom bar with the 4 primary sections + "সব বিভাগ" which opens a 2×4 grid of the
 *    same 8 sections (a menu, not a ninth section).
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { closeThenNavigate } from "@/client/ui/backStack";
import { useEffect, useState } from "react";
import { LayoutGrid, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { LogoMark } from "@/components/brand/Logo";
import { LazyBottomSheet as BottomSheet } from "@/components/forms/LazyBottomSheet";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import { SECTIONS, sectionOf, type Section } from "./sections";

const COLLAPSE_KEY = "dg.sidebarCollapsed";

function useActiveSection(): Section | undefined {
  return sectionOf(usePathname());
}

export function Sidebar() {
  const { t } = useI18n();
  const active = useActiveSection();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1"),
    );
    return () => cancelAnimationFrame(id);
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      return !c;
    });
  };
  return (
    <nav
      aria-label={t("sections.title")}
      data-testid="sidebar"
      className={cn(
        "bg-sidebar text-sidebar-foreground sticky top-0 hidden h-dvh shrink-0 flex-col bg-[radial-gradient(120%_60%_at_0%_0%,rgb(25_151_107/0.35),transparent_60%),radial-gradient(90%_40%_at_100%_100%,rgb(227_168_23/0.14),transparent_60%)] transition-[width] duration-300 ease-(--ease-premium) lg:flex print:hidden",
        collapsed ? "w-[76px]" : "w-64",
      )}
    >
      <div className={cn("flex h-18 items-center gap-3 px-5", collapsed && "justify-center px-0")}>
        <LogoMark className="size-10 drop-shadow-[0_4px_10px_rgb(227_168_23/0.35)]" />
        {collapsed ? null : (
          <span className="truncate text-xl font-bold tracking-tight text-white">
            {t("common.appName")}
          </span>
        )}
      </div>
      <ul className="flex flex-1 scrollbar-none flex-col gap-1 overflow-y-auto px-3 py-2">
        {SECTIONS.map((s) => {
          const on = active?.key === s.key;
          return (
            <li key={s.key} className={cn("relative", `accent-${s.key}`)}>
              <Link
                href={s.href}
                aria-current={on ? "page" : undefined}
                title={collapsed ? t(s.label) : undefined}
                data-testid={`nav-${s.key}`}
                className={cn(
                  "press relative flex min-h-12 items-center gap-3 rounded-2xl px-2.5 text-[15px] transition-colors duration-200",
                  on
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]"
                    : "text-sidebar-foreground/75 hover:bg-white/5 hover:text-white",
                  collapsed && "justify-center px-0",
                )}
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-xl transition-all duration-300",
                    on ? "tile-accent scale-105" : "bg-white/[0.07] text-white/85",
                  )}
                >
                  <s.icon className="size-[18px]" strokeWidth={2} aria-hidden />
                </span>
                {collapsed ? (
                  <span className="sr-only">{t(s.label)}</span>
                ) : (
                  <span className="truncate">{t(s.label)}</span>
                )}
                {on && !collapsed ? (
                  <span
                    className="bg-gold-300 anim-pop ml-auto size-2 rounded-full shadow-[0_0_10px_var(--gold-300)]"
                    aria-hidden
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={toggle}
        className="press m-3 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 text-sm text-white/70 hover:bg-white/5 hover:text-white"
        aria-label={collapsed ? t("sections.expand") : t("sections.collapse")}
      >
        {collapsed ? (
          <PanelLeftOpen className="size-5" aria-hidden />
        ) : (
          <PanelLeftClose className="size-5" aria-hidden />
        )}
        {collapsed ? null : t("sections.collapse")}
      </button>
    </nav>
  );
}

export function BottomBar() {
  const { t } = useI18n();
  const active = useActiveSection();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const primary = SECTIONS.filter((s) => s.primary);
  const inAll = active !== undefined && !active.primary;
  return (
    <>
      <nav
        aria-label={t("sections.title")}
        data-testid="bottom-bar"
        className="glass fixed inset-x-0 bottom-0 z-30 border-t border-(--hairline) pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_30px_-12px_rgb(20_40_30/0.25)] lg:hidden print:hidden"
      >
        <ul className="mx-auto grid max-w-xl grid-cols-5 px-1">
          {primary.map((s) => {
            const on = active?.key === s.key;
            return (
              <li key={s.key} className={`accent-${s.key}`}>
                <Link
                  href={s.href}
                  aria-current={on ? "page" : undefined}
                  data-testid={`tab-${s.key}`}
                  className={cn(
                    "press flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[11.5px] leading-tight",
                    on ? "text-foreground font-bold" : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-8 w-14 items-center justify-center rounded-full transition-all duration-300",
                      on && "tile-accent anim-pop",
                    )}
                  >
                    <s.icon className="size-5" strokeWidth={on ? 2.1 : 1.75} aria-hidden />
                  </span>
                  <span className="line-clamp-1 text-center">{t(s.short)}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              aria-current={inAll ? "page" : undefined}
              data-testid="tab-all"
              className={cn(
                "press flex min-h-16 w-full flex-col items-center justify-center gap-1 px-1 text-[11.5px] leading-tight",
                inAll ? "text-foreground font-bold" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex h-8 w-14 items-center justify-center rounded-full transition-all duration-300",
                  inAll && active && `tile-accent anim-pop accent-${active.key}`,
                )}
              >
                <LayoutGrid className="size-5" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="line-clamp-1">
                {inAll && active ? t(active.short) : t("sections.all")}
              </span>
            </button>
          </li>
        </ul>
      </nav>
      {open ? (
        <BottomSheet
          open={open}
          onOpenChange={setOpen}
          title={t("sections.all")}
          testId="all-sections"
        >
          <ul className="grid grid-cols-2 gap-3 pb-2">
            {SECTIONS.map((s) => {
              const on = active?.key === s.key;
              return (
                <li key={s.key} className={`accent-${s.key}`}>
                  <Link
                    href={s.href}
                    onClick={(e) => {
                      e.preventDefault();
                      const href = e.currentTarget.getAttribute("href") ?? "/";
                      closeThenNavigate(
                        () => setOpen(false),
                        () => router.push(href),
                      );
                    }}
                    aria-current={on ? "page" : undefined}
                    data-testid={`all-${s.key}`}
                    className={cn(
                      "press lift shadow-card relative flex min-h-24 flex-col items-start justify-between gap-2 overflow-hidden rounded-2xl border p-3.5 text-left",
                      on
                        ? "border-transparent bg-[color-mix(in_oklab,var(--sa)_10%,var(--card))] ring-2 ring-(--sa)/50"
                        : "bg-card",
                    )}
                  >
                    <span
                      className={cn(
                        "tile-accent flex size-11 items-center justify-center rounded-xl",
                      )}
                    >
                      <s.icon className="size-5" strokeWidth={1.75} aria-hidden />
                    </span>
                    <span className="text-[15px] leading-snug font-semibold">{t(s.label)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </BottomSheet>
      ) : null}
    </>
  );
}
