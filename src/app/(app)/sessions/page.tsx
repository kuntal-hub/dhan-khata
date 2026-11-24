"use client";

import { useCallback, useEffect, useState } from "react";
import { LogOut, Smartphone } from "lucide-react";
import { ConfirmDialog } from "@/components/shell/ConfirmDialog";
import { PageTitle } from "@/components/shell/PageTitle";
import { lazyToast } from "@/components/system/IdleToaster";
import { Loading } from "@/components/lists/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listSessions, revokeSession, type SessionRow } from "@/client/auth/account";
import { errorKey } from "@/client/errors";
import { todayIST } from "@/domain/dates";
import { useI18n } from "@/i18n/I18nProvider";

/** Settings → Sessions (requirement_v2 §2.2): devices with last-seen time; sign out others. */
export default function SessionsPage() {
  const { t, date } = useI18n();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<SessionRow | null>(null);

  const [nonce, setNonce] = useState(0);
  const load = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    listSessions()
      .then((r) => {
        if (!alive) return;
        setError(null);
        setRows(r);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(t(errorKey(e)));
        setRows([]);
      });
    return () => {
      alive = false;
    };
  }, [t, nonce]);

  const name = (r: SessionRow) => r.label || t("acct.deviceUnnamed", { code: r.code });

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title={t("acct.sessionsTitle")} subtitle={t("acct.sessionsHint")} />
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {rows === null ? (
        <Loading />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows
            .filter((r) => !r.revoked)
            .map((r) => (
              <li key={r.id}>
                <Card className="rounded-2xl" data-testid="session-row">
                  <CardContent className="flex items-center gap-3 py-4">
                    <Smartphone className="text-primary size-6 shrink-0" aria-hidden />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-base font-medium">{name(r)}</span>
                      <span className="text-muted-foreground text-sm">
                        {r.current
                          ? t("acct.thisDevice")
                          : t("acct.lastSeen", {
                              when: date(todayIST(new Date(r.lastSeenAt)), "short"),
                            })}
                      </span>
                    </div>
                    {r.current ? null : (
                      <Button variant="outline" className="h-11" onClick={() => setTarget(r)}>
                        <LogOut className="size-4" aria-hidden />
                        {t("acct.signOutDevice")}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
        </ul>
      )}
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title={t("acct.signOutDevice")}
        body={target ? t("acct.signOutConfirm", { name: name(target) }) : ""}
        confirmLabel={t("acct.signOutDevice")}
        onConfirm={async () => {
          if (!target) return;
          try {
            await revokeSession(target.id);
            lazyToast(t("acct.signedOut"), "success");
            setTarget(null);
            load();
          } catch (e) {
            lazyToast(t(errorKey(e)), "error");
          }
        }}
      />
    </div>
  );
}
