"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Archive, Pencil, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loading } from "@/components/lists/common";
import { PageHeader, PageSuspense, ReadOnlyNotice } from "@/components/system/page";
import { db } from "@/client/db/dexie";
import { errorKey } from "@/client/errors";
import { archiveGodownOnline } from "@/client/godown/manage";
import { useActiveGodown } from "@/client/hooks";
import { allGodownsTotals } from "@/client/queries/consolidated";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppSelector } from "@/store";

function Inner() {
  const { t, money, weightOf } = useI18n();
  const isOwner = useAppSelector((s) => s.session.isOwner);
  const { godowns, select } = useActiveGodown();
  const [archiving, setArchiving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = (godowns ?? []).map((g) => g._id);
  const data = useLiveQuery(async () => {
    const totals = await allGodownsTotals(ids);
    const openings = await Promise.all(
      ids.map(
        async (g) =>
          (await db()
            .vouchers.where("[godownId+type+date]")
            .between([g, "OPENING", ""], [g, "OPENING", "￿"], true, true)
            .filter((v) => v.status === "active")
            .count()) > 0,
      ),
    );
    return { totals, openings };
  }, [ids.join(",")]);
  if (!isOwner) return <ReadOnlyNotice reason="viewer" />;
  if (!godowns || !data) return <Loading />;

  const archive = async () => {
    if (!archiving) return;
    setBusy(true);
    try {
      await archiveGodownOnline(archiving);
      toast.success(t("godowns.archived"));
      setArchiving(null);
    } catch (e) {
      toast.error(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t("godowns.title")}
        actions={
          <Button asChild className="h-11">
            <Link href="/godowns/new" data-testid="godown-add">
              <Plus className="size-4" aria-hidden />
              {t("godowns.add")}
            </Link>
          </Button>
        }
      />
      <p className="text-muted-foreground text-xs">{t("godowns.onlineOnly")}</p>
      {godowns.map((g, i) => {
        const tot = data.totals.rows[i];
        return (
          <Card key={g._id} data-testid={`godown-card-${g.code}`}>
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <button
                  type="button"
                  className="text-primary underline"
                  onClick={() => select(g._id)}
                >
                  {g.name}
                </button>
                <Badge variant="secondary">{g.code}</Badge>
                <Badge variant={g.status === "active" ? "default" : "destructive"}>
                  {g.status === "active" ? t("godowns.active") : t("godown.archived")}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {tot ? (
                <span className="tabular text-muted-foreground">
                  {t("godowns.summary", {
                    cash: money(tot.cashPaise),
                    stock: weightOf(tot.stockQtyG),
                  })}
                </span>
              ) : null}
              {g.status === "active" ? (
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" className="h-11">
                    <Link href={`/godowns/edit?id=${g._id}`}>
                      <Pencil className="size-4" aria-hidden />
                      {t("godowns.editProfile")}
                    </Link>
                  </Button>
                  {!data.openings[i] ? (
                    <Button asChild variant="outline" className="h-11">
                      <Link href={`/godowns/new?id=${g._id}`}>
                        <Wallet className="size-4" aria-hidden />
                        {t("godowns.stepCash")}
                      </Link>
                    </Button>
                  ) : null}
                  <Button variant="ghost" className="h-11" onClick={() => setArchiving(g._id)}>
                    <Archive className="size-4" aria-hidden />
                    {t("godowns.archive")}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
      <Dialog open={archiving !== null} onOpenChange={(o) => !o && setArchiving(null)}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("godowns.archiveTitle")}</DialogTitle>
            <DialogDescription>{t("godowns.archiveBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setArchiving(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              className="h-11"
              disabled={busy}
              onClick={() => void archive()}
            >
              {t("godowns.archive")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Godown management (owner): status, code, quick summary; add / edit / archive (spec §9.11). */
export default function GodownsPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}
