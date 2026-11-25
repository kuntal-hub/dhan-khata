"use client";

/**
 * Expense categories (requirement_v2 §12.4): built-in ones render through i18n
 * (`expenseCategory.<code>`), custom ones show their typed name. Add / rename / hide.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { LazyBottomSheet as BottomSheet } from "@/components/forms/LazyBottomSheet";
import { FieldBox } from "@/components/entry/Fields";
import { lazyToast } from "@/components/system/IdleToaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorKey } from "@/client/errors";
import { categoryList } from "@/client/queries/expenses";
import { upsertMaster } from "@/client/repo";
import type { ExpenseCategory } from "@/domain/schemas";
import { FARMER_PAYMENT_CODE } from "@/domain/v2/accounts";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

type T = ReturnType<typeof useI18n>["t"];

export function categoryName(c: ExpenseCategory | undefined, t: T, code?: string): string {
  if (!c) return code ?? "";
  if (c.name) return c.name;
  return t(`expenseCategory.${c.code}` as TKey);
}

export function NewCategorySheet({
  godownId,
  onClose,
  existing,
}: {
  godownId: string;
  onClose: (code?: string) => void;
  existing?: ExpenseCategory;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(existing?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!name.trim()) return setError(t("acct.required"));
    try {
      const c = await upsertMaster(godownId, "expenseCategory", {
        ...(existing ?? { code: "", isSystem: false, enabled: true }),
        name: name.trim(),
      });
      lazyToast(t("xp.categorySaved"), "success");
      onClose(c.code);
    } catch (e) {
      setError(t(errorKey(e)));
    }
  };
  return (
    <BottomSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("xp.newCategory")}
      testId="category-sheet"
    >
      <FieldBox label={t("xp.categoryName")}>
        <Input
          className="h-12 text-base"
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="category-name"
          autoFocus
        />
      </FieldBox>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <Button className="h-12 text-base" onClick={() => void save()} data-testid="category-save">
        {t("xp.categorySave")}
      </Button>
    </BottomSheet>
  );
}

/** "খরচের ধরন সাজান": add, rename (custom), hide / show (Farmer payment always stays). */
export function CategoryManager({ godownId, onClose }: { godownId: string; onClose: () => void }) {
  const { t } = useI18n();
  const cats = useLiveQuery(() => categoryList(godownId), [godownId]);
  const [edit, setEdit] = useState<ExpenseCategory | "new" | null>(null);
  const toggle = async (c: ExpenseCategory) => {
    try {
      await upsertMaster(godownId, "expenseCategory", { ...c, enabled: !c.enabled });
    } catch (e) {
      lazyToast(t(errorKey(e)), "error");
    }
  };
  return (
    <BottomSheet open onOpenChange={(o) => !o && onClose()} title={t("xp.categories")}>
      <ul className="flex flex-col divide-y" data-testid="category-list">
        {(cats ?? []).map((c) => (
          <li key={c._id} className="flex min-h-12 items-center gap-2 py-1.5">
            <span className={`flex-1 text-[15px] ${c.enabled ? "" : "text-muted-foreground"}`}>
              {categoryName(c, t)}
              <span className="text-muted-foreground block text-xs">
                {c.isSystem ? t("xp.system") : ""}
                {c.enabled ? "" : ` ${t("xp.hidden")}`}
              </span>
            </span>
            {c.isSystem ? null : (
              <Button variant="ghost" className="h-11" onClick={() => setEdit(c)}>
                {t("common.edit")}
              </Button>
            )}
            {c.code === FARMER_PAYMENT_CODE ? null : (
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label={c.enabled ? t("xp.hide") : t("xp.show")}
                onClick={() => void toggle(c)}
              >
                {c.enabled ? (
                  <EyeOff className="size-5" aria-hidden />
                ) : (
                  <Eye className="size-5" aria-hidden />
                )}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Button className="h-12 text-base" onClick={() => setEdit("new")}>
        {t("xp.newCategory")}
      </Button>
      {edit ? (
        <NewCategorySheet
          godownId={godownId}
          {...(edit !== "new" ? { existing: edit } : {})}
          onClose={() => setEdit(null)}
        />
      ) : null}
    </BottomSheet>
  );
}
