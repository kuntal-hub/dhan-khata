"use client";

import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowLeft, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/I18nProvider";
import { ActionLink } from "./ActionLink";
import { sectionOf } from "./sections";

/**
 * Page title row with an optional back button and actions (right). `edit` adds the highlighted
 * edit button under the actions, so a detail page's edit form is found without scrolling.
 */
export function PageTitle({
  title,
  back,
  actions,
  subtitle,
  edit,
}: {
  title: string;
  back?: string | true;
  actions?: ReactNode;
  subtitle?: string;
  edit?: { href: string; label: string; testId?: string } | null;
}) {
  const t = useT();
  const router = useRouter();
  const section = sectionOf(usePathname());
  return (
    <div className={`anim-rise flex items-start gap-3 accent-${section?.key ?? "dashboard"}`}>
      {back ? (
        <Button
          variant="outline"
          size="icon"
          className="size-11 shrink-0 rounded-full"
          aria-label={t("common.back")}
          onClick={() => (back === true ? router.back() : router.push(back))}
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Button>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col pt-1">
        <h1 className="flex items-center gap-2 text-xl leading-tight font-bold sm:text-2xl">
          <span className="bg-accent-grad h-6 w-1.5 shrink-0 rounded-full" aria-hidden />
          <span className="min-w-0">{title}</span>
        </h1>
        {subtitle ? <p className="text-muted-foreground text-sm">{subtitle}</p> : null}
      </div>
      {actions || edit ? (
        <div className="flex shrink-0 flex-col items-end gap-2">
          {actions ? <div className="flex gap-2">{actions}</div> : null}
          {edit ? (
            <ActionLink href={edit.href} label={edit.label} icon={Pencil} testId={edit.testId} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
