/** Aging buckets for outstanding bills (spec §9.6): 0–30, 31–60, 61–90, 90+ days. */
import { diffDays, type Ymd } from "./dates";

export type AgingBucket = "D0_30" | "D31_60" | "D61_90" | "D90_PLUS";
export const AGING_BUCKETS: readonly AgingBucket[] = ["D0_30", "D31_60", "D61_90", "D90_PLUS"];

export function agingBucketOf(billDate: Ymd, asOf: Ymd): AgingBucket {
  const days = diffDays(billDate, asOf);
  if (days <= 30) return "D0_30";
  if (days <= 60) return "D31_60";
  if (days <= 90) return "D61_90";
  return "D90_PLUS";
}

export function agingBuckets(
  items: readonly { date: Ymd; outstandingPaise: bigint }[],
  asOf: Ymd,
): Record<AgingBucket, bigint> {
  const out: Record<AgingBucket, bigint> = { D0_30: 0n, D31_60: 0n, D61_90: 0n, D90_PLUS: 0n };
  for (const it of items) {
    if (it.outstandingPaise === 0n) continue;
    const b = agingBucketOf(it.date, asOf);
    out[b] += it.outstandingPaise;
  }
  return out;
}
