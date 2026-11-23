"use client";

import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { amountInWords } from "@/domain/amountInWords";
import { todayIST } from "@/domain/dates";
import { useI18n } from "@/i18n/I18nProvider";

/** Golden case G1: net 1,212.500 kg × ₹2,150.00/qtl = ₹26,068.75 */
const SAMPLE_PAISE = 2606875n;
const SAMPLE_GRAMS = 1212500n;

export default function HomePage() {
  const { t, lang, digits, setLang, setDigits, money, weightOf, date } = useI18n();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-primary text-2xl font-semibold">{t("common.appName")}</h1>
          <p className="text-muted-foreground line-clamp-2 text-sm">{t("common.appTagline")}</p>
        </div>
        <Button
          variant="outline"
          className="h-11 shrink-0"
          onClick={() => setLang(lang === "bn" ? "en" : "bn")}
          aria-label={t("lang.switchTo")}
        >
          <Languages className="size-4" aria-hidden />
          {lang === "bn" ? t("lang.en") : t("lang.bn")}
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("shell.demoTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Row label={t("shell.demoAmount")} value={money(SAMPLE_PAISE)} large />
          <Row label={t("shell.demoWeight")} value={weightOf(SAMPLE_GRAMS)} />
          <Row label={t("shell.demoInWords")} value={amountInWords(SAMPLE_PAISE, lang)} />
          <Row label={t("shell.demoDate")} value={date(todayIST())} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-sm">{t("common.digits")}</span>
        <Button
          variant={digits === "bn" ? "default" : "outline"}
          className="h-11"
          onClick={() => setDigits("bn")}
        >
          {t("lang.digitsBn")}
        </Button>
        <Button
          variant={digits === "en" ? "default" : "outline"}
          className="h-11"
          onClick={() => setDigits("en")}
        >
          {t("lang.digitsEn")}
        </Button>
      </div>

      <p className="text-muted-foreground text-sm">{t("shell.phaseNote")}</p>
    </main>
  );
}

function Row({ label, value, large }: { label: string; value: string; large?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className={large ? "tabular text-3xl font-semibold" : "tabular text-base"}>
        {value}
      </span>
    </div>
  );
}
