"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { Field, FormError, TextInput } from "@/components/auth/AuthBits";
import { LogoMark } from "@/components/brand/Logo";
import { PageTitle } from "@/components/shell/PageTitle";
import { lazyToast } from "@/components/system/IdleToaster";
import { Loading } from "@/components/lists/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateBusinessProfile } from "@/client/auth/account";
import { META } from "@/client/db/meta";
import { errorKey } from "@/client/errors";
import { useMeta } from "@/client/hooks";
import type { Business } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";

const MAX_LOGO_CHARS = 180_000;

/** Shrink a picture to at most 256 px and encode it small (PNG, or JPEG if smaller). */
async function compressLogo(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 256 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale)); // float-ok: pixel size, not money
  canvas.height = Math.max(1, Math.round(bmp.height * scale)); // float-ok: pixel size
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const png = canvas.toDataURL("image/png");
  const jpg = canvas.toDataURL("image/jpeg", 0.85);
  return png.length <= jpg.length ? png : jpg;
}

/** Business profile (requirement_v2 §2.2): name, address, mobile, logo; mon size; deductions. */
export default function BusinessPage() {
  const business = useMeta<Business>(META.business);
  if (business === undefined) return <Loading />;
  return <BusinessForm business={business} />;
}

function BusinessForm({ business }: { business: Business }) {
  const { t } = useI18n();
  const file = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({
    name: business.name,
    address: business.address ?? "",
    mobile: business.mobile ?? "",
    monKg: String(business.monKg),
    deductions: business.settings.deductionsEnabled,
    logo: business.logoDataUrl ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (fl: File | undefined) => {
    if (!fl) return;
    try {
      const url = await compressLogo(fl);
      if (url.length > MAX_LOGO_CHARS) setError(t("biz.logoTooBig"));
      else setF((x) => ({ ...x, logo: url }));
    } catch {
      setError(t("biz.logoTooBig"));
    }
  };

  const save = async () => {
    const mon = /^\d{1,3}$/.test(f.monKg.trim()) ? parseInt(f.monKg.trim(), 10) : NaN; // float-ok: whole kilograms
    if (!f.name.trim()) return setError(t("acct.required"));
    if (!Number.isInteger(mon) || mon < 1 || mon > 100) return setError(t("errors.number.invalid"));
    setBusy(true);
    try {
      await updateBusinessProfile({
        name: f.name.trim(),
        ...(f.address.trim() ? { address: f.address.trim() } : {}),
        ...(f.mobile.trim() ? { mobile: f.mobile.trim() } : {}),
        logoDataUrl: f.logo,
        monKg: mon,
        deductionsEnabled: f.deductions,
      });
      lazyToast(t("biz.saved"), "success");
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title={t("biz.title")} subtitle={t("biz.hint")} />
      <Card className="rounded-2xl">
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex items-center gap-4">
            {f.logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- local data URL, no optimisation needed
              <img
                src={f.logo}
                alt={t("biz.logo")}
                className="size-20 rounded-2xl border object-contain"
              />
            ) : (
              <LogoMark className="size-20" />
            )}
            <div className="flex flex-col gap-2">
              <Button variant="outline" className="h-11" onClick={() => file.current?.click()}>
                <ImagePlus className="size-4" aria-hidden />
                {t("biz.logoChange")}
              </Button>
              {f.logo ? (
                <Button
                  variant="ghost"
                  className="text-destructive h-11"
                  onClick={() => setF({ ...f, logo: "" })}
                >
                  <Trash2 className="size-4" aria-hidden />
                  {t("biz.logoRemove")}
                </Button>
              ) : null}
              <input
                ref={file}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void pick(e.target.files?.[0])}
              />
            </div>
          </div>
          <Field id="biz-name" label={t("biz.name")}>
            <TextInput
              id="biz-name"
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </Field>
          <Field id="biz-address" label={t("biz.address")}>
            <TextInput
              id="biz-address"
              value={f.address}
              onChange={(e) => setF({ ...f, address: e.target.value })}
            />
          </Field>
          <Field id="biz-mobile" label={t("biz.mobile")}>
            <TextInput
              id="biz-mobile"
              inputMode="tel"
              value={f.mobile}
              onChange={(e) => setF({ ...f, mobile: e.target.value })}
            />
          </Field>
        </CardContent>
      </Card>
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-lg">{t("biz.units")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field id="biz-mon" label={t("biz.monKg")} hint={t("biz.monHint")}>
            <TextInput
              id="biz-mon"
              inputMode="numeric"
              className="tabular-nums"
              value={f.monKg}
              onChange={(e) => setF({ ...f, monKg: e.target.value })}
            />
          </Field>
          <label className="flex min-h-12 cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="accent-primary mt-1 size-6"
              checked={f.deductions}
              onChange={(e) => setF({ ...f, deductions: e.target.checked })}
              data-testid="biz-deductions"
            />
            <span className="flex flex-col">
              <span className="text-base font-medium">{t("biz.deductions")}</span>
              <span className="text-muted-foreground text-sm">{t("biz.deductionsHint")}</span>
            </span>
          </label>
        </CardContent>
      </Card>
      <FormError message={error} />
      <Button
        className="h-12 text-base"
        disabled={busy}
        onClick={() => void save()}
        data-testid="biz-save"
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {t("common.save")}
      </Button>
    </div>
  );
}
