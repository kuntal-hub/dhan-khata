/**
 * Dashboard writes (requirement_v2 §12.1B–C):
 *  - day close: actual counted cash → DAY_CLOSE (expected from the cashbook, the difference posts
 *    to CASH_DIFF so the next opening = the counted cash); the owner can reopen (audited void);
 *  - cash ↔ bank and owner money: CONTRA (deposit, withdraw, transfer, capital in, drawings);
 *  - opening cash / opening stock: OPENING;
 *  - physical stock count → approved, reasoned STOCK_ADJUST.
 */
import { cashbookDay } from "@/domain/v2/cashbook";
import type { Doc, DocOf, Location, Product } from "@/domain/schemas";
import { db } from "../db/dexie";
import { RepoError } from "./context";
import { saveDoc, voidDoc, type DraftOf } from "./docs";

/** Expected closing cash of `date` (before any close on that day). */
export async function expectedCash(godownId: string, date: string): Promise<bigint> {
  const docs = (await db().vouchers.where("godownId").equals(godownId).toArray()) as Doc[];
  return cashbookDay(
    docs.filter((d) => d.type !== "DAY_CLOSE" || d.date !== date),
    "CASH",
    date,
  ).expectedClosingPaise;
}

export async function closeDay(
  godownId: string,
  input: {
    date: string;
    actualPaise: bigint;
    note?: string;
    denominations?: Record<string, number>;
  },
): Promise<Doc> {
  const expected = await expectedCash(godownId, input.date);
  const diff = input.actualPaise - expected;
  if (diff !== 0n && !input.note?.trim()) throw new RepoError("NOTE_REQUIRED");
  return saveDoc(godownId, {
    type: "DAY_CLOSE",
    date: input.date,
    expectedClosingPaise: expected.toString(),
    actualClosingPaise: input.actualPaise.toString(),
    diffPaise: diff.toString(),
    ...(input.note?.trim() ? { notes: input.note.trim() } : {}),
    ...(input.denominations && Object.keys(input.denominations).length
      ? { denominations: input.denominations }
      : {}),
  } as DraftOf<"DAY_CLOSE">);
}

/** Owner: reopen a closed day (the close is voided with the reason; audited). */
export async function reopenDay(godownId: string, date: string, reason: string): Promise<void> {
  const close = await db()
    .vouchers.where("[godownId+type]")
    .equals([godownId, "DAY_CLOSE"])
    .filter((x) => x.status === "active" && x.type === "DAY_CLOSE" && x.date === date)
    .first();
  if (!close) throw new RepoError("NOT_FOUND", date);
  await voidDoc(godownId, close._id, reason);
}

export type ContraKind = DocOf<"CONTRA">["kind"];

export function saveContra(
  godownId: string,
  input: {
    kind: ContraKind;
    date: string;
    amountPaise: bigint;
    bankAccountId?: string;
    toBankAccountId?: string;
    reference?: string;
    notes?: string;
  },
): Promise<Doc> {
  return saveDoc(godownId, {
    type: "CONTRA",
    kind: input.kind,
    transactionDate: input.date,
    amountPaise: input.amountPaise.toString(),
    ...(input.bankAccountId ? { bankAccountId: input.bankAccountId } : {}),
    ...(input.toBankAccountId ? { toBankAccountId: input.toBankAccountId } : {}),
    ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}),
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
  } as DraftOf<"CONTRA">);
}

/** The Gola's opening cash (once; a correction is a CONTRA or a day-close difference). */
export async function saveOpeningCash(
  godownId: string,
  date: string,
  amountPaise: bigint,
): Promise<Doc> {
  if (await hasOpeningCash(godownId)) throw new RepoError("VALIDATION_FAILED", "openingCash");
  return saveDoc(godownId, {
    type: "OPENING",
    transactionDate: date,
    items: [{ kind: "CASH", amountPaise: amountPaise.toString() }],
  } as DraftOf<"OPENING">);
}

export async function hasOpeningCash(godownId: string): Promise<boolean> {
  const list = await db()
    .vouchers.where("[godownId+type]")
    .equals([godownId, "OPENING"])
    .filter(
      (x) =>
        x.status === "active" && x.type === "OPENING" && x.items.some((i) => i.kind === "CASH"),
    )
    .count();
  return list > 0;
}

/** Opening stock of one product / variety in the warehouse, valued at `valuePaise`. */
export function saveOpeningStock(
  godownId: string,
  input: {
    date: string;
    product: Product;
    varietyId?: string;
    otherProductName?: string;
    qtyG: bigint;
    valuePaise: bigint;
  },
): Promise<Doc> {
  return saveDoc(godownId, {
    type: "OPENING",
    transactionDate: input.date,
    items: [
      {
        kind: "STOCK",
        product: input.product,
        location: "WAREHOUSE",
        ...(input.varietyId ? { varietyId: input.varietyId } : {}),
        ...(input.otherProductName ? { otherProductName: input.otherProductName } : {}),
        qtyG: input.qtyG.toString(),
        amountPaise: input.valuePaise.toString(),
      },
    ],
  } as DraftOf<"OPENING">);
}

export type AdjustReason = DocOf<"STOCK_ADJUST">["lines"][number]["reason"];

/** Physical verification approved: system vs counted → a reasoned adjustment (§9.3). */
export function approveStockCount(
  godownId: string,
  input: {
    date: string;
    product: Product;
    location?: Location;
    varietyId?: string;
    millPartyId?: string;
    otherProductName?: string;
    systemG: bigint;
    countedG: bigint;
    bags?: number;
    reason: AdjustReason;
    note?: string;
  },
): Promise<Doc> {
  const diff = input.countedG - input.systemG;
  if (diff === 0n) throw new RepoError("VALIDATION_FAILED", "noDifference");
  return saveDoc(godownId, {
    type: "STOCK_ADJUST",
    transactionDate: input.date,
    lines: [
      {
        product: input.product,
        location: input.location ?? "WAREHOUSE",
        ...(input.varietyId ? { varietyId: input.varietyId } : {}),
        ...(input.millPartyId ? { millPartyId: input.millPartyId } : {}),
        ...(input.otherProductName ? { otherProductName: input.otherProductName } : {}),
        qtyG: diff.toString(),
        ...(input.bags !== undefined ? { bags: input.bags } : {}),
        reason: input.reason,
        systemG: input.systemG.toString(),
        countedG: input.countedG.toString(),
        ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      },
    ],
  } as DraftOf<"STOCK_ADJUST">);
}
