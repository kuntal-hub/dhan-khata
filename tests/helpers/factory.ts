/**
 * Test factories: build schema-valid vouchers with recomputed derived fields.
 */
import { recomputeVoucher } from "@/domain/calc/recompute";
import { fyOf } from "@/domain/dates";
import {
  VoucherSchema,
  type Voucher,
  type VoucherOf,
  type VoucherType,
} from "@/domain/schemas/vouchers";

let counter = 0;

export function nextId(prefix = "v"): string {
  counter += 1;
  return `${prefix}${String(counter).padStart(6, "0")}`;
}

export interface BaseOpts {
  godownId?: string;
  date?: string;
  _id?: string;
  createdAt?: string;
  status?: "active" | "void";
  rev?: number;
}

export function baseFields(type: VoucherType, opts: BaseOpts = {}) {
  const date = opts.date ?? "2026-11-23";
  const id = opts._id ?? nextId();
  const createdAt = opts.createdAt ?? `${date}T10:00:00.000Z`;
  return {
    _id: id,
    godownId: opts.godownId ?? "GA",
    rev: opts.rev ?? 1,
    createdAt,
    createdBy: "U1",
    deviceId: "D1",
    updatedAt: createdAt,
    updatedBy: "U1",
    status: opts.status ?? "active",
    number: `RP-A-${type.slice(0, 3)}-${id.slice(-6)}`,
    date,
    fy: fyOf(date),
  } as const;
}

type Fields<T extends VoucherType> = Omit<
  VoucherOf<T>,
  keyof ReturnType<typeof baseFields> | "type"
>;

/** Build a voucher of `type`, recompute derived fields, and validate it against the schema. */
export function mk<T extends VoucherType>(
  type: T,
  fields: Fields<T>,
  opts: BaseOpts = {},
): VoucherOf<T> {
  const raw = { ...baseFields(type, opts), type, ...fields } as unknown as Voucher;
  const v = recomputeVoucher(raw);
  return VoucherSchema.parse(v) as VoucherOf<T>;
}

/** A trade line with placeholder derived values (recompute fills them in). */
export function line(
  varietyId: string,
  grossG: bigint,
  rate: bigint,
  extra: Partial<{
    bags: number;
    tarePerBagG: bigint;
    dhaltaMode: "PER_QUINTAL" | "PER_BAG" | "FIXED";
    dhaltaValueG: bigint;
    moistureBps: number;
    otherDedG: bigint;
  }> = {},
) {
  return {
    varietyId,
    grossG: grossG.toString(),
    ratePaisePerQtl: rate.toString(),
    netG: "1",
    amountPaise: "0",
    ...(extra.bags !== undefined ? { bags: extra.bags } : {}),
    ...(extra.tarePerBagG !== undefined ? { tarePerBagG: extra.tarePerBagG.toString() } : {}),
    ...(extra.dhaltaMode !== undefined ? { dhaltaMode: extra.dhaltaMode } : {}),
    ...(extra.dhaltaValueG !== undefined ? { dhaltaValueG: extra.dhaltaValueG.toString() } : {}),
    ...(extra.moistureBps !== undefined ? { moistureBps: extra.moistureBps } : {}),
    ...(extra.otherDedG !== undefined ? { otherDedG: extra.otherDedG.toString() } : {}),
  };
}
