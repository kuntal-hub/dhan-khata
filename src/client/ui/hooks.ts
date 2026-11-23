"use client";
/**
 * UI hooks: back-button closing of sheets, unsaved-changes guard, draft autosave to Dexie.
 */
import { useEffect, useRef, useState } from "react";
import { deleteMeta, getMeta, setMeta } from "../db/meta";
import { actions, useAppDispatch } from "@/store";
import { pushBack, releaseBack } from "./backStack";

/** While `open`, the hardware back button calls `onClose` instead of leaving the page. */
export function useBackClose(open: boolean, onClose: () => void): void {
  const idRef = useRef<number | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const id = pushBack(() => {
      idRef.current = null;
      closeRef.current();
    });
    idRef.current = id;
    return () => {
      if (idRef.current !== null) {
        releaseBack(idRef.current);
        idRef.current = null;
      }
    };
  }, [open]);
}

/**
 * Unsaved-changes guard for a form page: marks the form dirty in Redux (godown switch and app
 * update ask first) and warns on tab close. The in-app back button asks for confirmation
 * (FormShell). The hardware back button is NOT intercepted for whole pages (that would race
 * with navigation after save); the draft autosave restores the form instead.
 */
export function useUnsavedGuard(dirty: boolean): void {
  const dispatch = useAppDispatch();
  useEffect(() => {
    if (!dirty) return;
    dispatch(actions.ui.formDirtied());
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      dispatch(actions.ui.formCleaned());
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [dirty, dispatch]);
}

export function draftKey(formKey: string): string {
  return `formDraft:${formKey}`;
}

/**
 * Draft autosave (spec §11.3): the form state is saved to Dexie `meta` (debounced) and offered
 * back after an app kill. `restore` is the saved draft (or null) once loaded.
 */
export function useFormDraft<T>(formKey: string, state: T, enabled: boolean) {
  const [restore, setRestore] = useState<T | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void getMeta<{ state: T }>(draftKey(formKey)).then((d) => {
      if (alive) setRestore(d?.state ?? null);
    });
    return () => {
      alive = false;
    };
  }, [formKey]);
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => {
      void setMeta(draftKey(formKey), { state, at: new Date().toISOString() });
    }, 600);
    return () => clearTimeout(t);
  }, [formKey, state, enabled]);
  const clear = async () => {
    await deleteMeta(draftKey(formKey));
    setRestore(null);
  };
  const dismiss = () => setRestore(null);
  return { restore, clear, dismiss };
}
