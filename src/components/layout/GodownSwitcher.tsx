"use client";

import { useState } from "react";
import { Check, Layers, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveGodown } from "@/client/hooks";
import { useT } from "@/i18n/I18nProvider";
import { useAppSelector } from "@/store";

/**
 * Header switcher "গোডাউন: রামপুর ▾" (spec §1.4 rule 3). Lists only godowns the user can
 * access; asks before discarding a dirty form; offers the read-only "All godowns" mode to the
 * owner (or a user with `consolidated` on ≥ 2 godowns).
 */
export function GodownSwitcher() {
  const t = useT();
  const { godown, godowns, godownId, consolidated, canConsolidate, select, selectAll } =
    useActiveGodown();
  const dirty = useAppSelector((s) => s.ui.dirtyForms > 0);
  const [pending, setPending] = useState<string | "ALL" | null>(null);

  const choose = (target: string | "ALL") => {
    if (target === godownId && !consolidated) return;
    if (dirty) setPending(target);
    else apply(target);
  };
  const apply = (target: string | "ALL") => {
    if (target === "ALL") selectAll();
    else select(target);
    setPending(null);
  };

  const label = consolidated
    ? t("godown.allGodowns")
    : godown
      ? t("godown.switcher", { name: godown.name })
      : t("godown.choose");

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-11 min-w-0 flex-1 shrink justify-start gap-2 px-2 text-base"
          >
            <Warehouse className="size-5 shrink-0" aria-hidden />
            <span className="truncate font-semibold">{label}</span>
            <span aria-hidden>▾</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          <DropdownMenuLabel>{t("godown.choose")}</DropdownMenuLabel>
          {(godowns ?? []).length === 0 ? (
            <p className="text-muted-foreground px-2 py-3 text-sm">{t("godown.none")}</p>
          ) : null}
          {(godowns ?? []).map((g) => (
            <DropdownMenuItem key={g._id} className="min-h-11" onSelect={() => choose(g._id)}>
              <Check
                className={g._id === godownId && !consolidated ? "size-4" : "size-4 opacity-0"}
                aria-hidden
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{g.name}</span>
                {g.status === "archived" ? (
                  <span className="text-muted-foreground text-xs">{t("godown.archived")}</span>
                ) : null}
              </span>
            </DropdownMenuItem>
          ))}
          {canConsolidate ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="min-h-11" onSelect={() => choose("ALL")}>
                <Layers className="size-4" aria-hidden />
                {t("godown.readOnlyAll")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("godown.confirmSwitchTitle")}</DialogTitle>
            <DialogDescription>{t("godown.confirmSwitchBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setPending(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              className="h-11"
              onClick={() => pending !== null && apply(pending)}
            >
              {t("godown.switchAnyway")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
