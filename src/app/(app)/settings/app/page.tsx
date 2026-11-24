"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Choice } from "@/components/forms/fields";
import { Loading } from "@/components/lists/common";
import { PageHeader, ReadOnlyNotice } from "@/components/system/page";
import {
  clientErrorsOnline,
  compactOnline,
  getAppSettingsOnline,
  setAppSettingsOnline,
  storageOnline,
  type AppSettingsDto,
  type ClientErrorDto,
  type StorageDto,
} from "@/client/admin";
import { errorKey } from "@/client/errors";
import { useAccessibleGodowns } from "@/client/hooks";
import { dot } from "@/client/ui/text";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppSelector } from "@/store";

function hourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Owner: digest time, default language, storage gauge, diagnostics, year close (spec §9.16). */
export default function AppSettingsPage() {
  const { t, count } = useI18n();
  const isOwner = useAppSelector((s) => s.session.isOwner);
  const godowns = useAccessibleGodowns() ?? [];
  const [settings, setSettings] = useState<AppSettingsDto | null>(null);
  const [storage, setStorage] = useState<StorageDto | null>(null);
  const [errors, setErrors] = useState<ClientErrorDto[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isOwner) return;
    Promise.all([getAppSettingsOnline(), storageOnline(), clientErrorsOnline()])
      .then(([s, st, e]) => {
        setSettings(s);
        setStorage(st);
        setErrors(e.errors);
      })
      .catch(() => setOffline(true));
  }, [isOwner]);
  if (!isOwner) return <ReadOnlyNotice reason="viewer" />;
  const save = async (next: AppSettingsDto) => {
    setSettings(next);
    try {
      await setAppSettingsOnline(next);
      toast.success(t("common.saved"));
    } catch (e) {
      toast.error(t(errorKey(e)));
    }
  };
  const compact = async () => {
    setBusy(true);
    try {
      const r = await compactOnline();
      toast.success(t("settings.compactDone", { count: String(r.changelog) }));
    } catch (e) {
      toast.error(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  const used = storage
    ? Math.min(100, Math.round((storage.totalBytes / storage.limitBytes) * 100))
    : 0;
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={t("settings.appSettings")} />
      {offline ? <p className="text-destructive text-sm">{t("settings.onlineNeeded")}</p> : null}
      {!settings && !offline ? <Loading /> : null}
      {settings ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <label className="flex flex-col gap-1 text-sm">
              {t("settings.digestHour")}
              <select
                className="border-input h-12 rounded-md border px-2 text-base"
                value={settings.digestHour}
                onChange={(e) => void save({ ...settings, digestHour: Number(e.target.value) })}
                data-testid="digest-hour"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </label>
            <Choice
              label={t("settings.defaultLanguage")}
              value={settings.defaultLanguage}
              onChange={(defaultLanguage) => void save({ ...settings, defaultLanguage })}
              options={[
                { value: "bn", label: t("lang.bn") },
                { value: "en", label: t("lang.en") },
              ]}
            />
          </CardContent>
        </Card>
      ) : null}
      {storage ? (
        <Card data-testid="storage-gauge">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("settings.storage")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div
              className="bg-muted h-3 w-full overflow-hidden rounded-full"
              role="progressbar"
              aria-valuenow={used}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`h-full ${used > 78 ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${used}%` }}
              />
            </div>
            <span className="tabular">
              {t("settings.storageOf", {
                used: mb(storage.totalBytes),
                limit: mb(storage.limitBytes),
              })}
            </span>
            <ul className="flex flex-col">
              {storage.godowns.map((g) => (
                <li key={g.godownId} className="flex justify-between gap-2 border-t py-1">
                  <span>{godowns.find((x) => x._id === g.godownId)?.name ?? g.godownId}</span>
                  <span className="tabular">{dot(count(g.docs), mb(g.approxBytes))}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      {errors ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("settings.diagnostics")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-xs">
            {errors.length === 0 ? (
              <span className="text-muted-foreground">{t("settings.noErrors")}</span>
            ) : null}
            {errors.map((e) => (
              <div key={e._id} className="border-t py-1">
                <div className="font-medium">
                  {dot(new Date(e.at).toLocaleString(), e.route, e.appVersion)}
                </div>
                <div className="text-muted-foreground break-words">{e.message}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
      {settings ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("settings.compact")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p className="text-muted-foreground">{t("settings.compactHint")}</p>
            <Button
              variant="outline"
              className="h-11 self-start"
              disabled={busy}
              onClick={() => void compact()}
            >
              {t("settings.compact")}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
