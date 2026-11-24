"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { hasPin } from "@/client/auth/pin";
import { markUnlocked } from "@/client/auth/unlock";
import type { SessionMeta } from "@/client/db/meta";
import { restoreActiveGodown } from "@/client/godown/activeGodown";
import { requestPersistentStorage } from "@/client/pwa/browser";
import { actions, useAppDispatch } from "@/store";

/** What every successful sign-in does (login, registration, password recovery). */
export function useAfterSignIn() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  return useCallback(
    async (session: SessionMeta) => {
      dispatch(
        actions.session.signedIn({
          userId: session.user._id,
          userName: session.user.name,
          isOwner: session.user.isOwner,
        }),
      );
      markUnlocked(session.user._id);
      void requestPersistentStorage();
      const g = await restoreActiveGodown();
      if (g) dispatch(actions.activeGodown.godownSelected(g));
      router.replace((await hasPin()) ? "/" : "/unlock");
    },
    [dispatch, router],
  );
}
