"use client";

/**
 * Create / edit a Gola (requirement_v2 §2.2): name, short code (immutable after creation),
 * address, phone, firm name for receipts, colour chip. Online (the server writes Gola records).
 */
import { useState, type FormEvent } from "react";
import { Check, Loader2 } from "lucide-react";
import { Field, FormError, TextInput } from "@/components/auth/AuthBits";
import { Button } from "@/components/ui/button";
import { createGodownOnline, updateGodownOnline } from "@/client/godown/manage";
import { errorKey } from "@/client/errors";
import { ApiCallError } from "@/client/sync/transport";
import { GOLA_COLOURS } from "@/domain/v2/accounts";
import type { Godown } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import { golaColourClass } from "./colours";

export function GolaForm({
  existing,
  onSaved,
}: {
  existing?: Godown;
  onSaved: (g: Godown) => void;
}) {
  const { t, lang } = useI18n();
  const [form, setForm] = useState({
    name: existing?.name ?? "",
    code: existing?.code ?? "",
    address: existing?.address ?? "",
    phone: existing?.phone ?? "",
    firmName: existing?.firmName ?? "",
    colour: existing?.colour ?? GOLA_COLOURS[0],
  });
  const [errors, setErrors] = useState<{ name?: string; code?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: k === "code" ? e.target.value.toUpperCase() : e.target.value }));
  const opt = (s: string) => (s.trim() ? s.trim() : undefined);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v: typeof errors = {};
    if (!form.name.trim()) v.name = t("acct.required");
    if (!existing && !/^[A-Z][A-Z0-9]{1,5}$/.test(form.code)) v.code = t("gola.codeHint");
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    setError(null);
    try {
      const common = {
        name: form.name.trim(),
        colour: form.colour,
        ...(opt(form.address) ? { address: opt(form.address)! } : {}),
        ...(opt(form.phone) ? { phone: opt(form.phone)! } : {}),
        ...(opt(form.firmName) ? { firmName: opt(form.firmName)! } : {}),
      };
      const g = existing
        ? await updateGodownOnline({
            godownId: existing._id,
            receiptLanguage: existing.receiptLanguage,
            ...common,
          })
        : await createGodownOnline({ ...common, code: form.code, receiptLanguage: lang });
      onSaved(g);
    } catch (err) {
      setError(
        err instanceof ApiCallError && err.code === "GODOWN_CODE_TAKEN"
          ? t("gola.codeTaken")
          : t(errorKey(err)),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => void submit(e)}
      noValidate
      data-testid="gola-form"
    >
      <Field id="gola-name" label={t("gola.name")} error={errors.name}>
        <TextInput id="gola-name" value={form.name} onChange={set("name")} />
      </Field>
      <Field
        id="gola-code"
        label={t("gola.code")}
        hint={existing ? undefined : t("gola.codeHint")}
        error={errors.code}
      >
        <TextInput
          id="gola-code"
          value={form.code}
          onChange={set("code")}
          disabled={!!existing}
          maxLength={6}
          autoCapitalize="characters"
          className="font-mono uppercase"
        />
      </Field>
      <Field id="gola-address" label={t("gola.address")}>
        <TextInput id="gola-address" value={form.address} onChange={set("address")} />
      </Field>
      <Field id="gola-phone" label={t("gola.phone")}>
        <TextInput id="gola-phone" inputMode="tel" value={form.phone} onChange={set("phone")} />
      </Field>
      <Field id="gola-firm" label={t("gola.firmName")}>
        <TextInput id="gola-firm" value={form.firmName} onChange={set("firmName")} />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-base font-medium">{t("gola.colour")}</legend>
        <div className="flex flex-wrap gap-3">
          {GOLA_COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={form.colour === c}
              aria-label={c}
              onClick={() => setForm((f) => ({ ...f, colour: c }))}
              className={`flex size-11 items-center justify-center rounded-full ring-offset-2 transition-shadow ${golaColourClass(c)} ${form.colour === c ? "ring-primary ring-2" : ""}`}
            >
              {form.colour === c ? <Check className="size-5 text-white" aria-hidden /> : null}
            </button>
          ))}
        </div>
      </fieldset>
      <FormError message={error} />
      <Button type="submit" className="h-12 text-base" disabled={busy} data-testid="gola-save">
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {busy ? t("gola.creating") : existing ? t("common.save") : t("gola.create")}
      </Button>
    </form>
  );
}
