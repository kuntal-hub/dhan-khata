"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { toast } from "sonner";
import { errorKey } from "@/client/errors";
import { useActiveGodown } from "@/client/hooks";
import { RepoError } from "@/client/repo";
import { todayIST } from "@/domain/dates";
import { useI18n } from "@/i18n/I18nProvider";

/** Toast "সেভ হয়েছে" with "রসিদ শেয়ার করুন", then go to the voucher view (spec §9). */
export function useAfterSave() {
  const { t } = useI18n();
  const router = useRouter();
  return useCallback(
    (voucherId: string, viewPath: string, opts: { receipt?: boolean } = {}) => {
      toast.success(t("common.saved"), {
        ...(opts.receipt !== false
          ? {
              action: {
                label: t("common.shareReceipt"),
                onClick: () => router.push(`/print/voucher?id=${voucherId}`),
              },
            }
          : {}),
      });
      router.replace(`${viewPath}?id=${voucherId}`);
    },
    [router, t],
  );
}

/** Show a repo/domain error as a toast in plain language. */
export function useSaveError() {
  const { t } = useI18n();
  return useCallback(
    (e: unknown) => {
      const key = errorKey(e);
      const detail = e instanceof RepoError && e.code === "VALIDATION_FAILED" && e.issues?.[0];
      toast.error(t(key), detail ? { description: detail.path.join(".") } : undefined);
    },
    [t],
  );
}

export const today = () => todayIST();

/** Active godown name for form titles ("নতুন ক্রয় · রামপুর"). */
export function useGodownTitle(): string {
  return useActiveGodown().godown?.name ?? "";
}
