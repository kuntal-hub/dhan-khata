/**
 * v1 (requirement.md v1.1) → v2 (requirement_v2) data conversion. PURE: shared by
 * `scripts/migrate-v2.ts` (server) and the Dexie v4 upgrade (device).
 *
 * Every v1 voucher keeps its `_id`, `rev`, `number` and dates; records that v2 models separately
 * get deterministic ids derived from it (`<id>~pay`, `<id>~frt`, …) and the same `rev`, so the
 * device and the server produce the same documents.
 *
 * Mapping (see docs/MIGRATION_V2.md for the full table):
 *  - paid-now PAYMENT / advance RECEIPT linked to a bill → Payment(source = bill, isInitial)
 *  - PAYMENT / RECEIPT → Payment (allocations → sources; BILL without allocations → FIFO over the
 *    party's open bills at conversion time; ADVANCE / OTHER → PARTY_ADVANCE)
 *  - EXPENSE paid now → Expense + Payment(EXPENSE, paymentDate = old date); on credit → Expense
 *  - SALE freight paid by us → Expense(TRANSPORT, owed to the transporter); by the mill → Expense
 *    owed to (deducted by) the buyer; by the buyer → nothing (as in v1)
 *  - MILL_SETTLEMENT difference → SecondParty entry with the buyer (party balance unchanged)
 *  - LOAD → Load register (OWN_TRADE linked to its sale); AGENT commission → SecondParty entry
 *  - TRIP → Trip (costs + their payments; advance → Payment(VEHICLE_TRIP))
 *  - cheque receipts: cleared → Payment(BANK) on the clearing date; bounced → void Payment;
 *    still in hand → Payment(BANK) on the receipt date (v2 has no cheque-in-hand stage)
 */
import { todayIST } from "../dates";
import { DomainError } from "../errors";
import { amountForWeight } from "../money";
import { divRoundHalfUp } from "../rounding";
import { allocateFifo, billsOf, billState, type Bill } from "../v2/payments";
import { recomputeDoc } from "../v2/recompute";
import { DocSchema, type Doc, type DocOf, type PayMode, type WeightBlock } from "../v2/schemas";
import { ordOfDoc } from "../v2/replay";
import type { Voucher as V1, VoucherOf as V1Of } from "./v1Vouchers";

export interface MigrateOptions {
  businessId: string;
  /** Bank account to use for a v1 bank payment that had none (per Gola), if any. */
  defaultBankOf?: (godownId: string) => string | undefined;
  /** Party name (for trip driver names). */
  partyName?: (partyId: string) => string | undefined;
}

export type NoteKind =
  | "CHEQUE_CLEARED"
  | "CHEQUE_BOUNCED"
  | "CHEQUE_IN_HAND_TO_BANK"
  | "SETTLEMENT_TO_SECOND_PARTY"
  | "COMMISSION_TO_SECOND_PARTY"
  | "FREIGHT_TO_EXPENSE"
  | "FIFO_ALLOCATED"
  | "ADVANCE_REMAINDER"
  | "TRIP_COST_KIND"
  | "PAYMENT_DUE_DATE_DROPPED"
  | "MULTI_LINE_SPLIT"
  | "SALE_MILL_DROPPED";

export interface MigrationNote {
  kind: NoteKind;
  v1Id: string;
  godownId: string;
  detail?: string;
  amountPaise?: string;
  bankAccountId?: string;
}

export interface MigrateResult {
  docs: Doc[];
  /** v1 voucher id → ids of the v2 documents made from it. */
  produced: Map<string, string[]>;
  notes: MigrationNote[];
  /** Counts per v1 type. */
  counts: Record<string, number>;
}

const n = (s: string | undefined) => BigInt(s ?? "0");

function v1Ord(v: V1): string {
  return `${v.date}|${v.createdAt}|${v._id}`;
}

function mapMode(
  mode: string,
  bankAccountId: string | undefined,
  godownId: string,
  opts: MigrateOptions,
): { mode: PayMode; bankAccountId?: string } {
  if (mode === "CASH") return { mode: "CASH" };
  if (mode === "OTHER" && !bankAccountId) return { mode: "CASH" };
  const bank = bankAccountId ?? opts.defaultBankOf?.(godownId);
  if (!bank) return { mode: "CASH" };
  return { mode: mode === "UPI" ? "UPI" : "BANK", bankAccountId: bank };
}

