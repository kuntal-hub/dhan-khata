/**
 * Boundary conversions between wire/IndexedDB docs (decimal strings) and Mongo docs
 * (Int64 for derived money/weight so the server can $sum them). Exact: BigInt ↔ string only.
 */
import type { LedgerLine, StockMove } from "@/domain/schemas";
import type { DbLedgerLine, DbStockMove } from "./db";

export function toDbLine(l: LedgerLine): DbLedgerLine {
  return { ...l, debitPaise: BigInt(l.debitPaise), creditPaise: BigInt(l.creditPaise) };
}

export function fromDbLine(l: DbLedgerLine): LedgerLine {
  const out = {
    ...l,
    debitPaise: BigInt(l.debitPaise).toString(),
    creditPaise: BigInt(l.creditPaise).toString(),
  };
  return out as LedgerLine;
}

export function toDbMove(m: StockMove): DbStockMove {
  return {
    ...m,
    qtyG: BigInt(m.qtyG),
    valuePaise: BigInt(m.valuePaise),
    ord: m.ord ?? "",
  };
}

export function fromDbMove(m: DbStockMove): StockMove {
  return {
    ...m,
    qtyG: BigInt(m.qtyG).toString(),
    valuePaise: BigInt(m.valuePaise).toString(),
  };
}

/** Remove server-only fields (`_m`, password hashes) before sending a document to a client. */
export function publicDoc<T>(doc: T): T {
  if (doc === null || typeof doc !== "object") return doc;
  const { _m: _meta, passwordHash: _hash, ...rest } = doc as Record<string, unknown>;
  return rest as T;
}
