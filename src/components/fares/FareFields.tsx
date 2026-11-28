"use client";

/**
 * Vehicle fare inside the purchase form (DECISIONS D56), optional and closed by default:
 * vehicle owner (saved list, one tap), vehicle type, fare, paid now / unpaid, note. Shows
 *   total paddy value − vehicle fare = farmer's payable.
 * Paid now = the whole fare paid on the given date / mode (a VEHICLE_FARE payment saved with the
 * purchase). Part-payments are made later from the owner's ledger.
 */
import { Truck } from "lucide-react";
import { AmountInput } from "@/components/money/inputs";
import { Input } from "@/components/ui/input";
import { paiseToInput, parseAmountField } from "@/client/ui/parse";
import type { PaymentPart } from "@/client/repo";
import { FARE_VEHICLE_KINDS, type FareVehicleKind, type VehicleFare } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { FieldBox, Segmented } from "@/components/entry/Fields";
import { emptyPay, PaymentFields, toPart, type PayState } from "@/components/entry/Payments";
import { VehicleOwnerPicker } from "./OwnerPicker";

export interface FareState {
  on: boolean;
  ownerId?: string;
  kind: FareVehicleKind;
  amount: string;
  paid: "PAID" | "UNPAID";
  pay: PayState;
  note: string;
}

export function fareStateOf(date: string, f?: VehicleFare): FareState {
  return {
    on: !!f,
    ...(f ? { ownerId: f.ownerPartyId } : {}),
    kind: f?.vehicleKind ?? "TOTO",
    amount: f ? paiseToInput(f.amountPaise) : "",
    paid: "UNPAID",
    pay: emptyPay(date),
    note: f?.note ?? "",
  };
}

export interface ParsedFare {
  fare?: VehicleFare;
  /** The "paid now" payment (create only). */
  part: PaymentPart | null;
  amountPaise: bigint;
  error?: TKey;
}

/** Validate the fare part of the form. `totalPaise`: the purchase total (fare can't exceed it). */
export function parseFare(
  s: FareState,
  purchaseDate: string,
  totalPaise: bigint | undefined,
  withPayment: boolean,
): ParsedFare {
  if (!s.on) return { part: null, amountPaise: 0n };
  const a = parseAmountField(s.amount, true, 1n);
  if (!s.ownerId) return { part: null, amountPaise: a.value ?? 0n, error: "acct.required" };
  if (a.error || a.value === undefined)
    return { part: null, amountPaise: 0n, error: a.error ?? "errors.validation.required" };
  if (totalPaise !== undefined && a.value > totalPaise)
    return { part: null, amountPaise: a.value, error: "errors.domain.FARE_EXCEEDS_PURCHASE" };
  const fare: VehicleFare = {
    ownerPartyId: s.ownerId,
    vehicleKind: s.kind,
    amountPaise: a.value.toString(),
    ...(s.note.trim() ? { note: s.note.trim() } : {}),
  };
  if (!withPayment || s.paid === "UNPAID") return { fare, part: null, amountPaise: a.value };
  // Paid now = the whole fare.
  const p = toPart({ ...s.pay, amount: paiseToInput(a.value) }, false, purchaseDate);
  if (p.error) return { fare, part: null, amountPaise: a.value, error: p.error };
  return { fare, part: p.part, amountPaise: a.value };
}

