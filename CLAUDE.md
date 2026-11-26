# Dhan Khata (ধান খাতা): project guide for Claude Code

Dhan Khata is an offline-first, bilingual (বাংলা / English) PWA for a paddy broker in West Bengal who runs several godowns. **Each godown is an independent business with its own books.** It is built with Next.js 16, Dexie (IndexedDB), MongoDB Atlas (free tier) and Serwist, and hosted on Netlify Free.

**Source of truth (v2 upgrade, branch `feat/dhan-gola-v2`): `requirement_v2.md`** ("Dhan Gola"). Where the old `requirement.md` (v1.1) or the v1 phase notes below conflict with v2, v2 wins. v2 progress: `docs/PROGRESS.md` → "v2 plan"; gaps: `docs/GAP_ANALYSIS.md`; decisions: `docs/DECISIONS.md`. `requirement.md` (v1.1) is about 1,280 lines, so **never read it whole**. Find a section with Grep, then Read it with `offset`/`limit`.

---

## How sessions work: "start phase N" / "continue phase N"

The build is split into 5 phases. Each one is described in `docs/phases/PHASE-N.md`.

When the user says **"start phase N"**:
1. Read `docs/PROGRESS.md`. If phase N-1 is not marked ✅, stop and tell the user what is still missing.
2. Read `docs/phases/PHASE-N.md` fully. Then read the `requirement.md` sections it lists, and only those (use Grep + offset reads).
3. Also read the **Handoff log** entries of earlier phases in `docs/PROGRESS.md`. They record deviations and decisions you must respect.
4. Mark phase N as 🟡 in `docs/PROGRESS.md`. Work through the checklist **in order**. Tick each item (`- [ ]` → `- [x]`) in PHASE-N.md as soon as it is done, so a cut-off session can resume.
5. When you implement a [CONFIRM] default, fill in its "Where in code" cell in `docs/CLIENT-DEFAULTS.md`.
6. Run every exit-criteria command in PHASE-N.md and fix failures until all are green. Never mark a phase done with failing tests. If something truly can't be done, record it under "Known issues".
7. Append a handoff entry to `docs/PROGRESS.md`: what was built, deviations from the spec or plan, known issues, and notes for the next phase. Mark the phase ✅.
8. Commit locally, one commit per phase. Never push:
   `git add -A` then `git commit -m "Phase N: <title>"`, with the Co-Authored-By trailer.

When the user says **"continue phase N"**: do steps 1–3, then resume from the first unticked checklist item.

Don't pull work forward from later phases (each phase file has a "Do NOT do in this phase" list). If a later phase needs a small stub now, add it and note it in the handoff.

---

## Non-negotiables (violating any of these is a bug)
1. **No floating-point math on money, weight, rate or percent.** Use `bigint` paise, grams, paise-per-quintal and basis points, through `src/domain` helpers (`divRoundHalfUp`). In JSON and IndexedDB these values are decimal strings. No `parseFloat`, `toFixed`, or `Number()` on amounts.
2. Every financial document produces **balanced ledger lines** via one pure `postLedger` / `postStock` in `src/domain/posting`, shared by client and server. The server recomputes them and rejects any mismatch (`CALC_MISMATCH`).
3. Every write goes to **IndexedDB + the outbox in one Dexie transaction** (through `src/client/repo` only). The UI never waits for the network.
4. Nothing leaves the outbox until the server acknowledges it.
5. Every page works on a **cold start with the network off**. All routes are static, with **no dynamic segments**: use `?id=` search params. Pages are client components that read Dexie.
6. **Godown isolation:** every business record has a required, immutable `godownId`. Every repo/query function takes `godownId` as a required argument. Nothing mixes godowns except the read-only consolidated module `src/client/queries/consolidated`. The server enforces the same rules (`CROSS_GODOWN_REFERENCE`, `GODOWN_IMMUTABLE`).
7. **No hard-coded user-facing strings.** Everything goes through i18n (`src/i18n/bn.ts` is the canonical shape, and `en.ts` must `satisfies Dictionary`). Server errors return **codes**, never sentences. Stored system data uses codes, never UI text.
8. When something is ambiguous, prefer the option that can never lose or alter money data. After that, prefer the simplest option for a non-technical Bengali user on a cheap Android phone.

