"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { AuthHeader, Field, FormError, PasswordInput, TextInput } from "@/components/auth/AuthBits";
import { RecoveryCodeScreen } from "@/components/auth/RecoveryCodeScreen";
import { useAfterSignIn } from "@/components/auth/useAfterSignIn";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { recoverPassword } from "@/client/auth/account";
import type { SessionMeta } from "@/client/db/meta";
import { errorKey } from "@/client/errors";
import { DomainError } from "@/domain/errors";
import { normalizePhone } from "@/domain/phone";
import { useI18n } from "@/i18n/I18nProvider";

type Errors = Partial<Record<"mobile" | "code" | "password" | "again", string>>;

/** Forgot password (requirement_v2 §2.2): mobile + recovery code + new password (twice). */
export default function ForgotPage() {
  const { t } = useI18n();
  const afterSignIn = useAfterSignIn();
  const [form, setForm] = useState({ mobile: "", code: "", password: "", again: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ session: SessionMeta; code: string } | null>(null);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v: Errors = {};
    if (!normalizePhone(form.mobile)) v.mobile = t("acct.mobileInvalid");
    if (form.code.replace(/[^0-9A-Za-z]/g, "").length < 12) v.code = t("acct.required");
    if (form.password.length < 8) v.password = t("acct.passwordTooShort");
    if (form.again !== form.password) v.again = t("acct.passwordMismatch");
    setErrors(v);
    if (Object.keys(v).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await recoverPassword({
        mobile: form.mobile,
        recoveryCode: form.code,
        newPassword: form.password,
        deviceLabel: navigator.userAgent.slice(0, 80),
      });
      setDone({ session: r.session, code: r.recoveryCode });
    } catch (err) {
      setError(
        err instanceof DomainError && err.detail === "pending-ops-of-other-user"
          ? t("auth.otherUserPending")
          : t(errorKey(err)),
      );
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <RecoveryCodeScreen
        code={done.code}
        afterReset
        onContinue={() => void afterSignIn(done.session)}
      />
    );
  }

  return (
    <>
      <AuthHeader />
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-xl">{t("acct.forgotTitle")}</CardTitle>
          <p className="text-muted-foreground text-sm">{t("acct.forgotHint")}</p>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)} noValidate>
            <Field id="fp-mobile" label={t("acct.mobile")} error={errors.mobile}>
              <TextInput
                id="fp-mobile"
                inputMode="tel"
                autoComplete="username"
                value={form.mobile}
                onChange={set("mobile")}
              />
            </Field>
            <Field id="fp-code" label={t("acct.recoveryCode")} error={errors.code}>
              <TextInput
                id="fp-code"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                className="font-mono tracking-wider uppercase"
                placeholder="DG-XXXX-XXXX-XXXX"
                value={form.code}
                onChange={set("code")}
              />
            </Field>
            <Field id="fp-password" label={t("acct.newPassword")} error={errors.password}>
              <PasswordInput
                id="fp-password"
                autoComplete="new-password"
                value={form.password}
                onChange={set("password")}
              />
            </Field>
            <Field id="fp-again" label={t("acct.passwordAgain")} error={errors.again}>
              <PasswordInput
                id="fp-again"
                autoComplete="new-password"
                value={form.again}
                onChange={set("again")}
              />
            </Field>
            <FormError message={error} />
            <Button
              type="submit"
              className="h-12 text-base"
              disabled={busy}
              data-testid="forgot-submit"
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {busy ? t("acct.resetting") : t("acct.resetPassword")}
            </Button>
            <p className="text-muted-foreground text-sm">{t("acct.noRecoveryCode")}</p>
          </form>
        </CardContent>
      </Card>
      <Link href="/login" className="text-primary min-h-11 py-2 text-center text-base">
        {t("acct.haveAccount")}
      </Link>
    </>
  );
}
