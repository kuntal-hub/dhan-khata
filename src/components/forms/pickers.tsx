"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db } from "@/client/db/dexie";
import { errorKey } from "@/client/errors";
import { partyMatches } from "@/client/queries/parties";
import { upsertMaster } from "@/client/repo";
import {
  bankLabel,
  categoryLabel,
  partyTitle,
  varietyLabel,
  vehicleLabel,
} from "@/client/ui/labels";
import { normalizeDigits } from "@/domain/digits";
import { normalizePhone } from "@/domain/phone";
import { formatVehicleNumber, normalizeVehicleNumber, type PartyRole } from "@/domain/schemas";
import { matchesSearch, searchKeyOf } from "@/i18n/translit";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { EntityPicker, type PickerItem } from "./EntityPicker";

function textMatch(text: string) {
  const key = searchKeyOf(text);
  return (q: string) => !q.trim() || matchesSearch(key, q);
}

interface CommonProps {
  godownId: string;
  label: string;
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  required?: boolean;
  error?: TKey | null;
  disabled?: boolean;
  testId?: string;
  allowClear?: boolean;
}

/** Small inline create form used inside pickers. */
function InlineCreate({
  fields,
  onSubmit,
  cancel,
}: {
  fields: Array<{
    name: string;
    label: string;
    initial?: string;
    inputMode?: "text" | "tel" | "numeric";
    required?: boolean;
  }>;
  onSubmit: (values: Record<string, string>) => Promise<void>;
  cancel: () => void;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.name, f.initial ?? ""])),
  );
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
      {fields.map((f) => (
        <div key={f.name} className="flex flex-col gap-1">
          <Label htmlFor={`ic-${f.name}`}>{f.label}</Label>
          <Input
            id={`ic-${f.name}`}
            data-testid={`create-${f.name}`}
            className="h-12 text-base"
            inputMode={f.inputMode}
            required={f.required}
            value={values[f.name] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
          />
        </div>
      ))}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {t(error)}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="h-12 flex-1" onClick={cancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" className="h-12 flex-1" disabled={busy} data-testid="create-save">
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

export function PartyPicker({
  role,
  newRoles,
  ...p
}: CommonProps & { role?: PartyRole; newRoles?: PartyRole[] }) {
  const { t, lang } = useI18n();
  const parties = useLiveQuery(
    () =>
      db()
        .parties.where("godownId")
        .equals(p.godownId)
        .filter((x) => x.status === "active")
        .toArray(),
    [p.godownId],
  );
  const items: PickerItem[] | undefined = parties
    ?.filter((x) => !role || x.roles.includes(role))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .map((x) => {
      const { title: raw, sub } = partyTitle(x, lang);
      const title = x.roles.includes("godown") ? t("godown.otherGodownParty", { name: raw }) : raw;
      const extra = [sub, x.village, x.phone].filter(Boolean).join(" · ");
      return {
        id: x._id,
        title,
        ...(extra ? { sub: extra } : {}),
        match: (q) => partyMatches(x, q),
      };
    });
  return (
    <EntityPicker
      {...p}
      items={items}
      onSelect={p.onChange}
      renderCreate={(initial, done, cancel) => (
        <InlineCreate
          cancel={cancel}
          fields={[
            { name: "name", label: t("party.name"), initial, required: true },
            { name: "phone", label: t("party.phone"), inputMode: "tel" },
            { name: "village", label: t("party.village") },
          ]}
          onSubmit={async (v) => {
            const raw = v.phone?.trim();
            const phone = raw ? (normalizePhone(raw) ?? raw) : undefined;
            const party = await upsertMaster(p.godownId, "party", {
              name: v.name!.trim(),
              roles: newRoles ?? (role ? [role] : ["farmer"]),
              ...(phone ? { phone } : {}),
              ...(v.village?.trim() ? { village: v.village.trim() } : {}),
            });
            done(party._id);
          }}
        />
      )}
    />
  );
}

export function VarietyPicker(p: CommonProps) {
  const { t } = useI18n();
  const varieties = useLiveQuery(
    () =>
      db()
        .varieties.where("godownId")
        .equals(p.godownId)
        .filter((x) => x.status === "active")
        .toArray(),
    [p.godownId],
  );
  const items = varieties?.map((v) => {
    const title = varietyLabel(v, t);
    return { id: v._id, title, match: textMatch(`${title} ${v.name} ${v.nameAlt ?? ""}`) };
  });
  return (
    <EntityPicker
      {...p}
      items={items}
      onSelect={p.onChange}
      renderCreate={(initial, done, cancel) => (
        <InlineCreate
          cancel={cancel}
          fields={[{ name: "name", label: t("trade.variety"), initial, required: true }]}
          onSubmit={async (v) => {
            const created = await upsertMaster(p.godownId, "variety", { name: v.name!.trim() });
            done(created._id);
          }}
        />
      )}
    />
  );
}

/** Vehicle: pick a registered vehicle or type a number (auto-created as external on save). */
export function VehiclePicker(
  p: CommonProps & { text: string; onTextChange: (text: string) => void },
) {
  const { t } = useI18n();
  const vehicles = useLiveQuery(
    () =>
      db()
        .vehicles.where("godownId")
        .equals(p.godownId)
        .filter((x) => x.status === "active")
        .toArray(),
    [p.godownId],
  );
  const items = vehicles?.map((v) => ({
    id: v._id,
    title: vehicleLabel(v),
    sub: t(v.ownership === "own" ? "masters.vehicleOwn" : "masters.vehicleExternal"),
    match: (q: string) =>
      !q.trim() || v.number.includes(normalizeVehicleNumber(normalizeDigits(q))),
  }));
  return (
    <EntityPicker
      {...p}
      items={items}
      onSelect={p.onChange}
      freeText={{ value: p.text, onChange: p.onTextChange }}
    />
  );
}

/** Load place: pick a saved place or type one. */
export function PlacePicker(
  p: CommonProps & { text: string; onTextChange: (text: string) => void },
) {
  const { t } = useI18n();
  const places = useLiveQuery(
    () =>
      db()
        .places.where("godownId")
        .equals(p.godownId)
        .filter((x) => x.status === "active")
        .toArray(),
    [p.godownId],
  );
  const items = places?.map((x) => ({ id: x._id, title: x.name, match: textMatch(x.name) }));
  return (
    <EntityPicker
      {...p}
      items={items}
      onSelect={p.onChange}
      freeText={{ value: p.text, onChange: p.onTextChange }}
      renderCreate={(initial, done, cancel) => (
        <InlineCreate
          cancel={cancel}
          fields={[{ name: "name", label: t("load.loadPlace"), initial, required: true }]}
          onSubmit={async (v) => {
            const created = await upsertMaster(p.godownId, "place", { name: v.name!.trim() });
            done(created._id);
          }}
        />
      )}
    />
  );
}

/** Expense category (value = the immutable category CODE). Disabled categories are hidden. */
export function CategoryPicker(p: CommonProps) {
  const { t } = useI18n();
  const cats = useLiveQuery(
    () =>
      db()
        .expenseCategories.where("godownId")
        .equals(p.godownId)
        .filter((c) => c.status === "active" && (c.enabled || c.code === p.value))
        .toArray(),
    [p.godownId, p.value],
  );
  const items = cats?.map((c) => {
    const title = categoryLabel(c, t);
    return { id: c.code, title, match: textMatch(`${title} ${c.name ?? ""} ${c.code}`) };
  });
  return (
    <EntityPicker
      {...p}
      items={items}
      onSelect={p.onChange}
      renderCreate={(initial, done, cancel) => (
        <InlineCreate
          cancel={cancel}
          fields={[{ name: "name", label: t("masters.categoryName"), initial, required: true }]}
          onSubmit={async (v) => {
            const created = await upsertMaster(p.godownId, "expenseCategory", {
              code: "",
              isSystem: false,
              enabled: true,
              name: v.name!.trim(),
            });
            done(created.code);
          }}
        />
      )}
    />
  );
}

/** A registered vehicle of this godown (no free text). */
export function VehicleOnlyPicker(p: CommonProps & { ownOnly?: boolean }) {
  const { t } = useI18n();
  const vehicles = useLiveQuery(
    () =>
      db()
        .vehicles.where("godownId")
        .equals(p.godownId)
        .filter((x) => x.status === "active" && (!p.ownOnly || x.ownership === "own"))
        .toArray(),
    [p.godownId, p.ownOnly],
  );
  const items = vehicles?.map((v) => ({
    id: v._id,
    title: vehicleLabel(v),
    sub: t(v.ownership === "own" ? "masters.vehicleOwn" : "masters.vehicleExternal"),
    match: (q: string) =>
      !q.trim() || v.number.includes(normalizeVehicleNumber(normalizeDigits(q))),
  }));
  return (
    <EntityPicker
      {...p}
      items={items}
      onSelect={p.onChange}
      renderCreate={(initial, done, cancel) => (
        <InlineCreate
          cancel={cancel}
          fields={[{ name: "number", label: t("sale.vehicleNumber"), initial, required: true }]}
          onSubmit={async (v) => {
            const created = await upsertMaster(p.godownId, "vehicle", {
              number: normalizeVehicleNumber(normalizeDigits(v.number ?? "")),
              ownership: p.ownOnly ? "own" : "external",
            });
            done(created._id);
          }}
        />
      )}
    />
  );
}

/** A LOAD voucher of this godown (recent first) — to tag expenses / own-trade trips. */
export function LoadPicker(p: CommonProps) {
  const { date } = useI18n();
  const loads = useLiveQuery(
    () =>
      db()
        .vouchers.where("[godownId+type+date]")
        .between([p.godownId, "LOAD", ""], [p.godownId, "LOAD", "￿"], true, true)
        .filter((v) => v.status === "active")
        .reverse()
        .limit(200)
        .toArray(),
    [p.godownId],
  );
  const items = loads?.map((l) => {
    const sub = [
      date(l.date, "short"),
      l.type === "LOAD" ? formatVehicleNumber(l.vehicleNumber) : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return { id: l._id, title: l.number, sub, match: textMatch(`${l.number} ${sub}`) };
  });
  return <EntityPicker {...p} items={items} onSelect={p.onChange} />;
}

export function BankPicker(p: CommonProps) {
  const { t } = useI18n();
  const banks = useLiveQuery(
    () =>
      db()
        .bankAccounts.where("godownId")
        .equals(p.godownId)
        .filter((x) => x.status === "active")
        .toArray(),
    [p.godownId],
  );
  const items = banks?.map((b) => ({
    id: b._id,
    title: bankLabel(b),
    sub: b.bank,
    match: textMatch(`${b.name} ${b.bank} ${b.last4}`),
  }));
  return (
    <EntityPicker
      {...p}
      items={items}
      onSelect={p.onChange}
      renderCreate={(initial, done, cancel) => (
        <InlineCreate
          cancel={cancel}
          fields={[
            { name: "name", label: t("masters.bankName"), initial, required: true },
            { name: "bank", label: t("masters.bankBank"), required: true },
            { name: "last4", label: t("masters.bankLast4"), inputMode: "numeric", required: true },
          ]}
          onSubmit={async (v) => {
            const created = await upsertMaster(p.godownId, "bankAccount", {
              name: v.name!.trim(),
              bank: v.bank!.trim(),
              last4: normalizeDigits(v.last4 ?? "").trim(),
              isUpiLinked: false,
              openingBalancePaise: "0",
            });
            done(created._id);
          }}
        />
      )}
    />
  );
}
