# Gap analysis: v1.1 build → Requirement v2 ("Dhan Gola")

Source of truth: `requirement_v2.md` (repo root). Branch: `feat/dhan-gola-v2`.
Status legend: **done** (meets v2) · **partial** (exists, needs changes) · **missing** · **conflicts** (v1.1 behaviour contradicts v2 and must be replaced).
The "Phase" column is the v2 phase (see `docs/PROGRESS.md` → "v2 plan") that closes the row.

Audit date: 2026-11-25. Updated at the end of each v2 phase.

## Deployed data (Step 0.3)
The configured Atlas database (`MONGODB_DB=dhankhata`) holds **demo-seed data only**: godowns RP "রামপুর গোডাউন" and SN "সোনাপুর গোডাউন", the demo owner (phone 9000…), the three demo staff numbers from `scripts/demo-seed.ts` (9830011102–04), all created on 2026-11-24 between 17:12 and 17:33 UTC (233 vouchers, 29 parties). Following the ground rules, it is still treated as **potentially real**: `scripts/migrate-v2.ts` (dry run by default) is written and run against a copy first. **Nothing destructive is run without the owner's confirmation.**

## Summary of the big conflicts

| Area | v1.1 build | v2 requirement | Resolution |
|---|---|---|---|
| Navigation | 5 bottom tabs (হোম · ক্রয় · বিক্রি/লোড · খাতা · আরও) + ~20 screens behind "আরও" | Exactly 8 sections with internal tabs; settings/profile/Gola/bank in the avatar menu | New shell (Phase 4); old routes are folded into section tabs or removed |
| Design | Plain shadcn, "minimal animation" | Premium design, Forest Green / Paddy Gold / Ivory, `motion`, count-up, animated charts | New tokens, logo, motion layer (Phase 4) and per-section screens (Phases 5–11) |
| Payments | `paidNow` / `advanceReceived` / `vehicleAdvance` fields + separate PAYMENT/RECEIPT vouchers with `allocations` | One unified `Payment` (direction, `paymentDate`, `source {type,id}`, `isInitial`); paid/due derived | New PAYMENT document (Phase 1), migration (Phase 2) |
| Expenses | Expense = immediate payment (or `onCredit`) | Expense incurred (`expenseDate`) separate from payments; status derived | New EXPENSE posting + payments (Phases 1, 7) |
| Dates | one `date` per voucher | `transactionDate`, `expenseDate`, `dispatchDate`, `returnDate`, `conversionDate`, `paymentDate`, `dueDate`, `entryDate` | Per-type date fields + `businessDate(doc)` (Phase 1) |
| Mill | SALE to mill + MILL_SETTLEMENT | Mill Dispatch (MILLING/CONSIGNMENT, never a sale), Mill Return, Conversion, Consignment settlement → Sale; MILL location | New documents + stock engine (Phases 1, 9) |
| Load khata | LOAD auto-creates PURCHASE + SALE (or AGENT commission) | Register only, no money/stock; 1:1 link to a sale or dispatch | New LOAD semantics + migration keeps generated records as linked (Phases 1, 2, 10) |
| Accounts | Seed-script owner, staff roles, no registration/recovery | Registration (auto-closing), recovery code, forgot password, CLI reset, sessions, profiles | Phase 3 |
| Units | kg / quintal input; no mon; bags × average helper | kg / qtl / mon (40 kg configurable); bag-wise individual weights | WeightBlock + units (Phase 1), `WeightInput` (Phase 4/5) |
| Deductions | Always shown in trade lines | Optional, collapsed, OFF by default | Setting + collapsed block (Phase 5) |
| Stock | variety × {STORE, TRANSIT}; single product | product (PADDY/RICE/OTHER) × location (WAREHOUSE/MILL/TRANSIT) × mill; verification; low-stock | Stock engine v2 (Phase 1), Daily Stock tab (Phase 8) |

## Row-by-row

