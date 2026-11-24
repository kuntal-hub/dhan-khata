"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useTheme } from "next-themes";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Choice, TextField } from "@/components/forms/fields";
import { BottomSheet } from "@/components/forms/BottomSheet";
import { PercentInput, WeightInput } from "@/components/money/inputs";
import { Loading } from "@/components/lists/common";
import { PageHeader, useWriteGodown } from "@/components/system/page";
import { useGodownSettings } from "@/components/trade/hooks";
import { errorKey } from "@/client/errors";
import { dot } from "@/client/ui/text";
import { useGodownRole, useMeta, useOutbox } from "@/client/hooks";
import {
  changePasswordOnline,
  forceFullResync,
  importUnsynced,
  savePrefsOnline,
} from "@/client/admin";
import { PIN_RE, normalizePin, setPin, verifyPin } from "@/client/auth/pin";
import { META } from "@/client/db/meta";
import { APP_VERSION } from "@/client/diagnostics";
import { downloadText } from "@/client/download";
import { exportUnsynced } from "@/client/sync/resolve";
import { getSyncEngine } from "@/client/sync/instance";
import type { TKey } from "@/i18n/translate";
import { updateGodownSettings } from "@/client/repo";
import { bpsToInput, gramsToKgInput, parsePercentField, parseWeightField } from "@/client/ui/parse";
import type { DhaltaMode, GodownSettings } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import type { WeightDisplay } from "@/i18n/format";
import { actions, useAppDispatch, useAppSelector } from "@/store";

const MASTER_TABS = ["varieties", "categories", "banks", "vehicles", "places"] as const;

/** Language / digits are stored on the user record too (synced to their other phones). */
function syncPrefs(language: "bn" | "en", digits: "bn" | "en") {
  void savePrefsOnline({ language, digits }).catch(() => {});
}

/**
 * Settings (spec §9.16): My preferences, This godown (masters, defaults), App (owner: godowns,
 * users & devices, app settings, integrity, backup) and About.
 */
