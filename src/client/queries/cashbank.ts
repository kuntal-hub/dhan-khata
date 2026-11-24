/**
 * Cash book, bank books and cheques in hand (spec §9.9). Per godown; every figure is a sum of
 * stored ledger lines of the account.
 */
import { ordOf } from "@/domain/posting/derive";
import type { LedgerLine, Voucher } from "@/domain/schemas";
import { db } from "../db/dexie";

export interface BookRow {
  voucherId: string;
  date: string;
  voucher: Voucher | undefined;
  inPaise: bigint;
  outPaise: bigint;
  balancePaise: bigint;
}

export interface Book {
  openingPaise: bigint;
  rows: BookRow[];
  totalInPaise: bigint;
  totalOutPaise: bigint;
  closingPaise: bigint;
}

/** Book of one money account (CASH, BANK:<id>, CHEQUE_IN_HAND): opening, rows, running balance. */
export async function accountBook(
  godownId: string,
  account: string,
  range: { from?: string; to?: string } = {},
): Promise<Book> {
  const lines: LedgerLine[] = await db()
    .ledgerLines.where("[godownId+account+date]")
    .between([godownId, account, ""], [godownId, account, range.to ?? "￿"], true, true)
    .toArray();
  let opening = 0n;
  const byVoucher = new Map<string, { date: string; dr: bigint; cr: bigint }>();
  for (const l of lines) {
    const dr = BigInt(l.debitPaise);
    const cr = BigInt(l.creditPaise);
    if (range.from && l.date < range.from) {
      opening += dr - cr;
      continue;
    }
    const e = byVoucher.get(l.voucherId) ?? { date: l.date, dr: 0n, cr: 0n };
    e.dr += dr;
    e.cr += cr;
    byVoucher.set(l.voucherId, e);
  }
  const vouchers = await db().vouchers.bulkGet([...byVoucher.keys()]);
  const vById = new Map(vouchers.filter((v): v is Voucher => !!v).map((v) => [v._id, v]));
  const order = (id: string, date: string) => {
    const v = vById.get(id);
    return v ? ordOf(v) : `${date}|`;
  };
  const sorted = [...byVoucher.entries()].sort((a, b) => {
    const x = order(a[0], a[1].date);
    const y = order(b[0], b[1].date);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  let bal = opening;
  let tin = 0n;
  let tout = 0n;
  const rows: BookRow[] = sorted.map(([voucherId, e]) => {
    bal += e.dr - e.cr;
    tin += e.dr;
    tout += e.cr;
    return {
      voucherId,
      date: e.date,
      voucher: vById.get(voucherId),
      inPaise: e.dr,
      outPaise: e.cr,
      balancePaise: bal,
    };
  });
  return { openingPaise: opening, rows, totalInPaise: tin, totalOutPaise: tout, closingPaise: bal };
}

export interface ChequeInHand {
  receipt: Voucher & { type: "RECEIPT" };
  amountPaise: bigint;
}

/** Cheques/DDs received and not yet cleared or bounced (no active CONTRA points at them). */
export async function chequesInHand(godownId: string): Promise<ChequeInHand[]> {
  const d = db();
  const [receipts, contras] = await Promise.all([
    d.vouchers
      .where("[godownId+type+date]")
      .between([godownId, "RECEIPT", ""], [godownId, "RECEIPT", "￿"], true, true)
      .filter(
        (v) =>
          v.status === "active" && v.type === "RECEIPT" && (v.mode === "CHEQUE" || v.mode === "DD"),
      )
      .toArray(),
    d.vouchers
      .where("[godownId+type+date]")
      .between([godownId, "CONTRA", ""], [godownId, "CONTRA", "￿"], true, true)
      .filter((v) => v.status === "active" && v.type === "CONTRA" && !!v.receiptVoucherId)
      .toArray(),
  ]);
  const done = new Set(contras.map((c) => (c.type === "CONTRA" ? c.receiptVoucherId : "")));
  return receipts
    .filter((r): r is Voucher & { type: "RECEIPT" } => r.type === "RECEIPT" && !done.has(r._id))
    .map((receipt) => ({ receipt, amountPaise: BigInt(receipt.amountPaise) }))
    .sort((a, b) => (a.receipt.date < b.receipt.date ? -1 : 1));
}