export function FareFields({
  godownId,
  value,
  onChange,
  purchaseDate,
  totalPaise,
  showErrors,
  withPayment,
  ownerLocked,
}: {
  godownId: string;
  value: FareState;
  onChange: (s: FareState) => void;
  purchaseDate: string;
  totalPaise: bigint | undefined;
  showErrors: boolean;
  /** New purchase: offer "paid now". */
  withPayment: boolean;
  /** The fare already has payments: its owner can't change. */
  ownerLocked?: boolean;
}) {
  const { t, money } = useI18n();
  const parsed = parseFare(value, purchaseDate, totalPaise, withPayment);
  const set = (patch: Partial<FareState>) => onChange({ ...value, ...patch });
  const net = totalPaise !== undefined ? totalPaise - parsed.amountPaise : undefined;
  return (
    <section
      className="bg-card shadow-card flex flex-col gap-3 rounded-2xl border p-4"
      data-testid="fare-section"
    >
      <div className="flex items-center gap-2">
        <span className="tile-accent tone-blue flex size-9 shrink-0 items-center justify-center rounded-xl">
          <Truck className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-[15px] font-semibold">{t("fare.title")}</span>
      </div>
      <Segmented
        label={t("fare.title")}
        value={value.on ? "ON" : "OFF"}
        options={[
          ["OFF", t("fare.none")],
          ["ON", t("fare.add")],
        ]}
        onChange={(v) => set({ on: v === "ON" })}
        testId="fare-toggle"
      />
      {value.on ? (
        <>
          {ownerLocked ? (
            <p className="text-muted-foreground text-xs">{t("fare.ownerLocked")}</p>
          ) : null}
          {ownerLocked ? null : (
            <VehicleOwnerPicker
              godownId={godownId}
              value={value.ownerId}
              onChange={(ownerId) => set({ ownerId })}
              testId="fare-owner"
              error={showErrors && !value.ownerId ? t("acct.required") : null}
            />
          )}
          <FieldBox label={t("fare.vehicleKind")}>
            <Segmented
              label={t("fare.vehicleKind")}
              value={value.kind}
              options={FARE_VEHICLE_KINDS.map((k) => [k, t(`fare.kind.${k}` as TKey)])}
              onChange={(kind) => set({ kind })}
              testId="fare-kind"
            />
          </FieldBox>
          <AmountInput
            label={t("fare.amount")}
            value={value.amount}
            onChange={(amount) => set({ amount })}
            required
            testId="fare-amount"
            error={
              showErrors && parsed.error === "errors.domain.FARE_EXCEEDS_PURCHASE"
                ? parsed.error
                : null
            }
          />
          {withPayment ? (
            <>
              <FieldBox label={t("fare.payStatus")}>
                <Segmented
                  label={t("fare.payStatus")}
                  value={value.paid}
                  options={[
                    ["UNPAID", t("fare.unpaid")],
                    ["PAID", t("fare.paidNow")],
                  ]}
                  onChange={(paid) => set({ paid })}
                  testId="fare-paid"
                />
              </FieldBox>
              {value.paid === "PAID" ? (
                <PaymentFields
                  godownId={godownId}
                  value={value.pay}
                  onChange={(pay) => set({ pay })}
                  amountLabel={t("fare.amount")}
                  testId="fare-pay"
                  hideAmount
                  minDate={purchaseDate}
                />
              ) : (
                <p className="text-muted-foreground text-xs">{t("fare.unpaidHint")}</p>
              )}
            </>
          ) : null}
          <FieldBox label={t("fare.note")}>
            <Input
              className="h-12 text-base"
              value={value.note}
              onChange={(e) => set({ note: e.target.value })}
              data-testid="fare-note"
            />
          </FieldBox>
          <dl
            className="bg-muted/50 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 rounded-xl p-3 text-sm"
            data-testid="fare-breakdown"
          >
            <dt className="text-muted-foreground">{t("fare.paddyValue")}</dt>
            <dd className="tabular text-right">
              {totalPaise !== undefined ? money(totalPaise) : "—"}
            </dd>
            <dt className="text-muted-foreground">{t("fare.lessFare")}</dt>
            <dd className="tabular text-right" data-testid="fare-breakdown-fare">
              {money(parsed.amountPaise)}
            </dd>
            <dt className="font-medium">{t("fare.farmerNet")}</dt>
            <dd
              className="tabular text-right font-semibold"
              data-testid="fare-farmer-net"
              data-paise={net?.toString() ?? ""}
            >
              {net !== undefined ? money(net) : "—"}
            </dd>
          </dl>
        </>
      ) : null}
    </section>
  );
}
