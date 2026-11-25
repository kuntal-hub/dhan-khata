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
        "bg-sidebar sticky top-0 hidden h-dvh shrink-0 flex-col border-r transition-[width] duration-200 lg:flex print:hidden",
        collapsed ? "w-[76px]" : "w-64",
      )}
    >
      <div className={cn("flex h-16 items-center gap-3 px-4", collapsed && "justify-center px-0")}>
        <LogoMark className="size-9" />
        {collapsed ? null : (
          <span className="text-primary truncate text-lg font-semibold">{t("common.appName")}</span>
        )}
      </div>
      <ul className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
        {SECTIONS.map((s) => {
          const on = active?.key === s.key;
          return (
            <li key={s.key} className="relative">
              <Link
                href={s.href}
                aria-current={on ? "page" : undefined}
                title={collapsed ? t(s.label) : undefined}
                data-testid={`nav-${s.key}`}
                className={cn(
                  "press relative flex min-h-12 items-center gap-3 rounded-xl px-3 text-[15px] transition-colors duration-200",
                  on
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                    : "text-foreground/80 hover:bg-muted",
                  collapsed && "justify-center px-0",
                )}
              >
                <s.icon
                  className={cn("size-5 shrink-0", on ? "text-primary" : "")}
                  strokeWidth={1.75}
                  aria-hidden
                />
                {collapsed ? (
                  <span className="sr-only">{t(s.label)}</span>
                ) : (
                  <span className="truncate">{t(s.label)}</span>
                )}
                {on && !collapsed ? (
                  <span className="bg-gold ml-auto h-5 w-1 rounded-full" aria-hidden />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={toggle}
        className="text-muted-foreground hover:text-foreground press m-3 flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm"
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
        className="bg-card/95 fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_10px_rgb(30_45_35/0.06)] backdrop-blur lg:hidden print:hidden"
      >
        <ul className="mx-auto grid max-w-xl grid-cols-5">
          {primary.map((s) => {
            const on = active?.key === s.key;
            return (
              <li key={s.key}>
                <Link
                  href={s.href}
                  aria-current={on ? "page" : undefined}
                  data-testid={`tab-${s.key}`}
                  className={cn(
                    "press flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[11.5px] leading-tight",
                    on ? "text-primary font-semibold" : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                      on && "bg-secondary",
                    )}
                  >
                    <s.icon className="size-5" strokeWidth={1.75} aria-hidden />
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
                inAll ? "text-primary font-semibold" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-12 items-center justify-center rounded-full",
                  inAll && "bg-secondary",
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
                <li key={s.key}>
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
                      "press lift shadow-card flex min-h-24 flex-col items-start justify-between gap-2 rounded-2xl border p-3.5 text-left",
                      on ? "border-primary/40 bg-secondary" : "bg-card",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-10 items-center justify-center rounded-xl",
                        on ? "bg-primary text-primary-foreground" : "bg-gold-100 text-forest",
                      )}
                    >
                      <s.icon className="size-5" strokeWidth={1.75} aria-hidden />
                    </span>
                    <span className="text-[15px] leading-snug font-medium">{t(s.label)}</span>
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
