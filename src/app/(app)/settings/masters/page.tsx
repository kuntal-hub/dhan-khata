"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState, type ReactNode } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BottomSheet } from "@/components/forms/BottomSheet";
import { Choice, TextField } from "@/components/forms/fields";
import { PartyPicker } from "@/components/forms/pickers";
import { AmountInput, PercentInput, WeightInput } from "@/components/money/inputs";
import { Money } from "@/components/money/display";
import { EmptyState, Loading, SyncIcon } from "@/components/lists/common";
import {
  PageHeader,
  PageSuspense,
  ReadOnlyNotice,
  useParam,
  useWriteGodown,
} from "@/components/system/page";
import { db } from "@/client/db/dexie";
import { errorKey } from "@/client/errors";
import { upsertMaster } from "@/client/repo";
import { bankLabel, categoryLabel, varietyLabel, vehicleLabel } from "@/client/ui/labels";
import {
  bpsToInput,
  gramsToKgInput,
  paiseToInput,
  parseAmountField,
  parsePercentField,
  parseWeightField,
} from "@/client/ui/parse";
import { normalizeDigits } from "@/domain/digits";
import { SYSTEM_EXPENSE_CODES } from "@/domain/posting/accounts";
import {
  normalizeVehicleNumber,
  type BankAccount,
  type ExpenseCategory,
  type Place,
  type Variety,
  type Vehicle,
} from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";

const TABS = ["varieties", "categories", "banks", "vehicles", "places"] as const;
type Tab = (typeof TABS)[number];

function useSaver() {
  const { t } = useI18n();
  return async (fn: () => Promise<unknown>, done: () => void) => {
    try {
      await fn();
      toast.success(t("common.saved"));
      done();
    } catch (e) {
      toast.error(t(errorKey(e)));
    }
  };
}

function ListRow({
  title,
  sub,
  right,
  onEdit,
  id,
  serverSeq,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
  onEdit?: () => void;
  id: string;
  serverSeq?: number;
}) {
  const { t } = useI18n();
  return (
    <li className="flex min-h-14 items-center gap-3 border-b px-1 py-2">
      <SyncIcon entityId={id} {...(serverSeq !== undefined ? { serverSeq } : {})} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{title}</span>
        {sub ? <span className="text-muted-foreground truncate text-xs">{sub}</span> : null}
      </div>
      {right}
      {onEdit ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          onClick={onEdit}
          aria-label={t("common.edit")}
        >
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : null}
    </li>
  );
}

