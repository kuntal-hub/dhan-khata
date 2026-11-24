/** Routes of voucher screens (light module: no write path, safe for any screen). */
import type { Voucher } from "@/domain/schemas";

export function isTransfer(v: Voucher): boolean {
  return "interGodown" in v && !!v.interGodown;
}

export function editPathOf(v: Voucher): string | null {
  if (isTransfer(v)) return `/transfer?id=${v._id}`;
  switch (v.type) {
    case "EXPENSE":
      return `/expense/edit?id=${v._id}`;
    case "TRIP":
      return `/trip/edit?id=${v._id}`;
    case "CONTRA":
      return `/cashbank/entry?id=${v._id}`;
    case "STOCK_ADJUST":
      return `/stock/adjust?id=${v._id}`;
    case "PURCHASE":
      return `/purchase/edit?id=${v._id}`;
    case "SALE":
      return `/sale/edit?id=${v._id}`;
    case "LOAD":
      return `/load/edit?id=${v._id}`;
    case "PAYMENT":
    case "RECEIPT":
      return `/payment/edit?id=${v._id}`;
    case "MILL_SETTLEMENT":
      return `/sale/settle?id=${v.saleId}`;
    default:
      return null;
  }
}

export function viewPathOf(v: Pick<Voucher, "_id" | "type">): string {
  switch (v.type) {
    case "PURCHASE":
      return `/purchase/view?id=${v._id}`;
    case "SALE":
      return `/sale/view?id=${v._id}`;
    case "LOAD":
      return `/load/view?id=${v._id}`;
    case "PAYMENT":
    case "RECEIPT":
      return `/payment/view?id=${v._id}`;
    default:
      return `/voucher/view?id=${v._id}`;
  }
}
