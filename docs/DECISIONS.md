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