### §0–§1 Rules, product, glossary, calendar
| § | Requirement | Status | Files | Planned change | Phase |
|---|---|---|---|---|---|
| 0.2 | Integer paise/grams, no floats | done | `src/domain/{money,weight,decimal,rounding}.ts`, `scripts/check-no-float.mjs`, ESLint | Keep; extend to new modules | 1 |
| 0.2 | One financial event = one record (unified payments) | done (data layer) | `schemas/vouchers.ts` (`paidNow`, `advanceReceived`, PAYMENT/RECEIPT `allocations`) | Unified PAYMENT doc with `source` | 1–2 |
| 0.2 | Stock & balances derived | done | `posting/*`, `queries/*` | Keep (derived lines/moves) | — |
| 0.2 | Strict Gola separation | done | `domain/scope.ts`, server `applyOp` | Keep; add `businessId` checks | 2 |
| 0.2 | Credit purchase/sale doesn't move cash | done | `posting/post.ts` | Keep in v2 posting | 1 |
| 0.2 | Paddy/rice/other never combined | done (engine) | — | `product` dimension | 1 |
| 0.2 | Exactly 8 navigation sections | done | `components/layout/nav.tsx`, `(app)/more` | New shell | 4 |
| 0.2 | No dummy buttons / hard-coded data | partial | Home stubs, "coming soon" badges in `more/page.tsx` | Remove during section rebuilds | 4–12 |
| 0.2 | Bengali default + full English | done | `src/i18n/*` | New keys for every new screen | all |
| 0.2 | Offline-first | done | Dexie, outbox, Serwist | Keep; cold-offline test for 8 sections | 12 |
| 1.1 | App name "Dhan Gola / ধান গোলা" | done | `manifest.ts`, `layout.tsx`, i18n `app.name`, `.env*`, receipts | Rename everywhere | 4 |
| 1.2 | Glossary / Gola terminology | done (dictionary pass; native review Phase 12) | `bn.ts` uses "গোডাউন" | Replace with "গোলা" in UI strings | 4 |
| 1.3 | IST dates, FY, season tag | done | `domain/dates.ts` | Keep | — |

### §2 Accounts, auth, Golas
| § | Requirement | Status | Files | Planned change | Phase |
|---|---|---|---|---|---|
| 2.1 | Business entity (profile, logo) + `businessId` on docs | done | — | `Business` doc; `businessId` on all docs; server checks | 2–3 |
| 2.2 | Registration while no owner; `REGISTRATION_CLOSED`; `ALLOW_REGISTRATION` | done | `scripts/seed.ts` only | `/api/auth/register`, `/register` screen, env flag | 3 |
| 2.2 | Recovery code (shown once, hashed) | done | — | generate/hash/verify/regenerate | 3 |
| 2.2 | Login with show/hide, rate-limited | done | `(auth)/login`, `server/auth.ts` (rate limit done) | Show/hide toggle, new design | 3 |
| 2.2 | Forgot password + `pnpm admin:reset-password` | done | — | `/forgot` + `/api/auth/recover` + CLI | 3 |
| 2.2 | Logout blocked while unsynced | done | `client/auth/session.ts` | Keep; add "export unsynced" | 3 |
| 2.2 | Sessions list + revoke | done | admin devices route, settings users page | Owner "Sessions" screen in avatar menu | 3 |
| 2.2 | User profile (name, mobile, password, language, digits, PIN) | done | settings page, `/api/me/*` | Profile screen | 3 |
| 2.2 | Business profile + logo upload | done | godown letterhead only | Business profile screen + small logo asset | 3 |
| 2.2 | Gola create/edit/archive (+ colour, low stock, delete only when empty) | done | `GodownWizard`, `/godowns`, `godownService.ts` | Move into avatar menu; colour; low-stock thresholds; delete blocked | 3 |
| 2.2 | Staff logins out of scope | done (staff UI removed; roles internal, D14) | roles UI, `/settings/users`, entry-role gates | Hide staff UI; keep roles internally | 3 |
| 2.3 | Gola switcher in header + Dashboard, colour chip, cross-fade ≤250 ms | done | `GodownSwitcher*` | Colour chip, motion cross-fade | 4 |
| 2.3 | Form title shows Gola; switching with dirty form asks | partial | `FormShell` shows godown | Confirm on switch with dirty form | 4 |
| 2.3 | Combined (all Golas) read-only view | done | `queries/consolidated` | Rebuild as side-by-side + total in Dashboard & reports | 8 |
| 2.3 | Parties per Gola + "copy from other Gola" | done | `PartyForm` | Keep | — |
| 2.3 | Inter-Gola transfer = linked sale + purchase | done | `repo/sales.ts` `saveInterGolaTransfer` (one op group across both Golas) | Keep paddy transfer as Sales action; money transfer via payments | 6 |
| 2.4 | Server checks session/owner/godown/same-Gola refs (+ businessId) | done | `applyOp.ts`, `scope.ts` | Add `businessId` | 2 |

