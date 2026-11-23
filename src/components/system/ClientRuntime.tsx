"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DbOpenError, openDb } from "@/client/db/dexie";
import { getSession } from "@/client/db/meta";
import { restoreActiveGodown } from "@/client/godown/activeGodown";
import { useBootstrapped } from "@/client/hooks";
import { getSyncEngine } from "@/client/sync/instance";
import { installSyncTriggers } from "@/client/sync/triggers";
import { useT } from "@/i18n/I18nProvider";
import { actions, useAppDispatch, useAppSelector } from "@/store";
import { DbRecovery } from "./DbRecovery";
import { Splash } from "./Splash";

type BootState = { kind: "loading" } | { kind: "ready" } | { kind: "error"; error: DbOpenError };

let bootPromise: Promise<void> | null = null;

/**
 * Device runtime for every app/auth page: opens the local DB (recovery screen on failure),
 * restores the session (→ PIN unlock) and the active godown, wires the sync engine into Redux,
 * and runs the sync triggers while the app is unlocked.
 */
export function ClientRuntime({ children }: { children: ReactNode }) {
  const t = useT();
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.session.status);
  const [boot, setBoot] = useState<BootState>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    bootPromise ??= (async () => {
      await openDb();
      const session = await getSession();
      if (session) {
        dispatch(
          actions.session.sessionFound({
            userId: session.user._id,
            userName: session.user.name,
            isOwner: session.user.isOwner,
          }),
        );
        const g = await restoreActiveGodown();
        if (g) dispatch(actions.activeGodown.godownSelected(g));
      } else {
        dispatch(actions.session.noSession());
      }
    })();
    bootPromise.then(
      () => alive && setBoot({ kind: "ready" }),
      (e: unknown) => {
        bootPromise = null;
        if (alive) {
          setBoot({
            kind: "error",
            error: e instanceof DbOpenError ? e : new DbOpenError("other", e),
          });
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [dispatch]);

  // Mirror the engine's status into Redux (UI state only).
  useEffect(() => {
    const engine = getSyncEngine();
    return engine.subscribe((s) => {
      dispatch(
        actions.sync.syncStatusChanged({
          online: s.online,
          running: s.running,
          pendingOps: s.pendingOps,
          errorOps: s.errorOps,
          conflictOps: s.conflictOps,
          lastSyncAt: s.lastSyncAt,
          authRequired: s.authRequired,
          deviceRevoked: s.deviceRevoked,
          clockSkewMs: s.clockSkewMs,
          lastError: s.lastError,
        }),
      );
      if (s.deviceRevoked) dispatch(actions.session.revoked());
    });
  }, [dispatch]);

  // Sync only while unlocked and after the first download (which runs its own sync with a
  // progress bar); the outbox simply waits otherwise.
  const bootstrapped = useBootstrapped();
  useEffect(() => {
    if (boot.kind !== "ready" || status !== "active" || !bootstrapped) return;
    const engine = getSyncEngine();
    void engine.refreshCounts();
    return installSyncTriggers(engine);
  }, [boot.kind, status, bootstrapped]);

  if (boot.kind === "error") return <DbRecovery error={boot.error} />;
  if (boot.kind === "loading") return <Splash label={t("common.loading")} />;
  return <>{children}</>;
}