## Conventions
- Package manager: **pnpm**. Pin exact versions.
- Use Node runtime route handlers only. No Vercel-only or Edge-only APIs. Host-specific config goes only in `/deploy/*`.
- Folder layout follows `requirement.md` §20: `src/app`, `src/domain` (pure, 100% tested), `src/client` (db, repo, sync, queries), `src/server`, `src/store` (Redux: UI/session state only, never DB copies), `src/components`, `src/i18n`, `tests/`.
- IDs are UUID v7, generated on the device. Business dates are `YYYY-MM-DD` in IST (Asia/Kolkata).
- Dexie migrations are **additive only**.
- Mobile-first: design at 360 px wide, tap targets ≥ 44 px, `inputMode="decimal"`, amounts in `tabular-nums`.
- Each phase writes the tests for the code it builds.

## Commands
Keep this list up to date.
- `pnpm dev`: dev server (http://localhost:3000)
- `pnpm build` / `pnpm start`: production build (`next build && serwist build serwist.config.mjs`, writes `public/sw.js`) and server
- `pnpm typecheck`: `tsc --noEmit`
- `pnpm lint`: ESLint, including the no-float rule (`src/domain`) and the no-JSX-literal rule (`src/app`, `src/components`)
- `pnpm check:no-float`: grep guard over `src/domain`. A line may opt out only with `// float-ok: <reason>`, and only for non-money integer indices.
- `pnpm test`: Vitest (unit + property). Component tests opt in with `// @vitest-environment jsdom`.
- `pnpm format` / `pnpm format:check`: Prettier
- `pnpm test:e2e`: Playwright suite: cold-offline + §13 acceptance, full daily flow bn/en, trade flow, dashboard, two-godown, visual snapshots at 360 px (run `pnpm build` first; boots an in-memory MongoDB + `next start` on :3100 via `tests/e2e/server.ts`). Visual baselines live in `tests/e2e/visual.spec.ts-snapshots/` (per platform; a missing one is written, not failed). After an intended UI change, delete them and re-run.
- `pnpm seed --owner-phone=… --owner-name=… [--owner-password=…] [--godown-name=… --godown-code=…]`: first-run seed (reads `.env`/`.env.local`)
- `pnpm icons`: regenerate PWA icons in `public/icons`
- `pnpm check:bundle`: Home route JS size (gzipped) after `pnpm build`; `node scripts/bundle-size.mjs --why` marks the libraries per chunk
- `pnpm lighthouse`: Lighthouse mobile audit of Home, logged in (after `pnpm build`; boots the e2e server). Fails below Performance 85 or when Chrome reports the app not installable
- `pnpm restore --file=backup.json [--db=…]`: restore an in-app JSON backup into an EMPTY database (`docs/RESTORE.md`)
- `pnpm fix:mill-direction [--apply] [--db=…] [--godown=…] [--decisions=…]`: one-off v2.1 repair of mill data (dry run by default; run on a copy first)

## Key building blocks (from Phase 1)
- Money and weight: `src/domain/{money,weight,decimal,rounding,digits}.ts`, plus `divRoundHalfUp` and `allocateProportional`.
- Voucher calcs: `src/domain/calc/*`. `recomputeVoucher`, `verifyVoucher` (returns CALC_MISMATCH paths) and `validateVoucherRules` are in `calc/recompute.ts`. Linked-voucher builders (`paidNowPaymentDraft`, `saleLinkedDrafts`, `loadLinkedDrafts`) return drafts.
- Posting: `src/domain/posting`. `post`, `postLedger` and `postStock` take a `PostingContext` (stock position before the voucher). `replay` + `StockBook` rebuild everything in canonical order. `toLedgerLineDocs` / `toStockMoveDocs` serialize the results.
- Scope: `src/domain/scope.ts` provides `collectRefs`, `checkSameGodown` and `assertGodownUnchanged`.
- i18n: `useI18n()` / `useT()` from `src/i18n/I18nProvider.tsx`, plus framework-free `translate()` (`src/i18n/translate.ts`) and formatters (`src/i18n/format.ts`). Cross-script search lives in `src/i18n/translit.ts`.
- Test factories: `tests/helpers/factory.ts` (`mk`, `line`) and `tests/property/arbitraries.ts`.
## Key building blocks (Phases 2–3)
- Writes: `src/client/repo` only. Single vouchers `createVoucher`/`editVoucher`/`voidVoucher`; screens use `savePurchase`/`saveSale`/`saveLoad`/`saveMoney`/`saveMillSettlement` (built on `saveVoucherWithLinked`). Masters: `upsertMaster`. Errors: `RepoError` → `t(errorKey(e))`.
- Reads: `src/client/queries/*` (all take `godownId`) + Dexie `useLiveQuery`; hooks in `src/client/hooks.ts` (`useActiveGodown`, `useGodownRole`).
- UI kit: `src/components/forms/*` (`FormShell`, pickers, fields), `src/components/money/*`, `src/components/lists/common.tsx`, `src/components/system/page.tsx` (`Fresh`, `PageSuspense`, `useParam`, `useWriteGodown`).
- Routes are static; ids via `?id=`. Wrap entry-form routes in `<Fresh>` (Next keeps visited routes alive with React Activity). In e2e use `vis(page, testId)`.
## Key building blocks (Phase 4)
- Writes: `saveSimple` (EXPENSE/CONTRA/TRIP/STOCK_ADJUST/OPENING), `closeDay` / `unlockDay` (`repo/daily.ts`), `saveTransfer` / `voidTransfer` / `acceptTransfer` (`repo/transfer.ts`). Dexie schema v2 adds `transfers` (pending receipts from the server).
- Reads: `queries/{dashboard,cashbank,expenses,vehicles,search}.ts`, `stockSummary` / `stockRegister`; all-godown views only in `queries/consolidated`.
- UI: `src/components/daily/*` (forms, DateNav, DayBanners), `src/components/dashboard/*`, `src/components/godown/GodownWizard.tsx`; generic voucher view `/voucher/view`.
- e2e helpers: `switchGodown`, `createGodownViaWizard`, `createParty`, `switchToEnglish`, `istDate`.
## Key building blocks (Phase 5)
- Reminders: repo `setReminderState` / `createManualReminder` (bill reminders auto-close when Settled); light reads in `queries/reminders.ts`. Web push: `src/server/push.ts` (digest), `/api/push/*`, SW `push` handler, `src/client/pwa/push.ts`.
- Reports: builders in `src/client/reports/defs.ts` (+ all-godown ones in `queries/consolidated/reports.ts`), registry `reports/registry.ts`, one model rendered on screen / print (`/print/report`) / Excel (`modelToSheets`). recharts only in `components/reports/ReportChart.tsx` (lazy).
- Admin/ops: `src/server/admin.ts` (integrity, storage, users, devices, app settings, prefs, backup/restore, compaction), routes in `server/routes/admin.ts`, client calls in `src/client/admin.ts`, cron `/api/cron/daily` + `/api/cron/storage` (header `x-cron-secret`). Integrity logic shared in `src/domain/integrity.ts`.
- Role views: `src/client/access.ts` decides what the `entry` role may SEE (screens via `mayOpenPath`, own vouchers via `mayViewVoucher`); enforced by `RoleGate` and `useMayViewVoucher` (`components/system/page.tsx`); `useViewScope()` in `client/hooks`. A new route is blocked for `entry` until added to `ENTRY_PATHS`. New voucher views/forms/lists must apply `useMayViewVoucher` / `visibleVouchers`.
- Diagnostics: Dexie v3 `clientErrors`, `(app)/error.tsx` boundary, upload + quick integrity after each sync (`src/client/diagnostics.ts`).
- Keep the Home route light: never import `@/client/repo`, `@/client/sync/*` (except `constants`), `@/client/admin` or a value from `@/domain/schemas` in modules reached by the (app) layout or Home; use `queries/*`, `domain/vehicleNumber`, `domain/godownSettings`, `components/vouchers/{paths,VoucherRow}`, `LazyBottomSheet`. Also keep out of that path: `sonner` (use `lazyToast` from `components/system/IdleToaster`), Radix dialog/dropdown/tabs (header menus load on tap via `layout/lazyMenu`), `@tanstack/react-virtual` (`lists/VirtualList`, not `lists/common`), `date-fns`, and `@/i18n/en` / `@/i18n/translateAll` (English loads lazily; `translate()` falls back to Bengali until it is in). Check with `pnpm check:bundle`.

## Key building blocks (v2 Phase 5)
- Bills + payments: `saveBillWithInitialPayment`, `payBill` (OVERPAYMENT → `extraAsAdvance`), `payAdvance`, `mergeVarieties`, `saveBankAccount` in `src/client/repo`; reads in `queries/purchases.ts`.
- Entry kit `src/components/entry/*` (DateField, PartyPicker, BankPicker, VarietyPicker, WeightBlockInput, PaymentFields / PaymentList / AddPaymentSheet); `components/kit/WhatsApp.tsx`; print views in `src/app/(print)` with `components/print/ReceiptSheet.tsx`.

## Key building blocks (v2 Phases 6–8)
- Sales: `repo/sales.ts` (delivery steps, confirm order, inter-Gola transfer = one op group across two Golas), `queries/sales.ts` (incl. `stockAvailable`). Expenses: `queries/expenses.ts` (day view, unpaid, farmer-payment bills). Dashboard: `queries/dashboard.ts` (one Gola) + `queries/consolidated/dashboard.ts` (sum), `repo/daily.ts` (day close / reopen, contra, opening cash / stock, stock count).
- Shared UI: `components/entry/{PartyAccount,docPath,docLabel}`; dashboard tabs are `next/dynamic` chunks (keep heavy code off Home).

## Key building blocks (v2 Phase 9, corrected in v2.1 — DECISIONS D53)
- **Mills pay the broker.** A dispatch is a receivable (Dr PARTY:mill / Cr MILL_SALES); collections are IN; a paddy return is a credit; the final settlement is a `MILL_SETTLEMENT` doc (MILL_DEDUCTION), never a sale; the conversion is stock-only. Never add a "mill payable".
- Payment direction comes only from `domain/v2/direction.ts` (`PAYMENT_DIRECTION`, `directionFor`, `assertPaymentDirection`), enforced in `validateDocRules` + `validateLinks` (device and server). Dispatch dues are netted with `millCredits` (pass it to `dueBillsOf`).
- Mill: `repo/mill.ts` (`saveMillReturn`, `findDuplicateReturn`, `saveMillSettlement`, `saveMillRefund`); dispatches and second-party entries use `saveBillWithInitialPayment`, conversions `saveDoc`. One settlement per dispatch (`settlementGuard`). Reads in `queries/mill.ts` (`dispatchMoney`, `dispatchBalance`). UI in `components/mill/*` (forms, `MillTabs`, `SettleForm` = `FinalSettlementForm`, `RefundSheet`, `common.tsx`), routes under `/mill/*`.
- On-account second-party money: `payAdvance(..., "SECOND_PARTY")` / `AdvanceSheet sourceType`.
- Data repair for v2.0 mill data: `pnpm fix:mill-direction` (`src/server/fixMillDirection.ts`; `docs/OPERATIONS.md` §6a).

## Key building blocks (v2 Phase 12)
- Header: `layout/HeaderTools` (search → `/search`, bell → due reminders), loaded lazily. Settings `/settings` (theme, links, Excel export, JSON backup, integrity check incl. `negativePositions`).
- Tests that guard the whole app: `tests/e2e/acceptance.spec.ts` (Tests 7, 8, 11: every tab of every section at 360 / 768 / 1280 px with no horizontal scroll), `tests/repo/edit-reversal.test.ts` (Test 10), `tests/unit/i18n*.test.ts` (key + placeholder parity, no unused keys). A new tab must fit 360 px (`min-w-0` on flexible flex children).

## Key building blocks (v2 Phase 11)
- Reports: add a `ReportDef` to `src/client/reports/defs.ts` (`REPORTS`); it appears in its section's রিপোর্ট tab (`LazyReports`), prints at `/print/report?r=<id>&from&to&opt`, and exports to Excel / CSV / image from the same `ReportModel` (exact cells). `printHrefOf()` builds print links (party statements use `party-ledger`).
- Voice: `components/voice/VoiceButton` (+ `VoiceText`); number fields take `voice`.

## Key building blocks (v2 Phase 10)
- Loads: `repo/loads.ts` (link both sides in one op group; `linkFromLoadItem` + `saveBillWithInitialPayment(..., { extra })` for create-from-load), `queries/loads.ts`, `components/loads/*`.
- Dues: `queries/dues.ts` (`partyDues`: remaining = ledger balance; use `dueBillsOf`, never `billsOf`, for anything "owed"), `payParty` (FIFO across bills), `components/dues/{DueTabs,PayAcross}`.
- Vehicles: `repo/trips.ts` (`saveTrip`), `queries/vehicles.ts`, `components/vehicles/*` (`VehiclePicker`, `TripForm`, `VehicleTabs`). i18n namespaces `ld`, `dues`, `veh` (the v1 `due` namespace still exists and would shadow a v2 `due`).

## Key building blocks (UI refresh, D52)
- Design tokens + component classes live in `src/app/globals.css`: section accents `.accent-<section>` (`--sa`/`--sb`), tones `.tone-{green,gold,in,out,warn,blue,violet}`, `.hero`, `.tile-accent`, `.bg-accent-grad`, `.glass`, `.surface`. Controls: `Button` (raised), `.tabbar` + `.tab` (underline, `aria-selected`), `.chip` (`aria-pressed`), `.choice` (`aria-checked`), `.seg` (small switch). Never style a tab or chip like a button, or the reverse.
- Motion: `anim-rise` / `anim-zoom` / `anim-pop` / `anim-grow-x` (CSS only; never add a JS animation library: start-up budget).
- Kit: `Panel` takes `icon` + `tone`; `MetricCard` / `TxnCard` take `tone`; `EmptyArt`.
- Charts: `components/charts/Donut` (SVG, legend + exact amounts), `LazyTrendChart` / `LazyBarsChart` from `components/charts/lazy` (recharts, lazy). Colours `var(--chart-1…8)` in fixed order (validated for colour blindness); keep an entity's colour stable, never by rank. Dashboard trend data: `golaTrend` / `trendFor`.

## Key building blocks (QA pass, 2026-11-26)
- Sign-in: login, register and recover all go through `signInWith` (`client/auth/session.ts`); a different user gets a wiped device and no PIN.
- Sheets + history: `client/ui/backStack.ts` defers a push while a release's `history.back()` is in flight (never call `history.pushState` for sheets yourself).
- Forms: `FormShell` scrolls the first new `role="alert"` into view after Save, so give every form warning / error `role="alert"`.
- Display helpers: `displayVehicleNumber` (domain/vehicleNumber) for any vehicle shown; `docTitle` / `docAmountPaise` (components/entry/docLabel) for mixed lists; `t()` localises every numeric placeholder; report columns that must not be summed take `noTotal`.
- `BankAccountForm` (components/entry) is the one bank-account form (page + inline in `BankPicker`).

## Environment notes
- Windows 11. **The Bash tool fails in this environment (fork errors). Use the PowerShell tool.**
- The project folder is **inside OneDrive** (the user chose to keep it there). `pnpm-workspace.yaml` sets `nodeLinker: hoisted` to avoid symlink problems. If `pnpm install` or a build fails with EPERM / EBUSY / file-locked errors, ask the user to **pause OneDrive sync** and retry.
- PowerShell 5.1 `Set-Content -Encoding utf8` writes a BOM. Write files with the Write/Edit tools, or with `[IO.File]::WriteAllText(..., (New-Object Text.UTF8Encoding $false))`.
- Next.js **16.4** has `cacheComponents` enabled. `AGENTS.md`, which `next dev` maintains, says to read `node_modules/next/dist/docs/` before using Next APIs. Prerender must be deterministic, so `src/app/providers.tsx` gates the whole app to the client: the static HTML is a splash, and the UI renders from the device. Keep it that way, because pages must never depend on server render.
- Node 24, pnpm 10, git 2.52.
- Client [CONFIRM] questions: build with the spec defaults, which are tracked in `docs/CLIENT-DEFAULTS.md`.
