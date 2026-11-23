import type { SaleVoucher } from "../schemas/vouchers";
import type { ExpenseDraft, PaymentDraft, ReceiptDraft } from "./drafts";
import {
  chargesFromJson,
  computeBill,
  perQuintalOrFixed,
  recomputeTradeLine,
  totalNetG,
} from "./trade";

const big = (s: string | undefined): bigint | undefined =>
  s === undefined ? undefined : BigInt(s);

/** Recompute lines, bill total, loading & freight amounts, and the display-only due. */
export function recomputeSale(v: SaleVoucher): SaleVoucher {
  const lines = v.lines.map(recomputeTradeLine);
  const bill = computeBill(
    lines.map((l) => BigInt(l.amountPaise)),
    chargesFromJson(v.charges),
    v.roundToRupee,
  );
  const net = totalNetG(lines);
  const loading = v.loading && {
    ...v.loading,
    amountPaise: perQuintalOrFixed(
      net,
      big(v.loading.ratePaisePerQtl),
      big(v.loading.fixedPaise),
    ).toString(),
  };
  const delivery = v.delivery && {
    ...v.delivery,
    amountPaise: perQuintalOrFixed(
      net,
      big(v.delivery.ratePaisePerQtl),
      big(v.delivery.fixedPaise),
    ).toString(),
  };
  const advance = big(v.advanceReceived?.amountPaise) ?? 0n;
  const millDeductedFreight = delivery?.payer === "MILL" ? BigInt(delivery.amountPaise) : 0n;
  const due = bill.total - advance - millDeductedFreight;
  return {
    ...v,
    lines,
    loading,
    delivery,
    roundOffPaise: bill.roundOff.toString(),
    totalPaise: bill.total.toString(),
    duePaise: due.toString(),
  };
}

export interface SaleSummary {
  goodsValue: bigint;
  freight: bigint;
  loading: bigint;
  vehicleAdvance: bigint;
  advanceReceived: bigint;
  /** What the buyer still owes on this bill. */
  netReceivable: bigint;
  /** Amount still owed to the transporter for this trip (freight − vehicle advance), when we bear freight. */
  dueToVehicle: bigint;
}

export function saleSummary(v: SaleVoucher): SaleSummary {
  const goodsValue = BigInt(v.totalPaise);
  const freight = BigInt(v.delivery?.amountPaise ?? "0");
  const loading = BigInt(v.loading?.amountPaise ?? "0");
  const vehicleAdvance = BigInt(v.vehicleAdvance?.amountPaise ?? "0");
  const advanceReceived = BigInt(v.advanceReceived?.amountPaise ?? "0");
  const millDeducted = v.delivery?.payer === "MILL" ? freight : 0n;
  // payer US: we owe the transporter the freight. MILL: the mill paid the driver directly.
  const freightOwedByUs = v.delivery?.payer === "US" ? freight : 0n;
  return {
    goodsValue,
    freight,
    loading,
    vehicleAdvance,
    advanceReceived,
    netReceivable: goodsValue - advanceReceived - millDeducted,
    dueToVehicle: freightOwedByUs - vehicleAdvance,
  };
}

/** Estimated profit on a sale = goods value − cost of goods − loading − freight we bear. */
export function estimatedSaleProfit(v: SaleVoucher, costOfGoods: bigint): bigint {
  const s = saleSummary(v);
  const freightBorne = v.delivery && v.delivery.payer !== "BUYER" ? s.freight : 0n;
  return s.goodsValue - costOfGoods - s.loading - freightBorne;
}

export interface SaleLinkedDrafts {
  advanceReceipt: ReceiptDraft | null;
  vehicleAdvancePayment: PaymentDraft | null;
  loadingExpense: ExpenseDraft | null;
}

/** Linked vouchers created together with a sale (same groupId). */
export function saleLinkedDrafts(v: SaleVoucher): SaleLinkedDrafts {
  const base = { date: v.date, season: v.season, groupId: v.groupId };
  const advanceReceipt: ReceiptDraft | null = v.advanceReceived
    ? {
        ...base,
        type: "RECEIPT",
        partyId: v.partyId,
        amountPaise: v.advanceReceived.amountPaise,
        mode: v.advanceReceived.mode,
        ourBankAccountId: v.advanceReceived.bankAccountId,
        utrOrRef: v.advanceReceived.ref,
        cashVia: v.advanceReceived.via ? { personName: v.advanceReceived.via } : undefined,
        purpose: "BILL",
        allocations: [{ voucherId: v._id, amountPaise: v.advanceReceived.amountPaise }],
      }
    : null;
  const transporter = v.delivery?.transporterPartyId;
  const vehicleAdvancePayment: PaymentDraft | null =
    v.vehicleAdvance && transporter
      ? {
          ...base,
          type: "PAYMENT",
          partyId: transporter,
          amountPaise: v.vehicleAdvance.amountPaise,
          mode: v.vehicleAdvance.mode,
          ourBankAccountId: v.vehicleAdvance.bankAccountId,
          utrOrRef: v.vehicleAdvance.ref,
          cashVia: v.vehicleNumber ? { vehicleNumber: v.vehicleNumber } : undefined,
          purpose: "ADVANCE",
        }
      : null;
  const loadingAmount = BigInt(v.loading?.amountPaise ?? "0");
  const loadingExpense: ExpenseDraft | null =
    v.loading && loadingAmount > 0n
      ? {
          ...base,
          type: "EXPENSE",
          categoryCode: "LABOUR",
          amountPaise: loadingAmount.toString(),
          mode: "CASH",
          payeePartyId: v.loading.payTo === "LABOUR_PARTY" ? v.loading.labourPartyId : undefined,
          onCredit: v.loading.payTo === "LABOUR_PARTY" ? true : undefined,
          description: v.number,
          loadId: v.loadId,
          vehicleId: v.vehicleId,
        }
      : null;
  return { advanceReceipt, vehicleAdvancePayment, loadingExpense };
}