/** Masters of the active godown (spec §9.16 "This godown → masters"). */
function Inner() {
  const { t } = useI18n();
  const tab = useParam("tab");
  const { godownId, readOnly } = useWriteGodown();
  const [current, setCurrent] = useState<Tab>(
    (TABS as readonly string[]).includes(tab ?? "") ? (tab as Tab) : "varieties",
  );
  if (readOnly || !godownId) return <ReadOnlyNotice reason={readOnly ?? "noGodown"} />;
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={t("masters.title")} />
      <Tabs value={current} onValueChange={(v) => setCurrent(v as Tab)}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start">
          {TABS.map((x) => (
            <TabsTrigger key={x} value={x} className="min-h-11">
              {t(`masters.tab.${x}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="varieties">
          <Varieties godownId={godownId} />
        </TabsContent>
        <TabsContent value="categories">
          <Categories godownId={godownId} />
        </TabsContent>
        <TabsContent value="banks">
          <Banks godownId={godownId} />
        </TabsContent>
        <TabsContent value="vehicles">
          <Vehicles godownId={godownId} />
        </TabsContent>
        <TabsContent value="places">
          <Places godownId={godownId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function MastersPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

function Varieties({ godownId }: { godownId: string }) {
  const { t } = useI18n();
  const list = useLiveQuery(
    () => db().varieties.where("godownId").equals(godownId).toArray(),
    [godownId],
  );
  const [edit, setEdit] = useState<Variety | "new" | null>(null);
  if (!list) return <Loading />;
  return (
    <div className="flex flex-col gap-2 pt-2">
      <Button className="h-11 self-start" onClick={() => setEdit("new")}>
        <Plus className="size-4" aria-hidden />
        {t("common.addNew")}
      </Button>
      <ul>
        {list.map((v) => (
          <ListRow
            key={v._id}
            id={v._id}
            serverSeq={v.serverSeq}
            title={varietyLabel(v, t)}
            {...(v.systemKey ? { sub: v.systemKey } : {})}
            onEdit={() => setEdit(v)}
          />
        ))}
      </ul>
      {edit ? (
        <VarietyEditor
          godownId={godownId}
          v={edit === "new" ? null : edit}
          onClose={() => setEdit(null)}
        />
      ) : null}
    </div>
  );
}

function VarietyEditor({
  godownId,
  v,
  onClose,
}: {
  godownId: string;
  v: Variety | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const save = useSaver();
  const [name, setName] = useState(v ? (v.systemKey && !v.renamed ? "" : v.name) : "");
  const [tare, setTare] = useState(gramsToKgInput(v?.defaultDeductions?.tarePerBagG));
  const [dhalta, setDhalta] = useState(gramsToKgInput(v?.defaultDeductions?.dhaltaValueG));
  const [moisture, setMoisture] = useState(bpsToInput(v?.defaultDeductions?.moistureBps));
  return (
    <BottomSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={v ? varietyLabel(v, t) : t("trade.variety")}
    >
      <TextField
        label={v?.systemKey ? t("masters.renameVariety") : t("trade.variety")}
        value={name}
        onChange={setName}
        maxLength={80}
      />
      <WeightInput label={t("trade.bagTare")} value={tare} onChange={setTare} />
      <WeightInput label={t("trade.dhaltaValue")} value={dhalta} onChange={setDhalta} />
      <PercentInput label={t("trade.moistureCut")} value={moisture} onChange={setMoisture} />
      <Button
        className="h-12"
        onClick={() =>
          void save(async () => {
            const tp = parseWeightField(tare).value;
            const dp = parseWeightField(dhalta).value;
            const mp = parsePercentField(moisture).value;
            const ded = {
              ...(tp ? { tarePerBagG: tp.toString() } : {}),
              ...(dp ? { dhaltaMode: "PER_QUINTAL" as const, dhaltaValueG: dp.toString() } : {}),
              ...(mp ? { moistureBps: Number(mp) } : {}),
            };
            const renamed = !!v?.systemKey && name.trim() !== "";
            await upsertMaster(godownId, "variety", {
              ...(v ? { _id: v._id } : {}),
              name: name.trim(),
              ...(v?.systemKey ? { systemKey: v.systemKey } : {}),
              ...(v?.systemKey ? { renamed } : {}),
              ...(Object.keys(ded).length ? { defaultDeductions: ded } : {}),
            });
          }, onClose)
        }
        disabled={!v?.systemKey && !name.trim()}
      >
        {t("common.save")}
      </Button>
    </BottomSheet>
  );
}

function Categories({ godownId }: { godownId: string }) {
  const { t } = useI18n();
  const save = useSaver();
  const list = useLiveQuery(
    () => db().expenseCategories.where("godownId").equals(godownId).toArray(),
    [godownId],
  );
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  if (!list) return <Loading />;
  const toggle = (c: ExpenseCategory) =>
    void save(
      () =>
        upsertMaster(godownId, "expenseCategory", {
          _id: c._id,
          code: c.code,
          isSystem: c.isSystem,
          enabled: !c.enabled,
          ...(c.name ? { name: c.name } : {}),
        }),
      () => {},
    );
  return (
    <div className="flex flex-col gap-2 pt-2">
      <Button className="h-11 self-start" onClick={() => setAdding(true)}>
        <Plus className="size-4" aria-hidden />
        {t("common.addNew")}
      </Button>
      <ul>
        {list.map((c) => (
          <ListRow
            key={c._id}
            id={c._id}
            serverSeq={c.serverSeq}
            title={categoryLabel(c, t)}
            right={
              (SYSTEM_EXPENSE_CODES as readonly string[]).includes(c.code) ? (
                <span className="text-muted-foreground text-xs">{t("masters.systemCategory")}</span>
              ) : (
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={c.enabled}
                    onChange={() => toggle(c)}
                  />
                  {t("masters.enabled")}
                </label>
              )
            }
          />
        ))}
      </ul>
      <BottomSheet open={adding} onOpenChange={setAdding} title={t("masters.newCategory")}>
        <TextField
          label={t("masters.categoryName")}
          value={name}
          onChange={setName}
          maxLength={60}
        />
        <Button
          className="h-12"
          disabled={!name.trim()}
          onClick={() =>
            void save(
              () =>
                upsertMaster(godownId, "expenseCategory", {
                  code: "",
                  isSystem: false,
                  enabled: true,
                  name: name.trim(),
                }),
              () => {
                setAdding(false);
                setName("");
              },
            )
          }
        >
          {t("common.save")}
        </Button>
      </BottomSheet>
    </div>
  );
}

function Banks({ godownId }: { godownId: string }) {
  const { t } = useI18n();
  const list = useLiveQuery(
    () => db().bankAccounts.where("godownId").equals(godownId).toArray(),
    [godownId],
  );
  const [edit, setEdit] = useState<BankAccount | "new" | null>(null);
  if (!list) return <Loading />;
  return (
    <div className="flex flex-col gap-2 pt-2">
      <Button className="h-11 self-start" onClick={() => setEdit("new")}>
        <Plus className="size-4" aria-hidden />
        {t("common.addNew")}
      </Button>
      {list.length === 0 ? <EmptyState text={t("masters.noBanks")} /> : null}
      <ul>
        {list.map((b) => (
          <ListRow
            key={b._id}
            id={b._id}
            serverSeq={b.serverSeq}
            title={bankLabel(b)}
            sub={`${b.bank}${b.isUpiLinked ? ` · ${t("payMode.UPI")}` : ""}`}
            right={<Money paise={BigInt(b.openingBalancePaise)} className="text-sm" />}
            onEdit={() => setEdit(b)}
          />
        ))}
      </ul>
      {edit ? (
        <BankEditor
          godownId={godownId}
          b={edit === "new" ? null : edit}
          onClose={() => setEdit(null)}
        />
      ) : null}
    </div>
  );
}

function BankEditor({
  godownId,
  b,
  onClose,
}: {
  godownId: string;
  b: BankAccount | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const save = useSaver();
  const [name, setName] = useState(b?.name ?? "");
  const [bank, setBank] = useState(b?.bank ?? "");
  const [last4, setLast4] = useState(b?.last4 ?? "");
  const [ifsc, setIfsc] = useState(b?.ifsc ?? "");
  const [upi, setUpi] = useState(b?.isUpiLinked ?? false);
  const [opening, setOpening] = useState(paiseToInput(b?.openingBalancePaise));
  const l4 = normalizeDigits(last4).trim();
  const l4Err = l4 && !/^\d{4}$/.test(l4) ? ("errors.validation.last4" as const) : null;
  return (
    <BottomSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={b ? bankLabel(b) : t("masters.newBank")}
    >
      <TextField
        label={t("masters.bankName")}
        value={name}
        onChange={setName}
        required
        maxLength={80}
      />
      <TextField
        label={t("masters.bankBank")}
        value={bank}
        onChange={setBank}
        required
        maxLength={80}
      />
      <TextField
        label={t("masters.bankLast4")}
        value={last4}
        onChange={setLast4}
        inputMode="numeric"
        maxLength={4}
        required
        error={l4Err}
      />
      <TextField label={t("party.ifsc")} value={ifsc} onChange={setIfsc} maxLength={11} />
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-5"
          checked={upi}
          onChange={(e) => setUpi(e.target.checked)}
        />
        {t("masters.upiLinked")}
      </label>
      <AmountInput
        label={t("masters.openingBalance")}
        value={opening}
        onChange={setOpening}
        hint={t("masters.openingHint")}
      />
      <Button
        className="h-12"
        disabled={!name.trim() || !bank.trim() || !l4 || !!l4Err}
        onClick={() =>
          void save(
            () =>
              upsertMaster(godownId, "bankAccount", {
                ...(b ? { _id: b._id } : {}),
                name: name.trim(),
                bank: bank.trim(),
                last4: l4,
                ...(ifsc.trim() ? { ifsc: ifsc.trim().toUpperCase() } : {}),
                isUpiLinked: upi,
                openingBalancePaise: (parseAmountField(opening).value ?? 0n).toString(),
              }),
            onClose,
          )
        }
      >
        {t("common.save")}
      </Button>
    </BottomSheet>
  );
}

function Vehicles({ godownId }: { godownId: string }) {
  const { t } = useI18n();
  const list = useLiveQuery(
    () => db().vehicles.where("godownId").equals(godownId).toArray(),
    [godownId],
  );
  const [edit, setEdit] = useState<Vehicle | "new" | null>(null);
  const [q, setQ] = useState("");
  if (!list) return <Loading />;
  const plate = normalizeVehicleNumber(normalizeDigits(q));
  const shown = plate ? list.filter((v) => v.number.includes(plate)) : list;
  return (
    <div className="flex flex-col gap-2 pt-2">
      <Button className="h-11 self-start" onClick={() => setEdit("new")}>
        <Plus className="size-4" aria-hidden />
        {t("common.addNew")}
      </Button>
      {list.length === 0 ? <EmptyState text={t("masters.noVehicles")} /> : null}
      {list.length > 0 ? (
        <TextField label={t("common.search")} value={q} onChange={setQ} testId="vehicle-search" />
      ) : null}
      <ul>
        {shown.map((v) => (
          <ListRow
            key={v._id}
            id={v._id}
            serverSeq={v.serverSeq}
            title={vehicleLabel(v)}
            sub={t(v.ownership === "own" ? "masters.vehicleOwn" : "masters.vehicleExternal")}
            onEdit={() => setEdit(v)}
          />
        ))}
      </ul>
      {edit ? (
        <VehicleEditor
          godownId={godownId}
          v={edit === "new" ? null : edit}
          onClose={() => setEdit(null)}
        />
      ) : null}
    </div>
  );
}

function VehicleEditor({
  godownId,
  v,
  onClose,
}: {
  godownId: string;
  v: Vehicle | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const save = useSaver();
  const [number, setNumber] = useState(v ? vehicleLabel(v) : "");
  const [ownership, setOwnership] = useState<"own" | "external">(v?.ownership ?? "external");
  const [type, setType] = useState<"truck" | "tractor" | "pickup" | "other">(v?.type ?? "truck");
  const [owner, setOwner] = useState<string | undefined>(v?.ownerPartyId);
  const [driver, setDriver] = useState<string | undefined>(v?.driverPartyId);
  const [capacity, setCapacity] = useState(gramsToKgInput(v?.capacityG));
  const cap = parseWeightField(capacity);
  const n = normalizeVehicleNumber(normalizeDigits(number));
  return (
    <BottomSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={v ? vehicleLabel(v) : t("masters.newVehicle")}
    >
      <TextField
        label={t("sale.vehicleNumber")}
        value={number}
        onChange={setNumber}
        required
        maxLength={20}
      />
      <Choice
        label={t("masters.ownership")}
        value={ownership}
        onChange={setOwnership}
        options={[
          { value: "own", label: t("masters.vehicleOwn") },
          { value: "external", label: t("masters.vehicleExternal") },
        ]}
      />
      <Choice
        label={t("masters.vehicleType")}
        value={type}
        onChange={setType}
        wrap
        options={(["truck", "tractor", "pickup", "other"] as const).map((x) => ({
          value: x,
          label: t(`masters.vehicleTypes.${x}`),
        }))}
      />
      {ownership === "external" ? (
        <PartyPicker
          godownId={godownId}
          label={t("masters.vehicleOwner")}
          value={owner}
          onChange={setOwner}
          role="transporter"
          newRoles={["transporter"]}
          allowClear
        />
      ) : null}
      <PartyPicker
        godownId={godownId}
        label={t("partyRole.driver")}
        value={driver}
        onChange={setDriver}
        role="driver"
        newRoles={["driver"]}
        allowClear
      />
      <WeightInput label={t("masters.vehicleCapacity")} value={capacity} onChange={setCapacity} />
      <Button
        className="h-12"
        disabled={n.length < 2 || !!cap.error}
        onClick={() =>
          void save(
            () =>
              upsertMaster(godownId, "vehicle", {
                ...(v ? { _id: v._id } : {}),
                number: n,
                ownership,
                type,
                ...(ownership === "external" && owner ? { ownerPartyId: owner } : {}),
                ...(driver ? { driverPartyId: driver } : {}),
                ...(cap.value ? { capacityG: cap.value.toString() } : {}),
              }),
            onClose,
          )
        }
      >
        {t("common.save")}
      </Button>
    </BottomSheet>
  );
}

function Places({ godownId }: { godownId: string }) {
  const { t } = useI18n();
  const save = useSaver();
  const list = useLiveQuery(
    () => db().places.where("godownId").equals(godownId).toArray(),
    [godownId],
  );
  const [edit, setEdit] = useState<Place | "new" | null>(null);
  const [name, setName] = useState("");
  if (!list) return <Loading />;
  return (
    <div className="flex flex-col gap-2 pt-2">
      <Button
        className="h-11 self-start"
        onClick={() => {
          setName("");
          setEdit("new");
        }}
      >
        <Plus className="size-4" aria-hidden />
        {t("common.addNew")}
      </Button>
      {list.length === 0 ? <EmptyState text={t("masters.noPlaces")} /> : null}
      <ul>
        {list.map((p) => (
          <ListRow
            key={p._id}
            id={p._id}
            serverSeq={p.serverSeq}
            title={p.name}
            onEdit={() => {
              setName(p.name);
              setEdit(p);
            }}
          />
        ))}
      </ul>
      <BottomSheet
        open={edit !== null}
        onOpenChange={(o) => !o && setEdit(null)}
        title={t("load.loadPlace")}
      >
        <TextField
          label={t("load.loadPlace")}
          value={name}
          onChange={setName}
          required
          maxLength={80}
        />
        <Button
          className="h-12"
          disabled={!name.trim()}
          onClick={() =>
            void save(
              () =>
                upsertMaster(godownId, "place", {
                  ...(edit && edit !== "new" ? { _id: edit._id } : {}),
                  name: name.trim(),
                }),
              () => setEdit(null),
            )
          }
        >
          {t("common.save")}
        </Button>
      </BottomSheet>
    </div>
  );
}
