"use client";

/**
 * A main section page (requirement_v2 §11): section heading (icon tile + title + active Gola),
 * internal tabs as an animated pill bar (`?tab=`, static route) and the active tab's content.
 * The heading carries the highlighted add-buttons of the active tab (`Section.actions`).
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { golaColourClass } from "@/components/gola/colours";
import { FadeSlide } from "@/components/motion/Motion";
import { PageSuspense, useWriteGodown } from "@/components/system/page";
import { mayOpenPath } from "@/client/access";
import { useActiveGodown, useGodownRole, useRiceShown } from "@/client/hooks";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { ActionLink } from "./ActionLink";
import { actionsOf, sectionByKey, tabsOf, type Section, type SectionAction } from "./sections";

export function useTab(section: Section): string {
  const sp = useSearchParams();
  const tab = sp.get("tab");
  const tabs = tabsOf(section, useRiceShown());
  return tabs.some((t) => t.key === tab) ? tab! : section.tabs[0]!.key;
}

function Tabs({ section, active }: { section: Section; active: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const path = usePathname();
  const rice = useRiceShown();
  return (
    <div className="glass sticky top-16 z-20 -mx-3 px-1 sm:-mx-4 sm:px-2 lg:mx-0 lg:rounded-2xl lg:px-2">
      <div className="tabbar" role="tablist" aria-label={t(section.label)}>
        {tabsOf(section, rice).map((tab) => {
          const on = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={on}
              className="tab"
              data-testid={`stab-${tab.key}`}
              onClick={() =>
                router.replace(tab.key === section.tabs[0]!.key ? path : `${path}?tab=${tab.key}`, {
                  scroll: false,
                })
              }
            >
              {t(tab.label)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The add-buttons of the active tab (forms are actions, so they are real buttons, never tabs).
 * Hidden where nothing can be written (all Golas / archived) and for screens the role may not open.
 */
function useActions(section: Section, tab: string): SectionAction[] {
  const rice = useRiceShown();
  const role = useGodownRole();
  const { readOnly } = useWriteGodown();
  if (readOnly) return [];
  return actionsOf(section, tab, rice).filter((a) => mayOpenPath(role, a.href));
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
  const buttons = useActions(section, tab);
  const Icon = section.icon;
  return (
    <div
      className={cn("flex flex-col gap-4", `accent-${section.key}`)}
      data-testid={`section-${section.key}`}
    >
      <div className="hero anim-zoom rounded-[1.75rem] px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex items-center gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 shadow-[inset_0_1px_0_rgb(255_255_255/0.35)] ring-1 ring-white/30 sm:size-14">
            <Icon className="size-6 sm:size-7" strokeWidth={2} aria-hidden />
          </span>
          <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
            <h1 className="max-w-full truncate text-xl leading-tight font-bold drop-shadow-sm sm:text-2xl">
              {t(section.label)}
            </h1>
            {consolidated || godown ? (
              <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-black/15 px-2.5 py-0.5 text-xs font-medium">
                {consolidated ? (
                  t("gola.all")
                ) : godown ? (
                  <>
                    <span
                      className={`size-2 shrink-0 rounded-full ring-1 ring-white/70 ${golaColourClass(godown.colour)}`}
                      aria-hidden
                    />
                    <span className="truncate">{godown.name}</span>
                  </>
                ) : null}
              </span>
            ) : null}
          </div>
          {actions}
          {/* One add-button sits beside the title; two or more get their own row. */}
          {buttons.length === 1 ? (
            <ActionLink
              tone="hero"
              href={buttons[0]!.href}
              label={t(buttons[0]!.label)}
              icon={buttons[0]!.icon}
              testId={buttons[0]!.testId}
            />
          ) : null}
        </div>
        {buttons.length > 1 ? (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            {buttons.map((a) => (
              <ActionLink
                key={a.key}
                tone="hero"
                full
                href={a.href}
                label={t(a.label)}
                icon={a.icon}
                testId={a.testId}
              />
            ))}
          </div>
        ) : null}
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
