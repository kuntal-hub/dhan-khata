"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { AuthHeader, Field, FormError, PasswordInput, TextInput } from "@/components/auth/AuthBits";
import { RecoveryCodeScreen } from "@/components/auth/RecoveryCodeScreen";
import { useAfterSignIn } from "@/components/auth/useAfterSignIn";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { register, registrationStatus } from "@/client/auth/account";
import type { SessionMeta } from "@/client/db/meta";
import { errorKey } from "@/client/errors";
import { normalizePhone } from "@/domain/phone";
import { useI18n } from "@/i18n/I18nProvider";

type Errors = Partial<Record<"name" | "mobile" | "password" | "again" | "business", string>>;

/** First-run owner registration (requirement_v2 §2.2). Closed once an owner exists. */
export default function RegisterPage() {
  const { t, lang } = useI18n();
  const afterSignIn = useAfterSignIn();
  const [open, setOpen] = useState<boolean | null>(null);
  const [form, setForm] = useState({
    name: "",
    mobile: "",
    password: "",
    again: "",
    business: "",
    address: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ session: SessionMeta; code: string } | null>(null);

  useEffect(() => {
    let alive = true;
    registrationStatus()
      .then((s) => alive && setOpen(s.registrationOpen))
      .catch(() => alive && setOpen(null));
    return () => {
      alive = false;
    };
  }, []);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const validate = (): Errors => {
    const out: Errors = {};
    if (!form.name.trim()) out.name = t("acct.required");
    if (!normalizePhone(form.mobile)) out.mobile = t("acct.mobileInvalid");
    if (form.password.length < 8) out.password = t("acct.passwordTooShort");
    if (form.again !== form.password) out.again = t("acct.passwordMismatch");
    if (!form.business.trim()) out.business = t("acct.required");
    return out;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await register({
        name: form.name.trim(),
        mobile: form.mobile,
        password: form.password,
        businessName: form.business.trim(),
        ...(form.address.trim() ? { businessAddress: form.address.trim() } : {}),
        language: lang,
        deviceLabel: navigator.userAgent.slice(0, 80),
      });
      setDone({ session: r.session, code: r.recoveryCode });
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <RecoveryCodeScreen code={done.code} onContinue={() => void afterSignIn(done.session)} />
    );
  }

  return (
    <>
      <AuthHeader />
      {open === false ? (
        <Card className="shadow-lift rounded-3xl">
          <CardContent className="flex flex-col gap-4 pt-6">
            <p className="text-base" data-testid="registration-closed">
              {t("acct.registrationClosed")}
            </p>
            <Button asChild className="h-12 text-base">
              <Link href="/login">{t("auth.login")}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-lift rounded-3xl">
          <CardHeader>
            <CardTitle className="text-xl">{t("acct.registerTitle")}</CardTitle>
            <p className="text-muted-foreground text-sm">{t("acct.registerHint")}</p>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)} noValidate>
              <Field id="reg-name" label={t("acct.name")} error={errors.name}>
                <TextInput
                  id="reg-name"
                  autoComplete="name"
                  value={form.name}
                  onChange={set("name")}
                  aria-invalid={!!errors.name}
                />
              </Field>
              <Field id="reg-mobile" label={t("acct.mobile")} error={errors.mobile}>
                <TextInput
                  id="reg-mobile"
                  inputMode="tel"
                  autoComplete="tel"
                  value={form.mobile}
                  onChange={set("mobile")}
                  aria-invalid={!!errors.mobile}
                />
              </Field>
              <Field id="reg-password" label={t("acct.password")} error={errors.password}>
                <PasswordInput
                  id="reg-password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={set("password")}
                  aria-invalid={!!errors.password}
                />
              </Field>
              <Field id="reg-again" label={t("acct.passwordAgain")} error={errors.again}>
                <PasswordInput
                  id="reg-again"
                  autoComplete="new-password"
                  value={form.again}
                  onChange={set("again")}
                  aria-invalid={!!errors.again}
                />
              </Field>
              <Field id="reg-business" label={t("acct.businessName")} error={errors.business}>
                <TextInput
                  id="reg-business"
                  value={form.business}
                  onChange={set("business")}
                  aria-invalid={!!errors.business}
                />
              </Field>
              <Field id="reg-address" label={t("acct.businessAddress")}>
                <TextInput
                  id="reg-address"
                  autoComplete="street-address"
                  value={form.address}
                  onChange={set("address")}
                />
              </Field>
              <FormError message={error} />
              <Button
                type="submit"
                className="h-12 text-base"
                disabled={busy || open === null}
                data-testid="register-submit"
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {busy ? t("acct.registering") : t("acct.register")}
              </Button>
              {open === null ? (
                <p className="text-muted-foreground text-sm">{t("acct.onlineOnly")}</p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      )}
      <Link href="/login" className="text-primary min-h-11 py-2 text-center text-base">
        {t("acct.haveAccount")}
      </Link>
    </>
  );
}
