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

### D10: Mill-return value creates no receivable (OPEN: confirm with the client)
§12.8C lists "rate, total value, amount received, remaining receivable" on a mill return. The paddy, rice or by-product coming back is our own goods, so its value is treated as **valuation only** (used by the conversion, D6). Money actually received from the mill at return time is an IN payment (source `MILL_RETURN`) that credits the mill's party ledger, as §22.9 says ("the mill's outstanding is tracked on the mill's party ledger"). The "remaining" figure on the return screen is informational and is not posted. If the client means that the mill buys part of the return (e.g. keeps the by-products against payment), that will be recorded as a Sale to the mill.

### D11: Conversion loss is derived
`lossG = paddy consumed − Σ outputs` is recomputed (and verified by the server). The user confirms the loss shown, so the stored loss can never disagree with the quantities.

### D12: Devices re-download after the v2 migration
The Dexie v4 upgrade does not convert synced data on the device. It holds pending v1 work, clears the business tables and re-downloads the server's migrated data. The held work is replayed through the same converter after the first pull. **Why:** one converter run (on the server) is the single truth, and FIFO allocation of old payments can't differ between devices.

### D13: Automatic reminders are derived, not stored
Due reminders come from the `dueDate` of open bills (a query). Stored reminder records are only manual reminders and the owner's done/snooze state for an automatic one (`auto:<sourceId>`). A reminder therefore can never go stale when a bill is paid or edited.

### D14: Staff roles stay internal
v2 exposes only the owner (staff logins are out of scope). The role engine (`domain/rbac.ts`) and its server checks stay, because they cost nothing and keep a future staff feature safe. The owner can always write any day: the old "day lock" applies to internal roles only. A closed day that gets a back-dated cash entry is flagged "re-check" (§7.1) instead.

### D15: Op groups
Every op written in one local transaction carries the same `opGroup`. The device sends a group whole, and the server applies it in ONE Mongo transaction (all or nothing; the other members get `GROUP_FAILED`). A bill and its initial payment can therefore never be half-synced (§17).

### D16: The v1 screens were removed in v2 Phase 2
The v1 UI was built on the v1 data model and is replaced by the 8 v2 sections in Phases 4–11. Between Phase 2 and those phases the app has only the shell, Home, Sync, login and unlock. The cold-offline e2e covers exactly these routes until the sections return.

### D17: Password recovery signs out every other session
A recovery-code reset (or the CLI reset) deletes all refresh tokens of the user. Other phones must log in with the new password; their local data and unsynced entries are untouched. **Why:** a forgotten password may also mean a lost phone.

### D18: A Gola can be deleted only while it has no transactions
`POST /api/godowns/delete` refuses with `HAS_TRANSACTIONS` once any document exists. Otherwise the Gola is archived (read-only), which keeps every book intact (§2.2).

### D19: Animations with CSS keyframes, not the `motion` package
`motion` (LazyMotion) was installed and measured: Turbopack put 47 KB gzipped of it on the start-up path, which pushed Home JS to 291 KB against the 250 KB budget. The §15.3 animations (page, tab and Gola fade + 8 px slide in 200 ms, 35 ms stagger, count-up 700 ms with exact bigint end values, press scale 0.97, skeleton shimmer, tab and nav colour transitions) are now done with tw-animate-css keyframes and `requestAnimationFrame` in `components/motion/Motion.tsx`. Reduced motion → instant. Home JS is 238 KB. A heavier animation (e.g. charts) can still load `motion` lazily inside its own chunk.

### D20: Transitional "being built" tabs
During v2 Phases 4–11 the 8 sections and their tabs exist (navigation, offline precache, tests). Tabs whose screens arrive in a later phase show `NotBuiltYet`, and the quick-add button offers only actions whose screen exists (`QUICK_ACTIONS[].ready`). Phase 12 checks that no `NotBuiltYet` and no unready quick action remain.

### D9: Payment modes CASH / BANK / UPI only
v1 modes CHEQUE, DD, BANK_TRANSFER and OTHER are migrated to BANK, with the bank account kept. The `CHEQUE_IN_HAND` stage disappears. This is an intentional v2 semantic change, listed in the migration report.

### D21: Farmer account offers per-bill payment and advance; "pay across bills" waits for Due & Advance
In Purchase → কৃষকের হিসাব a farmer's dues are paid from each purchase ("+ বাকি টাকা দিন"), and an advance can be given. One amount spread over several open bills, oldest first (`allocateFifo`, §12.6), belongs to the Due & Advance section and arrives in Phase 10. Until then nothing is allocated automatically, so no money can land on the wrong bill.

### D22: Paying more than a bill's due
`payBill` refuses with `OVERPAYMENT` (the extra amount in `detail`). The sheet then says how much is extra and offers "keep the extra as advance". Only after that tap is the payment split: the due part against the bill, the rest as a party advance (`splitOverpayment`). An initial payment larger than the bill total is refused outright on the form.

### D23: Bank account opening balance
A new bank account with an opening balance writes one OPENING document (kind BANK) dated the day it is added, in the same transaction as the account. Editing the account later never re-posts the opening; a wrong opening is corrected with a CONTRA or a stock/opening correction in the Dashboard (Phase 8).

