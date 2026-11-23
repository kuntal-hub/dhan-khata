"use client";
/**
 * React hooks over the device DB (Dexie liveQuery: re-render on every local write or pull).
 */
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback } from "react";
import { canConsolidate } from "@/domain/rbac";
import type { Godown } from "@/domain/schemas";
import { actions, useAppDispatch, useAppSelector } from "@/store";
import { db } from "./db/dexie";
import { META, getMeta, getSession } from "./db/meta";
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
