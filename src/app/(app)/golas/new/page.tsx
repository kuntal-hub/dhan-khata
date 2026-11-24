"use client";

import { useRouter } from "next/navigation";
import { GolaForm } from "@/components/gola/GolaForm";
import { PageTitle } from "@/components/shell/PageTitle";
import { lazyToast } from "@/components/system/IdleToaster";
import { Card, CardContent } from "@/components/ui/card";
import { useActiveGodown } from "@/client/hooks";
import { useI18n } from "@/i18n/I18nProvider";

export default function NewGolaPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { select } = useActiveGodown();
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title={t("gola.add")} back="/golas" subtitle={t("gola.firstHint")} />
      <Card className="rounded-2xl">
        <CardContent className="pt-6">
          <GolaForm
            onSaved={(g) => {
              lazyToast(t("gola.created"), "success");
              select(g._id);
              router.push("/golas");
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
