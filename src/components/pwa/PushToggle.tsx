"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorKey } from "@/client/errors";
import { disablePush, enablePush, pushState, type PushState } from "@/client/pwa/push";
import { useI18n } from "@/i18n/I18nProvider";

/** Turn the daily reminder digest on/off for this phone (spec §9.13). */
export function PushToggle() {
  const { t } = useI18n();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void pushState().then(setState);
  }, []);
  if (state === null) return null;
  if (state === "unsupported") {
    return <p className="text-muted-foreground text-xs">{t("reminder.pushUnsupported")}</p>;
  }
  if (state === "denied") {
    return <p className="text-muted-foreground text-xs">{t("reminder.pushDenied")}</p>;
  }
  const toggle = async () => {
    setBusy(true);
    try {
      const next = state === "on" ? await disablePush() : await enablePush();
      setState(next);
      if (next === "on") toast.success(t("reminder.pushEnabled"));
      if (next === "denied") toast.error(t("reminder.pushDenied"));
    } catch (e) {
      toast.error(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      variant="outline"
      className="h-11 self-start"
      disabled={busy}
      onClick={() => void toggle()}
      data-testid="push-toggle"
    >
      <BellRing className="size-4" aria-hidden />
      {state === "on" ? t("reminder.pushOff") : t("reminder.pushOn")}
    </Button>
  );
}
