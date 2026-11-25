"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CloudDownload, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { META, getMeta, setMeta } from "@/client/db/meta";
import { restoreActiveGodown } from "@/client/godown/activeGodown";
import { useI18n } from "@/i18n/I18nProvider";
import { actions, useAppDispatch } from "@/store";

/** First download after login on a new device (spec §12.4): paged pull with a progress bar. */
export function BootstrapScreen() {
  const { t, count } = useI18n();
  const dispatch = useAppDispatch();
  const [pct, setPct] = useState(0);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  const run = useCallback(async () => {
    setFailed(false);
    const { getSyncEngine } = await import("@/client/sync/instance");
    const engine = getSyncEngine();
    await engine.syncNow({
      onProgress: ({ done, total }) =>
        setPct(total > 0 ? Math.min(100, Math.floor((done * 100) / total)) : 100),
    });
    const ok =
      engine.status.online &&
      engine.status.lastError === null &&
      (await getMeta<number>(META.cursor)) !== undefined;
    if (!ok) {
      setFailed(true);
      return;
    }
    const g = await restoreActiveGodown();
    if (g) dispatch(actions.activeGodown.godownSelected(g));
    await setMeta(META.bootstrapped, true);
  }, [dispatch]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      {failed ? (
        <>
          <span className="tone-warn tile-accent anim-pop flex size-16 items-center justify-center rounded-3xl">
            <WifiOff className="size-8" aria-hidden />
          </span>
          <p className="text-sm">{t("bootstrap.offline")}</p>
          <Button className="h-11" onClick={() => void run()}>
            {t("bootstrap.retry")}
          </Button>
        </>
      ) : (
        <>
          <span className="tone-green tile-accent anim-pop flex size-16 items-center justify-center rounded-3xl">
            <CloudDownload className="size-8" aria-hidden />
          </span>
          <p className="tabular text-base font-semibold">
            {t("bootstrap.progress", { percent: `${count(pct)}%` })}
          </p>
          <div
            className="bg-muted h-3 w-full overflow-hidden rounded-full shadow-[inset_0_1px_2px_rgb(0_0_0/0.08)]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div
              className="h-full rounded-full bg-linear-to-r from-[var(--primary-hi)] to-[var(--gold)] transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </>
      )}
    </main>
  );
}
