import type { Voucher } from "@/domain/schemas";

/** Headline amount of a voucher (lists, search by amount). */
export function amountOf(v: Voucher): bigint {
  switch (v.type) {
    case "PURCHASE":
    case "SALE":
      return BigInt(v.totalPaise);
    case "LOAD":
      return BigInt(v.mode === "AGENT" ? (v.commission?.amountPaise ?? "0") : v.totalAmountPaise);
    case "PAYMENT":
    case "RECEIPT":
    case "EXPENSE":
    case "CONTRA":
      return BigInt(v.amountPaise);
    case "MILL_SETTLEMENT":
      return BigInt(v.differencePaise);
    case "TRIP":
      return BigInt(v.freightPaise);
    case "DAY_CLOSE":
      return BigInt(v.differencePaise);
    case "STOCK_ADJUST":
      return 0n;
    case "OPENING": {
      let net = 0n;
      for (const it of v.items) net += BigInt(it.amountPaise);
      return net;
    }
    case "JOURNAL": {
      let dr = 0n;
      for (const l of v.lines) dr += BigInt(l.debitPaise);
      return dr;
    }
  }
}
