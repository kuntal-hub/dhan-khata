"use client";

/**
 * Vehicle owner picker (DECISIONS D56): the Gola's saved owners (search by name / mobile), owners
 * saved in the other Golas (one tap brings a copy into this Gola), and "+ নতুন" with a duplicate
 * check ("already saved — pick this one"). Works offline.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { EntityPicker, type PickerItem } from "@/components/forms/EntityPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db } from "@/client/db/dexie";
import { errorKey } from "@/client/errors";
import { useAccessibleGodowns } from "@/client/hooks";
import { ownersFromOtherGolas } from "@/client/queries/consolidated/vehicleOwners";
import { adoptVehicleOwner, importVehicleOwner, RepoError, saveVehicleOwner } from "@/client/repo";
import { normalizePhone } from "@/domain/phone";
import type { Party } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import { matchesSearch } from "@/i18n/translit";
import { FieldBox } from "@/components/entry/Fields";

const IMPORT = "import:";

export function VehicleOwnerPicker({
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
  const golas = useAccessibleGodowns();
  const [importError, setImportError] = useState<string | null>(null);
  const ids = (golas ?? []).map((g) => g._id);
  const data = useLiveQuery(async () => {
    const own = (await db().parties.where("godownId").equals(godownId).toArray())
      .filter((p) => p.status === "active" && p.roles.includes("TRANSPORTER"))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { own, others: await ownersFromOtherGolas(godownId, ids) };
  }, [godownId, ids.join(",")]);
  const names = new Map((golas ?? []).map((g) => [g._id, g.name] as const));
  const items: PickerItem[] | undefined = data && [
    ...data.own.map((p) => ({
      id: p._id,
      title: p.name,
      ...(p.phone || p.address ? { sub: [p.phone, p.address].filter(Boolean).join(" · ") } : {}),
      match: (q: string) => matchesSearch(p.searchKey, q) || (p.phone ?? "").includes(q),
    })),
    ...data.others.map((o) => ({
      id: `${IMPORT}${o.party._id}`,
      title: o.party.name,
      sub: [t("fare.fromGola", { gola: names.get(o.godownId) ?? "" }), o.party.phone]
        .filter(Boolean)
        .join(" · "),
      match: (q: string) =>
        matchesSearch(o.party.searchKey, q) || (o.party.phone ?? "").includes(q),
    })),
  ];

  const select = async (id: string | undefined) => {
    setImportError(null);
    if (!id?.startsWith(IMPORT)) return onChange(id);
    const src = await db().parties.get(id.slice(IMPORT.length));
    if (!src) return;
    try {
      const p = await importVehicleOwner(godownId, {
        name: src.name,
        ...(src.phone ? { phone: src.phone } : {}),
        ...(src.address ? { address: src.address } : {}),
      });
      onChange(p._id);
    } catch (e) {
      setImportError(t(errorKey(e)));
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <EntityPicker
        label={t("fare.owner")}
        sheetTitle={t("fare.ownerPick")}
        value={value}
        items={items}
        onSelect={(id) => void select(id)}
        testId={testId}
        emptyLabel={t("fare.ownerEmpty")}
        renderCreate={(initial, done, cancel) => (
          <VehicleOwnerForm
            godownId={godownId}
            initialName={initial}
            onDone={done}
            onCancel={cancel}
          />
        )}
      />
      {error || importError ? (
        <p className="text-destructive text-xs" role="alert">
          {error ?? importError}
        </p>
      ) : null}
    </div>
  );
}

/** Add (or edit, with `existing`) a vehicle owner: name, optional mobile, optional address. */
export function VehicleOwnerForm({
  godownId,
  existing,
  initialName = "",
  onDone,
  onCancel,
}: {
  godownId: string;
  existing?: Party;
  initialName?: string;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(existing?.name ?? initialName);
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [address, setAddress] = useState(existing?.address ?? "");
  const [error, setError] = useState<string | null>(null);
  const [dup, setDup] = useState<Party | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    setDup(null);
    if (!name.trim()) return setError(t("acct.required"));
    const ph = phone.trim() ? normalizePhone(phone) : undefined;
    if (phone.trim() && !ph) return setError(t("acct.mobileInvalid"));
    setBusy(true);
    try {
      const p = await saveVehicleOwner(
        godownId,
        { name, ...(ph ? { phone: ph } : {}), address },
        existing?._id,
      );
      onDone(p._id);
    } catch (e) {
      if (e instanceof RepoError && e.code === "DUPLICATE_PARTY" && e.detail) {
        const other = await db().parties.get(e.detail);
        if (other) setDup(other);
      }
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="owner-form">
      <FieldBox label={t("fare.ownerName")}>
        <Input
          className="h-12 text-base"
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="owner-name"
          autoFocus
        />
      </FieldBox>
      <FieldBox label={t("fare.ownerMobile")}>
        <Input
          className="h-12 text-base"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          data-testid="owner-phone"
        />
      </FieldBox>
      <FieldBox label={t("partyV2.address")}>
        <Input
          className="h-12 text-base"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </FieldBox>
      {error ? (
        <div className="text-destructive flex flex-col gap-2 text-sm" role="alert">
          <p>{error}</p>
          {dup && !existing ? (
            <Button
              variant="outline"
              className="h-11"
              data-testid="owner-use-existing"
              onClick={async () => {
                try {
                  const p = await adoptVehicleOwner(godownId, dup._id);
                  onDone(p._id);
                } catch (e) {
                  setError(t(errorKey(e)));
                }
              }}
            >
              {t("fare.useExisting", { name: dup.name, phone: dup.phone ?? "" })}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-12" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          className="h-12"
          disabled={busy}
          onClick={() => void save()}
          data-testid="owner-save"
        >
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