### §5–§9 Core engine
| § | Requirement | Status | Files | Planned change | Phase |
|---|---|---|---|---|---|
| 5 | Documents + payments → pure postLedger/postStock | done | `posting/post.ts`, `derive.ts` | v2 document union + new posting | 1 |
| 5 | Edit = new revision, derived rows replaced atomically | done | `repo/vouchers.ts`, `derive.ts` | Keep | — |
| 5 | Void (soft) with reason, excluded from totals | done | repo `voidVoucher` | Keep | — |
| 5 | Linked records edited/voided together or blocked with message | done (repo/server; dialog Phase 4+) | `saveVoucherWithLinked` | Payments linked by `source`; block/cascade dialog | 2, 5 |
| 6.1 | Storage units; parse rejects >2 dp money / >3 dp kg | done | `decimal.ts`, `client/ui/parse.ts` | Keep | — |
| 6.2 | kg / quintal / mon (monKg configurable) + 3-unit display line | missing | `i18n/parse.ts` (qtl + kg) | `domain/units.ts`, `UnitToggle`, `QtyTriple` | 1, 4 |
| 6.3 | WeightBlock (bag-wise / manual), avg bag | done (domain) | `TradeLine` (gross + deductions) | `domain/weightBlock.ts` | 1 |
| 6.3 | Deductions optional, off by default | done (setting \usiness.settings.deductionsEnabled\; block shown only when on) | trade lines always deduct | `deductions?` in WeightBlock + setting | 1, 5 |
| 6.3 | Closing paddy/mill formulas, vehicle net profit | missing/partial | `calc/vehicle.ts` | Stock engine v2, `calc/trip` v2 | 1 |
| 6.4 | Golden G1–G8 | done | `tests/unit/golden.test.ts` (G1, G4–G7 equivalents) | Add G2 (mon), G3 (bags), G8 (cashbook) | 1 |
| 6.4 | Property tests (balanced, void restores, edit-back, Gola isolation) | done (v2) | `tests/property/*` | Re-target to v2 documents | 1 |
| 7.1 | Separate date fields + entryDate | done | single `date` | Per-type dates, `businessDate()`, `entryDate` | 1 |
| 7.1 | Future business dates blocked (except dueDate) | partial | `validateVoucherRules` | Keep for v2 | 1 |
| 7.1 | Backdated entry on closed day → "re-check" | done | `dayStatus.lateEntry` → Cashbook banner + reopen | Recheck flag computed from day-close vs later entries | 8 |
| 7.2 | Unified Payment model | done | PAYMENT/RECEIPT vouchers | New PAYMENT document | 1 |
| 7.2 | Overpayment → split bill + PARTY_ADVANCE with shared groupId | missing | — | `splitPayment()` domain helper | 1 |
| 7.2 | Payment receipt (bilingual, logo, words) | partial (purchase + payment receipts done in Phase 5; others Phase 11) | `print/Receipt.tsx` | Re-target to Payment | 11 |
| 7.3 | Cashbook classifier (received / paid / expenses; farmer payment = paid) | done (domain) | `queries/cashbank.ts` (account book) | `domain/cashbook.ts` | 1 |
| 8 | Chart of accounts per Gola incl. STOCK_PADDY/RICE/OTHER/AT_MILL, EXP_PAYABLE, MILLING_* | partial | `posting/accounts.ts` | New account keys | 1 |
| 8 | Event → posting table | done | `post.ts` | Rewrite for v2 events | 1 |
| 9.1 | StockMove product/location/mill/bags | done | `StockMove` (variety, STORE/TRANSIT) | New move shape | 1 |
| 9.2 | Movement rules per transaction | done | `post.ts` | v2 rules | 1 |
| 9.3 | No silent negative stock ("Save anyway") | partial | integrity check | `wouldGoNegative()` + UI confirm | 1, 5–9 |
| 9.3 | Date-wise stock ledger | done | `components/dashboard/StockTab.tsx` (any date, per variety, 14-day history) | Per product/location | 8 |
| 9.3 | Physical verification + reasoned adjustment | done | `approveStockCount` + Stock tab | Count → approve | 8 |
| 9.3 | Low-stock alerts per Gola | done | `lowStockAlerts` + Overview (threshold on Gola edit) | thresholds on Gola + dashboard alert | 8 |

