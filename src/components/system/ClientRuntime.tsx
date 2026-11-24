"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DbOpenError, openDb } from "@/client/db/dexie";
import { getSession } from "@/client/db/meta";
import { clearUnlocked, isUnlockedThisTab } from "@/client/auth/unlock";
import { restoreActiveGodown } from "@/client/godown/activeGodown";
import { useBootstrapped } from "@/client/hooks";
import { useT } from "@/i18n/I18nProvider";
import { actions, useAppDispatch, useAppSelector } from "@/store";
import { DbRecovery } from "./DbRecovery";
import { Splash } from "./Splash";

type BootState = { kind: "loading" } | { kind: "ready" } | { kind: "error"; error: DbOpenError };

let bootPromise: Promise<void> | null = null;

/** The sync engine (and the whole write/sync graph) loads after first paint, in its own chunk. */
const loadSync = () =>
  Promise.all([import("@/client/sync/instance"), import("@/client/sync/triggers")]);

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
        const who = {
          userId: session.user._id,
          userName: session.user.name,
          isOwner: session.user.isOwner,
        };
        dispatch(
          isUnlockedThisTab(session.user._id)
            ? actions.session.signedIn(who)
            : actions.session.sessionFound(who),
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
    let alive = true;
    let unsub: (() => void) | undefined;
    void loadSync().then(([{ getSyncEngine }]) => {
      if (!alive) return;
      unsub = getSyncEngine().subscribe((s) => {
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
        if (s.deviceRevoked) {
          clearUnlocked();
          dispatch(actions.session.revoked());
        }
      });
    });
    return () => {
      alive = false;
      unsub?.();
    };
  }, [dispatch]);

  // Sync only while unlocked and after the first download (which runs its own sync with a
  // progress bar); the outbox simply waits otherwise.
  const bootstrapped = useBootstrapped();
  useEffect(() => {
    if (boot.kind !== "ready" || status !== "active" || !bootstrapped) return;
    let alive = true;
    let uninstall: (() => void) | undefined;
    void loadSync().then(([{ getSyncEngine }, { installSyncTriggers }]) => {
      if (!alive) return;
      const engine = getSyncEngine();
      void engine.refreshCounts();
      uninstall = installSyncTriggers(engine);
    });
    return () => {
      alive = false;
      uninstall?.();
    };
  }, [boot.kind, status, bootstrapped]);

  if (boot.kind === "error") return <DbRecovery error={boot.error} />;
  if (boot.kind === "loading") return <Splash label={t("common.loading")} />;
  return <>{children}</>;
}
