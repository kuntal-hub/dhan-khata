"use client";
/**
 * React hooks over the device DB (Dexie liveQuery: re-render on every local write or pull).
 */
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback } from "react";
import { canConsolidate, roleIn, type EffectiveRole } from "@/domain/rbac";
import { defaultGodownSettings } from "@/domain/godownSettings";
import type { Business, Godown, GodownSettings } from "@/domain/schemas";
import { actions, useAppDispatch, useAppSelector } from "@/store";
import { db } from "./db/dexie";
import { META, getGodownSettings, getMeta, getSession } from "./db/meta";
import { accessibleLocalGodowns, persistActiveGodown } from "./godown/activeGodown";

export function useAccessibleGodowns(): Godown[] | undefined {
  return useLiveQuery(() => accessibleLocalGodowns(), []);
}

export function useSessionMeta() {
  return useLiveQuery(() => getSession(), []);
}

export function useMeta<T>(key: string): T | undefined {
  return useLiveQuery(() => getMeta<T>(key), [key]);
}

export function useActiveGodown() {
  const dispatch = useAppDispatch();
  const { godownId, consolidated } = useAppSelector((s) => s.activeGodown);
  const godowns = useAccessibleGodowns();
  const session = useSessionMeta();
  const godown = godowns?.find((g) => g._id === godownId) ?? null;
  const select = useCallback(
    (id: string) => {
      dispatch(actions.activeGodown.godownSelected(id));
      void persistActiveGodown(id);
    },
    [dispatch],
  );
  const selectAll = useCallback(
    () => dispatch(actions.activeGodown.consolidatedSelected()),
    [dispatch],
  );
  const consolidate =
    session !== undefined &&
    canConsolidate(session.user) &&
    (godowns?.filter((g) => g.status === "active").length ?? 0) >= 2;
  return {
    godownId,
    godown,
    godowns,
    consolidated,
    canConsolidate: consolidate,
    select,
    selectAll,
  };
}

export function useOutbox() {
  return useLiveQuery(() => db().outbox.orderBy("seq").toArray(), []);
}

export function useBootstrapped(): boolean | undefined {
  return useLiveQuery(async () => {
    try {
      return (await getMeta<boolean>(META.bootstrapped)) === true;
    } catch {
      return false; // DB not openable: ClientRuntime shows the recovery screen
    }
  }, []);
}

/** The signed-in user's role in the active godown (null = no access / no godown). */
export function useGodownRole(): EffectiveRole | null {
  const session = useSessionMeta();
  const godownId = useAppSelector((s) => s.activeGodown.godownId);
  if (!session || !godownId) return null;
  return roleIn(session.user, godownId);
}

/**
 * What the signed-in user may see in the active godown (`client/access`): `entryOnly` = the
 * `entry` role (own entries + today's dashboard). `loaded` is false while the session loads.
 */
export function useViewScope() {
  const session = useSessionMeta();
  const godownId = useAppSelector((s) => s.activeGodown.godownId);
  const role = session && godownId ? roleIn(session.user, godownId) : null;
  return {
    loaded: session !== undefined,
    user: session ? session.user : null,
    role,
    userId: session ? session.user._id : null,
    entryOnly: role === "entry",
  };
}

/** A godown's settings (defaults when none were saved yet). */
export function useGodownSettings(godownId: string | null): GodownSettings | undefined {
  return useLiveQuery(
    async () =>
      godownId
        ? ((await getGodownSettings(godownId)) ??
          defaultGodownSettings(godownId, new Date().toISOString()))
        : undefined,
    [godownId],
  );
}

/** The owner's business profile (name, logo, mon size, deductions switch), pulled from the server. */
export function useBusiness(): Business | undefined {
  return useLiveQuery(() => getMeta<Business>(META.business), []);
}