### §10 Data model
| § | Requirement | Status | Files | Planned change | Phase |
|---|---|---|---|---|---|
| 10 | BaseDoc incl. `businessId`, `entryDate` | done | `schemas/common.ts` | Add fields | 1–2 |
| 10 | Party roles v2 (FARMER, SUPPLIER, CUSTOMER, MILL, SECOND_PARTY, VEHICLE_CUSTOMER, DRIVER, LABOUR, OTHER), mobile, address, opening balance | done (schema) | `schemas/masters.ts` (lowercase roles) | New role enum + migration mapping | 1–2 |
| 10 | Variety: company, product, normalizedKey, verified, lastUsedAt | done | `VarietySchema` | Extend + dedupe | 1, 5 |
| 10 | Vehicle (OWN/EXTERNAL, driver) | partial | `VehicleSchema` | Keep shape, add driver fields | 10 |
| 10 | Purchase/Sale/Expense/Load/MillDispatch/MillReturn/Conversion/ConsignmentSettlement/Trip/SecondParty/StockCount/DayClose/Contra/Reminder/AuditLog | done (schemas; D5 settlement = sale, StockCount = STOCK_ADJUST lines) | `schemas/vouchers.ts` | v2 document union (see DECISIONS D1) | 1 |
| 10 | Indexes prefixed `businessId, godownId` | done | `server/db.ts` (godownId only) | Add businessId to compound indexes | 2 |

