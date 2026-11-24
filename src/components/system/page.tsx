"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { mayOpenPath, mayViewVoucher } from "@/client/access";
import { roleIn } from "@/domain/rbac";
import { useActiveGodown, useViewScope } from "@/client/hooks";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppSelector } from "@/store";
import { Loading } from "@/components/lists/common";

/** Pages that read search params must render inside Suspense (Cache Components, static routes). */
export function PageSuspense({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

export function useParam(name: string): string | undefined {
  const sp = useSearchParams();
  return sp.get(name) ?? undefined;
}

export type ReadOnlyReason =
  "consolidated" | "archived" | "noGodown" | "viewer" | "notFound" | "entryRole";

/**
 * The godown a form writes into (always the active one) and why writing is impossible, if it is:
 * "All godowns" mode is read-only (spec §1.4 rule 4), archived godowns are read-only, viewers
 * can't write.
 */
export function useWriteGodown() {
  const { godown, godownId, consolidated } = useActiveGodown();
  const isOwner = useAppSelector((s) => s.session.isOwner);
  const access = useAppSelector((s) => s.session.userId);
  let reason: ReadOnlyReason | null = null;
  if (consolidated) reason = "consolidated";
  else if (!godown || !godownId) reason = "noGodown";
  else if (godown.status === "archived") reason = "archived";
  return {
    godown,
    godownId: godown ? godown._id : null,
    readOnly: reason,
    isOwner,
    userId: access,
  };
}

export function ReadOnlyNotice({ reason }: { reason: ReadOnlyReason }) {
  const { t } = useI18n();
  const key =
    reason === "entryRole"
      ? "godown.entryOnly"
      : reason === "consolidated"
        ? "godown.readOnlyAll"
        : reason === "archived"
          ? "godown.archived"
          : reason === "notFound" || reason === "viewer"
            ? "errors.domain.FORBIDDEN"
            : "godown.none";
  return (
    <div
      className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-center text-sm"
      data-testid={`notice-${reason}`}
    >
      <Lock className="size-8 opacity-60" aria-hidden />
      <p>{t(key)}</p>
      <Link href="/" className="text-primary min-h-11 py-3 underline">
        {t("pwa.goHome")}
      </Link>
    </div>
  );
}

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h1 className="min-w-0 truncate text-xl font-semibold">{title}</h1>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * Entry forms start fresh on every push/replace navigation (Next keeps up to 3 visited routes
 * alive with React Activity; back/forward still restores the in-progress form).
 */
export function Fresh({ children }: { children: ReactNode }) {
  const { bfcacheId } = useRouter();
  return <Fragment key={bfcacheId}>{children}</Fragment>;
}

/**
 * Screens the active role may not open render a notice instead (the `entry` role: own entries
 * + today's dashboard, `client/access`). Used by the app and print layouts.
 */
export function RoleGate({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { loaded, role } = useViewScope();
  if (!loaded) return <Loading />;
  if (!mayOpenPath(role, path)) return <ReadOnlyNotice reason="entryRole" />;
  return <>{children}</>;
}

/**
 * Whether the signed-in user may see a voucher, by their role in the VOUCHER's godown (the
 * `entry` role: own vouchers only). `null` while the session is still loading: show a spinner.
 */
export function useMayViewVoucher():
  ((v: { createdBy: string; godownId: string }) => boolean) | null {
  const { loaded, user } = useViewScope();
  if (!loaded) return null;
  return (v) => mayViewVoucher(user ? roleIn(user, v.godownId) : null, user ? user._id : null, v);
}
