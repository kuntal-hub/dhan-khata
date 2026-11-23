"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasPin } from "@/client/auth/pin";
import { login } from "@/client/auth/session";
import { markUnlocked } from "@/client/auth/unlock";
import { errorKey } from "@/client/errors";
import { restoreActiveGodown } from "@/client/godown/activeGodown";
import { requestPersistentStorage } from "@/client/pwa/browser";
import { DomainError } from "@/domain/errors";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { actions, useAppDispatch } from "@/store";

export default function LoginPage() {
  const { t, lang, setLang } = useI18n();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TKey | null>(null);

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
      dispatch(
        actions.session.signedIn({
          userId: session.user._id,
          userName: session.user.name,
          isOwner: session.user.isOwner,
        }),
      );
      markUnlocked(session.user._id);
      void requestPersistentStorage();
      const g = await restoreActiveGodown();
      if (g) dispatch(actions.activeGodown.godownSelected(g));
      router.replace((await hasPin()) ? "/" : "/unlock");
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
      <div className="flex justify-end gap-2" role="group" aria-label={t("common.language")}>
        <Button
          variant={lang === "bn" ? "default" : "outline"}
          className="h-11"
          onClick={() => setLang("bn")}
        >
          {t("lang.bn")}
        </Button>
        <Button
          variant={lang === "en" ? "default" : "outline"}
          className="h-11"
          onClick={() => setLang("en")}
        >
          {t("lang.en")}
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-primary text-2xl">{t("common.appName")}</CardTitle>
          <CardDescription>{t("auth.loginSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="phone">{t("auth.phone")}</Label>
              <Input
                id="phone"
                name="phone"
                inputMode="tel"
                autoComplete="username"
                className="h-11 text-base"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">{t("auth.password")}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                className="h-11 text-base"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {t(error)}
              </p>
            ) : null}
            <Button
              type="submit"
              className="h-12 text-base"
              disabled={busy}
              data-testid="login-submit"
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {busy ? t("auth.loggingIn") : t("auth.login")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
