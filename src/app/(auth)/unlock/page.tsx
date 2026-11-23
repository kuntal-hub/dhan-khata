"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PIN_RE,
  failedPinAttempts,
  hasPin,
  normalizePin,
  setPin,
  verifyPin,
} from "@/client/auth/pin";
import { markUnlocked } from "@/client/auth/unlock";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { actions, useAppDispatch, useAppSelector } from "@/store";

/** After 5 wrong PINs, each further try waits 30 seconds. */
const FREE_ATTEMPTS = 5;
const WAIT_SECONDS = 30;

export default function UnlockPage() {
  const { t, count } = useI18n();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.session.status);
  const [mode, setMode] = useState<"loading" | "enter" | "set">("loading");
  const [pin, setPinValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<TKey | null>(null);
  const [waitUntil, setWaitUntil] = useState(0);
  const [nowTick, setNowTick] = useState(0);

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  useEffect(() => {
    void hasPin().then((has) => setMode(has ? "enter" : "set"));
  }, []);

  useEffect(() => {
    if (waitUntil === 0) return;
    const id = setInterval(() => {
      const n = Date.now();
      setNowTick(n);
      if (n >= waitUntil) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [waitUntil]);

  const waitLeft = Math.max(0, Math.ceil((waitUntil - nowTick) / 1000));

  const userId = useAppSelector((s) => s.session.userId);
  const done = () => {
    if (userId) markUnlocked(userId);
    dispatch(actions.session.unlocked());
    router.replace("/");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const p = normalizePin(pin);
    if (!PIN_RE.test(p)) {
      setError("auth.pinFormat");
      return;
    }
    if (mode === "set") {
      if (p !== normalizePin(confirm)) {
        setError("auth.pinMismatch");
        return;
      }
      await setPin(p);
      done();
      return;
    }
    if (Date.now() < waitUntil) return;
    if (await verifyPin(p)) {
      done();
      return;
    }
    setPinValue("");
    setError("auth.wrongPin");
    if ((await failedPinAttempts()) >= FREE_ATTEMPTS) {
      const until = Date.now() + WAIT_SECONDS * 1000;
      setWaitUntil(until);
      setNowTick(Date.now());
    }
  };

  if (mode === "loading") return null;
  const setting = mode === "set";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="text-primary size-5" aria-hidden />
          {setting ? t("auth.setPinTitle") : t("auth.unlockTitle")}
        </CardTitle>
        {setting ? <CardDescription>{t("auth.setPinHint")}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pin">{t("auth.enterPin")}</Label>
            <Input
              id="pin"
              name="pin"
              type="password"
              inputMode="numeric"
              autoComplete={setting ? "new-password" : "current-password"}
              maxLength={6}
              className="tabular h-12 text-center text-2xl tracking-[0.5em]"
              value={pin}
              onChange={(e) => setPinValue(e.target.value)}
              autoFocus
              required
            />
          </div>
          {setting ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="pin2">{t("auth.confirmPin")}</Label>
              <Input
                id="pin2"
                name="pin2"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={6}
                className="tabular h-12 text-center text-2xl tracking-[0.5em]"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {t(error)}
            </p>
          ) : null}
          {waitLeft > 0 ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t("auth.tooManyAttempts", { seconds: count(waitLeft) })}
            </p>
          ) : null}
          <Button
            type="submit"
            className="h-12 text-base"
            disabled={waitLeft > 0}
            data-testid="pin-submit"
          >
            {setting ? t("auth.savePin") : t("auth.unlock")}
          </Button>
          {!setting ? (
            <Link
              href="/login"
              className="text-primary min-h-11 py-3 text-center text-sm underline"
            >
              {t("auth.forgotPin")}
            </Link>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
