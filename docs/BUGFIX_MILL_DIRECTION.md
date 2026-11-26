# Bug fix: money direction with rice mills (v2.1)

**The business:** the broker buys paddy from farmers and pays them (money OUT, farmer = দেনা). He
delivers paddy to rice mills and **the mill pays him** (money IN, mill = পাওনা). A mill is a
customer/debtor. The broker pays a mill only when he explicitly records a refund or a mill expense.

**The bug:** the app followed `requirement_v2.md` §8 / §12.8 B–E, which modelled a "For milling"
dispatch as a milling charge **payable to the mill** and a consignment as a separate sale. Mill
balances came out as "মিলের দেনা / Mill payable", and money from a mill entered on a milling
dispatch was an OUT payment, so it **reduced** cash.

> Spec file: the v2 spec lives at `requirement_v2.md` in the repo root (DECISIONS D2). The
> request's `docs/requirement.md` means that file; it is the one updated.

---

## 1. Where the wrong behaviour lives (found before changing anything)

### Domain (`src/domain`): shared by the client write path and the server recompute

| File / function | Wrong behaviour | Fix |
|---|---|---|
| `v2/post.ts` `postDoc` case `MILL_DISPATCH` | Value moves to `STOCK_AT_MILL` (still our asset). A MILLING dispatch posts Dr `MILLING_CHARGES` / Cr `PARTY:mill`, so the mill ends up **credit** (we owe it). A CONSIGNMENT dispatch posts no party line at all. | Dr `PARTY:mill` / Cr `MILL_SALES` (total). Dr `COGS` / Cr `STOCK_PADDY` at average cost. Quantity still moves WAREHOUSE → MILL (the MILL position carries the cost as a memo so a return comes back at cost). `dispatchType` ignored. |
| `v2/post.ts` case `MILL_RETURN` | Paddy goes back at cost Dr `STOCK_PADDY` / Cr `STOCK_AT_MILL`. No credit to the mill. | Dr `MILL_SALES` / Cr `PARTY:mill` for the credit value. Dr `STOCK_PADDY` / Cr `COGS` at cost. Rice/other: stock only (unchanged). |
| `v2/post.ts` case `CONVERSION` | Moves value from `STOCK_AT_MILL` into rice/other stock + `MILLING_LOSS`. | Stock only: the consumed paddy leaves mill stock. No ledger lines (its cost is already in COGS). |
| `v2/accounts.ts` `ACC2` | `MILLING_CHARGES` (expense); no mill income account. | Remove `MILLING_CHARGES` and `MILLING_LOSS` (kept only as tolerated legacy keys). Add `MILL_SALES` (income) and `MILL_DEDUCTION` (contra-income). |
| `v2/payments.ts` `billsOf` | MILL_DISPATCH bill direction = `OUT` for MILLING (we pay), `IN` for CONSIGNMENT. | Always `IN` (the mill pays us). |
| `v2/payments.ts` `dueBillsOf` | Drops CONSIGNMENT dispatches (expected value "not owed", D39). | Every active dispatch is owed. Bill totals are netted by return credits and settlement adjustments (`millCredits`). |
| `v2/links.ts` `validatePaymentSource` | Allows IN payments with source `MILL_RETURN` (D37). Direction only checked against the (wrong) bill. | `MILL_RETURN` payments refused. New `MILL_REFUND` (OUT) source, optionally linked to a dispatch of the same mill. |
| `v2/links.ts` case `CONVERSION` / `SALE` | Conversion only for MILLING dispatches; settlement sale must point to a CONSIGNMENT dispatch. | Conversion on any dispatch. New `MILL_SETTLEMENT` link rules (same mill/variety, copied dispatch rate). |
| `v2/recompute.ts` `validateDocRules` | No rule ties a payment's direction to its source. | One shared map `v2/direction.ts` (`PAYMENT_DIRECTION`). A mismatch fails with `PAYMENT_DIRECTION_MISMATCH` on the device and on the server. |
| `v2/schemas.ts` | `MillDispatch.dispatchType` required. `Sale.consignmentDispatchId`. No settlement record. No `MILL_REFUND` source. | `dispatchType` optional (deprecated, old records keep it). New `MILL_SETTLEMENT` document. `MILL_REFUND` payment source. `consignmentDispatchId` kept only so old records still parse. |
| `v2/stock.ts` `dispatchBalance`, `millDay` | "Settled" = consignment sales. | "Accepted" + "shortfall" from the final settlement. |
| `v2/cashbook.ts` | Correct in itself (classifies by `direction`), but received the wrong OUT payments. | No change; mill collections are IN → **Cash received**. A `MILL_REFUND` is **Cash paid**. |

