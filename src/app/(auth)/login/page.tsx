"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { AuthHeader, Field, FormError, PasswordInput, TextInput } from "@/components/auth/AuthBits";
import { useAfterSignIn } from "@/components/auth/useAfterSignIn";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { registrationStatus } from "@/client/auth/account";
import { login } from "@/client/auth/session";
import { errorKey } from "@/client/errors";
import { DomainError } from "@/domain/errors";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

export default function LoginPage() {
  const { t } = useI18n();
  const afterSignIn = useAfterSignIn();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [registrationOpen, setRegistrationOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    registrationStatus()
      .then((s) => alive && setRegistrationOpen(s.registrationOpen))
      .catch(() => alive && setRegistrationOpen(false));
    return () => {
      alive = false;
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await login({
        phone,
        password,
        deviceLabel: navigator.userAgent.slice(0, 80),
      });
      await afterSignIn(session);
    } catch (err) {
      setError(
        err instanceof DomainError && err.detail === "pending-ops-of-other-user"
          ? "auth.otherUserPending"
          : errorKey(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AuthHeader />
      <Card className="shadow-lift rounded-3xl">
        <CardContent className="pt-6">
          <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
            <p className="text-muted-foreground text-sm">{t("auth.loginSubtitle")}</p>
            <Field id="phone" label={t("acct.mobile")}>
              <TextInput
                id="phone"
                name="phone"
                inputMode="tel"
                autoComplete="username"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </Field>
            <Field id="password" label={t("auth.password")}>
              <PasswordInput
                id="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <FormError message={error ? t(error) : null} />
            <Button
              type="submit"
              className="h-12 text-base"
              disabled={busy}
              data-testid="login-submit"
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {busy ? t("auth.loggingIn") : t("auth.login")}
            </Button>
            <Link
              href="/forgot"
              className="text-primary min-h-11 py-2 text-center text-base underline-offset-4 hover:underline"
              data-testid="go-forgot"
            >
              {t("acct.forgot")}
            </Link>
          </form>
        </CardContent>
      </Card>
      {registrationOpen ? (
        <Button asChild variant="outline" className="h-12 text-base">
          <Link href="/register" data-testid="go-register">
            {t("acct.noAccount")}
          </Link>
        </Button>
      ) : null}
    </>
  );
}
