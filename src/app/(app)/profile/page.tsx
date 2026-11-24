"use client";

import { useState } from "react";
import { Field, FormError, PasswordInput, TextInput } from "@/components/auth/AuthBits";
import { RecoveryCodeScreen } from "@/components/auth/RecoveryCodeScreen";
import { PageTitle } from "@/components/shell/PageTitle";
import { lazyToast } from "@/components/system/IdleToaster";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { changePasswordOnline } from "@/client/admin";
import { regenerateRecoveryCode } from "@/client/auth/account";
import { PIN_RE, setPin } from "@/client/auth/pin";
import { errorKey } from "@/client/errors";
import { useSessionMeta } from "@/client/hooks";
import { useI18n } from "@/i18n/I18nProvider";

/** User profile (requirement_v2 §2.2): name, mobile, password, language, digits, PIN, recovery code. */
export default function ProfilePage() {
  const { t, lang, setLang, digits, setDigits } = useI18n();
  const session = useSessionMeta();
  const [newCode, setNewCode] = useState<string | null>(null);
  if (newCode)
    return <RecoveryCodeScreen code={newCode} afterReset onContinue={() => setNewCode(null)} />;
  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title={t("acct.profileTitle")}
        subtitle={session ? `${session.user.name} · ${session.user.phone}` : undefined}
      />

      <Card className="rounded-2xl">
        <CardContent className="flex flex-col gap-4 pt-6">
          <Toggle
            label={t("acct.language")}
            value={lang}
            options={[
              ["bn", t("lang.bn")],
              ["en", t("lang.en")],
            ]}
            onChange={(v) => setLang(v as "bn" | "en")}
          />
          <Toggle
            label={t("acct.digits")}
            value={digits}
            options={[
              ["bn", t("acct.digitsBn")],
              ["en", t("acct.digitsEn")],
            ]}
            onChange={(v) => setDigits(v as "bn" | "en")}
          />
        </CardContent>
      </Card>

      <ChangePasswordCard />
      <PinCard />
      <RecoveryCard onCode={setNewCode} />
    </div>
  );
}

function Toggle({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-base font-medium">{label}</span>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={label}>
        {options.map(([v, l]) => (
          <Button
            key={v}
            type="button"
            variant={value === v ? "default" : "outline"}
            aria-pressed={value === v}
            className="h-12 text-base"
            onClick={() => onChange(v)}
          >
            {l}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ChangePasswordCard() {
  const { t } = useI18n();
  const [f, setF] = useState({ current: "", next: "", again: "" });
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    if (f.next.length < 8) return setError(t("acct.passwordTooShort"));
    if (f.next !== f.again) return setError(t("acct.passwordMismatch"));
    try {
      await changePasswordOnline(f.current, f.next);
      setF({ current: "", next: "", again: "" });
      lazyToast(t("acct.passwordChanged"), "success");
    } catch (e) {
      setError(t(errorKey(e)));
    }
  };
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-lg">{t("acct.changePassword")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field id="pw-current" label={t("acct.currentPassword")}>
          <PasswordInput
            id="pw-current"
            autoComplete="current-password"
            value={f.current}
            onChange={(e) => setF({ ...f, current: e.target.value })}
          />
        </Field>
        <Field id="pw-next" label={t("acct.newPassword")}>
          <PasswordInput
            id="pw-next"
            autoComplete="new-password"
            value={f.next}
            onChange={(e) => setF({ ...f, next: e.target.value })}
          />
        </Field>
        <Field id="pw-again" label={t("acct.passwordAgain")}>
          <PasswordInput
            id="pw-again"
            autoComplete="new-password"
            value={f.again}
            onChange={(e) => setF({ ...f, again: e.target.value })}
          />
        </Field>
        <FormError message={error} />
        <Button
          className="h-12 text-base"
          onClick={() => void save()}
          disabled={!f.current || !f.next}
        >
          {t("acct.changePassword")}
        </Button>
      </CardContent>
    </Card>
  );
}

function PinCard() {
  const { t } = useI18n();
  const [pin, setPinValue] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    if (!PIN_RE.test(pin)) return setError(t("auth.pinFormat"));
    if (pin !== again) return setError(t("auth.pinMismatch"));
    await setPin(pin);
    setPinValue("");
    setAgain("");
    lazyToast(t("common.saved"), "success");
  };
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-lg">{t("acct.pin")}</CardTitle>
        <p className="text-muted-foreground text-sm">{t("auth.setPinHint")}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field id="pin-new" label={t("auth.setPinTitle")}>
          <TextInput
            id="pin-new"
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPinValue(e.target.value)}
          />
        </Field>
        <Field id="pin-again" label={t("auth.confirmPin")}>
          <TextInput
            id="pin-again"
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
        </Field>
        <FormError message={error} />
        <Button className="h-12 text-base" onClick={() => void save()} disabled={!pin}>
          {t("acct.changePin")}
        </Button>
      </CardContent>
    </Card>
  );
}

function RecoveryCard({ onCode }: { onCode: (code: string) => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setError(null);
    try {
      onCode(await regenerateRecoveryCode(password));
      setPassword("");
    } catch (e) {
      setError(t(errorKey(e)));
    }
  };
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-lg">{t("acct.newCode")}</CardTitle>
        <p className="text-muted-foreground text-sm">{t("acct.newCodeHint")}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field id="rc-password" label={t("acct.currentPassword")}>
          <PasswordInput
            id="rc-password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <FormError message={error} />
        <Button
          variant="outline"
          className="h-12 text-base"
          onClick={() => void go()}
          disabled={!password}
          data-testid="recovery-regenerate"
        >
          {t("acct.newCode")}
        </Button>
      </CardContent>
    </Card>
  );
}