### §11 Navigation & §12 Sections
| § | Requirement | Status | Files | Planned change | Phase |
|---|---|---|---|---|---|
| 11 | 8 sections, desktop sidebar, mobile bottom bar (4) + "All sections" sheet | done | `nav.tsx`, `AppShell.tsx` | New shell | 4 |
| 11 | Header: switcher, sync badge, search, bell; avatar menu (profile, business, Golas, banks, settings, language, logout) | partial | `UserMenu`, `GodownMenu`, `SyncBadge`, `ReminderBadge` | Restructure avatar menu | 4 |
| 11 | Floating quick-add (8 actions) | partial | Home FAB sheet | New FAB with v2 actions | 4 |
| 12.1A | Overview cards (14), charts, recent, due & low-stock alerts, quick actions, date filters, combined | done (Gola-wise / combined report shortcuts come with the reports tab, Phase 11) | `components/dashboard/Overview.tsx`, `queries/dashboard.ts`, `consolidated/dashboard.ts` | Rebuild with range filters + charts | 8 |
| 12.1B | Daily Cashbook (opening/received/paid/expenses/expected/actual/diff, formula, itemised, correct, day close, reopen, bank toggle, contra, drawings/capital) | done | `components/dashboard/Cashbook.tsx`, `repo/daily.ts` | Cashbook tab over the v2 classifier | 8 |
| 12.1C | Daily Stock (paddy/rice/other, mill block, verification, history) | done | `components/dashboard/StockTab.tsx` | Stock tab | 8 |
| 12.1D | Daily Overview table | done (Excel/CSV export Phase 11) | `components/dashboard/DailyOverview.tsx`, `dailyRows` | New query + tab | 8 |
| 12.1 | Dashboard reports tab (business-wide, Gola-wise, combined) | partial | `/reports` | Move into Dashboard → রিপোর্ট | 8, 11 |
| 12.2 | Purchase form (bag-wise, variety picker, initial payment, due date) | done | `PurchaseForm.tsx`, `LinesEditor.tsx` | New form | 5 |
| 12.2 | Purchase detail (payment ledger, add due payment, receipts, audit) | done | `VoucherView.tsx` | New detail page | 5 |
| 12.2 | Purchase list (search, filters incl. paid status, totals) | done | `/purchase`, `VoucherList` | New list | 5 |
| 12.2 | Farmer history | done | `PartyProfile.tsx` | Purchase → কৃষকের হিসাব tab | 5 |
| 12.2 | Variety management (companies, duplicate prevention, recents, merge, seed verified) | done | `settings/masters` | New tab | 5 |
| 12.3 | Sale form (product, advance as payment, delivery, Order/Confirmed, source, charges collapsed) | done | `components/sales/SaleForm.tsx` | New form | 6 |
| 12.3 | Collections, invoice, delivery tracking, customer ledger | done | `/sales/view`, `/print/sale`, `/sales/customer`, `?tab=delivery` | New | 6 |
| 12.3 | Inter-Gola transfer action | done | `/sales/transfer` | Inside Sales | 6 |
| 12.4 | Expense categories incl. Farmer payment special flow | done | `components/expenses/ExpenseForm.tsx`, `category.tsx` | Rebuild | 7 |
| 12.4 | Incurred vs paid, backdated payments, unpaid list | done | `queries/expenses.ts`, `ExpenseTabs.tsx`, `/expenses/view` | New flow | 7 |
| 12.5 | Load khata = register, link/create sale or dispatch, slip | conflicts | `LoadForm.tsx`, `calc/load.ts` | Rebuild | 10 |
| 12.6 | Due & Advance unified view, tabs, ledger, FIFO allocation, aging, reminders, WhatsApp | partial | `/due`, `/reminders`, `queries/parties.ts` | Rebuild over payments | 10 |
| 12.7 | Vehicle trips with multiple collections, driver/diesel/other costs with payments, net profit, daily/monthly | partial | `TripForm.tsx`, `/vehicle` | Rebuild | 10 |
| 12.8A | Second Party ledger | done | `components/mill/*`, `/mill/party`, `/mill/entry/*`, `queries/mill.ts` (statement print: Phase 11) | New | 9 |
| 12.8B | Mill Dispatch (MILLING / CONSIGNMENT) | done | `DispatchForm`, `/mill/dispatch/*` (dispatch-wise balance) | New | 9 |
| 12.8C | Mill Return (paddy/rice/other, bag weights, duplicate check) | done | `ReturnForm`, `repo/mill.ts` (D37, D40) | New | 9 |
| 12.8D | Milling Conversion | done | `ConversionForm`, `/mill/conversion/*` | New | 9 |
| 12.8E | Consignment settlement → Sale | done | `SettleForm`, `settleConsignment` / `voidSettlement` (D38) | New | 9 |

