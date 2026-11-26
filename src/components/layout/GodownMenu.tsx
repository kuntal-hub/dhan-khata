"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Layers, Settings2 } from "lucide-react";
import { golaColourClass } from "@/components/gola/colours";
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
import { GodownSwitcherButton } from "./GodownSwitcherButton";
import type { LazyMenuProps } from "./lazyMenu";

/**
 * The godown list + "discard unsaved form?" confirm. Loaded on the first tap of the header
 * switcher (`GodownSwitcher`).
 */
export function GodownMenu({ open, onOpenChange }: LazyMenuProps) {
  const t = useT();
  const { godowns, godownId, consolidated, canConsolidate, select, selectAll } = useActiveGodown();
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

  return (
    <>
      <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <GodownSwitcherButton />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          <DropdownMenuLabel>{t("gola.list")}</DropdownMenuLabel>
          {(godowns ?? []).map((g) => (
            <DropdownMenuItem
              key={g._id}
              className="min-h-12 text-base"
              onSelect={() => choose(g._id)}
              data-testid={`godown-item-${g.code}`}
            >
              <Check
                className={g._id === godownId && !consolidated ? "size-4" : "size-4 opacity-0"}
                aria-hidden
              />
              <span
                className={`size-3 shrink-0 rounded-full ${golaColourClass(g.colour)}`}
                aria-hidden
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{g.name}</span>
                {g.status === "archived" ? (
                  <span className="text-muted-foreground text-xs">{t("gola.archived")}</span>
                ) : null}
              </span>
            </DropdownMenuItem>
          ))}
          {canConsolidate ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="min-h-12 text-base"
                onSelect={() => choose("ALL")}
                data-testid="godown-item-ALL"
              >
                <Layers className="size-4" aria-hidden />
                {t("gola.all")}
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuSeparator />
          {/* Where a new Gola is added (also in the avatar menu); one tap from the switcher. */}
          <DropdownMenuItem asChild className="min-h-12 text-base">
            <Link href="/golas" data-testid="godown-item-manage">
              <Settings2 className="size-4" aria-hidden />
              {t("gola.manage")}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("gola.word")}</DialogTitle>
            <DialogDescription className="text-base">{t("gola.switchDirty")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-12" onClick={() => setPending(null)}>
              {t("common.cancel")}
            </Button>
            <Button className="h-12" onClick={() => pending !== null && apply(pending)}>
              {t("acct.continue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