### Client (`src/client`)

| File / function | Wrong behaviour | Fix |
|---|---|---|
| `queries/dashboard.ts` `golaOverview` | `millPayablePaise` = Σ negative mill balances ("Mill payable" card). `receivablePaise` mixes mills with customers. | `millReceivablePaise` (Σ positive mill balances), `millRefundPaise` (Σ negative), `millSalesPaise` (dispatch value in the range, for the Sales card sub-line). Customer receivable excludes mills. |
| `queries/consolidated/dashboard.ts` | Sums `millPayablePaise`. | Sums the new fields. |
| `queries/dues.ts` `dueCategory` | Negative mill balance → tab "মিলের দেনা"; positive mill balance mixed into customer receivables. | Positive mill balance → "মিলের কাছে পাওনা". Negative mill balance → অন্যান্য with "মিলকে ফেরত দিতে হবে". Labels by sign everywhere. |
| `queries/mill.ts` | Dispatch state: MILLING = what we owe the mill; CONSIGNMENT = advances. Settlement = consignment sales. | Value / collected / receivable per dispatch (value − return credits − settlement adjustment − collections + refunds). Settlement = `MILL_SETTLEMENT`. |
| `repo/mill.ts` `saveMillReturn` | Saves an IN payment with source `MILL_RETURN`. | Return only (a credit, never cash). |
| `repo/mill.ts` `settleConsignment` / `voidSettlement` | Creates a SALE to the mill and moves the dispatch's money onto it (income counted as a sale). | Removed. `saveMillSettlement` writes a `MILL_SETTLEMENT`; `saveMillRefund` writes a `MILL_REFUND` payment. |
| `repo/payments.ts` `payBill`, `saveBillWithInitialPayment` | Direction taken from the (wrong) bill. | Direction from the shared map; dispatch due = net receivable. |
| `repo/docs.ts` `dependentsOf` | Settlement = consignment sales. | Settlements are `MILL_SETTLEMENT` docs (found by `dispatchId`). |
| `reports/defs.ts` | Mill dispatch report: type column, value only. Mill return: "received". Summary: `dues.cat.mill` = mill payable. Gross profit = SALES − COGS. | Dispatch: value, collected, receivable. Return: credit value. Summary: receivable from mills. Gross profit = SALES + MILL_SALES − MILL_DEDUCTION − COGS. |

### Server (`src/server`)

| File / function | Wrong behaviour | Fix |
|---|---|---|
| `apply/applyOp.ts` | Recomputes with the same (wrong) domain code. `hasDependents` looks for consignment sales. | Same corrected domain code (posting, direction map, links). Dependents include `MILL_SETTLEMENT`. One active settlement per dispatch. |

### UI (`src/app`, `src/components`)

| File | Wrong behaviour | Fix |
|---|---|---|
| `components/mill/DispatchForm.tsx` | Type toggle (ভাঙানোর জন্য / কনসাইনমেন্ট). MILLING: "মিলকে দিতে হবে", "এখন মিলকে কত দিলেন" (OUT). | No toggle. "মিলের রেট (মিল দেবে)", "মোট পাওনা", "মিল দিয়েছে" (IN), "মিলের কাছে বাকি পাওনা". |
| `app/(app)/mill/dispatch/view/page.tsx` | "+ মিলকে টাকা দিন" → OUT payment. Red "মিলকে দিতে বাকি". WhatsApp "we owe" template. | "+ মিল থেকে টাকা পেলাম" → IN. Value / collected / receivable; sent / returned / accepted / at mill. Final settlement panel. Refund button only when the mill paid too much. Collection WhatsApp template. |
| `components/mill/ReturnForm.tsx`, `app/(app)/mill/return/view/page.tsx` | "Value (valuation only, creates no receivable)"; "money received now" (IN, source MILL_RETURN). | "Credit value" (auto = qty × dispatch rate, editable) with "মিলের পাওনা ₹X কমবে". No payment fields. |
| `components/mill/SettleForm.tsx`, `app/(app)/mill/settle/page.tsx` | Consignment settlement creates a Sale. | "চূড়ান্ত হিসাব / Final settlement" on the dispatch: accepted qty, final rate, deduction, shortfall, date; shows the difference and the new receivable before saving. |
| `components/mill/MillTabs.tsx`, `components/shell/sections.ts` | Tab "কনসাইনমেন্ট নিষ্পত্তি"; type filter. | Tab "চূড়ান্ত হিসাব"; no type filter. |
| `components/mill/ConversionForm.tsx` | Only MILLING dispatches. | Any dispatch with paddy at the mill. |
| `components/sales/SaleForm.tsx`, `app/(app)/sales/view/page.tsx`, `edit/page.tsx` | "মিল থেকে" source and the consignment settlement sale. | Source options: Gola stock / direct delivery. Legacy consignment sales show read-only. |
| `components/dashboard/Overview.tsx` | Card "মিলের দেনা / Mill payable" (tone out). Dues donut counts it. | "মিলের কাছে পাওনা / Receivable from mills" (tone in) + "মিলকে ফেরত দিতে হবে ₹X" only when negative. Sales card sub-line "মিলে পাঠানো ₹X". |
| `components/dues/DueTabs.tsx` | Tab "মিলের দেনা". | "মিলের কাছে পাওনা". |
| `app/(app)/mill/entry/view/page.tsx` | Re-uses `mill.paidMILLING`. | Own label. |
| `i18n/v2/{bn,en}.ts` | `dsh.millPayable`, `dues.cat.mill` "মিলের দেনা", `mill.*MILLING` / `*CONSIGNMENT`, settlement-as-sale strings. | Replaced (see the diff). |

