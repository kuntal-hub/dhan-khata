"use client";

/**
 * Entry-form building blocks (requirement_v2 §15.6): DateField (no future dates, back-date note),
 * PartyPicker and BankPicker (search + offline inline create), Segmented toggle, FieldBox.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { useId, useState, type ReactNode } from "react";
import { CalendarClock } from "lucide-react";
import { EntityPicker, type PickerItem } from "@/components/forms/EntityPicker";
import { BankAccountForm } from "./BankAccountForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db } from "@/client/db/dexie";
import { errorKey } from "@/client/errors";
import { upsertMaster } from "@/client/repo";
import { todayIST } from "@/domain/dates";
import { normalizePhone } from "@/domain/phone";
import type { PartyRole } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import { matchesSearch } from "@/i18n/translit";

export function FieldBox({
  label,
  children,
  hint,
  error,
  htmlFor,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  htmlFor?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={htmlFor} className="text-sm">
        {label}
      </Label>
      {children}
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : hint ? (
        <div className="text-muted-foreground text-xs">{hint}</div>
      ) : null}
    </div>
  );
}

/** Business date (YYYY-MM-DD, IST). Future dates are blocked; older dates show a note. */
export function DateField({
  label,
  value,
  onChange,
  testId,
  allowFuture = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testId?: string;
  allowFuture?: boolean;
}) {
  const { t, date } = useI18n();
  const id = useId();
  const today = todayIST();
  const future = !allowFuture && value > today;
  return (
    <FieldBox
      label={label}
      htmlFor={id}
      error={future ? t("dateF.future") : null}
      hint={
        !allowFuture && value && value < today ? (
          <span className="flex items-center gap-1 text-amber-700">
            <CalendarClock className="size-3.5" aria-hidden />
            {t("dateF.backdated", { date: date(value, "short") })}
          </span>
        ) : undefined
      }
    >
      <Input
        id={id}
        type="date"
        className="h-12 text-base"
        value={value}
        max={allowFuture ? undefined : today}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
      />
    </FieldBox>
  );
}

/** Two-to-four-option toggle (big buttons). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  testId,
  label,
}: {
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
  testId?: string;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="seg w-full"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          data-testid={testId ? `${testId}-${v}` : undefined}
          onClick={() => onChange(v)}
          className="min-h-11 px-2"
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** Party picker for the active Gola, filtered by roles; creates a party inline (offline). */
export function PartyPicker({
  godownId,
  roles,
  value,
  onChange,
  label,
  testId,
  error,
  createRole,
}: {
  godownId: string;
  roles: PartyRole[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  label: string;
  testId: string;
  error?: string | null;
  createRole: PartyRole;
}) {
  const items = useLiveQuery(async (): Promise<PickerItem[]> => {
    const ps = await db().parties.where("godownId").equals(godownId).toArray();
    return ps
      .filter((p) => p.status === "active" && p.roles.some((r) => roles.includes(r)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({
        id: p._id,
        title: p.name,
        ...(p.phone || p.address ? { sub: [p.phone, p.address].filter(Boolean).join(" · ") } : {}),
        match: (q: string) => matchesSearch(p.searchKey, q) || (p.phone ?? "").includes(q),
      }));
  }, [godownId, roles.join(",")]);
  return (
    <div className="flex flex-col gap-1">
      <EntityPicker
        label={label}
        value={value}
        items={items}
        onSelect={onChange}
        testId={testId}
        renderCreate={(initial, done, cancel) => (
          <NewPartyForm
            godownId={godownId}
            role={createRole}
            initial={initial}
            onDone={done}
            onCancel={cancel}
          />
        )}
      />
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
      {value ? <PartyPhone id={value} /> : null}
    </div>
  );
}

function PartyPhone({ id }: { id: string }) {
  const p = useLiveQuery(() => db().parties.get(id), [id]);
  if (!p?.phone) return null;
  return (
    <a href={`tel:${p.phone}`} className="text-primary text-sm underline-offset-2 hover:underline">
      {p.phone}
    </a>
  );
}

function NewPartyForm({
  godownId,
  role,
  initial,
  onDone,
  onCancel,
}: {
  godownId: string;
  role: PartyRole;
  initial: string;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initial);
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    if (!name.trim()) return setError(t("acct.required"));
    const ph = phone.trim() ? normalizePhone(phone) : undefined;
    if (phone.trim() && !ph) return setError(t("acct.mobileInvalid"));
    try {
      const p = await upsertMaster(godownId, "party", {
        name: name.trim(),
        roles: [role],
        ...(ph ? { phone: ph } : {}),
        ...(address.trim() ? { address: address.trim() } : {}),
      });
      onDone(p._id);
    } catch (e) {
      setError(t(errorKey(e)));
    }
  };
  return (
    <div className="flex flex-col gap-3" data-testid="new-party">
      <FieldBox label={t("partyV2.name")}>
        <Input
          className="h-12 text-base"
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="new-party-name"
          autoFocus
        />
      </FieldBox>
      <FieldBox label={t("partyV2.mobile")}>
        <Input
          className="h-12 text-base"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          data-testid="new-party-phone"
        />
      </FieldBox>
      <FieldBox label={t("partyV2.address")}>
        <Input
          className="h-12 text-base"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </FieldBox>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-12" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button className="h-12" onClick={() => void save()} data-testid="new-party-save">
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

/** Our bank account (for BANK / UPI payments). */
export function BankPicker({
  godownId,
  value,
  onChange,
  testId,
  error,
}: {
  godownId: string;
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  testId: string;
  error?: string | null;
}) {
  const { t } = useI18n();
  const items = useLiveQuery(async (): Promise<PickerItem[]> => {
    const bs = await db().bankAccounts.where("godownId").equals(godownId).toArray();
    return bs
      .filter((b) => b.status === "active")
      .map((b) => ({
        id: b._id,
        title: b.name,
        sub: `${b.bank} · ••${b.last4}`,
        match: (q: string) =>
          `${b.name} ${b.bank} ${b.last4}`.toLowerCase().includes(q.toLowerCase()),
      }));
  }, [godownId]);
  return (
    <div className="flex flex-col gap-1">
      <EntityPicker
        label={t("pay.bankAccount")}
        value={value}
        items={items}
        onSelect={onChange}
        testId={testId}
        {...(items && items.length === 0 ? { emptyLabel: t("pay.noBank") } : {})}
        renderCreate={(initial, done, cancel) => (
          <BankAccountForm
            godownId={godownId}
            initialName={initial}
            onDone={done}
            onCancel={cancel}
          />
        )}
      />
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
