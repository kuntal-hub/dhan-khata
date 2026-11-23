"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { BottomSheet } from "./BottomSheet";

export interface PickerItem {
  id: string;
  title: string;
  sub?: string;
  /** Text matched by the search box (in addition to the title). */
  match: (query: string) => boolean;
}

/**
 * Searchable picker (bottom sheet) with inline "+ নতুন যোগ করুন" creation that works offline
 * (the create form writes through the repo, then selects the new record).
 */
export function EntityPicker({
  label,
  sheetTitle,
  value,
  items,
  onSelect,
  renderCreate,
  freeText,
  required,
  error,
  disabled,
  testId,
  emptyLabel,
  allowClear,
}: {
  label: string;
  sheetTitle?: string;
  value: string | undefined;
  items: PickerItem[] | undefined;
  onSelect: (id: string | undefined) => void;
  /** Inline create form; call `done(newId)` after saving. */
  renderCreate?: (initialText: string, done: (id: string) => void, cancel: () => void) => ReactNode;
  /** Accept typed text that matches nothing (e.g. vehicle number, place name). */
  freeText?: { value: string; onChange: (text: string) => void };
  required?: boolean;
  error?: TKey | null;
  disabled?: boolean;
  testId?: string;
  emptyLabel?: string;
  allowClear?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const selected = items?.find((i) => i.id === value);
  const shown = useMemo(
    () => (items ?? []).filter((i) => i.match(query)).slice(0, 200),
    [items, query],
  );
  const display = selected?.title ?? (freeText?.value || "");

  const close = () => {
    setOpen(false);
    setCreating(false);
    setQuery("");
  };

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label className="text-sm">
        {label}
        {required ? (
          <span aria-hidden className="text-destructive ml-0.5">
            {t("form.requiredMark")}
          </span>
        ) : null}
      </Label>
      <button
        type="button"
        data-testid={testId}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          "border-input flex h-12 w-full min-w-0 items-center justify-between gap-2 rounded-md border px-3 text-left text-base",
          error ? "border-destructive" : "",
          disabled ? "bg-muted opacity-70" : "",
        )}
      >
        <span className={cn("min-w-0 truncate", display ? "" : "text-muted-foreground")}>
          {display || emptyLabel || t("form.choose")}
          {selected?.sub ? (
            <span className="text-muted-foreground ml-2 text-sm">{selected.sub}</span>
          ) : null}
        </span>
        <ChevronDown className="size-4 shrink-0 opacity-60" aria-hidden />
      </button>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {t(error)}
        </p>
      ) : null}

      <BottomSheet
        open={open}
        onOpenChange={(o) => (o ? setOpen(true) : close())}
        title={sheetTitle ?? label}
        testId={testId ? `${testId}-sheet` : undefined}
      >
        {creating && renderCreate ? (
          renderCreate(
            query,
            (id) => {
              onSelect(id);
              close();
            },
            () => setCreating(false),
          )
        ) : (
          <>
            <div className="relative">
              <Search
                className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
                aria-hidden
              />
              <Input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  freeText?.onChange(e.target.value);
                }}
                placeholder={t("common.search")}
                aria-label={t("common.search")}
                data-testid={testId ? `${testId}-search` : undefined}
                className="h-12 pl-9 text-base"
              />
            </div>
            {renderCreate ? (
              <Button
                type="button"
                variant="outline"
                className="h-12 justify-start"
                data-testid={testId ? `${testId}-create` : undefined}
                onClick={() => setCreating(true)}
              >
                <Plus className="size-4" aria-hidden />
                {t("common.addNew")}
              </Button>
            ) : null}
            {freeText && query.trim() ? (
              <Button
                type="button"
                variant="secondary"
                className="h-12 justify-start"
                onClick={() => {
                  freeText.onChange(query.trim());
                  onSelect(undefined);
                  close();
                }}
              >
                {t("form.useTyped", { text: query.trim() })}
              </Button>
            ) : null}
            {allowClear && value ? (
              <Button
                type="button"
                variant="ghost"
                className="h-11 justify-start"
                onClick={() => {
                  onSelect(undefined);
                  close();
                }}
              >
                {t("form.clearChoice")}
              </Button>
            ) : null}
            <ul className="flex flex-col" role="listbox" aria-label={label}>
              {shown.length === 0 ? (
                <li className="text-muted-foreground py-6 text-center text-sm">
                  {t("form.noMatches")}
                </li>
              ) : null}
              {shown.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i.id === value}
                    className={cn(
                      "hover:bg-muted flex min-h-12 w-full flex-col items-start justify-center rounded-md px-3 py-2 text-left",
                      i.id === value ? "bg-muted" : "",
                    )}
                    onClick={() => {
                      onSelect(i.id);
                      freeText?.onChange("");
                      close();
                    }}
                  >
                    <span className="text-base">{i.title}</span>
                    {i.sub ? <span className="text-muted-foreground text-xs">{i.sub}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </BottomSheet>
    </div>
  );
}
