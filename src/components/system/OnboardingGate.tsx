"use client";

import dynamic from "next/dynamic";
import { useLiveQuery } from "dexie-react-hooks";
import type { ReactNode } from "react";
import { db } from "@/client/db/dexie";
import { getMeta } from "@/client/db/meta";
import { useSessionMeta } from "@/client/hooks";
import type { Step } from "./Onboarding";

const ONBOARDING_KEY = "onboarding";
const Onboarding = dynamic(() => import("./Onboarding"), { ssr: false });

/**
 * First-run wizard (spec §10, owner, online): language → owner profile → first godown (the
 * Phase 4 godown setup wizard) → invite users. Shown while the owner has no godown, or until the
 * last step is finished. Alternatively restore a backup into the empty database.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const session = useSessionMeta();
  const state = useLiveQuery(async () => {
    const [count, step] = await Promise.all([
      db().godowns.count(),
      getMeta<string>(ONBOARDING_KEY),
    ]);
    return { count, step };
  }, []);
  if (!session || !state) return <>{children}</>;
  const active =
    session.user.isOwner && (state.count === 0 || (state.step && state.step !== "done"));
  if (!active) return <>{children}</>;
  return <Onboarding initial={(state.step as Step | undefined) ?? "language"} />;
}
