"use client";

/**
 * The recovery code, shown ONCE on a full screen (requirement_v2 §2.2): "লিখে রাখুন", copy,
 * print, and a confirmation checkbox before continuing. The code is never stored on the device.
 */
import { useState } from "react";
import { Check, Copy, KeyRound, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/brand/Logo";
import { useI18n } from "@/i18n/I18nProvider";

export function RecoveryCodeScreen({
  code,
  afterReset = false,
  onContinue,
}: {
  code: string;
  afterReset?: boolean;
  onContinue: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="recovery-code-screen">
      <div className="flex items-center gap-3 print:hidden">
        <KeyRound className="text-primary size-8" aria-hidden />
        <h1 className="text-xl font-semibold">{t("acct.codeTitle")}</h1>
      </div>
      <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-amber-500/60 bg-amber-50 p-5 text-center dark:bg-amber-950/30">
        <LogoMark className="hidden size-12 print:block" />
        <p className="text-lg font-semibold text-amber-900 dark:text-amber-100">
          {t("acct.codeWrite")}
        </p>
        <p
          className="font-mono text-2xl font-bold tracking-wider break-all select-all"
          data-testid="recovery-code"
          translate="no"
        >
          {code}
        </p>
        {afterReset ? <p className="text-sm">{t("acct.codeNewAfterReset")}</p> : null}
      </div>
      <p className="text-muted-foreground text-base print:text-black">{t("acct.codeBody")}</p>
      <div className="grid grid-cols-2 gap-3 print:hidden">
        <Button
          type="button"
          variant="outline"
          className="h-12 text-base"
          onClick={() => void copy()}
        >
          {copied ? (
            <Check className="size-5" aria-hidden />
          ) : (
            <Copy className="size-5" aria-hidden />
          )}
          {copied ? t("acct.copied") : t("acct.copy")}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-12 text-base"
          onClick={() => window.print()}
        >
          <Printer className="size-5" aria-hidden />
          {t("acct.print")}
        </Button>
      </div>
      <label className="flex min-h-12 cursor-pointer items-center gap-3 text-base print:hidden">
        <input
          type="checkbox"
          className="accent-primary size-6"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          data-testid="recovery-confirm"
        />
        {t("acct.codeConfirm")}
      </label>
      <Button
        type="button"
        className="h-12 text-base print:hidden"
        disabled={!confirmed}
        onClick={onContinue}
        data-testid="recovery-continue"
      >
        {t("acct.continue")}
      </Button>
    </div>
  );
}