### §13–§20
| § | Requirement | Status | Files | Planned change | Phase |
|---|---|---|---|---|---|
| 13 | Reports per section, header with business/logo/Gola, print A4 + 80 mm, xlsx + csv, image share | partial | `client/reports/*`, `(print)/*` | `ReportShell`; reports moved into sections; CSV | 11 |
| 14.1 | Voice input + Bengali/English number parser | missing | — | `domain/voiceNumber.ts` (Phase 1), `VoiceButton` (Phase 11) | 1, 11 |
| 14.2 | WhatsApp click-to-chat templates everywhere specified | partial (purchase detail, farmer account, payment receipt done) | `PartyProfile` তাগাদা | `WhatsAppButton` + templates | 10–11 |
| 15.1 | Logo SVG, icons, palette tokens, fonts | done | `globals.css`, `public/icons` | New tokens/logo | 4 |
| 15.2–15.3 | Premium components, animations, reduced motion | done (kit + CSS motion, D19; charts Phase 8) | — | `motion` LazyMotion | 4 |
| 15.4 | Non-technical UX: 48 px buttons, confirmations stating effect, calc on tap, undo | partial | `Computed` | `ConfirmDialog`, undo toast | 4+ |
| 15.5 | Responsive 360/768/1280 | done (shell) | mobile-first only | Sidebar + grids | 4 |
| 15.6 | Reusable components list | partial | `forms/*`, `money/*` | Build missing ones | 4–11 |
| 16 | Bengali default, toggle on login + avatar, natural WB terms, digits, key parity CI | partial | i18n | Terminology pass (গোলা, মণ, বস্তা…) | 4, 12 |
| 17 | Offline-first sync, conflicts never merged for money, **op groups** | done | `client/sync/*`, `applyOp.ts` (one op per tx) | Op groups applied in one Mongo transaction | 2 |
| 18 | Manifest name, shortcuts (নতুন কেনা, নতুন বিক্রি, খরচ, ক্যাশবই), icons | done | `manifest.ts` | Update | 4 |
| 19 | Security (argon2id, rate limits, recovery rate limit, audit incl. password reset/export) | partial | `server/auth.ts` | Recovery rate limit + audit actions | 3 |
| 20 | Ops: env `ALLOW_REGISTRATION`, `NEXT_PUBLIC_APP_NAME=Dhan Gola` | done | `.env.example` | Add | 3–4 |

### §21 Acceptance tests
| Test | Status | Planned |
|---|---|---|
| 1 Purchase payments | done (`v2-acceptance`, `tests/repo/payments.test.ts`, e2e `purchase.spec.ts` bn + en; cashbook screen check in Phase 8) | Domain (Phase 1) + e2e bn/en (Phase 5) |
| 2 Stock 126 / mill 20 | done (`v2-acceptance`, `tests/repo/{dashboard,mill}.test.ts`, e2e `mill.spec.ts` bn + en) | Domain (Phase 1) + e2e (Phases 8–9) |
| 3 Mill return 131 / 15 | done (`v2-acceptance`, `tests/repo/mill.test.ts`, e2e `mill.spec.ts` bn + en) | Domain (Phase 1) + e2e (Phase 9) |
| 4 Cashbook 30,000 / shortage 500 / excess 200 | done (`v2-acceptance`, `tests/repo/dashboard.test.ts`, e2e `dashboard.spec.ts` bn + en) | Domain (Phase 1) + e2e (Phase 8) |
| 5 Backdated expense | done (`v2-acceptance`, `tests/repo/expenses.test.ts`, e2e `expenses.spec.ts` bn + en; cashbook screen check in Phase 8) | Domain (Phase 1) + e2e (Phase 7) |
| 6 Partial sales collection | done (`v2-acceptance`, `tests/repo/sales.test.ts`, e2e `sales.spec.ts` bn + en) | Domain (Phase 1) + e2e (Phase 6) |
| 7 Two Golas + combined | done (Vitest; e2e Phase 12) | e2e (Phase 3/8) |
| 8 Persistence | done (Vitest; e2e Phase 12) | e2e (Phase 3/12) |
| 9 Security | done (`isolation.test.ts`, `account.test.ts`) | + businessId, second business (Phase 2/3) |
| 10 Edit & reversal | partial (property tests) | Phase 12 |
| 11 UX | missing | Phase 12 |