### D24: Seeded variety names carry the public variety code
The seeded varieties show their common code where one exists ("স্বর্ণ (MTU-7029)", "শতাব্দী (IET-4786)") and IR-36 was added, so that "স্বর্ণ" and "লাল স্বর্ণ" are easy to tell apart in the picker. These are display names (i18n); the stored `systemKey` is unchanged.
### D25: Direct delivery and the sale's source
A sale "সরাসরি (কেনা থেকে)" picks one open direct-delivery purchase (stored at TRANSIT). The sale takes that purchase's group id (`purchase.groupId ?? purchase._id`), so it takes exactly that paddy at that cost and never touches the warehouse. Rice is always sold from the Gola. "মিল থেকে" needs the mill; the link to a consignment dispatch comes with Phase 9.

### D26: Inter-Gola transfer
Owner only, paddy only. One Dexie transaction and one op group write a CONFIRMED SALE in the sending Gola and a PURCHASE (stored) in the receiving Gola at the same rate, with one shared groupId and `interGola` on both. Each Gola sees the other as a party with role GOLA (created on first use; `linkedGodownId`), so A is owed and B owes until a payment settles it through the normal payment screens. The variety is matched in the receiving Gola by seed key or normalized name + company, or copied. A transfer is never edited: "গোলা বদল বাতিল করুন" voids both halves together (blocked while either has active payments). **Why:** both books must change together or not at all.

### D27: Sale delivery steps and orders
Delivery status is a timeline (PENDING → LOADED → IN_TRANSIT → DELIVERED). Each step is an edit of the sale that appends `{status, at, note?}` to `deliveryLog`; it never moves stock or money. An ORDER posts nothing (D3). "অর্ডার নিশ্চিত করুন" edits it to CONFIRMED, which takes the stock out once. An advance taken on an order is a normal IN payment against the sale and shows as the buyer's advance until the order is confirmed.

### D28: Negative stock warning on sales
When a confirmed sale needs more than the position holds (all dates, this sale excluded), the form shows the stock and the need and saves only after "তবুও সেভ করুন" (§9.3). The integrity check lists negative positions (Phase 12).
### D29: Daily Expenses day view
"আজকের খরচ" shows any day (◀ ▶, today by default). "এই দিনের খরচ" = expenses by expense date, grouped by category. "এই দিনে টাকা গেল" = every payment made that day for expenses (whatever the expense date) plus farmer payments, with the cash part separately. Farmer payments (PURCHASE payments, and advances to FARMER/SUPPLIER parties) are listed in their own block with a "পেমেন্ট" badge and are never added to expenses (§7.3).

### D30: Farmer payment from the expense form
Choosing "কৃষক পেমেন্ট" turns the form into the farmer-payment flow: farmer (create inline) → one open purchase (its due is filled in) or "অগ্রিম" → payment fields. It saves through `payBill` / `payAdvance`, so it is exactly the same record as a payment made from the purchase screen. Paying more than the bill's due asks "keep the extra as advance" (D22). Expense documents with `FARMER_PAYMENT` are refused (`CATEGORY_IS_PAYMENT`).

### D31: Expense categories
Built-in categories (§12.4) render through i18n and can be hidden, not renamed. Custom categories get a generated immutable code (`U_…`) and a typed name, and can be renamed or hidden. "কৃষক পেমেন্ট" can't be hidden. A hidden category stays valid for old expenses.
### D32: Dashboard tabs load on demand; dead v1 strings removed
The Overview, Cashbook, Stock and Daily Overview tabs are `next/dynamic` chunks (precached by the service worker, so they open offline), and recharts loads only inside the chart. 35 v1 i18n namespaces with no remaining use (old screens removed in Phase 2) were deleted from `bn.ts` / `en.ts`; the Bengali dictionary is on the start-up path. Home JS went from 246.5 KB to 237.9 KB. Partly used v1 namespaces are cleaned in Phase 12 with the i18n-usage test.

### D33: Dashboard money cards follow the cashbook
"নগদ পেলাম" / "নগদ দিলাম" use the same classifier as the cashbook (§7.3): received includes bank → cash withdrawals and capital brought in as cash; paid includes farmer and other payments, deposits, drawings and cash expenses. So the card always equals the cashbook total for the same range. Receivables = positive balances of customer / mill / vehicle-customer / Gola parties; farmer payables = negative balances of farmer / supplier parties; mill payable = negative balances of mill parties.

### D34: Opening cash and opening stock
"শুরুর নগদ বসান" writes one OPENING (CASH) document for the Gola, once. Later corrections are cash moves or day-close differences. Opening stock is entered per variety (qty + value per quintal) from the Stock tab as OPENING (STOCK) documents, dated the viewed day.

### D35: Correcting a cashbook line
Lines from a purchase, sale, expense or payment open their detail page (edit / reverse there, audited). Cash ↔ bank, capital and drawings have no detail page: "সংশোধন" voids the entry with a reason and the user enters the right one. Every following day recalculates either way.

### D36: Day close and reopen
Closing writes a DAY_CLOSE with the expected cash at that moment, the counted cash and the difference (note required when ≠ 0; denomination counts kept). The difference posts to CASH_DIFF, so the next day's opening equals the counted cash. Only the owner reopens (the close is voided with a reason). An entry dated on a closed day shows "পরে এন্ট্রি হয়েছে — আবার মেলান"; "আবার মেলান" reopens the day so it can be counted again.