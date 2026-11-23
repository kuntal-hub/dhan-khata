/**
 * Canonical weight-deduction and bill formulas (spec §6.3). Shared by purchase, sale, load.
 *
 *   tareG     = bags × tarePerBagG
 *   dhaltaG   = PER_QUINTAL: round(grossG × dhaltaGPerQtl / 100,000) | PER_BAG: bags × g | FIXED: g
 *   moistureG = round((grossG − tareG) × moistureBps / 10,000)
 *   netG      = grossG − tareG − dhaltaG − moistureG − otherDedG      (must be > 0)
 *   amount    = round(netG × ratePaisePerQtl / 100,000)
 */
import { DomainError } from "../errors";
import { amountForWeight, applyBps, GRAMS_PER_QUINTAL, nearestRupee } from "../money";
import { divRoundHalfUp, sumBig } from "../rounding";
import type { DhaltaMode } from "../schemas/common";
import type { Charge, TradeLine } from "../schemas/vouchers";

export interface LineInput {
  bags?: number;
  grossG: bigint;
  tarePerBagG?: bigint;
  dhaltaMode?: DhaltaMode;
  dhaltaValueG?: bigint;
  moistureBps?: bigint;
  otherDedG?: bigint;
  ratePaisePerQtl: bigint;
}

export interface LineResult {
  tareG: bigint;
  dhaltaG: bigint;
  moistureG: bigint;
  otherDedG: bigint;
  netG: bigint;
  amountPaise: bigint;
}

export function computeDeductions(
  input: Omit<LineInput, "ratePaisePerQtl">,
): Omit<LineResult, "amountPaise"> {
  const bags = BigInt(input.bags ?? 0);
  const gross = input.grossG;
  const tareG = bags * (input.tarePerBagG ?? 0n);
  const dv = input.dhaltaValueG ?? 0n;
  let dhaltaG = 0n;
  switch (input.dhaltaMode) {
    case "PER_QUINTAL":
      dhaltaG = divRoundHalfUp(gross * dv, GRAMS_PER_QUINTAL);
      break;
    case "PER_BAG":
      dhaltaG = bags * dv;
      break;
    case "FIXED":
      dhaltaG = dv;
      break;
    default:
      dhaltaG = 0n;
  }
  const moistureG = applyBps(gross - tareG, input.moistureBps ?? 0n);
  const otherDedG = input.otherDedG ?? 0n;
  const netG = gross - tareG - dhaltaG - moistureG - otherDedG;
  return { tareG, dhaltaG, moistureG, otherDedG, netG };
}

export function computeLine(input: LineInput): LineResult {
  const d = computeDeductions(input);
  if (d.netG <= 0n) throw new DomainError("NET_NOT_POSITIVE");
  return { ...d, amountPaise: amountForWeight(d.netG, input.ratePaisePerQtl) };
}

export function lineInputFromJson(line: TradeLine): LineInput {
  return {
    bags: line.bags,
    grossG: BigInt(line.grossG),
    tarePerBagG: line.tarePerBagG !== undefined ? BigInt(line.tarePerBagG) : undefined,
    dhaltaMode: line.dhaltaMode,
    dhaltaValueG: line.dhaltaValueG !== undefined ? BigInt(line.dhaltaValueG) : undefined,
    moistureBps: line.moistureBps !== undefined ? BigInt(line.moistureBps) : undefined,
    otherDedG: line.otherDedG !== undefined ? BigInt(line.otherDedG) : undefined,
    ratePaisePerQtl: BigInt(line.ratePaisePerQtl),
  };
}

/** Returns the line with `netG` and `amountPaise` recomputed from its inputs. */
export function recomputeTradeLine(line: TradeLine): TradeLine {
  const r = computeLine(lineInputFromJson(line));
  return { ...line, netG: r.netG.toString(), amountPaise: r.amountPaise.toString() };
}

export interface BillResult {
  subTotal: bigint;
  chargesTotal: bigint;
  roundOff: bigint;
  total: bigint;
}

/**
 * subTotal = Σ line amounts; charges = Σ adds − Σ deducts;
 * roundOff = nearestRupee(subTotal + charges) − (subTotal + charges) if roundToRupee; total = sum.
 */
export function computeBill(
  lineAmounts: readonly bigint[],
  charges: readonly { kind: "add" | "deduct"; amount: bigint }[],
  roundToRupee: boolean,
): BillResult {
  const subTotal = sumBig(lineAmounts);
  const chargesTotal = sumBig(charges.map((c) => (c.kind === "add" ? c.amount : -c.amount)));
  const beforeRound = subTotal + chargesTotal;
  const roundOff = roundToRupee ? nearestRupee(beforeRound) - beforeRound : 0n;
  const total = beforeRound + roundOff;
  if (total < 0n) throw new DomainError("TOTAL_NEGATIVE");
  return { subTotal, chargesTotal, roundOff, total };
}

export function chargesFromJson(charges: readonly Charge[]) {
  return charges.map((c) => ({ kind: c.kind, amount: BigInt(c.amountPaise) }));
}

export function totalNetG(lines: readonly TradeLine[]): bigint {
  return sumBig(lines.map((l) => BigInt(l.netG)));
}

/** Per-quintal charge (loading, freight, commission) or a fixed amount. */
export function perQuintalOrFixed(
  netG: bigint,
  ratePaisePerQtl?: bigint,
  fixedPaise?: bigint,
): bigint {
  if (ratePaisePerQtl !== undefined && ratePaisePerQtl > 0n)
    return amountForWeight(netG, ratePaisePerQtl);
  return fixedPaise ?? 0n;
}
