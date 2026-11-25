"use client";

/**
 * A main section page (requirement_v2 §11): section heading (icon tile + title + active Gola),
 * internal tabs as an animated pill bar (`?tab=`, static route) and the active tab's content.
 * Tabs with `href` open their own page (e.g. "নতুন কেনা" → the form).
 */
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { golaColourClass } from "@/components/gola/colours";
import { FadeSlide } from "@/components/motion/Motion";
import { PageSuspense } from "@/components/system/page";
import { useActiveGodown } from "@/client/hooks";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { sectionByKey, type Section } from "./sections";

export function useTab(section: Section): string {
  const sp = useSearchParams();
  const tab = sp.get("tab");
  return section.tabs.some((t) => t.key === tab && !t.href) ? tab! : section.tabs[0]!.key;
}

function Tabs({ section, active }: { section: Section; active: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const path = usePathname();
  return (
    <div
      className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0"
      role="tablist"
      aria-label={t(section.label)}
    >
      <div className="bg-card shadow-card inline-flex min-w-max gap-1 rounded-2xl border p-1">
        {section.tabs.map((tab) => {
          const on = tab.key === active;
          const cls = cn(
            "press relative flex min-h-11 items-center rounded-xl px-3.5 text-[15px] whitespace-nowrap transition-colors duration-200",
            on
              ? "bg-primary text-primary-foreground font-semibold shadow-sm"
              : "text-foreground/75 hover:bg-muted hover:text-foreground",
          );
          return tab.href ? (
            <Link
              key={tab.key}
              href={tab.href}
              className={cls}
              role="tab"
              aria-selected={false}
              data-testid={`stab-${tab.key}`}
            >
              <span className="relative">{t(tab.label)}</span>
            </Link>
          ) : (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={on}
              className={cls}
              data-testid={`stab-${tab.key}`}
              onClick={() =>
                router.replace(tab.key === section.tabs[0]!.key ? path : `${path}?tab=${tab.key}`, {
                  scroll: false,
                })
              }
            >
              <span className="relative">{t(tab.label)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SectionPageInner({
  sectionKey,
  render,
  actions,
}: {
  sectionKey: Section["key"];
  render: (tab: string) => ReactNode;
  actions?: ReactNode;
}) {
  const { t } = useI18n();
  const section = sectionByKey(sectionKey);
  const tab = useTab(section);
  const { godown, consolidated } = useActiveGodown();
  const Icon = section.icon;
  return (
    <div className="flex flex-col gap-4" data-testid={`section-${section.key}`}>
      <div className="flex items-center gap-3">
        <span className="bg-forest-100 text-forest flex size-11 shrink-0 items-center justify-center rounded-xl">
          <Icon className="size-6" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate text-xl leading-tight font-semibold sm:text-2xl">
            {t(section.label)}
          </h1>
          <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
            {consolidated ? (
              t("gola.all")
            ) : godown ? (
              <>
                <span
                  className={`size-2 rounded-full ${golaColourClass(godown.colour)}`}
                  aria-hidden
                />
                {godown.name}
              </>
            ) : null}
          </span>
        </div>
        {actions}
      </div>
      <Tabs section={section} active={tab} />
      <FadeSlide k={tab}>{render(tab)}</FadeSlide>
    </div>
  );
}

export function SectionPage(props: {
  sectionKey: Section["key"];
  render: (tab: string) => ReactNode;
  actions?: ReactNode;
}) {
  return (
    <PageSuspense>
      <SectionPageInner {...props} />
    </PageSuspense>
  );
}
