"use client";

/**
 * Variety picker (requirement_v2 §12.2): recents (last 8 used) first, company shown, "+ নতুন জাত"
 * inline with duplicate prevention — close matches ("Did you mean…") before creating.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { EntityPicker, type PickerItem } from "@/components/forms/EntityPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorKey } from "@/client/errors";
import { varietyRows } from "@/client/queries/purchases";
import { upsertMaster } from "@/client/repo";
import { normalizedVarietyKey } from "@/domain/legacy/migrateV1";
import { VARIETY_COMPANIES, type Variety } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { buildSearchKey, matchesSearch } from "@/i18n/translit";
import { FieldBox, Segmented } from "./Fields";

type T = (k: TKey, v?: Record<string, string | number>) => string;

export function varietyName(v: Variety | undefined, t: T): string {
  if (!v) return "";
  if (v.systemKey && !v.renamed && !v.name) return t(`variety.${v.systemKey}` as TKey);
  return v.name;
}

export function companyLabel(v: Variety, t: T): string {
  if (!v.company) return "";
  return v.company === "OTHER"
    ? (v.companyOther ?? t("vari.OTHER"))
    : t(`vari.${v.company}` as TKey);
}

export function VarietyPicker({
  godownId,
  value,
  onChange,
  testId,
  error,
  product = "PADDY",
  label,
}: {
  godownId: string;
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  testId: string;
  error?: string | null;
  product?: "PADDY" | "RICE";
  label?: string;
}) {
  const { t } = useI18n();
  const items = useLiveQuery(async (): Promise<PickerItem[]> => {
    const { all, recent } = await varietyRows(godownId);
    const rank = new Map(recent.map((id, i) => [id, i] as const));
    return all
      .filter((r) => r.variety.product === product)
      .sort(
        (a, b) =>
          (rank.get(a.variety._id) ?? 99) - (rank.get(b.variety._id) ?? 99) ||
          varietyName(a.variety, t).localeCompare(varietyName(b.variety, t)),
      )
      .map((r) => {
        const name = varietyName(r.variety, t);
        const key = buildSearchKey(name, r.variety.nameAlt, r.variety.systemKey);
        const sub = [companyLabel(r.variety, t), rank.has(r.variety._id) ? t("vari.recent") : ""]
          .filter(Boolean)
          .join(" · ");
        return {
          id: r.variety._id,
          title: name,
          ...(sub ? { sub } : {}),
          match: (q: string) => matchesSearch(key, q),
        };
      });
  }, [godownId, product, t]);
  return (
    <div className="flex flex-col gap-1">
      <EntityPicker
        label={label ?? t("pur.variety")}
        value={value}
        items={items}
        onSelect={onChange}
        testId={testId}
        renderCreate={(initial, done, cancel) => (
          <NewVarietyForm
            godownId={godownId}
            product={product}
            initial={initial}
            onDone={done}
            onCancel={cancel}
          />
        )}
      />
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}

/** Add a variety; warns about close matches first (case, spaces, Bengali/English spelling). */
export function NewVarietyForm({
  godownId,
  product,
  initial,
  onDone,
  onCancel,
}: {
  godownId: string;
  product: "PADDY" | "RICE";
  initial: string;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initial);
  const [nameAlt, setNameAlt] = useState("");
  const [company, setCompany] = useState<string>("NONE");
  const [companyOther, setCompanyOther] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [similar, setSimilar] = useState<Variety[] | null>(null);
  const existing = useLiveQuery(
    () => varietyRows(godownId).then((r) => r.all.map((x) => x.variety)),
    [godownId],
  );

  const create = async (force: boolean) => {
    setError(null);
    if (!name.trim()) return setError(t("acct.required"));
    if (!force) {
      const q = buildSearchKey(name, nameAlt);
      const key = normalizedVarietyKey(name, company === "NONE" ? undefined : company);
      const close = (existing ?? []).filter(
        (v) =>
          v.normalizedKey === key ||
          matchesSearch(buildSearchKey(varietyName(v, t), v.nameAlt, v.systemKey), name.trim()) ||
          matchesSearch(q, varietyName(v, t)),
      );
      if (close.length > 0) {
        setSimilar(close);
        return;
      }
    }
    try {
      const v = await upsertMaster(godownId, "variety", {
        name: name.trim(),
        ...(nameAlt.trim() ? { nameAlt: nameAlt.trim() } : {}),
        ...(company !== "NONE" ? { company: company as Variety["company"] } : {}),
        ...(company === "OTHER" && companyOther.trim()
          ? { companyOther: companyOther.trim() }
          : {}),
        product,
        normalizedKey: "",
        verified: false,
      });
      onDone(v._id);
    } catch (e) {
      setError(t(errorKey(e)));
    }
  };

  if (similar) {
    return (
      <div className="flex flex-col gap-3" data-testid="variety-similar">
        <p className="text-base font-medium">{t("vari.didYouMean")}</p>
        {similar.map((v) => (
          <Button
            key={v._id}
            variant="outline"
            className="h-12 justify-between text-base"
            onClick={() => onDone(v._id)}
          >
            <span>{varietyName(v, t)}</span>
            <span className="text-muted-foreground text-sm">
              {companyLabel(v, t) || t("vari.useThis")}
            </span>
          </Button>
        ))}
        <Button
          variant="ghost"
          className="h-12"
          onClick={() => void create(true)}
          data-testid="variety-create-anyway"
        >
          {t("vari.createAnyway")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="new-variety">
      <FieldBox label={t("vari.name")}>
        <Input
          className="h-12 text-base"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          data-testid="new-variety-name"
        />
      </FieldBox>
      <FieldBox label={t("vari.nameAlt")}>
        <Input
          className="h-12 text-base"
          value={nameAlt}
          onChange={(e) => setNameAlt(e.target.value)}
        />
      </FieldBox>
      <FieldBox label={t("vari.company")}>
        <div className="flex flex-wrap gap-2">
          {(["NONE", ...VARIETY_COMPANIES] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={company === c}
              onClick={() => setCompany(c)}
              className="chip chip-gold"
            >
              {c === "NONE" ? t("vari.noCompany") : t(`vari.${c}` as TKey)}
            </button>
          ))}
        </div>
      </FieldBox>
      {company === "OTHER" ? (
        <FieldBox label={t("vari.companyOther")}>
          <Input
            className="h-12 text-base"
            value={companyOther}
            onChange={(e) => setCompanyOther(e.target.value)}
          />
        </FieldBox>
      ) : null}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-12" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button className="h-12" onClick={() => void create(false)} data-testid="new-variety-save">
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

export { Segmented };