export function migrateV1Vouchers(all: readonly V1[], opts: MigrateOptions): MigrateResult {
  const out: Doc[] = [];
  const produced = new Map<string, string[]>();
  const notes: MigrationNote[] = [];
  const counts: Record<string, number> = {};
  const groups = new Map<string, V1[]>();
  for (const v of all) {
    if (v.groupId) groups.set(v.groupId, [...(groups.get(v.groupId) ?? []), v]);
  }
  /** CHEQUE_CLEAR / CHEQUE_BOUNCE contra per receipt id. */
  const chequeFate = new Map<string, V1Of<"CONTRA">>();
  for (const v of all) {
    if (v.type === "CONTRA" && v.status === "active" && v.receiptVoucherId) {
      if (v.kind === "CHEQUE_CLEAR" || v.kind === "CHEQUE_BOUNCE")
        chequeFate.set(v.receiptVoucherId, v);
    }
  }

  const base = (v: V1, id: string, extra: { number?: string; groupId?: string } = {}) => {
    const out: Record<string, unknown> = {
      _id: id,
      businessId: opts.businessId,
      godownId: v.godownId,
      rev: v.rev,
      status: v.status,
      ...(v.voidReason ? { voidReason: v.voidReason } : {}),
      entryDate: todayIST(new Date(v.createdAt)),
      createdAt: v.createdAt,
      createdBy: v.createdBy,
      updatedAt: v.updatedAt,
      updatedBy: v.updatedBy,
      deviceId: v.deviceId,
      number: extra.number ?? v.number,
      fy: v.fy,
      ...(v.season ? { season: v.season } : {}),
      ...(v.notes ? { notes: v.notes } : {}),
      ...((extra.groupId ?? v.groupId) ? { groupId: extra.groupId ?? v.groupId } : {}),
      ...(v.editReason ? { editReason: v.editReason } : {}),
    };
    return out;
  };

  const emit = (v1Id: string, raw: Record<string, unknown>) => {
    const parsed = DocSchema.safeParse(recomputeDoc(DocSchema.parse(raw)));
    if (!parsed.success) {
      throw new DomainError(
        "VALIDATION_FAILED",
        `${v1Id}: ${parsed.error.issues[0]?.path.join(".")}`,
      );
    }
    out.push(parsed.data);
    produced.set(v1Id, [...(produced.get(v1Id) ?? []), parsed.data._id]);
    return parsed.data;
  };

  const tradeWeight = (l: {
    bags?: number;
    grossG: string;
    tarePerBagG?: string;
    dhaltaMode?: string;
    dhaltaValueG?: string;
    moistureBps?: number;
    otherDedG?: string;
    netG: string;
  }): WeightBlock => {
    const bags = BigInt(l.bags ?? 0);
    const gross = BigInt(l.grossG);
    const tareG = bags * n(l.tarePerBagG);
    const dv = n(l.dhaltaValueG);
    const dhaltaG =
      l.dhaltaMode === "PER_QUINTAL"
        ? divRoundHalfUp(gross * dv, 100_000n)
        : l.dhaltaMode === "PER_BAG"
          ? bags * dv
          : l.dhaltaMode === "FIXED"
            ? dv
            : 0n;
    const ded: Record<string, unknown> = {};
    if (tareG > 0n) ded.tareG = tareG.toString();
    if (dhaltaG > 0n) ded.dhaltaG = dhaltaG.toString();
    if (l.moistureBps) ded.moistureBps = l.moistureBps;
    if (n(l.otherDedG) > 0n) ded.otherG = l.otherDedG;
    return {
      mode: "MANUAL",
      totalG: l.grossG,
      ...(l.bags ? { bagCount: l.bags } : {}),
      ...(Object.keys(ded).length ? { deductions: ded as WeightBlock["deductions"] } : {}),
      netG: l.netG,
    };
  };

  const deferredMoney: V1[] = [];
  const sorted = [...all].sort((a, b) => (v1Ord(a) < v1Ord(b) ? -1 : 1));

  for (const v of sorted) {
    counts[v.type] = (counts[v.type] ?? 0) + 1;
    switch (v.type) {
      case "PURCHASE": {
        if (v.lines.length !== 1) {
          notes.push({ kind: "MULTI_LINE_SPLIT", v1Id: v._id, godownId: v.godownId });
          throw new DomainError("VALIDATION_FAILED", `${v._id}: multi-line purchase`);
        }
        const l = v.lines[0]!;
        emit(v._id, {
          ...base(v, v._id),
          type: "PURCHASE",
          transactionDate: v.date,
          partyId: v.partyId,
          varietyId: l.varietyId,
          storeAt: v.storeAt === "STORE" ? "WAREHOUSE" : "TRANSIT",
          weight: tradeWeight(l),
          ratePaisePerQtl: l.ratePaisePerQtl,
          amountPaise: "0",
          ...(v.roundToRupee ? { roundToRupee: true } : {}),
          roundOffPaise: "0",
          totalPaise: "0",
          ...(v.charges.length ? { legacyCharges: v.charges } : {}),
          ...(v.dueDate ? { dueDate: v.dueDate } : {}),
          ...(v.loadId ? { linkedLoadId: v.loadId } : {}),
          ...(v.interGodown ? { interGola: v.interGodown } : {}),
        });
        break;
      }
      case "SALE": {
        if (v.lines.length !== 1 || v.charges.length > 0) {
          throw new DomainError("VALIDATION_FAILED", `${v._id}: multi-line sale or sale charges`);
        }
        const l = v.lines[0]!;
        if (v.millPartyId && v.millPartyId !== v.partyId) {
          notes.push({ kind: "SALE_MILL_DROPPED", v1Id: v._id, godownId: v.godownId });
        }
        const charges: Record<string, string> = {};
        if (v.loading && n(v.loading.amountPaise) > 0n)
          charges.loadingPaise = v.loading.amountPaise;
        if (v.delivery && n(v.delivery.amountPaise) > 0n)
          charges.freightPaise = v.delivery.amountPaise;
        if (v.vehicleAdvance) charges.vehicleAdvancePaise = v.vehicleAdvance.amountPaise;
        emit(v._id, {
          ...base(v, v._id),
          type: "SALE",
          transactionDate: v.date,
          partyId: v.partyId,
          product: "PADDY",
          varietyId: l.varietyId,
          source: v.source === "STORE" ? "WAREHOUSE" : "TRANSIT",
          weight: tradeWeight(l),
          ratePaisePerQtl: l.ratePaisePerQtl,
          amountPaise: "0",
          ...(v.roundToRupee ? { roundToRupee: true } : {}),
          roundOffPaise: "0",
          totalPaise: "0",
          saleStatus: "CONFIRMED",
          deliveryStatus: "DELIVERED",
          deliveryLog: [],
          ...(v.vehicleNumber ? { vehicleNumber: v.vehicleNumber } : {}),
          ...(v.expectedPaymentDate ? { dueDate: v.expectedPaymentDate } : {}),
          ...(Object.keys(charges).length ? { charges } : {}),
          ...(v.loadId ? { linkedLoadId: v.loadId } : {}),
          ...(v.interGodown ? { interGola: v.interGodown } : {}),
        });
        // Freight posted inside the v1 sale.
        const freight = n(v.delivery?.amountPaise);
        if (v.delivery && freight > 0n && v.delivery.payer !== "BUYER") {
          const owedTo = v.delivery.payer === "US" ? v.delivery.transporterPartyId : v.partyId; // MILL: deducted by the buyer
          if (!owedTo) throw new DomainError("TRANSPORTER_REQUIRED", v._id);
          emit(v._id, {
            ...base(v, `${v._id}~frt`, { number: `${v.number}-F` }),
            type: "EXPENSE",
            title: v.delivery.payer === "US" ? "গাড়ি ভাড়া" : "গাড়ি ভাড়া (মিল কেটেছে)",
            categoryCode: "TRANSPORT",
            amountPaise: freight.toString(),
            partyId: owedTo,
            expenseDate: v.date,
            ...(v.vehicleId ? { vehicleId: v.vehicleId } : {}),
          });
          notes.push({
            kind: "FREIGHT_TO_EXPENSE",
            v1Id: v._id,
            godownId: v.godownId,
            detail: v.delivery.payer,
            amountPaise: freight.toString(),
          });
        }
        break;
      }
      case "MILL_SETTLEMENT": {
        const diff = n(v.differencePaise);
        if (diff !== 0n) {
          emit(v._id, {
            ...base(v, v._id),
            type: "SECOND_PARTY",
            partyId: v.partyId,
            transactionDate: v.date,
            kind: diff > 0n ? "THEY_OWE" : "WE_OWE",
            amountPaise: (diff > 0n ? diff : -diff).toString(),
            notes: [v.notes, `মিল নিষ্পত্তি ${v.millNetG} g @ ${v.finalRatePaisePerQtl}`]
              .filter(Boolean)
              .join(" · "),
          });
          notes.push({
            kind: "SETTLEMENT_TO_SECOND_PARTY",
            v1Id: v._id,
            godownId: v.godownId,
            amountPaise: diff.toString(),
          });
        }
        break;
      }
      case "LOAD": {
        const net = BigInt(v.netG);
        const gross = BigInt(v.grossG);
        const rate = n(v.millRatePaisePerQtl ?? v.partySellRatePaisePerQtl);
        emit(v._id, {
          ...base(v, v._id),
          type: "LOAD",
          transactionDate: v.date,
          ...(v.fromPartyId ? { fromPartyId: v.fromPartyId } : {}),
          destinationMillId: v.toMillPartyId,
          varietyId: v.varietyId,
          weight: {
            mode: "MANUAL",
            totalG: v.grossG,
            ...(v.bags ? { bagCount: v.bags } : {}),
            ...(gross > net ? { deductions: { otherG: (gross - net).toString() } } : {}),
            netG: v.netG,
          },
          ratePaisePerQtl: rate.toString(),
          totalPaise: amountForWeight(net, rate).toString(),
          vehicleNumber: v.vehicleNumber,
          ...(v.secondPartyId ? { secondPartyId: v.secondPartyId } : {}),
          ...(v.linkedSaleId ? { link: { type: "SALE", id: v.linkedSaleId } } : {}),
          ...(v.loadPlaceText
            ? { notes: [v.notes, v.loadPlaceText].filter(Boolean).join(" · ") }
            : {}),
        });
        if (v.mode === "AGENT" && v.commission && n(v.commission.amountPaise) > 0n) {
          const payer = v.commission.payer === "MILL" ? v.toMillPartyId : v.fromPartyId;
          if (!payer) throw new DomainError("PARTY_REQUIRED", v._id);
          emit(v._id, {
            ...base(v, `${v._id}~com`, { number: `${v.number}-C` }),
            type: "SECOND_PARTY",
            partyId: payer,
            transactionDate: v.date,
            kind: "THEY_OWE",
            amountPaise: v.commission.amountPaise,
            notes: "দালালি (পুরনো লোড)",
          });
          notes.push({
            kind: "COMMISSION_TO_SECOND_PARTY",
            v1Id: v._id,
            godownId: v.godownId,
            amountPaise: v.commission.amountPaise,
          });
        }
        break;
      }
      case "EXPENSE": {
        const exp = emit(v._id, {
          ...base(v, v._id),
          type: "EXPENSE",
          title: v.description,
          categoryCode: v.categoryCode,
          amountPaise: v.amountPaise,
          ...(v.payeePartyId ? { partyId: v.payeePartyId } : {}),
          ...(v.payeeText ? { personText: v.payeeText } : {}),
          expenseDate: v.date,
          ...(v.vehicleId ? { vehicleId: v.vehicleId } : {}),
        });
        if (!v.onCredit) {
          emit(v._id, {
            ...base(v, `${v._id}~pay`, { number: `${v.number}-P` }),
            type: "PAYMENT",
            direction: "OUT",
            amountPaise: v.amountPaise,
            paymentDate: v.date,
            ...mapMode(v.mode, v.bankAccountId, v.godownId, opts),
            ...(v.payeePartyId ? { partyId: v.payeePartyId } : {}),
            source: { type: "EXPENSE", id: exp._id },
            isInitial: true,
          });
        }
        break;
      }
      case "TRIP": {
        const costs = v.expenses.map((e, i) => {
          const kind = e.kind === "DIESEL" || e.kind === "DRIVER" ? e.kind : "OTHER";
          if (kind !== e.kind) {
            notes.push({
              kind: "TRIP_COST_KIND",
              v1Id: v._id,
              godownId: v.godownId,
              detail: e.kind,
            });
          }
          const note = [kind !== e.kind ? e.kind : "", e.note ?? ""].filter(Boolean).join(" · ");
          return {
            id: `c${i + 1}`,
            kind,
            amountPaise: e.amountPaise,
            ...(e.litresMl ? { litresMl: e.litresMl } : {}),
            ...(e.creditPartyId ? { partyId: e.creditPartyId } : {}),
            ...(note ? { note } : {}),
          };
        });
        const income = v.ownTradeLoadId ? 0n : n(v.freightPaise);
        const perQtl = !v.ownTradeLoadId && v.rateMode === "PER_QUINTAL";
        const trip = emit(v._id, {
          ...base(v, v._id),
          type: "TRIP",
          transactionDate: v.date,
          ...(v.hirerPartyId ? { customerPartyId: v.hirerPartyId } : {}),
          vehicleId: v.vehicleId,
          ...(v.driverPartyId && opts.partyName?.(v.driverPartyId)
            ? { driverName: opts.partyName(v.driverPartyId) }
            : {}),
          loadingLocation: v.loadingPlace,
          destination: v.unloadingPlace,
          ...(v.qtyG ? { qtyG: v.qtyG } : {}),
          rateMode: perQtl ? "PER_QTL" : "FIXED",
          ratePaise: perQtl ? v.ratePaise : income.toString(),
          totalIncomePaise: income.toString(),
          costs,
          ...(v.ownTradeLoadId ? { linkedLoadId: v.ownTradeLoadId } : {}),
        });
        v.expenses.forEach((e, i) => {
          if (e.creditPartyId) return;
          emit(v._id, {
            ...base(v, `${v._id}~c${i + 1}`, { number: `${v.number}-${i + 1}` }),
            type: "PAYMENT",
            direction: "OUT",
            amountPaise: e.amountPaise,
            paymentDate: v.date,
            ...mapMode(e.mode, e.bankAccountId, v.godownId, opts),
            source: { type: "VEHICLE_COST", id: `${trip._id}:c${i + 1}` },
            isInitial: true,
          });
        });
        const adv = n(v.advanceReceivedPaise);
        if (adv > 0n && v.hirerPartyId) {
          emit(v._id, {
            ...base(v, `${v._id}~adv`, { number: `${v.number}-A` }),
            type: "PAYMENT",
            direction: "IN",
            amountPaise: adv.toString(),
            paymentDate: v.date,
            ...mapMode(v.advanceMode ?? "CASH", v.advanceBankAccountId, v.godownId, opts),
            partyId: v.hirerPartyId,
            source:
              income > 0n
                ? { type: "VEHICLE_TRIP", id: trip._id }
                : { type: "PARTY_ADVANCE", id: null },
            isInitial: true,
          });
        }
        break;
      }
      case "CONTRA": {
        if (v.kind === "CHEQUE_CLEAR" || v.kind === "CHEQUE_BOUNCE") break; // absorbed by the receipt
        const kind = {
          CASH_DEPOSIT: "DEPOSIT",
          CASH_WITHDRAWAL: "WITHDRAW",
          BANK_TRANSFER: "TRANSFER",
          CAPITAL_IN: "CAPITAL_IN",
          DRAWINGS: "DRAWINGS",
        }[v.kind];
        emit(v._id, {
          ...base(v, v._id),
          type: "CONTRA",
          transactionDate: v.date,
          kind,
          ...(v.bankAccountId ? { bankAccountId: v.bankAccountId } : {}),
          ...(v.toBankAccountId ? { toBankAccountId: v.toBankAccountId } : {}),
          amountPaise: v.amountPaise,
        });
        break;
      }
      case "STOCK_ADJUST":
        emit(v._id, {
          ...base(v, v._id),
          type: "STOCK_ADJUST",
          transactionDate: v.date,
          lines: v.lines.map((l) => ({
            product: "PADDY",
            varietyId: l.varietyId,
            location: "WAREHOUSE",
            qtyG: l.qtyG,
            reason: l.reason === "COUNT" ? "WEIGHING" : l.reason,
            ...(l.note ? { note: l.note } : {}),
          })),
        });
        break;
      case "DAY_CLOSE":
        emit(v._id, {
          ...base(v, v._id),
          type: "DAY_CLOSE",
          date: v.date,
          expectedClosingPaise: v.expectedCashPaise,
          actualClosingPaise: v.countedCashPaise,
          diffPaise: v.differencePaise,
          ...(v.denominations ? { denominations: v.denominations } : {}),
        });
        break;
      case "OPENING":
        emit(v._id, {
          ...base(v, v._id),
          type: "OPENING",
          transactionDate: v.date,
          items: v.items.map((it) => ({
            kind: it.kind,
            ...(it.refId ? { refId: it.refId } : {}),
            ...(it.kind === "STOCK"
              ? {
                  product: "PADDY",
                  location: "WAREHOUSE",
                  varietyId: it.varietyId,
                  qtyG: it.qtyG ?? "0",
                }
              : {}),
            amountPaise: it.amountPaise,
          })),
        });
        break;
      case "PAYMENT":
      case "RECEIPT":
        deferredMoney.push(v);
        break;
      case "JOURNAL":
        throw new DomainError("VALIDATION_FAILED", `${v._id}: JOURNAL has no v2 equivalent`);
    }
  }

  // ── Money: in canonical order, after every bill exists ──────────────────────────────────────
  const payments = (): DocOf<"PAYMENT">[] =>
    out.filter((d): d is DocOf<"PAYMENT"> => d.type === "PAYMENT");
  const billIndex = new Map<string, { bill: Bill; doc: Doc }>();
  for (const d of out)
    for (const b of billsOf(d)) billIndex.set(`${b.sourceType}|${b.sourceId}`, { bill: b, doc: d });
  const billsFromV1 = (v1Id: string): Bill[] =>
    (produced.get(v1Id) ?? [])
      .map((id) => out.find((d) => d._id === id))
      .filter((d): d is Doc => !!d)
      .flatMap(billsOf);

  for (const v of deferredMoney) {
    if (v.type !== "PAYMENT" && v.type !== "RECEIPT") continue;
    const direction = v.type === "PAYMENT" ? "OUT" : "IN";
    let status: "active" | "void" = v.status;
    let voidReason = v.voidReason;
    let paymentDate = v.date;
    let money = mapMode(v.mode, v.ourBankAccountId, v.godownId, opts);
    if (v.type === "RECEIPT" && (v.mode === "CHEQUE" || v.mode === "DD")) {
      const fate = chequeFate.get(v._id);
      if (fate?.kind === "CHEQUE_CLEAR") {
        paymentDate = fate.date;
        money = { mode: "BANK", bankAccountId: fate.bankAccountId! };
        notes.push({ kind: "CHEQUE_CLEARED", v1Id: v._id, godownId: v.godownId, detail: fate._id });
      } else if (fate?.kind === "CHEQUE_BOUNCE") {
        status = "void";
        voidReason = "CHEQUE_BOUNCED";
        notes.push({
          kind: "CHEQUE_BOUNCED",
          v1Id: v._id,
          godownId: v.godownId,
          detail: fate._id,
          amountPaise: v.amountPaise,
        });
      } else if (v.status === "active") {
        notes.push({
          kind: "CHEQUE_IN_HAND_TO_BANK",
          v1Id: v._id,
          godownId: v.godownId,
          amountPaise: v.amountPaise,
          ...(money.bankAccountId ? { bankAccountId: money.bankAccountId } : {}),
        });
      }
    }
    if (v.dueDate)
      notes.push({ kind: "PAYMENT_DUE_DATE_DROPPED", v1Id: v._id, godownId: v.godownId });

    // Initial payment: settles a bill of a PURCHASE / SALE in its own group (paid now / advance).
    const group = v.groupId ? (groups.get(v.groupId) ?? []) : [];
    const groupBills = new Set(
      group
        .filter((g) => g._id !== v._id && (g.type === "PURCHASE" || g.type === "SALE"))
        .flatMap((g) => billsFromV1(g._id).map((b) => b.sourceId)),
    );

    // Parts: [source, amount].
    const total = BigInt(v.amountPaise);
    const parts: Array<{ type: Bill["sourceType"]; id: string | null; amount: bigint }> = [];
    let left = total;
    const pick = (b: Bill, amount: bigint) => {
      if (amount <= 0n) return;
      parts.push({ type: b.sourceType, id: b.sourceId, amount });
      left -= amount;
    };
    if (v.purpose === "BILL" && status === "active") {
      if (v.allocations?.length) {
        for (const a of v.allocations) {
          const b = billsFromV1(a.voucherId).find(
            (x) => x.partyId === v.partyId && x.direction === direction,
          );
          if (b) pick(b, BigInt(a.amountPaise) < left ? BigInt(a.amountPaise) : left);
        }
      } else {
        const today = v.date;
        const open = [...billIndex.values()]
          .filter(
            ({ bill: b, doc }) =>
              doc.godownId === v.godownId &&
              b.partyId === v.partyId &&
              b.direction === direction &&
              b.date <= v.date &&
              ordOfDoc(doc) <= `${v.date}|${v.createdAt}|${v._id}`,
          )
          .map(({ bill: b }) => billState(b, payments(), today));
        const r = allocateFifo(left, open);
        for (const a of r.allocations) {
          const b = billIndex.get(`${a.sourceType}|${a.sourceId}`)!.bill;
          pick(b, a.amountPaise);
        }
        if (r.allocations.length) {
          notes.push({
            kind: "FIFO_ALLOCATED",
            v1Id: v._id,
            godownId: v.godownId,
            detail: String(r.allocations.length),
          });
        }
      }
    }
    if (left > 0n || parts.length === 0) {
      if (parts.length > 0) {
        notes.push({
          kind: "ADVANCE_REMAINDER",
          v1Id: v._id,
          godownId: v.godownId,
          amountPaise: left.toString(),
        });
      }
      parts.push({ type: "PARTY_ADVANCE", id: null, amount: left });
    }
    const groupId = parts.length > 1 ? (v.groupId ?? v._id) : v.groupId;
    parts.forEach((p, i) => {
      const id = i === 0 ? v._id : `${v._id}~${i + 1}`;
      const b = base(v, id, {
        number: i === 0 ? v.number : `${v.number}-${i + 1}`,
        ...(groupId ? { groupId } : {}),
      });
      emit(v._id, {
        ...b,
        status,
        ...(voidReason ? { voidReason } : {}),
        type: "PAYMENT",
        direction,
        amountPaise: p.amount.toString(),
        paymentDate,
        ...money,
        ...(v.utrOrRef || v.chequeNo
          ? { reference: (v.utrOrRef ?? v.chequeNo)!.slice(0, 60) }
          : {}),
        ...(v.cashVia?.personName ? { personName: v.cashVia.personName } : {}),
        ...(v.cashVia?.vehicleNumber ? { vehicleNumber: v.cashVia.vehicleNumber } : {}),
        partyId: v.partyId,
        source: { type: p.type, id: p.id },
        isInitial: p.id !== null && groupBills.has(p.id),
      });
    });
  }

  return { docs: out, produced, notes, counts };
}

