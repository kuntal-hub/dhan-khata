"use client";

import Link from "next/link";
import { useState } from "react";
import { Archive, Pencil, Plus, Trash2 } from "lucide-react";
import { golaColourClass } from "@/components/gola/colours";
import { ConfirmDialog } from "@/components/shell/ConfirmDialog";
import { PageTitle } from "@/components/shell/PageTitle";
import { lazyToast } from "@/components/system/IdleToaster";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { deleteEmptyGola } from "@/client/auth/account";
import { errorKey } from "@/client/errors";
import { archiveGodownOnline } from "@/client/godown/manage";
import { useAccessibleGodowns } from "@/client/hooks";
import { ApiCallError } from "@/client/sync/transport";
import type { Godown } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";

/** Gola management (avatar menu): list, add, edit, archive, delete an empty Gola. */
export default function GolasPage() {
  const { t } = useI18n();
  const golas = useAccessibleGodowns();
  const [confirm, setConfirm] = useState<{ kind: "archive" | "delete"; g: Godown } | null>(null);

  const run = async () => {
    if (!confirm) return;
    try {
      if (confirm.kind === "archive") {
        await archiveGodownOnline(confirm.g._id);
        lazyToast(t("gola.archivedDone"));
      } else {
        await deleteEmptyGola(confirm.g._id);
        lazyToast(t("gola.deleted"));
      }
      setConfirm(null);
    } catch (e) {
      lazyToast(
        e instanceof ApiCallError && e.detail === "HAS_TRANSACTIONS"
          ? t("gola.hasTransactions")
          : t(errorKey(e)),
        "error",
      );
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title={t("gola.manage")}
        actions={
          <Button asChild className="h-11">
            <Link href="/golas/new" data-testid="gola-add">
              <Plus className="size-5" aria-hidden />
              {t("gola.add")}
            </Link>
          </Button>
        }
      />
      <ul className="flex flex-col gap-3">
        {(golas ?? []).map((g) => (
          <li key={g._id}>
            <Card className="rounded-2xl" data-testid={`gola-row-${g.code}`}>
              <CardContent className="flex items-center gap-3 py-4">
                <span
                  className={`size-4 shrink-0 rounded-full ${golaColourClass(g.colour)}`}
                  aria-hidden
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-base font-semibold">{g.name}</span>
                  <span className="text-muted-foreground text-sm">
                    {g.code} · {g.status === "archived" ? t("gola.archived") : t("gola.active")}
                  </span>
                </div>
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  aria-label={t("gola.edit")}
                >
                  <Link href={`/golas/edit?id=${g._id}`}>
                    <Pencil className="size-5" aria-hidden />
                  </Link>
                </Button>
                {g.status === "active" ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11"
                    aria-label={t("gola.archive")}
                    onClick={() => setConfirm({ kind: "archive", g })}
                  >
                    <Archive className="size-5" aria-hidden />
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive size-11"
                  aria-label={t("gola.delete")}
                  onClick={() => setConfirm({ kind: "delete", g })}
                  data-testid={`gola-delete-${g.code}`}
                >
                  <Trash2 className="size-5" aria-hidden />
                </Button>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.kind === "archive" ? t("gola.archive") : t("gola.delete")}
        body={
          confirm
            ? t(confirm.kind === "archive" ? "gola.archiveConfirm" : "gola.deleteConfirm", {
                name: confirm.g.name,
              })
            : ""
        }
        confirmLabel={confirm?.kind === "archive" ? t("gola.archive") : t("gola.delete")}
        onConfirm={run}
      />
    </div>
  );
}
