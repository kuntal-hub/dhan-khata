/**
 * Daily load khata (spec §9.5). OWN_TRADE: one LOAD creates (same group) a PURCHASE from the
 * seller into TRANSIT (unless loaded from this godown's stock) and exactly ONE SALE to the mill.
 * AGENT: only the commission posts (from the LOAD voucher itself).
 */
import { DomainError } from "../errors";
import { amountForWeight } from "../money";
import type { LoadVoucher, TradeLine } from "../schemas/vouchers";
import type { PurchaseDraft, SaleDraft } from "./drafts";
import { perQuintalOrFixed } from "./trade";

const big = (s: string | undefined): bigint | undefined =>
  s === undefined ? undefined : BigInt(s);

export function recomputeLoad(v: LoadVoucher): LoadVoucher {
  const net = BigInt(v.netG);
  const gross = BigInt(v.grossG);
  if (net <= 0n) throw new DomainError("NET_NOT_POSITIVE");
  if (net > gross) throw new DomainError("NET_EXCEEDS_GROSS");
  const millRate = big(v.millRatePaisePerQtl) ?? 0n;
  // Commission: per-quintal rate if given (> 0), otherwise the typed fixed amount.
  const commission = v.commission && {
    ...v.commission,
    amountPaise: perQuintalOrFixed(
      net,
      big(v.commission.ratePaisePerQtl),
      BigInt(v.commission.amountPaise),
    ).toString(),
  };
  return { ...v, totalAmountPaise: amountForWeight(net, millRate).toString(), commission };
}

/** Margin per load = (mill rate − party sell rate) × net. */
export function loadMargin(v: LoadVoucher): bigint {
  const net = BigInt(v.netG);
  const mill = big(v.millRatePaisePerQtl) ?? 0n;
  const sell = big(v.partySellRatePaisePerQtl) ?? 0n;
  return amountForWeight(net, mill) - amountForWeight(net, sell);
}

function loadLine(v: LoadVoucher, rate: bigint): TradeLine {
  const gross = BigInt(v.grossG);
  const net = BigInt(v.netG);
  return {
    varietyId: v.varietyId,
    bags: v.bags,
    grossG: v.grossG,
    otherDedG: (gross - net).toString(),
    netG: v.netG,
    ratePaisePerQtl: rate.toString(),
    amountPaise: amountForWeight(net, rate).toString(),
  };
}

export interface LoadLinkedDrafts {
  purchase: PurchaseDraft | null;
  sale: SaleDraft | null;
}

/**
 * Build the linked vouchers for an OWN_TRADE load. `roundToRupee` comes from godown settings.
 * Both drafts carry `loadId = load._id` and the load's groupId.
 */
export function loadLinkedDrafts(v: LoadVoucher, roundToRupee: boolean): LoadLinkedDrafts {
  if (v.mode === "AGENT") {
    if (!v.commission) throw new DomainError("COMMISSION_REQUIRED");
    return { purchase: null, sale: null };
  }
  const millRate = big(v.millRatePaisePerQtl);
  if (!millRate || millRate <= 0n) throw new DomainError("RATE_REQUIRED", "millRate");
  const base = { date: v.date, season: v.season, groupId: v.groupId, loadId: v._id };

  let purchase: PurchaseDraft | null = null;
  if (!v.fromStore) {
    if (!v.fromPartyId) throw new DomainError("PARTY_REQUIRED", "fromPartyId");
    const sellRate = big(v.partySellRatePaisePerQtl);
    if (!sellRate || sellRate <= 0n) throw new DomainError("RATE_REQUIRED", "partySellRate");
    const line = loadLine(v, sellRate);
    purchase = {
      ...base,
      type: "PURCHASE",
      partyId: v.fromPartyId,
      storeAt: "TRANSIT",
      lines: [line],
      charges: [],
      roundToRupee,
      roundOffPaise: "0",
      totalPaise: line.amountPaise,
    };
  }
  const saleLine = loadLine(v, millRate);
  const sale: SaleDraft = {
    ...base,
    type: "SALE",
    partyId: v.secondPartyId ?? v.toMillPartyId,
    millPartyId: v.secondPartyId ? v.toMillPartyId : undefined,
    vehicleNumber: v.vehicleNumber,
    source: v.fromStore ? "STORE" : "TRANSIT",
    lines: [saleLine],
    charges: [],
    roundToRupee,
    roundOffPaise: "0",
    totalPaise: saleLine.amountPaise,
    duePaise: saleLine.amountPaise,
    settlementStatus: "PENDING",
  };
  return { purchase, sale };
}
