/**
 * Integer rounding helpers. The ONLY place where division of money/weight happens.
 * Rule (spec §6.2): round half up, half away from zero for negatives.
 */

export function abs(a: bigint): bigint {
  return a < 0n ? -a : a;
}

/** a / b rounded half away from zero. Throws on b === 0n. */
export function divRoundHalfUp(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new RangeError("DIV_BY_ZERO");
  const negative = a < 0n !== b < 0n;
  const absA = abs(a);
  const absB = abs(b);
  const q = absA / absB;
  const r = absA % absB;
  const rounded = r * 2n >= absB ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/**
 * Split `total` across `weights` proportionally so that the parts sum EXACTLY to total
 * (largest-remainder method). Used to spread a bill total over its lines.
 */
export function allocateProportional(total: bigint, weights: readonly bigint[]): bigint[] {
  if (weights.length === 0) return [];
  const sumW = weights.reduce((s, w) => s + w, 0n);
  if (sumW === 0n) {
    return weights.map((_, i) => (i === 0 ? total : 0n));
  }
  const sign = total < 0n ? -1n : 1n;
  const absTotal = abs(total);
  const parts = weights.map((w) => (absTotal * w) / sumW);
  const remainders = weights.map((w, i) => ({ i, r: (absTotal * w) % sumW }));
  let leftover = absTotal - parts.reduce((s, p) => s + p, 0n);
  remainders.sort((x, y) => (x.r === y.r ? x.i - y.i : x.r > y.r ? -1 : 1));
  for (const { i } of remainders) {
    if (leftover === 0n) break;
    parts[i] = (parts[i] ?? 0n) + 1n;
    leftover -= 1n;
  }
  return parts.map((p) => p * sign);
}

export function sumBig(values: readonly bigint[]): bigint {
  return values.reduce((s, v) => s + v, 0n);
}

export function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
