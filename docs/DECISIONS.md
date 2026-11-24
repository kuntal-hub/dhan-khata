# v2 decisions

Decisions taken while implementing `requirement_v2.md` that the spec (incl. §22) does not settle. Each one picks the option that can't lose, double-count or silently change money/stock, then the simplest one for the user.

### D1: One document store, discriminated by `type` (2026-11-25)
The upgrade prompt suggests new Dexie stores (`payments`, `millDispatches`, …). Instead, every v2 business document (PURCHASE, SALE, PAYMENT, EXPENSE, LOAD, MILL_DISPATCH, MILL_RETURN, CONVERSION, TRIP, SECOND_PARTY, STOCK_ADJUST, CONTRA, DAY_CLOSE, OPENING) lives in the existing `vouchers` store/collection as a discriminated union. Compound indexes (`[godownId+type+…date]`) give each type its own fast lists.
**Why:** the posting engine (`applyVoucherDerived`, re-posting of later stock), server recomputation, conflict handling, Gola isolation checks and the outbox all work per document. One store keeps them correct for the new types without duplicating that machinery per store. A payment is still exactly one record, so "one financial event = one record" holds.

### D2: Migration of the spec file location
The prompt mentions `docs/requirement.md`; the v2 spec is `requirement_v2.md` at the repo root. It stays there and is the source of truth. `requirement.md` (v1.1) is kept for history.

### D3: Sale in ORDER status posts nothing
An ORDER has no stock and no ledger effect (no receivable) until it is confirmed. An advance received against an order is a normal IN payment (source SALE) and shows as the buyer's advance until the sale is confirmed.

### D4: Sale `charges` are informational
Loading, freight and vehicle advance on the sale form (optional, collapsed) are recorded on the sale for the invoice and reference only. They change neither the sales total (spec §6.3 "Sales total = Quantity × Rate") nor cash. Actual money paid for them is entered as an expense or a payment, so nothing is counted twice.

### D5: Consignment settlement = the Sale itself
The created Sale carries `consignmentDispatchId` and `source: MILL`. The accepted quantity and final rate are the sale's weight and rate. No separate settlement document posts anything, so a settlement can never double-post.

### D6: Milling conversion valuation
Rice/by-product returns add quantity at zero value. The conversion moves value: it removes the consumed paddy from MILL stock at average cost and adds that cost to the outputs. If every output has an entered valuation (return `totalValuePaise`), that value is used. Otherwise the cost is split by grams over the outputs and the loss. Either way `MILLING_LOSS` takes the balancing amount. This affects internal stock value only: never cash, dues or quantities.

### D7: Second-party entries post against `SP_CLEARING`
"আমরা দেব / We owe" = Dr SP_CLEARING / Cr PARTY. "ওরা দেবে / They owe" = Dr PARTY / Cr SP_CLEARING. `SP_CLEARING` is an equity-type account, so it never shows as income or expense in profit.

### D8: Expense and vehicle-cost payables
An expense with a party posts Cr PARTY:person, and its payments settle that party. Without a party it posts Cr `EXP_PAYABLE`, and its payments debit `EXP_PAYABLE`. Vehicle trip costs work the same way. Paid/unpaid status is always derived per source from its payments.

### D9: Payment modes CASH / BANK / UPI only
v1 modes CHEQUE, DD, BANK_TRANSFER and OTHER are migrated to BANK, with the bank account kept. The `CHEQUE_IN_HAND` stage disappears. This is an intentional v2 semantic change, listed in the migration report.
