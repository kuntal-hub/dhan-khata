# Client open questions: defaults being built

The client has not answered these yet (spec §22 and the [CONFIRM] tags). We build the **default** for each one. Whenever a phase implements an item, it fills in **Where in code**, so that changing it later after the client answers is a small, local edit.

| # | Question | Default being built | Phase | Where in code |
|---|---|---|---|---|
| 1 | Is the ধলতা (dhalta) deduction per quintal, per bag, or fixed? Is a moisture cut applied to farmers? | Per quintal on gross weight. Moisture is optional and applied on (gross − tare). All three dhalta modes are supported. | 1 | `src/domain/calc/trade.ts` → `computeDeductions` (order + modes); default mode in `defaultGodownSettings` (`src/domain/schemas/system.ts`) |
| 2 | Does the client quote prices in মণ (40 kg)? | Quintal only. মণ display is optional (off). | 1/3 | i18n key `units.maund` only; no মণ maths yet (Phase 3 input helper if confirmed) |
| 3 | Round bills to the nearest rupee? | Yes, shown as a separate round-off line (`roundToRupee` godown setting). | 1 | `computeBill` in `src/domain/calc/trade.ts`; per-voucher `roundToRupee` flag; default `rounding.roundToRupee: true` in `defaultGodownSettings` |
| 4 | "Party Sell": does the broker sometimes act only as an agent on commission? | Both modes are supported. `OWN_TRADE` is the default and `AGENT` books commission only. | 1/3 | `LoadVoucher.mode`; `src/domain/calc/load.ts` (`loadLinkedDrafts`); `post.ts` LOAD case |
| 5 | In the mill payment section, is the bank account the mill's or ours? | Record both: `ourBankAccountId` and `theirBankText`. | 3 | Both fields in `MoneyVoucherShape` (`src/domain/schemas/vouchers.ts`); form in Phase 3 |
| 6 | Who pays freight: broker or mill? Does the mill pay the driver directly and deduct it? | Chosen per sale (`delivery.payer`: US / MILL / BUYER). | 1/3 | `src/domain/posting/post.ts` SALE case (US: we owe transporter; MILL: mill paid driver & deducts from our bill; BUYER: nothing); `calc/sale.ts` due/summary |
| 7 | When an own vehicle carries the client's own load, charge internal freight or record costs only? | Costs only, with no freight income line. | 1/4 | `src/domain/calc/trip.ts` (`ownTradeLoadId` → due 0) + `post.ts` TRIP case (no VEH_INCOME line) |
| 8 | How many staff and devices? Should field staff see amounts and rates? | The `entry` role sees only its own entries plus today's dashboard. Entries can't be edited after 30 min or after sync. | 2/3 | |
| 9 | Should voucher numbers restart every financial year? | No (format `RP-A-PUR-000123`). | 1 | `src/domain/numbering.ts` → `formatVoucherNumber` (add FY segment there if confirmed) |
| 10 | Should the dashboard show profit? | Owner only, behind a hidden toggle. | 4 | |
| 11 | Pay for Vercel Pro (about $20/month) or stay on Netlify Free? | Netlify Free. | 5 | |
| 12 | Does paddy or money ever move between the client's own godowns? | Supported through the inter-godown transfer wizard (a SALE/PURCHASE or PAYMENT/RECEIPT pair). | 1/4 | Party role `godown` + `linkedGodownId` (`schemas/masters.ts`); posts as a normal SALE/PURCHASE pair sharing `groupId` (see `transferArb` in `tests/property/posting.property.test.ts`); wizard in Phase 4 |
| 13 | Are bank accounts and vehicles shared between godowns in real life? | They are registered separately in each godown. Each tracks only its own transactions. | 2/3 | |
| 14 | Should a trusted manager also see the "All godowns" view? | Owner only by default. It can be granted through the `consolidated` permission. | 2/4 | |
| 15 | Does any godown have several sheds that need separate stock? | One stock per godown. Sheds are a v2 feature. | — | |
| 16 | Which language does each staff member prefer? Should farmer receipts be Bengali-only or bilingual? | UI in Bengali, receipts in Bengali, both switchable. | 1/3 | Default `lang: "bn"` in `localeSlice` (`src/store/slices.ts`); `Godown.receiptLanguage` |
| 17 | `entry` role edit window (§2) | 30 minutes, or until synced | 2 | |
| 18 | Mill TDS (§3.6) | Recorded only, as an optional "TDS deducted" field on receipts. | 1/3 | `ReceiptVoucherSchema.tdsPaise`; `post.ts` RECEIPT → `TDS_RECEIVABLE` |
| 19 | All-godowns view: show inter-godown party balances (§9.1) | Shown in a separate row. No elimination. | 4 | |
