/**
 * v2 test factories: build schema-valid documents with recomputed derived fields.
 */
import { fyOf } from "@/domain/dates";
import { recomputeDoc } from "@/domain/v2/recompute";
import {
  DocSchema,
  type Doc,
  type DocOf,
  type DocType,
  type WeightBlock,
} from "@/domain/v2/schemas";

let counter = 0;

export function nid(prefix = "d"): string {
  counter += 1;
  return `${prefix}${String(counter).padStart(6, "0")}`;
}

export interface Opts {
  godownId?: string;
  businessId?: string;
  _id?: string;
  createdAt?: string;
  status?: "active" | "void";
  rev?: number;
  entryDate?: string;
  groupId?: string;
  notes?: string;
}

type BaseKeys =
  | "_id"
  | "businessId"
  | "godownId"
  | "rev"
  | "status"
  | "entryDate"
  | "createdAt"
  | "createdBy"
  | "updatedAt"
  | "updatedBy"
  | "deviceId"
  | "number"
  | "fy"
  | "type";

export type Fields<T extends DocType> = Omit<DocOf<T>, BaseKeys>;

/** Build a document of `type` dated `date` (its business date), recompute and validate it. */
export function doc<T extends DocType>(
  type: T,
  date: string,
  fields: Fields<T>,
  o: Opts = {},
): DocOf<T> {
  const id = o._id ?? nid();
  const createdAt = o.createdAt ?? `${date}T10:00:00.000Z`;
  const raw = {
    _id: id,
    businessId: o.businessId ?? "B1",
    godownId: o.godownId ?? "GA",
    rev: o.rev ?? 1,
    status: o.status ?? "active",
    entryDate: o.entryDate ?? date,
    createdAt,
    createdBy: "U1",
    updatedAt: createdAt,
    updatedBy: "U1",
    deviceId: "D1",
    number: `${type.slice(0, 3)}-${id.slice(-6)}`,
    fy: fyOf(date),
    ...(o.groupId ? { groupId: o.groupId } : {}),
    ...(o.notes ? { notes: o.notes } : {}),
    type,
    ...fields,
  } as unknown as Doc;
  return DocSchema.parse(recomputeDoc(raw)) as DocOf<T>;
}

/** Manual weight block of `g` grams (derived fields filled by recompute). */
export function manual(g: bigint, bagCount?: number): WeightBlock {
  return {
    mode: "MANUAL",
    totalG: g.toString(),
    netG: g.toString(),
    ...(bagCount !== undefined ? { bagCount } : {}),
  };
}

/** Bag-wise weight block. */
export function bags(...weightsG: bigint[]): WeightBlock {
  return {
    mode: "BAGS",
    bags: weightsG.map((w, i) => ({ id: `b${i + 1}`, seq: i + 1, weightG: w.toString() })),
    totalG: "1",
    netG: "1",
  };
}

export const QTL = 100_000n;
export const RS = 100n;

/** A purchase of `g` grams at `rate` paise/qtl. */
export function purchase(
  date: string,
  partyId: string,
  varietyId: string,
  g: bigint,
  rate: bigint,
  o: Opts = {},
  extra: Partial<Fields<"PURCHASE">> = {},
) {
  return doc(
    "PURCHASE",
    date,
    {
      transactionDate: date,
      partyId,
      varietyId,
      storeAt: "WAREHOUSE",
      weight: manual(g),
      ratePaisePerQtl: rate.toString(),
      amountPaise: "0",
      roundOffPaise: "0",
      totalPaise: "0",
      ...extra,
    },
    o,
  );
}

export function sale(
  date: string,
  partyId: string,
  varietyId: string,
  g: bigint,
  rate: bigint,
  o: Opts = {},
  extra: Partial<Fields<"SALE">> = {},
) {
  return doc(
    "SALE",
    date,
    {
      transactionDate: date,
      partyId,
      product: "PADDY",
      varietyId,
      source: "WAREHOUSE",
      weight: manual(g),
      ratePaisePerQtl: rate.toString(),
      amountPaise: "0",
      roundOffPaise: "0",
      totalPaise: "0",
      saleStatus: "CONFIRMED",
      deliveryStatus: "PENDING",
      deliveryLog: [],
      ...extra,
    },
    o,
  );
}

export function payment(
  date: string,
  direction: "IN" | "OUT",
  amount: bigint,
  source: Fields<"PAYMENT">["source"],
  extra: Partial<Fields<"PAYMENT">> = {},
  o: Opts = {},
) {
  return doc(
    "PAYMENT",
    date,
    {
      direction,
      amountPaise: amount.toString(),
      paymentDate: date,
      mode: "CASH",
      source,
      isInitial: false,
      ...extra,
    },
    o,
  );
}

export function opening(date: string, items: Fields<"OPENING">["items"], o: Opts = {}) {
  return doc("OPENING", date, { transactionDate: date, items }, o);
}
