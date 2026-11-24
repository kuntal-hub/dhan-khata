"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/I18nProvider";

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
  return (
    <div className="flex items-start gap-2">
      {back ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-11 shrink-0"
          aria-label={t("common.back")}
          onClick={() => (back === true ? router.back() : router.push(back))}
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Button>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col pt-1.5">
        <h1 className="text-xl leading-tight font-semibold">{title}</h1>
        {subtitle ? <p className="text-muted-foreground text-sm">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  );
}