// ── Masters ──────────────────────────────────────────────────────────────────────────────────

const ROLE_MAP: Record<string, string[]> = {
  farmer: ["FARMER"],
  party: ["CUSTOMER", "SECOND_PARTY"],
  mill: ["MILL"],
  transporter: ["OTHER"],
  driver: ["DRIVER"],
  labour: ["LABOUR"],
  pump: ["SUPPLIER"],
  other: ["OTHER"],
  godown: ["GOLA"],
};

export function migrateRoles(roles: readonly string[]): string[] {
  const out = new Set<string>();
  for (const r of roles) for (const m of ROLE_MAP[r] ?? [r]) out.add(m);
  return [...out];
}

/** v1 party → v2 party (roles, businessId, address). */
export function migrateParty(
  p: Record<string, unknown>,
  businessId: string,
): Record<string, unknown> {
  const roles = migrateRoles((p.roles as string[]) ?? []);
  const address =
    (p.address as string | undefined) ??
    ([p.village, p.postOffice, p.block, p.district].filter(Boolean).join(", ") || undefined);
  return { ...p, businessId, roles, ...(address ? { address } : {}) };
}

export function normalizedVarietyKey(name: string, company?: string): string {
  return `${name.trim().toLowerCase().replace(/\s+/g, " ")}|${company ?? ""}`;
}

/** v1 variety → v2 variety (product PADDY, normalizedKey, verified for seeded ones). */
export function migrateVariety(
  v: Record<string, unknown>,
  businessId: string,
): Record<string, unknown> {
  const name = String(v.name ?? "");
  const key = name || String(v.systemKey ?? "");
  return {
    ...v,
    businessId,
    product: v.product ?? "PADDY",
    normalizedKey: v.normalizedKey ?? normalizedVarietyKey(key),
    verified: v.verified ?? Boolean(v.systemKey && !v.renamed),
  };
}

/** Add `businessId` to any other Gola-scoped master. */
export function withBusiness<T extends Record<string, unknown>>(doc: T, businessId: string): T {
  return { ...doc, businessId };
}
