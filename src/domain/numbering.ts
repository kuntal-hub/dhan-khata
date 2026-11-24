/**
 * Offline-safe voucher numbering (spec §12.7):
 *   `${godownCode}-${deviceCode}-${typeCode}-${6-digit seq}`  e.g. "RP-A-PUR-000123"
 * The per-godown, per-device, per-type sequence lives in the device's meta table.
 */
import type { DocType } from "./v2/schemas";

type VoucherType = DocType;

export const VOUCHER_TYPE_CODES: Record<DocType, string> = {
  PURCHASE: "PUR",
  SALE: "SAL",
  PAYMENT: "PAY",
  EXPENSE: "EXP",
  LOAD: "LOD",
  MILL_DISPATCH: "MDS",
  MILL_RETURN: "MRT",
  CONVERSION: "CNV",
  TRIP: "TRP",
  SECOND_PARTY: "SPE",
  STOCK_ADJUST: "SAD",
  CONTRA: "CON",
  DAY_CLOSE: "DCL",
  OPENING: "OPN",
};

export const GODOWN_CODE_RE = /^[A-Z][A-Z0-9]{1,5}$/;
export const DEVICE_CODE_RE = /^[A-Z]{1,3}$/;

export function formatVoucherNumber(
  godownCode: string,
  deviceCode: string,
  type: VoucherType,
  seq: number,
): string {
  if (!GODOWN_CODE_RE.test(godownCode)) throw new RangeError(`Bad godown code: ${godownCode}`);
  if (!DEVICE_CODE_RE.test(deviceCode)) throw new RangeError(`Bad device code: ${deviceCode}`);
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError(`Bad sequence: ${seq}`);
  return `${godownCode}-${deviceCode}-${VOUCHER_TYPE_CODES[type]}-${String(seq).padStart(6, "0")}`;
}

export function parseVoucherNumber(
  num: string,
): { godownCode: string; deviceCode: string; typeCode: string; seq: number } | null {
  const m = /^([A-Z][A-Z0-9]{1,5})-([A-Z]{1,3})-([A-Z]{3})-(\d{6,})$/.exec(num);
  if (!m) return null;
  return { godownCode: m[1]!, deviceCode: m[2]!, typeCode: m[3]!, seq: parseInt(m[4]!, 10) };
}

/** Device code for the n-th registered device (0-based): 0→A … 25→Z, 26→AA, 27→AB … */
export function deviceCodeFromIndex(index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new RangeError(`Bad device index: ${index}`);
  let n = index + 1;
  let code = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    code = String.fromCharCode(65 + rem) + code;
    n = (n - 1 - rem) / 26;
  }
  return code;
}

export function deviceIndexFromCode(code: string): number {
  if (!DEVICE_CODE_RE.test(code)) throw new RangeError(`Bad device code: ${code}`);
  let n = 0;
  for (const ch of code) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Meta-table key for the per-godown, per-type sequence on this device. */
export function voucherSeqKey(godownId: string, type: VoucherType): string {
  return `voucherSeq:${godownId}:${type}`;
}
