"use client";

import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/I18nProvider";
import { sectionOf } from "./sections";

/** Page title row with an optional back button and actions (right). */
export function PageTitle({
  title,
  back,
  actions,
  subtitle,
}: {
  title: string;
  back?: string | true;
  actions?: ReactNode;
  subtitle?: string;
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
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  );
}