export default function SettingsPage() {
  const { t, lang, setLang, digits, setDigits, weight } = useI18n();
  const dispatch = useAppDispatch();
  const { godownId, godown, readOnly } = useWriteGodown();
  const settings = useGodownSettings(godownId);
  const role = useGodownRole();
  const isOwner = useAppSelector((s) => s.session.isOwner);
  const { theme, setTheme } = useTheme();
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
            onChange={(l) => {
              setLang(l);
              syncPrefs(l, digits);
            }}
            options={[
              { value: "bn", label: t("lang.bn") },
              { value: "en", label: t("lang.en") },
            ]}
            testId="pref-language"
          />
          <Choice
            label={t("common.digits")}
            value={digits}
            onChange={(d) => {
              setDigits(d);
              syncPrefs(lang, d);
            }}
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
          <Choice
            label={t("settings.theme")}
            value={theme === "dark" ? "dark" : "light"}
            onChange={setTheme}
            options={[
              { value: "light", label: t("settings.themeLight") },
              { value: "dark", label: t("settings.themeDark") },
            ]}
          />
          <SecurityActions />
        </CardContent>
      </Card>
      {godownId && !readOnly && role !== "entry" ? (
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
            {role === "owner" ? (
              <Link
                href="/opening"
                className="hover:bg-muted flex min-h-12 items-center justify-between rounded-md px-2"
                data-testid="settings-opening"
              >
                {t("settings.openingBalances")}
                <ChevronRight className="size-4" aria-hidden />
              </Link>
            ) : null}
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
      {isOwner ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("settings.app")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col">
              {APP_LINKS.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="hover:bg-muted flex min-h-12 items-center justify-between rounded-md px-2"
                    data-testid={`settings-link-${l.href.split("/").pop()}`}
                  >
                    {t(l.label)}
                    <ChevronRight className="size-4" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      <AboutCard />
    </div>
  );
}

const APP_LINKS: Array<{ href: string; label: TKey }> = [
  { href: "/godowns", label: "nav.godowns" },
  { href: "/settings/users", label: "settings.users" },
  { href: "/settings/app", label: "settings.appSettings" },
  { href: "/settings/integrity", label: "settings.integrity" },
  { href: "/settings/backup", label: "settings.backup" },
];

function SecurityActions() {
  const { t } = useI18n();
  const [open, setOpen] = useState<"pin" | "password" | null>(null);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const close = () => {
    setOpen(null);
    setA("");
    setB("");
  };
  const savePin = async () => {
    if (!(await verifyPin(a))) return toast.error(t("settings.pinWrong"));
    if (!PIN_RE.test(normalizePin(b))) return toast.error(t("errors.validation.invalid"));
    await setPin(b);
    toast.success(t("settings.pinChanged"));
    close();
  };
  const savePassword = async () => {
    try {
      await changePasswordOnline(a, b);
      toast.success(t("settings.passwordChanged"));
      close();
    } catch (e) {
      toast.error(t(errorKey(e)));
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        className="h-11"
        onClick={() => setOpen("pin")}
        data-testid="change-pin"
      >
        {t("settings.changePin")}
      </Button>
      <Button variant="outline" className="h-11" onClick={() => setOpen("password")}>
        {t("settings.changePassword")}
      </Button>
      <BottomSheet
        open={open !== null}
        onOpenChange={(o) => !o && close()}
        title={open === "pin" ? t("settings.changePin") : t("settings.changePassword")}
      >
        <TextField
          label={open === "pin" ? t("settings.currentPin") : t("settings.currentPassword")}
          value={a}
          onChange={setA}
          inputMode={open === "pin" ? "numeric" : "text"}
        />
        <TextField
          label={open === "pin" ? t("settings.newPin") : t("settings.newPassword")}
          value={b}
          onChange={setB}
          inputMode={open === "pin" ? "numeric" : "text"}
        />
        {open === "password" ? (
          <p className="text-muted-foreground text-xs">{t("settings.onlineNeeded")}</p>
        ) : null}
        <Button
          className="h-12"
          disabled={!a || !b}
          onClick={() => void (open === "pin" ? savePin() : savePassword())}
        >
          {t("common.save")}
        </Button>
      </BottomSheet>
    </div>
  );
}

function AboutCard() {
  const { t, count } = useI18n();
  const outbox = useOutbox();
  const lastSync = useMeta<string>(META.lastSyncAt);
  const fileRef = useRef<HTMLInputElement>(null);
  const exportData = async () => {
    const text = await exportUnsynced();
    downloadText(`dhan-khata-unsynced-${new Date().toISOString().slice(0, 10)}.json`, text);
  };
  const importData = async (f: File) => {
    try {
      const n = await importUnsynced(await f.text());
      toast.success(t("settings.imported", { count: n }));
      void getSyncEngine().syncNow();
    } catch {
      toast.error(t("settings.importInvalid"));
    }
  };
  const resync = async () => {
    try {
      if (!(await forceFullResync())) toast.error(t("settings.resyncNeedsEmpty"));
      else toast.success(t("settings.resyncDone"));
    } catch (e) {
      toast.error(t(errorKey(e)));
    }
  };
  return (
    <Card data-testid="about">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("settings.about")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <div>{t("settings.version", { v: APP_VERSION })}</div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">{t("settings.lastSync")}</span>
          <span>{lastSync ? new Date(lastSync).toLocaleString() : t("settings.never")}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">{t("settings.pending")}</span>
          <span data-testid="about-pending">{count(outbox?.length ?? 0)}</span>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            variant="outline"
            className="h-11"
            onClick={() => void exportData()}
            data-testid="export-unsynced"
          >
            {t("settings.exportUnsynced")}
          </Button>
          <Button variant="outline" className="h-11" onClick={() => fileRef.current?.click()}>
            {t("settings.importUnsynced")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importData(f);
              e.target.value = "";
            }}
          />
          <Button variant="ghost" className="h-11" onClick={() => void resync()}>
            {t("settings.forceResync")}
          </Button>
        </div>
      </CardContent>
    </Card>
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