### Tests that encoded the wrong behaviour

`tests/repo/mill.test.ts` (MILLING payable, consignment → sale), `tests/unit/v2-posting.test.ts`
(MILLING_CHARGES lines), `tests/unit/v2-acceptance.test.ts`, `tests/property/v2.property.test.ts`
(dispatch type arbitrary), `tests/repo/dashboard.test.ts` (mill payable),
`tests/repo/loads-dues-trips.test.ts` (mill tab), `tests/repo/edit-reversal.test.ts`,
`tests/e2e/mill.spec.ts`, `tests/e2e/acceptance.spec.ts`, `tests/e2e/offline.spec.ts`.

### Docs that described the wrong model

`requirement_v2.md` §1.1, §1.2, §6.3, §7.2, §7.3, §8, §9.2, §10, §11, §12.1, §12.3, §12.6, §12.8,
§21, §22; `docs/DECISIONS.md` D5, D6, D10, D33, D37, D38, D39, D41, D45.

---

## 2. Design decisions taken during the fix

- **D53 — Final settlement is its own document (`MILL_SETTLEMENT`), not a field on the dispatch.**
  The request suggested `MillDispatch.settlement`. Every document posts on ONE business date
  (`businessDate()`), and stock cost is replayed in date order. A settlement stored on the dispatch
  would post its cut and its stock exit on the *dispatch* date: the cashbook / dues history would
  be wrong for the days in between, and later returns would run against stock that had already
  left. A separate document has its own date, revision, audit and reversal, and is linked by
  `dispatchId` (one active settlement per dispatch, enforced on device and server). The dispatch
  detail page shows it as part of the dispatch.
- **Settlement maths (pure, no other records needed):**
  `billed = (accepted + shortfall) × dispatch rate` (the part of the dispatch that was still at the
  mill), `final = accepted × final rate − deduction`, `adjustment = billed − final`.
  Adjustment > 0 → Dr `MILL_DEDUCTION` / Cr `PARTY:mill`; < 0 → the reverse. Accepted and shortfall
  leave mill stock (no ledger line: their cost is already in COGS). The dispatch rate is copied onto
  the settlement and checked against the dispatch.
- **Mill stock keeps its cost as a memo.** After a dispatch the paddy's cost is in COGS, but the MILL
  stock position still carries that cost in its moves, so a paddy return comes back to the warehouse
  at the same cost (Dr STOCK_PADDY / Cr COGS). Opening stock and stock adjustments at a mill keep
  their old accounts (rare; noted).
- **Rice / by-products from a conversion carry no cost** (the paddy's cost is already in COGS).
  Selling them later is income with zero cost of goods.
- **Negative mill balances** (the mill paid more than it owes) show under Due & Advance → অন্যান্য
  with "মিলকে ফেরত দিতে হবে", never under "মিলের কাছে পাওনা".
- **"Customer receivables"** no longer include mills; mills have their own card.

## 3. Data repair

`scripts/fix-mill-direction.ts` (dry-run by default, `--apply` to write; logic in
`src/server/fixMillDirection.ts`). It writes `docs/MILL_FIX_REVIEW.md` (items needing the owner's
decision) and a reconciliation report. See `docs/OPERATIONS.md` → "Mill direction fix".
