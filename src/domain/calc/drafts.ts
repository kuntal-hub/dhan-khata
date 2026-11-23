/**
 * A "draft" is a voucher without the bookkeeping fields that the local write path fills in
 * (id, godownId, rev, number, fy, timestamps, device, status). Builders return drafts for
 * linked vouchers; `src/client/repo` turns them into real documents in one transaction.
 */
import type {
  PaymentVoucher,
  ReceiptVoucher,
  ExpenseVoucher,
  PurchaseVoucher,
  SaleVoucher,
} from "../schemas/vouchers";

type BookkeepingKeys =
  | "_id"
  | "godownId"
  | "rev"
  | "createdAt"
  | "createdBy"
  | "deviceId"
  | "updatedAt"
  | "updatedBy"
  | "serverSeq"
  | "status"
  | "voidReason"
  | "number"
  | "fy";

export type DraftOf<V> = Omit<V, BookkeepingKeys>;

export type PaymentDraft = DraftOf<PaymentVoucher>;
export type ReceiptDraft = DraftOf<ReceiptVoucher>;
export type ExpenseDraft = DraftOf<ExpenseVoucher>;
export type PurchaseDraft = DraftOf<PurchaseVoucher>;
export type SaleDraft = DraftOf<SaleVoucher>;
