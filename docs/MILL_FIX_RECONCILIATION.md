# Mill direction fix — reconciliation

> **Status: not yet run on the real database.** `pnpm fix:mill-direction [--apply]` regenerates
> this file per Gola. Below is the run on the test fixture (`tests/sync/fix-mill-direction.test.ts`)
> with the owner's decisions `payments: { d000003: "IN" }`, `rates: { d000002: "2600" }`.
>
> In the fixture the "before" rows were posted with the new code (the old posting code no longer
> exists to produce them), so the "before" mill balance there already counts the consignment
> dispatch. On the real database "before" is the v2.0 books: the mill shows as owed money, and
> each mill dispatch appears as a payable.

Rules checked for every Gola:
- Every stock quantity (warehouse paddy, paddy at mills, rice, other products) is unchanged.
- Cash and each bank change **only** by 2 × each payment flipped from OUT to IN (it was counted as
  paid; it was received), and every such change is listed.

## Rampur — applied

| | Before | After |
|---|---|---|
| Cash | ₹55000.00 | ₹57000.00 |
| Mill Mill One (> 0 = owes us) | ₹41400.00 | ₹65400.00 |
| Total receivable | ₹41400.00 | ₹65400.00 |
| Total payable | ₹0.00 | ₹0.00 |
| Warehouse paddy | 72.000 qtl | 72.000 qtl |
| Paddy at mills | 20.000 qtl | 20.000 qtl |
| Rice | 0.000 qtl | 0.000 qtl |
| Other products | 0.000 qtl | 0.000 qtl |

Checks:

- OK warehousePaddyG unchanged (7200000 g)
- OK millPaddyG unchanged (2000000 g)
- OK riceG unchanged (0 g)
- OK otherG unchanged (0 g)
- OK CASH 5500000 → 5700000 paise (change 200000 = 2 × flipped payments)

Cash / bank changes (payments flipped OUT → IN, each changes its account by 2 × amount):

- d000003: CASH +₹2000.00 (₹1000.00 was counted as paid; it was received)

Why the mill balance changed (₹41,400 → ₹65,400):
- Before: dispatch MIL-000002 at its ₹50 milling-charge rate = ₹1,000, plus the ₹1,000 OUT payment
  (+₹1,000 more) = ₹2,000; dispatch MIL-000004 ₹25,000 with no credit for the 2 qtl returned; the
  consignment sale ₹20,400 counted a second time; minus ₹6,000 received → ₹41,400.
- After: MIL-000002 at the price the mill pays, 20 qtl × ₹2,600 = ₹52,000, minus the ₹1,000 now
  correctly received = ₹51,000. MIL-000004: ₹25,000 − ₹5,000 credit for the return + ₹400 final
  settlement extra (8 qtl at ₹2,550 instead of ₹2,500) − ₹6,000 received = ₹14,400.
  Total ₹65,400.

Automatic changes:

- dispatch MIL-000004: consignment price 250000 paise/qtl kept as the price the mill pays
- return MIL-000005: credit = qty × dispatch rate = 500000 paise
- payment PAY-000006: money received with return MIL-000005 moved to its dispatch (no cash change)
- sale SAL-000007 (consignment) → final settlement RP-FIX-MST-000001 on dispatch MIL-000004; sale voided, its payments moved to the dispatch

A second run on the same data: `unchanged`, 0 documents (idempotent).
