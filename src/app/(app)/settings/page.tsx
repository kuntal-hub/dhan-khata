"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Choice } from "@/components/forms/fields";
import { PercentInput, WeightInput } from "@/components/money/inputs";
import { Loading } from "@/components/lists/common";
import { PageHeader, useWriteGodown } from "@/components/system/page";
import { useGodownSettings } from "@/components/trade/hooks";
import { errorKey } from "@/client/errors";
import { dot } from "@/client/ui/text";
import { useGodownRole } from "@/client/hooks";
import { updateGodownSettings } from "@/client/repo";
import { bpsToInput, gramsToKgInput, parsePercentField, parseWeightField } from "@/client/ui/parse";
import type { DhaltaMode, GodownSettings } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import type { WeightDisplay } from "@/i18n/format";
import { actions, useAppDispatch } from "@/store";

const MASTER_TABS = ["varieties", "categories", "banks", "vehicles", "places"] as const;

/** Settings (spec §9.16): My preferences + This godown (masters, deduction defaults, rounding). */
export default function SettingsPage() {
  const { t, lang, setLang, digits, setDigits, weight } = useI18n();
  const dispatch = useAppDispatch();
  const { godownId, godown, readOnly } = useWriteGodown();
  const settings = useGodownSettings(godownId);
  const role = useGodownRole();
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={t("settings.title")} />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("settings.myPreferences")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Choice
            label={t("common.language")}
            value={lang}
            onChange={setLang}
            options={[
              { value: "bn", label: t("lang.bn") },
              { value: "en", label: t("lang.en") },
            ]}
            testId="pref-language"
          />
          <Choice
            label={t("common.digits")}
            value={digits}
            onChange={setDigits}
            options={[
              { value: "bn", label: t("lang.digitsBn") },
              { value: "en", label: t("lang.digitsEn") },
            ]}
          />
          <Choice<WeightDisplay>
            label={t("settings.weightDisplay")}
            value={weight}
            onChange={(w) => dispatch(actions.locale.weightDisplayChanged(w))}
            options={[
              { value: "qtlKg", label: t("settings.weightQtlKg") },
              { value: "kg", label: t("settings.weightKg") },
              { value: "qtl", label: t("settings.weightQtl") },
            ]}
          />
        </CardContent>
      </Card>
      {godownId && !readOnly ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {dot(t("settings.thisGodown"), godown?.name)}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <ul className="flex flex-col">
              {MASTER_TABS.map((tab) => (
                <li key={tab}>
                  <Link
                    href={`/settings/masters?tab=${tab}`}
                    className="hover:bg-muted flex min-h-12 items-center justify-between rounded-md px-2"
                    data-testid={`masters-${tab}`}
                  >
                    {t(`masters.tab.${tab}`)}
                    <ChevronRight className="size-4" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
            {settings ? (
              role === "owner" ? (
                <DefaultsEditor godownId={godownId} settings={settings} />
              ) : null
            ) : (
              <Loading />
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function DefaultsEditor({ godownId, settings }: { godownId: string; settings: GodownSettings }) {
  const { t } = useI18n();
  const d = settings.defaults.deductions;
  const [tare, setTare] = useState(
    gramsToKgInput(d.tarePerBagG !== "0" ? d.tarePerBagG : undefined),
  );
  const [mode, setMode] = useState<DhaltaMode>(d.dhaltaMode ?? "PER_QUINTAL");
  const [dhalta, setDhalta] = useState(
    gramsToKgInput(d.dhaltaValueG !== "0" ? d.dhaltaValueG : undefined),
  );
  const [moisture, setMoisture] = useState(bpsToInput(d.moistureBps || undefined));
  const [round, setRound] = useState(settings.rounding.roundToRupee);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const tp = parseWeightField(tare);
    const dp = parseWeightField(dhalta);
    const mp = parsePercentField(moisture);
    if (tp.error || dp.error || mp.error) return;
    setSaving(true);
    try {
      await updateGodownSettings(godownId, {
        defaults: {
          deductions: {
            tarePerBagG: (tp.value ?? 0n).toString(),
            dhaltaMode: mode,
            dhaltaValueG: (dp.value ?? 0n).toString(),
            ...(mp.value ? { moistureBps: Number(mp.value) } : {}),
          },
        },
        rounding: { roundToRupee: round },
      });
      toast.success(t("common.saved"));
    } catch (e) {
      toast.error(t(errorKey(e)));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 border-t pt-3" data-testid="godown-defaults">
      <h3 className="text-sm font-semibold">{t("settings.deductionDefaults")}</h3>
      <WeightInput label={t("trade.bagTare")} value={tare} onChange={setTare} />
      <Choice
        label={t("trade.dhalta")}
        value={mode}
        onChange={setMode}
        options={[
          { value: "PER_QUINTAL", label: t("trade.dhaltaPerQtl") },
          { value: "PER_BAG", label: t("trade.dhaltaPerBag") },
          { value: "FIXED", label: t("trade.dhaltaFixed") },
        ]}
      />
      <WeightInput label={t("trade.dhaltaValue")} value={dhalta} onChange={setDhalta} />
      <PercentInput label={t("trade.moistureCut")} value={moisture} onChange={setMoisture} />
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-5"
          checked={round}
          onChange={(e) => setRound(e.target.checked)}
        />
        {t("settings.roundToRupee")}
      </label>
      <Button className="h-11 self-start" onClick={() => void save()} disabled={saving}>
        {t("common.save")}
      </Button>
    </div>
  );
}
