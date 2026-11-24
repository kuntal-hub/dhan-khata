/**
 * WeightBlock formulas (requirement_v2 §6.3), shared by Purchase, Sale, Load, Mill dispatch and
 * Mill return.
 *
 *   Bag-wise: totalG = Σ bag.weightG;  avgBagG = round(totalG / bagCount)   (display only)
 *   Manual:   totalG = entered
 *   Deductions (optional): moistureG = round((totalG − tareG) × moistureBps / 10,000)
 *             netG = totalG − tareG − dhaltaG − moistureG − otherG          (must be > 0)
 *   Amount:   amountPaise = round(netG × ratePaisePerQtl / 100,000)
 */
import { DomainError } from "../errors";
import { amountForWeight, applyBps, nearestRupee } from "../money";
import { divRoundHalfUp, sumBig } from "../rounding";
import type { Bag, Deductions, WeightBlock } from "./schemas";

export interface WeightResult {
  totalG: bigint;
  bagCount: number;
  /** null when there are no bags. */
  avgBagG: bigint | null;
  tareG: bigint;
  dhaltaG: bigint;
  moistureG: bigint;
  otherG: bigint;
  netG: bigint;
}

export function bagsTotal(bags: readonly Pick<Bag, "weightG">[]): bigint {
  return sumBig(bags.map((b) => BigInt(b.weightG)));
}

export function averageBag(totalG: bigint, bagCount: number): bigint | null {
  return bagCount > 0 ? divRoundHalfUp(totalG, BigInt(bagCount)) : null;
}

export function applyDeductions(
  totalG: bigint,
  d: Deductions | undefined,
): Pick<WeightResult, "tareG" | "dhaltaG" | "moistureG" | "otherG" | "netG"> {
  const tareG = BigInt(d?.tareG ?? "0");
  const dhaltaG = BigInt(d?.dhaltaG ?? "0");
  const moistureG = applyBps(totalG - tareG, BigInt(d?.moistureBps ?? 0));
  const otherG = BigInt(d?.otherG ?? "0");
  return { tareG, dhaltaG, moistureG, otherG, netG: totalG - tareG - dhaltaG - moistureG - otherG };
}

/**
 * Compute a weight block from its inputs. `deductionsEnabled = false` ignores any deductions
 * (the feature is off by default, §6.3).
 */
export function computeWeight(
  w: Pick<WeightBlock, "mode" | "bags" | "bagCount" | "totalG" | "deductions">,
  deductionsEnabled = true,
): WeightResult {
  let totalG: bigint;
  let bagCount: number;
  if (w.mode === "BAGS") {
    const bags = w.bags ?? [];
    totalG = bagsTotal(bags);
    bagCount = bags.length;
  } else {
    totalG = BigInt(w.totalG);
    bagCount = w.bagCount ?? 0;
  }
  if (totalG <= 0n) throw new DomainError("NET_NOT_POSITIVE");
  const ded = applyDeductions(totalG, deductionsEnabled ? w.deductions : undefined);
  if (ded.netG <= 0n) throw new DomainError("NET_NOT_POSITIVE");
  return { totalG, bagCount, avgBagG: averageBag(totalG, bagCount), ...ded };
}

/** The weight block with `totalG` and `netG` recomputed from its inputs. */
export function recomputeWeight(w: WeightBlock): WeightBlock {
  const r = computeWeight(w);
  return { ...w, totalG: r.totalG.toString(), netG: r.netG.toString() };
}

/** Bag count of a block (bags length, or the manual count). */
export function bagCountOf(w: Pick<WeightBlock, "mode" | "bags" | "bagCount">): number {
  return w.mode === "BAGS" ? (w.bags?.length ?? 0) : (w.bagCount ?? 0);
}

export interface BillResult {
  amountPaise: bigint;
  roundOffPaise: bigint;
  totalPaise: bigint;
}

/** amount = netG × rate (half-up); optional visible round-off to the nearest rupee. */
export function computeBill(
  netG: bigint,
  ratePaisePerQtl: bigint,
  roundToRupee = false,
  /** Legacy v1 purchase charges (Σ add − Σ deduct); 0 for v2 bills. */
  chargesPaise = 0n,
): BillResult {
  const amountPaise = amountForWeight(netG, ratePaisePerQtl);
  const before = amountPaise + chargesPaise;
  const roundOffPaise = roundToRupee ? nearestRupee(before) - before : 0n;
  const totalPaise = before + roundOffPaise;
  if (totalPaise < 0n) throw new DomainError("TOTAL_NEGATIVE");
  return { amountPaise, roundOffPaise, totalPaise };
}
