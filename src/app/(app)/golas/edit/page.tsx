"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FormError, TextInput } from "@/components/auth/AuthBits";
import { GolaForm } from "@/components/gola/GolaForm";
import { PageTitle } from "@/components/shell/PageTitle";
import { PageSuspense, useParam } from "@/components/system/page";
import { lazyToast } from "@/components/system/IdleToaster";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loading } from "@/components/lists/common";
import { useAccessibleGodowns, useGodownSettings } from "@/client/hooks";
import { errorKey } from "@/client/errors";
import { updateGodownSettings } from "@/client/repo";
import { gramsToInput, parseWeightIn } from "@/domain/units";
import { useI18n } from "@/i18n/I18nProvider";

function EditGola() {
  const { t } = useI18n();
  const router = useRouter();
  const id = useParam("id");
  const golas = useAccessibleGodowns();
  const g = golas?.find((x) => x._id === id);
  const settings = useGodownSettings(g?._id ?? null);
  if (!golas || (g && !settings)) return <Loading />;
  if (!g) return <p className="text-muted-foreground">{t("errors.domain.NOT_FOUND")}</p>;
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title={g.name} back="/golas" subtitle={t("gola.edit")} />
      <Card className="rounded-2xl">
        <CardContent className="pt-6">
          <GolaForm
            existing={g}
            onSaved={() => {
              lazyToast(t("gola.saved"), "success");
              router.push("/golas");
            }}
          />
        </CardContent>
      </Card>
      {settings ? <LowStockCard godownId={g._id} initialG={settings.lowStock?.totalG} /> : null}
    </div>
  );
}

/** Low-stock alert threshold for warehouse paddy (§9.3). Works offline (Gola settings sync). */
function LowStockCard({ godownId, initialG }: { godownId: string; initialG?: string }) {
  const { t } = useI18n();
  const [value, setValue] = useState(initialG ? gramsToInput(BigInt(initialG), "QTL") : "");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    let totalG: string | undefined;
    if (value.trim()) {
      const r = parseWeightIn(value, "QTL");
      if (!r.ok) {
        setError(t(r.error));
        return;
      }
      totalG = r.value.toString();
    }
    try {
      await updateGodownSettings(godownId, { lowStock: totalG ? { totalG } : {} });
      lazyToast(t("gola.saved"), "success");
    } catch (e) {
      setError(t(errorKey(e)));
    }
  };
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-lg">{t("gola.lowStock")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field id="low-stock" label={t("gola.lowStockTotal")}>
          <TextInput
            id="low-stock"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="tabular-nums"
          />
        </Field>
        <FormError message={error} />
        <Button className="h-12 text-base" onClick={() => void save()} data-testid="low-stock-save">
          {t("common.save")}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function EditGolaPage() {
  return (
    <PageSuspense>
      <EditGola />
    </PageSuspense>
  );
}
