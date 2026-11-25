# Build progress

Legend: ⬜ not started · 🟡 in progress · ✅ done (exit criteria green + committed)

## v2 plan ("Dhan Gola", `requirement_v2.md`, branch `feat/dhan-gola-v2`)

Gap analysis: `docs/GAP_ANALYSIS.md`. Decisions: `docs/DECISIONS.md`.

| Phase | Work | Exit criteria | Status |
|---|---|---|---|
| 0 | Audit, gap analysis | GAP_ANALYSIS.md | ✅ |
| 1 | Domain core (units, WeightBlock, Payment, dates, posting v2, stock engine, cashbook classifier, voice number parser) | G1–G8 + property tests; Tests 1–6 as domain tests | ✅ |
| 2 | Data layer & migration (Dexie v4, repo, server, op groups, businessId, `scripts/migrate-v2.ts`) | sync + isolation tests; migration dry-run reconciles | ✅ |
| 3 | Auth & Gola management | Tests 7, 8, 9 | ✅ |
| 4 | Design system & shell (8 sections) | visual review 360/768/1280 bn+en; 8 sections | ✅ |
| 5 | Purchase + Variety | Test 1 e2e | ✅ |
| 6 | Sales | Test 6 e2e | ✅ |
| 7 | Daily Expenses | Test 5 e2e | ✅ |
| 8 | Dashboard (overview, cashbook, stock, daily overview, reports) | Tests 2, 4 e2e | ✅ |
| 9 | Mill & Second Party | Tests 2, 3 e2e | ✅ |
| 10 | Load Khata, Due & Advance, Vehicle | linked load never double-deducts; Due totals == ledger | ✅ |
| 11 | Reports, print, export, voice, WhatsApp | reports reconcile with dashboard | ✅ |
| 12 | Hardening | all of §21 | ✅ |

## v1 build (requirement.md v1.1)

| Phase | Title | Spec phases | Status |
|---|---|---|---|
| 1 | Foundations & Domain Core | P0 + P1 | ✅ |
| 2 | Offline Data, Auth, Sync & PWA Shell | P2 + P3 + P4 | ✅ |
| 3 | Masters, Parties & Trade Flow | P5 + P6 | ✅ |
| 4 | Daily Money, Dashboard, Vehicles, Stock & Godowns | P7 + P8 | ✅ |
| 5 | Reminders, Reports, Export, Ops & Hardening | P9 + P10 + P11 (automatable) | ✅ |

After Phase 5, the remaining work is manual UAT with the client (see `docs/UAT-CHECKLIST.md`, which Phase 5 creates).

---

## Handoff log

Each phase appends one entry using this template. Next sessions **must** read every entry before starting.

```
### Phase N — <title> — <YYYY-MM-DD>
**Built:** short bullet list of what now exists (key files/modules).
**Deviations from spec/plan:** what was done differently and why.
**Known issues / TODO carried forward:** …
**Notes for next phase:** APIs, helpers, gotchas the next session should know.
**Exit criteria results:** commands run + pass counts.
```

<!-- entries below -->


### Phase 1 — Foundations & Domain Core — 2026-11-23
**Built:**
- Project setup: Next.js 16.4.6 (App Router, TS strict + `noUncheckedIndexedAccess`, `src/`, Tailwind 4.3), shadcn/ui on Radix (button, input, label, card, drawer/vaul, dialog, dropdown-menu, sonner, tabs, badge), lucide, next-themes, and a Redux Toolkit store (`src/store`: session, activeGodown, locale, sync, ui). Prettier, Vitest 5 + fast-check, `.github/workflows/ci.yml`.
- Guards: ESLint no-float rules for `src/domain` (parseFloat, Math rounding, toFixed/toPrecision, float literals); `react/jsx-no-literals` for `src/app` and `src/components` (except `ui/`); `scripts/check-no-float.mjs` (also flags `Number(`, with a `// float-ok:` escape for non-money indices). I checked that both rules fire.
- Domain (`src/domain`):
  - `rounding.ts` (`divRoundHalfUp`, `allocateProportional`), `decimal.ts` (exact scaled parse/format, Indian grouping), `digits.ts`, `money.ts`, `weight.ts`
  - `amountInWords.ts` (bn/en, lakh/crore), `dates.ts` (IST, FY, season map), `numbering.ts`, `scope.ts`, `allocation.ts` (FIFO + manual), `aging.ts`, `errors.ts` (domain error codes)
  - `schemas/` (Zod 4: common, masters, vouchers ×13 types, system)
  - `calc/` (trade lines + bill, purchase, sale, load, trip, settlement/day close, `recompute.ts` with `recomputeVoucher` / `verifyVoucher` / `validateVoucherRules`)
  - `posting/` (accounts, `post` / `postLedger` / `postStock`, `replay` + `StockBook`, balances)
- i18n (`src/i18n`): `bn.ts` (canonical) and `en.ts` (`satisfies Dictionary`), framework-free `translate()` with typed keys and plurals, `I18nProvider` / `useI18n` / `useT` (instant switch, `<html lang>`, digit style independent of language), `format.ts`, `parse.ts` (qtl + kg input), `translit.ts`, `zodErrorMap.ts` (Zod issues become i18n keys).
- App shell `src/app/page.tsx`: a sample amount, weight, amount in words and date, with language and digit toggles. Fonts are Noto Sans Bengali + Inter via `next/font` (self-hosted at build time).
- Tests: 126 passing. These cover golden G1–G10, a table-driven posting test for every voucher type, money/weight/dates/numbering/i18n/translit/allocation/scope/rules, a jsdom shell test, and 7 property tests at 1000 runs each.

**Deviations from spec/plan:**
1. **TypeScript 5.9.3 and ESLint 9.39** instead of TS 7 / ESLint 10. These are the newest versions the Next 16.4 tooling expects.
2. pnpm settings (`nodeLinker: hoisted`, `saveExact`) live in **`pnpm-workspace.yaml`**, not `.npmrc`, because npm warns about pnpm keys in `.npmrc`.
3. **Cache Components (Next 16.4 default) needs a deterministic prerender.** `src/app/providers.tsx` gates the whole app to the client (`useSyncExternalStore`): the prerendered/precached HTML is a static splash and the UI mounts on the device. This fits local-first and offline cold start. Keep every page a client page.
4. Schema changes needed to make vouchers self-contained (all additive to §8):
   - EXPENSE uses an immutable **`categoryCode`** (posts to `EXP:<code>`) instead of `categoryId`, plus an `onCredit` flag (owed to `payeePartyId`).
   - PURCHASE and SALE carry `roundToRupee`; SALE also has `charges`/`roundOffPaise`.
   - MILL_SETTLEMENT copies `partyId`, `dispatchedNetG` and `saleTotalPaise` from the sale (the server must verify them against the sale).
   - TRIP adds `advanceBankAccountId`, per-expense `bankAccountId` / `creditPartyId`, and odometer fields.
   - CONTRA `kind` covers deposit, withdrawal, bank transfer, cheque clear/bounce, capital in and drawings.
   - OPENING is a list of `items` (CASH / BANK / PARTY / STOCK / CAPITAL) balanced to OPENING_BAL; JOURNAL is a list of lines.
   - Party role `godown` + `linkedGodownId` (inter-godown parties); `Variety.renamed`; `ExpenseCategory.enabled`.
   - A `COGS` system account was added (§7.2 uses it, but the §7.1 table omits it).
5. Posting semantics I chose:
   - SALE posts goods, COGS and freight. Loading labour, the buyer's advance and the vehicle advance are **separate linked vouchers** built by `saleLinkedDrafts`.
   - Freight `payer`: US means we owe the transporter. MILL means the mill paid the driver and deducts it from our bill: Dr EXP:TRANSPORT / Cr PARTY:T, then Dr PARTY:T / Cr PARTY:buyer. BUYER means nothing is posted.
   - **TRANSIT stock is scoped by `groupId`**, so direct loads get specific cost.
   - With no positive stock, COGS is 0. Phase 3 must warn before a sale takes stock negative.
6. Locale preference is kept in `localStorage` (`dk.locale.v1`) for now. Phase 2 should move it to the synced user record plus Dexie `meta`.
7. The spec's "fail CI on unused i18n keys" check is **deferred to Phase 5**, because keys are added ahead of the screens that use them. Key parity and no-empty-values are already tested.
8. The shadcn `dialog.tsx` now takes a `closeLabel` prop, so there is no hard-coded "Close".

**Known issues / TODO carried forward:**
- On first paint the splash shows, and the saved language applies after mount. An English user may briefly see Bengali `<html lang>`, but no visible text.
- The "edit then edit back" property is checked at the replay level. Phase 2 should add the same check at the Dexie stored-lines level (rev+1 then rev+2).
- The Bash tool does not work in this environment (fork errors); use PowerShell.

**Notes for next phase (Phase 2):**
- ⚠ **COGS and stock values depend on the stock position at posting time** (`PostingContext`). Two offline devices can compute different COGS for the same sale. So the server should:
  - reject `CALC_MISMATCH` only on the voucher's **own derived fields** (`verifyVoucher`) and on `validateVoucherRules`;
  - **recompute ledger lines and stock moves itself** from its own position, in `voucherOrder` order (`replay.ts`);
  - send its lines back on pull, and the client should accept the server's lines.

  Design `applyOp` around this, since the server is the arbiter (§5.5).
- Writing a voucher: `recomputeVoucher` → `validateVoucherRules` → `checkSameGodown(v, lookup)` → `post(v, ctxFromDexie)` → `toLedgerLineDocs` / `toStockMoveDocs`. Ledger line ids are deterministic: `${voucherId}:${rev}:L${i}` and `:S${i}`.
- Linked groups: `paidNowPaymentDraft(purchase)`, `saleLinkedDrafts(sale)` and `loadLinkedDrafts(load, roundToRupee)` return drafts **without** bookkeeping fields. The repo assigns `_id`, number, `fy`, rev, timestamps and `groupId`.
- Godown creation: `seedChartOfAccounts`, `SYSTEM_EXPENSE_CODES` / `OPTIONAL_EXPENSE_CODES` / `SEED_VARIETY_KEYS` (`posting/accounts.ts`) and `defaultGodownSettings` (`schemas/system.ts`).
- Numbering: `formatVoucherNumber`, `voucherSeqKey`, `deviceCodeFromIndex`.
- Server routes should call `installZodErrorMap()` so validation errors are i18n keys.

**Exit criteria results:**
- `pnpm typecheck` ✅
- `pnpm lint` ✅ (0 problems)
- `pnpm check:no-float` ✅
- `pnpm test` ✅ 126/126 (8 files; property tests at 1000 runs each)
- `pnpm build` ✅ (`/` static)
- `pnpm start` smoke test: HTTP 200, self-hosted fonts.
- Language switch without reload: verified by `tests/unit/shell.test.tsx`.

### Phase 2 — Offline Data, Auth, Sync & PWA Shell — 2026-11-24
**Built:**
- Local DB `src/client/db`: `dexie.ts` (schema v1 exactly §8.6, multiple named DBs for tests via `selectDatabase`, `openDb` + `classifyOpenError` → `DbOpenError`, `exportRawDatabase` for the recovery screen), `migrations.ts` (`SCHEMA_V1`, `assertAdditive`, `applyVersions`), `meta.ts` (cursor, deviceId, deviceCode, session, PIN, access snapshot, `voucherSeq:*`, `godownSettings:<id>`).
- Shared domain additions: `src/domain/rbac.ts` (`can`, `roleIn`, `canConsolidate`, `entryMayChange`, `isDayLocked`), `src/domain/posting/derive.ts` (storage-agnostic `DerivedStore`, `ordOf`, `applyVoucherDerived`, `repostAfter`), `src/domain/schemas/sync.ts` (wire protocol + API error codes), `src/domain/phone.ts`, `collectMasterRefs`/`checkRefs` in `scope.ts`, new `DomainErrorCode`s.
- Local write path `src/client/repo`: `createVoucher`, `createVoucherGroup` (shared `groupId`, pre-assigned `_id`s may link siblings), `editVoucher`, `voidVoucher`, `voidVoucherGroup`, `upsertMaster` (party `searchKey`, vehicle normalization, `fields` for merges), `updateGodownSettings`, `rebuildDailyAgg`. One Dexie tx each; `emitLocalWrite` after commit (BroadcastChannel).
- Queries `src/client/queries/{ledger,stock}.ts` and read-only `queries/consolidated`.
- Server `src/server`: `db.ts` (cached client, `useBigInt64`, §8.5 indexes, `nextServerSeq`), `auth.ts` (argon2id, jose JWT 15 min, rotating refresh cookie with reuse detection + 30 s concurrent-refresh grace, login rate limit), `rbac.ts`, `users.ts` (create, `setGodownAccess` → accessVersion, device codes), `godownService.ts` (create/archive), `apply/applyOp.ts` + `apply/mongoStore.ts`, `pull.ts`, `routes/*` (plain Request/Response; route files under `src/app/api` delegate). `scripts/seed.ts`, `.env.example`, `/api/health`.
- Client sync `src/client/sync`: `transport.ts`, `push.ts`, `pull.ts` (access reconcile, per-godown bootstrap, purge), `engine.ts` (backoff, single flight), `locks.ts`, `triggers.ts`, `resolve.ts` (retry, keep server, apply mine, discard failed, export unsynced), `instance.ts`. Auth: `src/client/auth/{pin,session}.ts`.
- UI: `(auth)/login`, `(auth)/unlock`, `(app)/layout` (ClientRuntime → AuthGate → AppShell), `(app)/page` (Home), `(app)/sync`, `~offline`; components `GodownSwitcher`, `SyncBadge`, `Banners`, `BootstrapScreen`, `DbRecovery`, `PwaRuntime`, `InstallButton`.
- PWA: `src/app/sw.ts`, `serwist.config.mjs` (configurator mode, `next build && serwist build serwist.config.mjs`), `src/app/manifest.ts`, icons in `public/icons` (`pnpm icons`), CSP + security headers in `next.config.ts`.
- Tests: `tests/repo/*` (repo, property at stored-lines level, DB/migrations/PIN), `tests/sync/{sync,isolation}.test.ts` (memory replica set via `tests/setup/mongo.global.ts`, real route handlers via `tests/helpers/server.ts` `TestDevice`), Playwright `tests/e2e/offline.spec.ts` (+ `tests/e2e/server.ts`).

**Deviations from spec/plan:**
1. **Server is the cost arbiter, and the client re-posts too.** Both sides post through the shared `applyVoucherDerived`: the stock position comes from stored moves ordered by `ord` (= date|createdAt|_id, the `voucherOrder` key), and every later voucher on an affected stock key is re-posted. Stored lines therefore always equal a full `replay` (property-tested). `StockMove` gained an optional `ord`. Applied push results and pulls carry the server's lines and moves, and the client adopts them.
2. Money in Mongo: **derived** collections (ledgerLines, stockMoves) store Int64 (`bigint` via `useBigInt64`). Voucher and master documents keep decimal strings (exact round-trip of the synced document).
3. `GodownSettings` live in Dexie `meta` (`godownSettings:<id>`), because §8.6 v1 has no table for them. Server-only extras: collections `accounts` (seeded chart), `locations` (TRANSIT), `conflicts`, `refreshTokens`, `loginAttempts`; `_m.fieldRev` on master docs (stripped before sending).
4. Rejected ops are NOT stored in `appliedOps`, so a retry re-evaluates them (e.g. after access is restored). Infrastructure errors fail the whole push request (HTTP 500), and the client retries as a network error.
5. Master conflicts: field-level merge using per-field revs. An overlapping field keeps the server value; the loser goes to `conflicts` and the result is still `applied` (with `conflictFields`).
6. The `entry` role server-side: own entry plus a 30-minute window (device clock). "Not yet synced" is enforced on the client only.
7. Revoked godown with ops still queued: the device keeps everything (`pendingPurge`); those ops fail with FORBIDDEN, and the user can export and then discard them on the Sync screen. Purge runs once the godown has no outbox ops.
8. Cold start always asks for the PIN (session status `locked`). A password login skips the PIN once if a PIN already exists.
9. Logout (blocked while the outbox is non-empty) wipes local business data and the PIN, but keeps deviceId and voucher sequences. Logging in as a different user is blocked while ops are pending.
10. Locale stays in localStorage (instant first paint). Moving it to the synced user record needs a prefs API, which is deferred to Phase 5 (Settings).
11. Manifest shortcuts point to `/?shortcut=purchase|sale|expense` until the Phase 3 screens exist.
12. CSP uses `'unsafe-inline'` for scripts, because pages are static prerenders with no per-request nonce.
13. Dexie 4 opens a DB left at a higher version without error (data kept). Version/Upgrade errors are still mapped to the recovery screen, which has deliberately no reset button.

**Known issues / TODO carried forward:**
- A back-dated stock voucher re-posts every later voucher on the same variety, which is slow for very old dates. Acceptable for now; revisit if profiling shows a problem.
- The update prompt checks `sync.running` (not per-op "sending") and dirty forms. Phase 3 forms must dispatch `ui.formDirtied`/`formCleaned`.
- Server logs are JSON lines on stdout (`DK_QUIET_LOGS=1` silences non-errors in tests).
- E2E covers the cold-offline shell only. The §13 "create purchase/payment/load/expense offline → drain → identical totals" e2e needs the Phase 3 screens (it is covered at the Vitest level by the isolation suite's exit-criterion test).

**Notes for next phase (Phase 3):**
- Write ONLY through `src/client/repo`. Build drafts as `VoucherDraft` (derived fields can be placeholders; recompute fills them). For linked groups, pre-assign `_id` with `newId()` and call `createVoucherGroup`.
- Errors: catch `RepoError` (`code`, `codes`, `issues` for form fields) and show `t(errorKey(e))` (`src/client/errors.ts`).
- Read with `useLiveQuery` (`src/client/hooks.ts`: `useActiveGodown`, `useAccessibleGodowns`, `useOutbox`). Never mix godowns outside `queries/consolidated`. Respect `consolidated` mode (hide + buttons).
- Search params: wrap `useSearchParams` users in `<Suspense>` (Cache Components). Keep pages static.
- Point the manifest shortcuts at `/purchase/new`, `/sale/new`, `/expense/new`.
- Phase-2 e2e: `pnpm build` first, then `pnpm test:e2e` (server: `tests/e2e/server.ts`, owner 9830012345 / e2e-owner-pass, godowns Rampur RP + Sonapur SP).

**Exit criteria results:**
- `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm check:no-float` ✅ · `pnpm format:check` ✅
- `pnpm test` ✅ 177/177 (13 files: repo, repo property, DB/PIN, sync, isolation + RBAC, plus Phase 1 suites)
- `pnpm build` ✅ (all pages static; SW precaches 36 URLs incl. `/`, `/login`, `/unlock`, `/sync`, `/~offline`)
- `pnpm test:e2e` ✅ 1/1 cold-offline acceptance (persistent Chromium, Pixel 7 viewport)
- Scripted two-godown offline create/edit/void → sync → server totals == device totals: `tests/sync/isolation.test.ts` "exit criterion" ✅

### Phase 3 — Masters, Parties & Trade Flow — 2026-11-24
**Built:**
- App layout: header (godown switcher, search placeholder, sync badge, user menu with language + digit toggles, sync, settings, logout), mobile bottom tabs (হোম · ক্রয় · বিক্রি/লোড · খাতা · আরও), desktop sidebar, Home quick actions + FAB sheet, "আরও" menu with coming-soon badges. `src/components/layout/{AppShell,nav}.tsx`.
- Shared UI: `FormShell` (full-screen form, godown in title, sticky totals bar, leave confirm, `RestoreDraftBanner`), draft autosave (`useFormDraft`, Dexie `meta` `formDraft:<key>`), back-button stack for sheets (`src/client/ui/backStack.ts`, `useBackClose`), `BottomSheet`, `EntityPicker` + party/variety/vehicle/place/bank pickers with inline offline create, money inputs (`AmountInput`, `WeightInput` with bags × avg helper, `RateInput`, `PercentInput`, `CountInput`), `Money`/`Qty`/`Balance`/`Computed` (formula on tap), `VirtualList`, `SyncIcon`, `EmptyState`, `Fresh` (bfcacheId key), `useWriteGodown`/`ReadOnlyNotice`.
- Repo: `saveVoucherWithLinked` (primary + linked members matched by type; changed → new rev, missing → voided `LINKED_REMOVED`; reminders; extra writes), `savePurchase` / `saveSale` / `saveLoad` / `saveMoney` (`src/client/repo/trade.ts`), `saveMillSettlement`, read-only linked members (`LINKED_READ_ONLY`), cascade void (group + settlements; voiding a settlement returns the sale to PENDING), settlements refreshed when their sale changes, reminder records (`src/client/repo/reminders.ts`), last-used per party (`lastUsed:<godown>:<party>`).
- Queries: `src/client/queries/parties.ts` (search, balances, statement with running balance + bank filter, bills via FIFO/manual `settleBills`, aging, due list, purchase history), `src/client/queries/vouchers.ts` (lists, day list, 30-day average rate + ±25 % band, load register).
- Screens: purchase/sale/load/payment new·edit·view, `sale/settle`, purchase & sale lists with filters, load register with daily totals + Excel (`src/client/export/excel.ts`, exceljs lazy), parties list/form (copy from another godown)/profile (summary, khata, purchases, sales, payments, loads, reminders; call, WhatsApp, তাগাদা bn/en, merge), due/advance page, settings (preferences + owner deduction defaults/rounding) and masters (varieties, categories, banks, vehicles, places), print views `(print)/print/{voucher,statement}` (letterhead, bn/en/both, amount in words, `window.print()`, PNG share via html-to-image + Web Share, download fallback).
- Server: reminders collection + sync entity `reminder`; owner-only `/api/parties/merge` (`src/server/partyMerge.ts`, one transaction: re-point vouchers/vehicles/reminders, re-derive lines, void duplicate with `mergedInto`, changelog, audit).
- Tests: `tests/repo/trade.test.ts` (load → exactly one SALE, load edit propagation, read-only links, AGENT commission, paid-now atomicity + payment void on removal, reminders, FIFO/manual statuses + advance, sale linked vouchers, settlement difference/shortage/void, hand-computed trade flow), `tests/sync/merge.test.ts`; Playwright `tests/e2e/trade-flow.spec.ts` (bn + en, identical numbers) and the offline spec extended to all 31 routes; helpers in `tests/e2e/helpers.ts`.

**Deviations from spec/plan:**
1. Forms use controlled React state + the shared parse helpers (`src/client/ui/parse.ts`) instead of react-hook-form: every field is a decimal string parsed exactly to bigint, which fits the money rules better than RHF's value model.
2. Reminders are a synced master-like entity (`reminder`, field-level merge) with deterministic ids `<voucherId>:<kind>`; auto reminders store `title: ""` (rendered from the kind). The reminder centre UI is Phase 5. Advance given → COLLECT_DUE, advance taken → PAY_DUE, cheque receipt → CHEQUE.
3. Party merge needs a server round trip and then a sync; devices with pending edits of affected vouchers get normal conflict items.
4. Void is owner-only in the UI (spec §9). The server still allows a manager to void on open days (§2), which is needed when a manager's edit removes a linked member (e.g. paid-now).
5. The hardware back button closes sheets; on whole form pages it is not intercepted (it would race with navigation after save). The in-app back asks first, a tab-close warning shows, and draft autosave restores the form.
6. Next 16 keeps up to 3 visited routes alive with React Activity: entry-form routes are wrapped in `Fresh` (key = `router.bfcacheId`) so a new form starts empty; e2e tests must target `:visible` elements (`vis()` helper).
7. "Unlocked" is remembered per tab in `sessionStorage` (`src/client/auth/unlock.ts`), so an offline client navigation that falls back to a full page load doesn't ask for the PIN again; a new tab/app start still does.
8. Header dropdowns are non-modal (`modal={false}`) and the godown switcher shrinks to fit; a 19 px header overflow at 412 px was zooming the whole page on phones (now guarded by `expectNoHorizontalScroll` in e2e).
9. Excel money/weight cells are written as formulas holding the exact decimal text (no JS float on amounts).
10. Home shows a "হাতে নগদ" (cash in hand) card and today's list as stubs; the dashboard cards are Phase 4. Expense and trip quick actions show "coming soon".
11. Bank-account opening balance is stored on the master only; it is posted through the OPENING voucher in the go-live wizard (Phase 5).
12. Manifest shortcuts now open `/purchase/new` and `/sale/new`; expense still opens Home (Phase 4).

**Known issues / TODO carried forward:**
- Bengali conjunct rendering on receipts relies on browser shaping (HTML print and html-to-image) — check ক্ষ, ন্দ্র, স্ব, ত্ত on a real phone during UAT.
- The rate sanity band uses this godown's purchases of the last 30 days on this device.
- `dueList` computes bills per party on every render (fine for a few hundred parties; revisit with dailyAgg-style caching if slow).
- Party merge is online-only and owner-only; there is no un-merge (the dropped party stays visible as "merged").

**Notes for next phase (Phase 4):**
- New entry screens: build with `FormShell` + `useFormDraft` + pickers; wrap the route in `<Fresh>`; save through a `saveVoucherWithLinked` plan; give inputs `testId`s and use `vis()` in e2e.
- Expense/trip quick actions are in `QUICK_ACTIONS` (`src/app/(app)/page.tsx`, `href: null`); the "আরও" items in `src/app/(app)/more/page.tsx`.
- Dashboard cards can replace the Home cash stub; `dailyAgg` and `src/client/queries/{ledger,stock}.ts` are ready.
- Reminder records already exist for due dates (query `openReminders`).

**Exit criteria results:**
- `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm check:no-float` ✅ · `pnpm format:check` ✅
- `pnpm test` ✅ 189/189 (15 files)
- `pnpm build` ✅ (every route static; SW precaches 102 URLs)
- `pnpm test:e2e` ✅ 3/3 — cold-offline (31 routes by direct URL + tab navigation), trade flow in bn and en (F −₹12,000, F2 −₹42,000, mill +₹17,770, cash ₹32,000, shortage 10 kg; same numbers in both languages)

### Phase 4 — Daily Money, Dashboard, Vehicles, Stock & Godowns — 2026-11-24
**Built:**
- Expenses: `src/components/daily/ExpenseForm.tsx` (`/expense/new`, `/expense/edit`), daily screen + monthly-vs-previous view `/expense` (`src/client/queries/expenses.ts`).
- Cash & bank: `/cashbank` (cash book, bank books with running balance + date range, cheques in hand with clear/bounce), CONTRA form `src/components/daily/ContraForm.tsx` (`/cashbank/entry?kind=`) for all 7 kinds incl. capital in / drawings (`src/client/queries/cashbank.ts`).
- Day close: `/day-close` (`src/components/daily/DayClose.tsx`, denomination helper, required note, CASH_DIFF), repo `closeDay` / `unlockDay` (`src/client/repo/daily.ts`); a DAY_CLOSE writes the local `dayStatus` lock in the same transaction; banners `src/components/daily/DayBanners.tsx` (dayCloseRequired, owner late-entry with local "OK" ack, pending receipts).
- Dashboard: `src/components/dashboard/Dashboard.tsx` (10 cards, ◀ ▶ date, bank row + cheques, quick actions, today's list, top-5 reminders, দিন শেষ button, owner-only profit toggle) over `src/client/queries/dashboard.ts` (reads `dailyAgg` + one day range). All-godowns table `src/components/dashboard/ConsolidatedTable.tsx`.
- Vehicles: capacity + search in the masters screen, TRIP form `src/components/daily/TripForm.tsx` (`/trip/new|edit`), fleet `/vehicle` and per-vehicle P&L + khata `/vehicle/view` (`src/domain/calc/vehicle.ts` `vehiclePnl`, `src/client/queries/vehicles.ts`).
- Stock: `/stock` (by variety: qty, bag estimate, avg cost, value; pending receipts), `/stock/register`, physical count `/stock/adjust` (`StockAdjustForm.tsx`), `stockSummary` / `stockRegister` in `src/client/queries/stock.ts`.
- Inter-godown transfers: `interGodown` link on SALE/PURCHASE/PAYMENT/RECEIPT, builders `src/domain/transfer.ts`, repo `saveTransfer` / `voidTransfer` / `acceptTransfer` (`src/client/repo/transfer.ts`, auto "গোডাউন: X" parties), wizard `/transfer`, accept `/transfer/accept`. Server: pending receipts (`transfers` collection, `publishTransfer`), counter-book guard `TRANSFER_NEEDS_BOTH`, DAY_CLOSE → `dayStatus` publish + `DAY_ALREADY_CLOSED` (`src/server/apply/applyOp.ts`).
- Godowns (owner): `/godowns` list, add-godown wizard `/godowns/new` (`src/components/godown/GodownWizard.tsx`: create online → varieties → banks + opening → cash → stock → party balances → one OPENING voucher, difference as CAPITAL after confirmation), profile/letterhead `/godowns/edit` via new `POST /api/godowns/update`, archive. Client helpers `src/client/godown/manage.ts`.
- Search `/search` (header icon): parties, vehicles, voucher numbers, amounts in either script (`src/client/queries/search.ts`); owner "search all godowns" in `queries/consolidated`.
- Generic `/voucher/view` for expense/trip/contra/stock/day-close/opening; Dexie schema **v2** adds the `transfers` table (additive).
- Tests: `tests/repo/daily.test.ts`, `tests/repo/dashboard.perf.test.ts`, `tests/unit/phase4-domain.test.ts`, `tests/sync/phase4.test.ts`; e2e `tests/e2e/dashboard.spec.ts` (G5, bn + en) and `tests/e2e/two-godown.spec.ts` (G10); offline spec covers the 20 new routes.

**Deviations from spec/plan:**
1. Owner "unlock day" = void the day's DAY_CLOSE (audited as void + local `unlock` audit). That reverses its CASH_DIFF; the owner closes the day again afterwards. A DAY_CLOSE is never edited.
2. One active DAY_CLOSE per godown and day, enforced on client and server (`DAY_ALREADY_CLOSED`).
3. The late-entry flag is cleared server-side only by unlocking (re-closing). The owner's "ঠিক আছে" just hides the banner on that device (meta `lateAck:<godown>:<date>`).
4. The `dayCloseRequired` banner shows only when the previous calendar day had active entries and isn't closed. It's shown to owner/manager only.
5. Transfers: when the user can write both godowns, one Dexie transaction writes both books (`paired: true`). Otherwise only the SEND side is written and the server publishes a pending receipt to the receiving godown. A sender must at least *see* the receiving godown; the wizard lists only visible godowns. Changing an accepted/paired transfer needs write rights in both godowns (server `TRANSFER_NEEDS_BOTH`). The server does not cross-check amounts between the two books.
6. Transfer parties store the other godown's name. The UI renders them as "গোডাউন: X" (pickers / names), and a SEND voucher carries the counter godown id (an id only, no data).
7. Dashboard card 7 = EXPENSE vouchers + all TRIP expenses ("নিজের গাড়ির খরচ" bucket). "আজকের লাভ" = the day's income − expense accounts from `dailyAgg` (incl. COGS).
8. Bags estimate on the stock page = qty ÷ (Σ gross ÷ Σ bags of this godown's purchases); "—" when unknown (no assumed bag weight).
9. Trip "due from hirers" = Σ trip due at entry time (later receipts from the hirer aren't linked to trips).
10. Reminders "সব দেখুন" links to `/due` until the Phase 5 reminder centre exists.
11. Godown profile edit is online-only (godown records are server-written); the device gets the change through sync.

**Known issues / TODO carried forward:**
- The perf budget is verified in Vitest (50k vouchers: ~22 ms for the dashboard queries on fake-indexeddb). A manual check on a mid-range Android phone is still to do during UAT.
- The `entry` role "own entries + today's dashboard only" view ([CONFIRM] #8) is not restricted in the UI yet; the write rules are enforced.
- The header godown dropdown keeps the old menu in the DOM while it animates closed. The e2e helper `switchGodown` waits for it; a real user tapping very fast could see a missed tap.
- Excel export for the new books/registers is not built (reports/export are Phase 5).

**Notes for next phase (Phase 5):**
- Simple vouchers save through `saveSimple(godownId, draft, {id, reason})`; day close via `closeDay` / `unlockDay`; transfers via `saveTransfer` / `voidTransfer` / `acceptTransfer`.
- Report-ready queries: `accountBook`, `chequesInHand`, `dailyExpense`, `monthlyExpenses`, `vehicleSummaries`, `vehicleKhata`, `stockSummary`, `stockRegister`, `dashboardData`, `consolidatedDashboard`, `searchGodown`.
- The reminder centre can reuse `topReminders` / `openReminders` and should replace the dashboard "সব দেখুন" link.
- e2e: use `switchGodown`, `createGodownViaWizard`, `createParty`, `switchToEnglish`, `istDate` from `tests/e2e/helpers.ts`. Godown codes used by specs: RP, SP (seed), GFB, GFE, TA, TB.

**Exit criteria results:**
- `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm check:no-float` ✅ · `pnpm format:check` ✅
- `pnpm test` ✅ 212/212 (19 files), incl. the dashboard perf test (50k vouchers: ~22 ms, budget 300 ms)
- `pnpm build` ✅ (every route static; SW precaches 143 URLs)
- `pnpm test:e2e` ✅ 6/6: G5 dashboard + day close (bn, en), cold-offline (51 routes), trade flow (bn, en), two-godown G10 + All-godowns totals

### Phase 5 — Reminders, Reports, Export, Ops & Hardening — 2026-11-24
**Built:**
- Reminders: centre `/reminders` (Today / Overdue / Upcoming, done, snooze, manual + cheque reminders), auto-close when the bill is Settled (repo `setReminderState` / `createManualReminder`), header badge + banner. Web push: VAPID, `/api/push/subscribe|unsubscribe`, SW `push` handler, bilingual digest from `/api/cron/daily` (`src/server/push.ts`, `src/client/pwa/push.ts`).
- Reports `/reports`, `/reports/view`, `/print/report`: one model per report (`src/client/reports/defs.ts`, registry `reports/registry.ts`, all-godown ones in `queries/consolidated/reports.ts`) rendered on screen, print and Excel (`modelToSheets`); share as image; recharts only in `components/reports/ReportChart.tsx` (lazy). Reconciliation tests against ledger totals.
- Settings: preferences, app settings (owner), users with per-godown roles + `consolidated`, devices (revoke), storage gauge, force resync, diagnostics (Dexie v3 `clientErrors`, `(app)/error.tsx` boundary), about + "export unsynced data". Integrity check on device after every sync and on demand + `/api/admin/integrity` comparison (`src/domain/integrity.ts`, `/settings/integrity`).
- Onboarding wizard (`OnboardingGate`, `Onboarding.tsx`), bulk opening balances `/opening` (difference → মূলধন after confirm).
- Ops: backup JSON / Excel workbook `/settings/backup`, `pnpm restore` into an empty DB (`docs/RESTORE.md`), `/api/cron/daily` + `/api/cron/storage`, GitHub workflows (nightly backup, daily cron, storage check), FY close/compaction, `deploy/netlify.toml`, `docs/OPERATIONS.md`, `docs/CHANGELOG.md`, `docs/UAT-CHECKLIST.md`.
- Hardening (this session): Home JS 322 → 241 KB gzipped (`pnpm check:bundle`):
  - date-fns removed: `formatDate` uses `calendar.*` dictionary keys.
  - English dictionary loads lazily: `loadDictionary` / `registerDictionary` in `src/i18n/translate.ts`. `I18nProvider` keeps Bengali until English is in; `@/i18n/translateAll` registers both for server, print, WhatsApp and tests.
  - Header menus load on first tap (`layout/lazyMenu.ts`, `UserMenu`, `GodownMenu`). The iOS install dialog and `ConsolidatedTable` are lazy.
  - The toast host mounts when idle (`components/system/IdleToaster.tsx`, `lazyToast`).
  - `VirtualList` moved out of `lists/common`.
- Long tables are window-virtualized with `useVirtualRows` (`lists/VirtualList.tsx`): reports, cash/bank book, party khata, stock register. Print and Ctrl+P render every row.
- `pnpm lighthouse` (`scripts/lighthouse.mts`): logged-in mobile audit of Home + Chrome installability.
- Header at 360 px: the switcher shows just the godown name (full "গোডাউন: X" from `sm` up and in its aria-label); the sync badge is icon-only on phones when everything is synced.
- Tests: `tests/unit/virtual-rows.test.tsx`, more date tests in `tests/unit/i18n.test.ts`; e2e `daily-flow.spec.ts` (bn + en), `visual.spec.ts` (Home, reports, settings, purchase form × bn/en at 360 px; baselines in `tests/e2e/visual.spec.ts-snapshots/`), offline spec extended with the full §13 acceptance.

**Deviations from spec/plan:**
1. Lighthouse ≥ 12 has no PWA category, so installability is read from Chrome (`Page.getInstallabilityErrors`) in `pnpm lighthouse`, which is not part of `test:e2e`.
2. `translate(lang)` falls back to Bengali (never a raw key) if English hasn't loaded yet. On the client, English loads immediately when chosen and otherwise when the device is idle.
3. The toast host mounts on idle (≤ 1.5 s after start). Every toast follows a user action, so none are lost in practice.
4. Tables up to 150 rows are not virtualized (simple DOM, exact print); above that, window virtualization with spacer rows.
5. Visual baselines are per platform (`*-win32.png`). A missing baseline is written, not failed (`updateSnapshots: "missing"`), so CI on Linux writes its own on the first run.

**Known issues / TODO carried forward:**
- ~~The `entry` role view restriction~~: fixed after Phase 5 (see "Post-v1 fixes" below).
- The header godown menu animation note from Phase 4 still applies (now inside the lazy `GodownMenu`).
- Manual checks for UAT: performance on a real mid-range / cheap Android phone, a native-speaker translation review (see `docs/UAT-CHECKLIST.md`).
- Home JS is 241 KB of a 250 KB budget: keep the rules in CLAUDE.md ("Keep the Home route light") and run `pnpm check:bundle` after UI work.

**Notes for next steps (UAT / fixes):**
- Deploy per `docs/OPERATIONS.md`, then run the UAT week per `docs/UAT-CHECKLIST.md`. Fix issues in sessions like "fix UAT issue: …".
- After an intended UI change, delete `tests/e2e/visual.spec.ts-snapshots/*.png` and re-run `pnpm test:e2e`, then look at the new PNGs before committing them.

**Exit criteria results:**
- `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm check:no-float` ✅ · `pnpm format:check` ✅
- `pnpm test` ✅ 241/241 (25 files), incl. report reconciliation, integrity, restore round-trip, isolation crafted requests, virtual rows
- `pnpm build` ✅ (every route static; SW precaches 204 URLs) · `pnpm check:bundle` ✅ Home JS 241.3 KB gzipped (budget 250 KB)
- `pnpm test:e2e` ✅ 9/9: daily flow bn + en, G5 dashboard bn + en, cold-offline + §13 acceptance, trade flow bn + en, two-godown G10, visual snapshots (re-run against baselines ✅)
- `pnpm lighthouse` ✅ Home (mobile): Performance 90 · Accessibility 100 · Best practices 96 · installable

## Post-v1 fixes

### Entry role view restriction ([CONFIRM] #8) — 2026-11-24
**Built:** the `entry` role now *sees* only its own entries and today's dashboard (spec §2). Writes were already limited.
- Policy: `src/client/access.ts` (pure).
  - `ENTRY_PATHS` / `mayOpenPath`: screens entry may open. These are its purchase, load and expense screens, the views of its linked vouchers, print voucher, Home, More, Settings and Sync.
  - `mayViewVoucher` / `visibleVouchers`: own vouchers only.
- Enforcement:
  - `RoleGate` in the app shell and the print layout: any other screen shows "এন্ট্রি ভূমিকায় শুধু নিজের এন্ট্রি…", even when opened by direct URL.
  - `useMayViewVoucher` (role in the voucher's own godown) in `VoucherView`, print voucher and the purchase/load/expense edit forms.
- Trimmed UI for entry:
  - Navigation: no খাতা tab; the sale/load tab opens `/load`. No header search or reminders bell. "আরও" and the Home quick actions only offer what the role may open.
  - Dashboard: no ◀ ▶ (`DateNav locked`). "আজ আমার এন্ট্রি" lists own entries only. No reminders and no drill-downs.
  - Lists and other screens: the purchase list (`VoucherList`) shows own entries only. Load and expense pages show "my loads / my expenses" instead of godown-wide registers and totals. Settings has no masters card. Edit on a voucher view shows only within the 30-minute, unsynced window.
- Tests: `tests/unit/access.test.ts`. e2e `tests/e2e/entry-role.spec.ts`, with an entry user seeded in RP by `tests/e2e/server.ts` (`ENTRY` in helpers; `loginFresh(page, user)`).

**Deviation:** this is a UI restriction. The entry user's device still syncs the whole godown, because dashboard totals, pickers and the posting replay need it. The server does not filter pulls by creator. Godown isolation stays server-enforced. If the client wants field staff unable to obtain other users' amounts even with technical skill, that needs server-side pull filtering plus a server-computed dashboard: a v2 change.


## v2 handoff log

### v2 Phase 1 — Domain core — 2026-11-25
**Built (all pure, in `src/domain`, not yet wired to the app):**
- `units.ts`: kg / quintal / mon (`monKg`, default 40, whole kg), exact parse per unit (`parseWeightIn`), display helpers (`formatWeightNumber`, `weightTriple`, `gramsToInput`).
- `v2/schemas.ts`: the v2 document union `Doc` (PURCHASE, SALE, PAYMENT, EXPENSE, LOAD, MILL_DISPATCH, MILL_RETURN, CONVERSION, TRIP, SECOND_PARTY, STOCK_ADJUST, CONTRA, DAY_CLOSE, OPENING) with per-type dates, `entryDate`, `businessId`, `WeightBlock`; `businessDate(doc)`; `LedgerLineV2`, `StockMoveV2` (product / location / mill / bags).
- `v2/weightBlock.ts` (bag-wise / manual, optional deductions, `computeBill` with visible round-off), `v2/accounts.ts` (STOCK_PADDY, STOCK_RICE, STOCK_OTHER:x, STOCK_AT_MILL:mill, EXP_PAYABLE, MILLING_*, SP_CLEARING, …), `v2/post.ts` (`postDoc`: every §8 event; weighted average per position key; TRANSIT scoped by group), `v2/replay.ts` (`ordOfDoc`, `replayDocs`, `deriveAll`, serializers), `v2/recompute.ts` (`recomputeDoc`, `verifyDoc`, `validateDocRules`), `v2/payments.ts` (`billsOf`, `billState` paid/partial/unpaid/overdue, `splitOverpayment`, `allocateFifo`), `v2/cashbook.ts` (§7.3 classifier, `cashbookDay`, `balanceAt`), `v2/stock.ts` (`paddyDay`, `millDay`, `productDay`, `dispatchBalance`, `wouldGoNegative`), `voiceNumber.ts` (Bengali/English spoken numbers).
- New domain error codes (`errors.ts`): MILL_REQUIRED, FUTURE_DATE, OVERPAYMENT, SOURCE_MISMATCH, LINKED_PAYMENTS, ALREADY_LINKED, CATEGORY_IS_PAYMENT, DISPATCH_TYPE_MISMATCH, DUPLICATE_VARIETY.
- Tests: `tests/unit/v2-golden.test.ts` (G1–G8, units, WeightBlock), `tests/unit/v2-acceptance.test.ts` (§21 Tests 1–6 at domain level), `tests/unit/v2-posting.test.ts` (each event, dues, FIFO, rules, CALC_MISMATCH), `tests/property/v2.property.test.ts` (balanced, void restores, edit-back, Gola isolation), `tests/unit/voice-number.test.ts`. Factory `tests/helpers/v2.ts`.

**Decisions:** D3–D11 in `docs/DECISIONS.md` (D10 is an open question for the client: mill-return value is valuation only).

**Other:** fixed a pre-existing clock-dependent test (`tests/sync/phase5.test.ts` failed before 08:00 IST).

**Notes for Phase 2:**
- The old v1 domain (`schemas/vouchers.ts`, `posting/*`, `calc/*`) is still what the app uses. Phase 2 switches the data layer (Dexie, repo, sync, server) to `Doc` and removes v1 posting; the old screens that depend on v1 types are replaced section by section (Phases 4–11).
- `DerivedStore`/`applyVoucherDerived` (`posting/derive.ts`) must be ported to `postDoc` with `StockKeyV2` (key = `stockKeyId`) and `ordOfDoc`.

**Exit criteria:** `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm check:no-float` ✅ · `pnpm format:check` ✅ · `pnpm test` ✅ 345/345 (31 files).
### v2 Phase 2 — Data layer & migration — 2026-11-25
**Built:**
- The v2 schemas ARE the schemas now (`@/domain/schemas` re-exports `v2/schemas`). The v1 voucher schemas live in `src/domain/legacy/v1Vouchers.ts`, used only by the migration. The v1 `posting/`, `calc/` and `transfer.ts` are removed. Masters are v2: party roles `FARMER…GOLA`, variety `company/product/normalizedKey/verified`, `Business` schema, `businessId` on every record, Gola `colour`, settings `lowStock`.
- Domain: `v2/derive.ts` (the shared DerivedStore port with `StockKeyV2`), `v2/links.ts` (payment source/party/direction, return/conversion ↔ dispatch, consignment, load), `scope.ts` (v2 refs), `legacy/migrateV1.ts` (pure converter), `legacy/reconcile.ts`.
- Device: Dexie **v4** (additive indexes for per-type dates, `source.id`, `dispatchId`, product/location) with `db/upgradeV4.ts`, which holds pending v1 work and clears data for a full re-download. Repo `repo/docs.ts`: `saveDoc`, `saveDocs` (several docs, one transaction, pre-assigned ids), `voidDoc` (LINKED_PAYMENTS / `withPayments`, ALREADY_LINKED), `paymentsOfSource`, `dependentsOf`; day close + "re-check" flags; business id + op group in the write context. Also `repo/reminders.ts` (manual + state only, D13), masters with the variety duplicate check, `queries/ledger.ts`, and `sync/legacy.ts` (`replayLegacyV1`). Sync push sends op groups whole (`cutAtGroup`) and pull handles `business`.
- Server: `applyOp.ts` rewritten. `applyGroup` applies one op group in one transaction. It checks the business (`FORBIDDEN`), `CALC_MISMATCH` via `verifyDoc`, `validateDocRules`, links, `LINKED_PAYMENTS` / `ALREADY_LINKED` on void, load 1:1, day close, and re-check flags. Also: `mongoStore.ts` (v2 keys), the `businesses` collection with `businessId`-prefixed indexes, `business.ts` (`createBusinessWithOwner`), owners scoped to their business (`godownIdsFor`, admin, godown edit/archive, party merge), and admin backup/restore v2 (`dhan-gola-backup` version 2).
- Migration: `src/server/migrateV2.ts` + `scripts/migrate-v2.ts` (`pnpm migrate:v2` dry run, `--copy-to-memory` rehearsal, `--apply`), `docs/MIGRATION_V2.md`.
- Tests: `tests/repo/docs.test.ts` (stored rows == replay, back-dated re-post, linked voids, re-check, duplicate varieties), `tests/repo/upgrade-v4.test.ts`, `tests/unit/migrate-v1.test.ts`, the sync suite ported to v2 (+ op-group atomicity, linked void), and the isolation suite ported (+ owner separation, Test 9: cross-business pull/push and a forged payment source).

**Migration rehearsal (demo database):** `pnpm migrate:v2 --copy-to-memory` → reconciliation OK, 39 figures checked; the only allowed difference is a ₹75,922 cheque in hand moving to the bank. Stored == re-posted, both Golas balanced. **The live database was not modified** (the rehearsal only reads it).

**Decisions:** D12–D16.

**Known issues / TODO:**
- The app has only the shell, Home (Gola name), Sync, login and unlock until Phase 4 (D16). The cold-offline e2e covers those routes.
- `tests/unit/i18n-usage.test.ts` "every key is used" is paused until Phase 12 (most v1 keys lost their screens).
- `pnpm check:bundle` / `pnpm lighthouse` were not re-run (no UI to measure yet). They are re-run in Phase 4.
- Inter-Gola transfers (paired sale + purchase across two Golas in one op group) are rebuilt in Phase 6.

**Exit criteria:** `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm check:no-float` ✅ · `pnpm format:check` ✅ · `pnpm test` ✅ 236 passed, 1 skipped (19 files) · `pnpm build` ✅ · `pnpm test:e2e` ✅ 1/1 (cold offline, transitional routes) · migration rehearsal reconciles ✅
### v2 Phase 3 — Auth & Gola management — 2026-11-25
**Built:**
- Server: `routes/account.ts`. `GET /api/auth/status` (registration open?). `POST /api/auth/register`: business + owner + recovery code (shown once) and the device is signed in; `ALLOW_REGISTRATION` auto/true/false; a `locks` doc makes two simultaneous registrations safe. `POST /api/auth/recover`: mobile + recovery code → new password + NEW code; rate-limited; signs out all other sessions. `POST /api/me/recovery`: regenerate, needs the password. `POST /api/business`: owner profile, logo data URL, `monKg`, `deductionsEnabled`; changelog → devices. `GET /api/me/sessions` + `POST /api/me/sessions/revoke`. `POST /api/godowns/delete`: only a Gola with no transactions; others are archived. Also `server/recovery.ts` (code `DG-XXXX-XXXX-XXXX`, no ambiguous characters, argon2id hash), `scripts/admin-reset-password.ts` (`pnpm admin:reset-password --mobile=…`: temporary password + new code, all sessions signed out, audited), `publicUser` strips the recovery hash, Gola `colour` on create/edit, and audit actions `register`, `password_reset`, `recovery_regenerate`, `business_edit`.
- Client: `client/auth/account.ts` (register, recoverPassword, regenerateRecoveryCode, updateBusinessProfile, sessions, deleteEmptyGola), `queries/consolidated/totals.ts` (read-only per-Gola + combined totals), and `ApiCallError.detail`.
- Screens: `/login` (show/hide password, forgot link, register link only while registration is open, bn | English toggle), `/register`, `/forgot`, the shown-once `RecoveryCodeScreen` (copy, print, confirm checkbox), `FirstGolaGate` (an owner without a Gola creates one first), `/golas` (list, archive, delete-if-empty with confirmations), `/golas/new`, `/golas/edit` (+ low-stock threshold, offline via Gola settings), `/profile` (language, digits, password, PIN, new recovery code), `/business` (profile + compressed logo + mon size + deductions switch), `/sessions`. The avatar menu has the v2 items. Components: `brand/Logo` (SVG mark; pulled forward from Phase 4), `auth/AuthBits`, `shell/PageTitle`, `shell/ConfirmDialog`, `gola/GolaForm`.
- i18n: v2 namespaces in `src/i18n/v2/{bn,en}.ts` (`acct`, `biz`, `gola`, `menu`), merged into the canonical dictionaries; app name ধান গোলা / Dhan Gola; new API and domain error messages.
- Tests: `tests/sync/account.test.ts` covers registration closing, recovery (wrong/right/messy input, old code dead, rate limit), regeneration + audit, business profile sync, session revoke, **Test 7** (two Golas: separate books, combined = sum, delete only empty) and **Test 8** (logout blocked while unsynced; logout → re-login and a second phone restore identical books). **Test 9** is covered by `tests/sync/isolation.test.ts` (Phase 2). The cold-offline e2e now includes the new screens.

**Decisions:** D17–D18.

**Known issues / TODO:** the header Gola switcher still uses the v1 look and labels; Phase 4 redesigns it (colour chip, cross-fade, গোলা wording). The bank accounts and settings screens come with the sections that use them (Phases 5 and 8).

**Exit criteria:** `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm check:no-float` ✅ · `pnpm format:check` ✅ · `pnpm test` ✅ 246 passed, 1 skipped (20 files) · `pnpm build` ✅ · `pnpm test:e2e` ✅ 1/1 (13 routes offline)
### v2 Phase 4 — Design system & shell — 2026-11-25
**Built:**
- Identity: logo mark (`components/brand/Logo.tsx` + `logoGeometry.ts`: a tied paddy sheaf of three stalks with slim grains, in a rounded Paddy Gold square; colour, inverse and mono variants); `pnpm icons` regenerates `public/icons` (192/512, maskable, apple-touch, favicon, logo SVGs). Manifest: "Dhan Gola – ধান গোলা", theme #1E4D3A, background #FAF6EC, shortcuts নতুন কেনা / নতুন বিক্রি / খরচ / ক্যাশবই. Root metadata renamed.
- Tokens (`globals.css`): Deep Forest Green, Paddy Gold, Warm Ivory, white cards, warm borders, muted money colours, `shadow-card` / `shadow-lift`, dark mode, skeleton shimmer, `.press` (scale 0.97) / `.lift`, reduced motion.
- Shell: `components/shell/sections.ts` (the EXACTLY 8 sections with their §11 tabs as `?tab=`), `Nav.tsx` (collapsible desktop sidebar ≥ 1024 px; mobile bottom bar with 4 primary sections + the "সব বিভাগ" 2×4 sheet), `SectionPage.tsx` (section heading with Gola chip, pill tabs, tab fade), `QuickAdd.tsx` (quick-add FAB with the 8 §11 actions; only ready ones are shown), new `AppShell` (header: logo, Gola switcher with colour chip, sync badge, avatar initial; content fade on page/Gola change), restyled Gola menu (chips, "সব গোলা একসাথে").
- Kit (`components/kit/Kit.tsx`): MetricCard (count-up), QtyTriple (tap → kg / qtl / mon using the business mon size), StatusPill, TxnCard, EmptyState, delayed Skeleton, Panel; `components/motion/Motion.tsx` (FadeSlide, CrossFade, StaggerItem, useCountUp); `client/ui/backStack.closeThenNavigate` (a sheet that navigates waits for its history entry to be released).
- Routes for all 8 sections (`/`, `/purchase`, `/sales`, `/expenses`, `/loads`, `/dues`, `/vehicles`, `/mill`). Dashboard → সারাংশ shows real balance cards (cash, bank, warehouse paddy, rice, mill paddy, receivable, payable) for the active Gola or all Golas combined (`useBusiness` hook).
- Terminology: গোডাউন → গোলা and godown → Gola in every dictionary value; English bottom-bar label "Dues"; the language toggle also sets matching digits (Profile can choose separately).
- Tests: `tests/unit/sections.test.ts` (exactly 8 sections, 4 primary, every label in bn + en, quick actions), `tests/e2e/shell.spec.ts` (360 / 768 / 1280 px, bn + en, bottom bar 4 + all, sheet 8, sidebar 8, every section reachable, no horizontal scroll, Gola switch, reduced motion). Screenshots are in `test-results/v2-shell/` and were reviewed.

**Decisions:** D19 (CSS animations instead of `motion`), D20 (transitional tabs).

**Exit criteria:** `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm check:no-float` ✅ · `pnpm format:check` ✅ · `pnpm test` ✅ 250 passed, 1 skipped (21 files) · `pnpm build` ✅ · `pnpm check:bundle` ✅ Home JS 238 KB (budget 250) · `pnpm test:e2e` ✅ 3/3 · visual review ✅ (bn/en at 360, 768, 1280).
### v2 Phase 5 — Purchase + Variety — 2026-11-25
**Built:**
- Repo: `repo/payments.ts` (`saveBillWithInitialPayment` writes the purchase and its initial payment in one op group; `payBill` with `OVERPAYMENT` → confirmed split to advance; `payAdvance`; `dueOf`), `repo/varieties.ts` (`mergeVarieties` repoints every document and archives the dropped variety), `repo/banks.ts` (`saveBankAccount`, opening balance as one OPENING doc).
- Queries: `queries/purchases.ts` (`purchaseRows` with paid / due / status from active payments, search by farmer / phone / variety / bill no. / amount, date range, status filter; `purchaseTotals`; `farmerSummaries`; `partyLedger` with opening and running balance; `varietyRows` with uses + recents; `bankRows`; `paymentsOf` incl. reversed).
- Entry kit (`components/entry/*`): `DateField` (future blocked, back-date note), `Segmented`, `PartyPicker` with inline new farmer (works offline), `BankPicker`, `VarietyPicker` (recents first, company shown, "Did you mean…" before creating), `WeightBlockInput` (bag by bag with Enter → next bag, chips, delete + undo, live total / bags / average in kg · qtl · mon; or a total in kg / qtl / mon with bag count; deductions only when the business turned them on), `PaymentFields`, `PaymentList` (edit, reverse with reason and a confirmation that states the effect, receipt), `AddPaymentSheet`.
- Screens: Purchase section tabs কেনার তালিকা / কৃষকের হিসাব / ধানের জাত (reports tab stays transitional until Phase 11); `/purchase/new`, `/purchase/edit?id=`, `/purchase/view?id=` (bags, paid / due, payment ledger, + বাকি টাকা দিন, edit, receipt, WhatsApp, reverse with payments, history), `/purchase/farmer?id=` (balance, purchases, ledger, give advance, WhatsApp), `/banks` (avatar menu, owner), print views `/print/purchase` and `/print/payment` (business header + logo, Gola, amount in words, signature; `(print)` route group without app chrome). Quick action "নতুন কেনা" is on. `WhatsAppButton` (`wa.me/91…`, only opens WhatsApp).
- i18n: `rcpt`, `farmerV`, `wa`, `hist` namespaces; v2 document types in `voucherType`; seeded variety names with public codes + IR-36 (D24).
- Tests: `tests/repo/payments.test.ts` (Test 1 through the repo incl. cash vs bank, one op group, full credit moves no cash, overpayment → advance, reversals, LINKED_PAYMENTS, ledger running balance, search / filters, variety recents + merge + duplicate refusal, bank opening once); `tests/e2e/purchase.spec.ts` Test 1 in bn (total weight) and en (bag by bag) at 360 px: inline farmer and bank, ₹1,34,400 → ₹84,400 → ₹54,400 → ₹34,400, three dated payments, refresh, list, farmer balance. Offline spec covers the new routes. Screenshots in `test-results/v2-purchase/` were reviewed.
- The reduced-motion e2e no longer expects cash = 0 (specs share one server); it checks the value is final at once.

**Decisions:** D21 (pay across bills waits for Phase 10), D22 (overpayment), D23 (bank opening), D24 (variety display names).

**Known issues / notes for next phases:** Payments made through FIFO across bills come in Phase 10. Cashbook / bank-book screens for Test 1's cashbook checks arrive in Phase 8 (the domain test `v2-acceptance` already covers them). `components/entry/*` and `PaymentList` / `AddPaymentSheet` are meant to be reused by Sales (`direction="IN"`).

**Exit criteria:** `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm check:no-float` ✅ · `pnpm format:check` ✅ · `pnpm test` ✅ 261 passed, 1 skipped (22 files) · `pnpm build` ✅ · `pnpm check:bundle` ✅ Home JS 243 KB (budget 250) · `pnpm test:e2e` ✅ 5/5.### v2 Phase 6 — Sales — 2026-11-25
**Built:**
- Repo `repo/sales.ts`: `setDeliveryStatus` (time-stamped delivery log), `confirmSaleOrder`, `saveInterGolaTransfer` (SALE in the sender + PURCHASE in the receiver, one Dexie transaction, one op group across both Golas; GOLA-role parties and the matching variety created on first use), `pairedTransferDoc`, `voidInterGolaTransfer` (both halves together). Sales use `saveBillWithInitialPayment` / `payBill` like purchases (advance = IN payment, `isInitial`).
- Queries `queries/sales.ts`: `saleRows` (paid / due / status, search, date range, payment status, delivery status, order / confirmed, party), `saleTotals` (confirmed only; orders counted apart), `customerSummaries`, `stockAvailable` (one position, any date), `openTransitPurchases`. `matchesQuery` is shared with purchases.
- Screens: Sales tabs বিক্রির তালিকা (+ "অন্য গোলায় পাঠান" for the owner) / ক্রেতার হিসাব / ডেলিভারি (counts per status, one-tap next step); `/sales/new`, `/sales/edit`, `/sales/view` (collections with "+ টাকা পেলাম", delivery timeline + next step with note, confirm order, invoice, WhatsApp, reverse with collections, transfer badge), `/sales/customer` (balance, sales, ledger, take advance, WhatsApp), `/sales/transfer`, `/print/sale` (invoice). Sale form: buyer or mill (inline create), product ধান / চাল, variety, bag-wise or total weight, rate → total with formula, advance, due, due date, Confirmed / Order, delivery status, vehicle, driver, notes; under "আরও": source (Gola / direct from a TRANSIT purchase / mill) and charges (noted only). Negative stock → warning with "তবুও সেভ করুন". The quick action "নতুন বিক্রি" is on.
- Shared: `components/entry/PartyAccount.tsx` (`LedgerTable` with links to each source, `AdvanceSheet` IN / OUT; the farmer page uses them too), `components/entry/docPath.ts`. The purchase half of a transfer can't be edited and reverses as a pair.
- i18n: `sl` namespace, `rcpt.invoiceTitle`.
- Tests: `tests/repo/sales.test.ts` (Test 6 incl. customer ledger and cashbook by date, advance in one op group, void with collections, order → confirm once, delivery timeline, search, direct delivery via TRANSIT, inter-Gola transfer + reversal + parties reused, same-Gola refusal); `tests/e2e/sales.spec.ts` Test 6 bn + en at 360 px (inline buyer, stock warning → save anyway, ₹25,000 → ₹15,000 → ₹10,000, ledger dates, delivery step, invoice, list, refresh). Offline spec covers the new routes. Screenshots in `test-results/v2-sales/` were reviewed.

**Decisions:** D25 (direct delivery), D26 (inter-Gola transfer), D27 (delivery steps, orders), D28 (negative stock warning).

**Known issues / notes:** The Sales reports tab stays transitional until Phase 11. Consignment settlement (a sale against a mill dispatch) is Phase 9. The cashbook screen check for Test 6 comes with the Dashboard cashbook (Phase 8).

**Exit criteria:** `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm check:no-float` ✅ · `pnpm format:check` ✅ · `pnpm test` ✅ 270 passed, 1 skipped (23 files) · `pnpm build` ✅ · `pnpm check:bundle` ✅ Home JS 243 KB · `pnpm test:e2e` sales + offline ✅ (full suite re-run at Phase 8).
### v2 Phase 7 — Daily Expenses — 2026-11-25
**Built:**
- Queries `queries/expenses.ts`: `expenseRows` (by expense date or by payment date, category, status incl. OPEN, search by title / person / number / amount), `unpaidExpenses` (earliest due first), `expenseTotals`, `expenseDay` (incurred by category, money out that day incl. the cash part, the farmer-payments block), `categoryList`, `openPurchasesOf` (farmer-payment flow).
- Screens: Expenses tabs আজকের খরচ (any day with ◀ ▶) / সব খরচ (filters, totals, "খরচের ধরন সাজান") / বাকি খরচ (total, pay button → `AddPaymentSheet`); `/expenses/new` (title, category chips + "নতুন ধরন", amount, expense date, entry date shown read-only, person: party or typed name, "এখনই পুরো দিলাম" / "কিছু দিলাম" / "এখনও দিইনি" with the actual payment date, mode, bank, reference; due date; notes; `?category=` preset), the farmer-payment flow inside the form, `/expenses/edit`, `/expenses/view` (paid / still to pay, payments with their dates, "+ পেমেন্ট দিন", edit, void with payments, WhatsApp to a party, history). Quick action "খরচ" is on. `PaymentFields` gained `hideAmount`.
- i18n: `xp` namespace; v2 category names (কৃষক পেমেন্ট, লেবার খরচ, লোডিং/আনলোডিং, ডিজেল, গাড়ির খরচ, অফিস খরচ).
- Tests: `tests/repo/expenses.test.ts` (Test 5 incl. cashbook ₹3,000 on the expense date and ₹2,000 today, counted once; unpaid → void with payments; FARMER_PAYMENT refused as expense; farmer payments shown but under "cash paid"; custom / hidden categories); `tests/e2e/expenses.spec.ts` Test 5 bn + en at 360 px (+ day view, unpaid list, farmer-payment flow, filter by payment date). Offline spec covers the new routes. Screenshots in `test-results/v2-expenses/` were reviewed.

**Decisions:** D29 (day view), D30 (farmer payment from the expense form), D31 (categories).

**Known issues / notes:** Expense reports (category-wise, month comparison, chart) are Phase 11. Linking an expense to a vehicle / trip comes with Phase 10.

**Exit criteria:** `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm check:no-float` ✅ · `pnpm format:check` ✅ · `pnpm test` ✅ 275 passed, 1 skipped (24 files) · `pnpm build` ✅ · `pnpm check:bundle` ✅ Home JS 244 KB · `pnpm test:e2e` expenses + offline ✅.
### v2 Phase 8 — Dashboard — 2026-11-25
**Built:**
- Queries `queries/dashboard.ts` (one Gola): `golaOverview` (flows in the range, balances at its end, per-day purchase / sales series, cash and bank flow summary, paddy by variety, mills, receivable / farmer payable / mill payable by party role), `recentEntries`, `dueAlerts` (overdue + due within 3 days, collect vs pay), `lowStockAlerts`, `cashbookView` (one day of the cash or a bank book, bank closings, closed / late-entry state), `dailyRows`, `docsOfDay`, `golaMoves`. `queries/consolidated/dashboard.ts`: the all-Golas sum (`overviewFor`, `recentFor`, `alertsFor`, `dailyRowsFor`, `movesFor`), read-only.
- Repo `repo/daily.ts`: `closeDay` (expected from the cashbook, counted, difference, note, denominations), `reopenDay` (owner), `saveContra` (deposit, withdraw, bank → bank, capital in, drawings), `saveOpeningCash` (once), `saveOpeningStock`, `approveStockCount`.
- Screens (all four Dashboard tabs; each loads on demand):
  - সারাংশ: date filter আজ / গতকাল / এই সপ্তাহ / এই মাস / custom (shared with দৈনিক হিসাব); the 14 metric cards with count-up and drill-down links; the per-Gola table in combined mode; the purchase-vs-sales bar chart (recharts, lazy; a tap opens that day); the cash / bank money-flow summary; the stock summary with paddy by variety; due alerts with WhatsApp; low-stock alerts; recent transactions (readable titles, IST time); quick actions.
  - ক্যাশবই: any date ◀ ▶; cash or each bank; opening, received, paid, expenses, expected with the written formula; the day's lines in three groups with "সংশোধন"; day close with the note-counting helper; owner reopen; late-entry banner; cash moves; opening cash.
  - স্টক: any date; ধান / চাল / অন্যান্য; variety filter; kg / quintal / mon. Paddy lines (each opens its movements with links), expected closing, physical count → shortage / excess → reasoned approval. Per-mill block, rice block, other products, 14-day history, opening stock.
  - দৈনিক হিসাব: day rows for the range with a totals row, a sticky date column, print; `?day=` single-day entries.
- Shared: `components/entry/docLabel.ts` (`docTitle`, `timeIST`), `components/dashboard/range.tsx`.
- Bundle: dashboard tabs dynamic; 35 unused v1 i18n namespaces removed (D32). Home JS is 237.9 KB.
- Tests: `tests/repo/dashboard.test.ts` covers:
  - Test 4: ₹30,000 expected; ₹29,500 counted → short ₹500 → next opening ₹29,500; reopen and count ₹30,200 → excess ₹200 → next opening ₹30,200; a note is required; a second close is refused; a late entry raises the flag.
  - Cash ↔ bank, capital and drawings.
  - Test 2 numbers: 100 + 56 − 10 − 20 = 126, mill 20.
  - Overview flows vs balances.
  - Physical count → adjustment.
  - Daily rows and recent entries.
  - Combined = sum of the Golas.
  - Due and low-stock alerts.
- e2e `tests/e2e/dashboard.spec.ts` runs in bn and en at 360 px: Test 4 through the UI, then opening stock, count → adjustment, the Overview with "this month", and the Daily Overview with a custom range → day view. The offline spec covers `?tab=stock`, `?tab=daily` and the day view. Screenshots in `test-results/v2-dashboard/` were reviewed; recent-entry and cashbook titles were fixed after that review.

**Decisions:** D32–D36.

**Known issues / notes:**
- Test 2's mill dispatch is entered through the UI in Phase 9; the domain and repo tests already cover it.
- The Dashboard reports tab (business-wide, Gola-wise, combined) and Excel/CSV export are Phase 11.
- Due-alert links for mill / trip / second-party bills open once those screens exist (Phases 9–10).

**Exit criteria:** `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm check:no-float` ✅ · `pnpm format:check` ✅ · `pnpm test` ✅ 281 passed, 1 skipped (25 files) · `pnpm build` ✅ · `pnpm check:bundle` ✅ Home JS 237.9 KB · `pnpm test:e2e` ✅ 11/11 (Tests 1, 4, 5, 6 in bn + en, shell, reduced motion, cold offline).

### v2 Phase 9 — Mill & Second Party — 2026-11-25
**Built:**
- Domain: `validateLinks` accepts an IN payment against a mill return from that return's mill (D37). No other domain change: dispatch / return / conversion posting and `dispatchBalance` were already in place (Phase 1).
- Repo `repo/mill.ts`: `saveMillReturn` (return + money received from the mill, one op group), `findDuplicateReturn` (same dispatch, date, product, quantity within 10 minutes), `settleConsignment` (CONFIRMED sale to the mill from mill stock, linked to the dispatch; advances re-pointed onto the sale, D38), `voidSettlement` (advances back to the dispatch, sale voided). `payAdvance` / `AdvanceSheet` take `sourceType` SECOND_PARTY for on-account second-party money; `AdvanceSheet` also takes a custom `onSave`.
- Queries `queries/mill.ts`: `dispatchRows` (type / open / search / status filters, dispatch-wise balance, MILLING payable state), `dispatchDetail`, `returnRows`, `convertibleReturns`, `conversionRows`, `conversionBps`, `secondPartySummaries`, `secondPartyEntries`, `secondPartyOnAccount`.
- Screens (section 8, all tabs except reports): সেকেন্ড পার্টি খাতা (parties with balance, totals) + `/mill/party` (balance, entries, on-account money given / received, ledger, WhatsApp) + `/mill/entry/{new,edit,view}`; মিলে পাঠানো list + `/mill/dispatch/{new,edit,view}` (type toggle with explanation, negative-stock warning, MILLING payable with payments, CONSIGNMENT advances, sent / returned / milled / sold / at mill, add return / conversion / settle, reverse blocked while linked records exist); মিল থেকে ফেরত list + `/mill/return/{new,edit,view}` (paddy / rice / other, more-than-at-mill and duplicate confirmations, optional valuation, money received); ভাঙানোর হিসাব list + `/mill/conversion/{new,edit,view}` (pick outputs from the dispatch's returns, `consumed − outputs = loss` with confirmation, yield %); কনসাইনমেন্ট নিষ্পত্তি tab (open consignments with "নিষ্পত্তি করুন", settled sales) + `/mill/settle`. Shared `components/mill/common.tsx` (Cell, HistoryPanel, ReverseButton). The sale detail shows a settlement badge, blocks editing a settlement sale and reverses it with `voidSettlement`. `docPath` opens the mill and second-party screens. Quick action "মিলে পাঠানো" is on. `VarietyPicker` takes a `label`.
- i18n: `mill` namespace (bn + en).
- Tests: `tests/repo/mill.test.ts` (Tests 2 and 3 through the repo incl. rice only to rice stock; conversion takes the paddy out of the mill and blocks voiding its returns; conversion needs MILLING; money with a return, wrong direction refused, void with payments; duplicate window; MILLING charges payable and paid; consignment advance → settlement → reversal; advance larger than the sale stays; second-party entries, partial payments, on-account money and balance; stored == replay). `tests/unit/assert-migrated.test.ts`. e2e `tests/e2e/mill.spec.ts` bn + en at 360 px: opening 100 → purchase 56 → sale 10 → dispatch 20 → Gola 126 / mill 20; paddy return 5 → 131 / 15; rice return 3 only to rice; dispatch detail balance; second-party entry with a later payment. Offline spec covers every new route. Screenshots in `test-results/v2-mill/` were reviewed (rice-variety label fixed after review).

**Decisions:** D37–D40.

**Known issues / notes for next phases:**
- Phase 10: Due & Advance must not count a CONSIGNMENT dispatch's expected value as a receivable (D39); mill payables = MILLING charges + the mill party ledger. Load khata "create dispatch from this load": `DispatchForm` already takes `preset` and `linkedLoadId`.
- Phase 11: mill reports (dispatch, return, mill stock, conversion, second-party ledger) and the second-party statement print.
- A sale entered from the Sales form with source "মিল থেকে" is still possible without a consignment link (for MILLING paddy sold at the mill); consignments are settled from the Mill section.

**Exit criteria:** `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm check:no-float` ✅ · `pnpm format:check` ✅ · `pnpm test` ✅ 292 passed, 1 skipped (27 files) · `pnpm build` ✅ · `pnpm check:bundle` ✅ Home JS 240.1 KB · `pnpm test:e2e` ✅ 13/13 (Tests 1–6 in bn + en, shell, reduced motion, cold offline).
### v2 Phase 10 — Load Khata, Due & Advance, Vehicle — 2026-11-25
**Built:**
- Domain: `dueBillsOf` (bills that are really owed: no consignment expected value, no order; D39). The dashboard due alerts use it.
- Repo: `repo/loads.ts` (`saveLoad` with "update the linked record too", `linkLoad`, `unlinkLoad`, `linkFromLoadItem` for create-from-load, `activeLinkOf`; 1:1 checked on both sides, D42), `payParty` (one amount across bills + advance, one groupId, D43), `saveBillWithInitialPayment` takes `extra` items (same op group), `repo/trips.ts` (`saveTrip`: trip + advance + costs paid now in one op group; a paid cost can't be removed).
- Queries: `queries/loads.ts` (`loadRows`, `groupLoads` by date / party / mill / vehicle with totals and unlinked count, `linkCandidates` ranked by date, vehicle, mill, variety), `queries/dues.ts` (`dueCategory`, `partyDues` with opening / total / paid / remaining = ledger / earliest due / overdue / last date, `dueSummary` with aging, `openBillsOf`, `reminderRows` auto + manual with state, `reminderWhen`), `queries/vehicles.ts` (`tripRow`, `tripRows`, `vehicleSummaries`, `tripCustomerSummaries`, `pnlByPeriod` by day / month).
- Screens: Load Khata (তারিখ / পার্টি / মিল / গাড়ি tabs with totals, search, "যুক্ত নয়" filter; `/loads/new|edit|view` with link / unlink / create sale or dispatch from the load; `/print/load` slip). `SaleForm` / `DispatchForm` take `fromLoad` (`/sales/new?load=`, `/mill/dispatch/new?load=`). Due & Advance (সারাংশ with category cards, aging table, biggest dues; পাওনা / দেনা / মিলের দেনা / অগ্রিম / অন্যান্য rows with opening, total, settled, overdue, call and WhatsApp; রিমাইন্ডার with done / snooze 3 days / change date / manual reminders; `/dues/party` ledger with date range, open bills, pay / collect across bills, print; `/dues/pay?direction=` for the quick actions). Vehicle Business (ট্রিপ list, গাড়ি অনুযায়ী with add / edit vehicle and P&L by cost kind, খদ্দের অনুযায়ী, আয়-খরচ by day / month per vehicle; `/vehicles/trip/new|edit|view` with collections, per-cost payments, live net profit and its formula). The expense form can name a vehicle (D44). All 8 quick actions are on. `AddPaymentSheet` takes `sourceId` (trip costs); `VehiclePicker` / `VehicleForm`.
- i18n: `ld`, `dues`, `veh` namespaces (`due` is still a v1 namespace; Phase 12 cleans it).
- Tests: `tests/repo/loads-dues-trips.test.ts` (linked load never double-deducts incl. create-from-load, 1:1 both ways, update-linked, unlink, void → not linked, dispatch link; remaining == ledger for every party, categories, consignment not due, aging, reminders + done; FIFO across bills with advance and one group, over-allocation refused; trip with advance and costs paid now, net profit, later cost payment, paid cost not removable, vehicle P&L). e2e `tests/e2e/loads-dues-trips.spec.ts` bn + en at 360 px (load → sale from load: 50 → 30, edit load to 22 → 28; ₹12,000 across two bills → ₹2,000 advance; trip net ₹4,500, due ₹5,000). Offline spec covers every new route. Screenshots in `test-results/v2-p10/` were reviewed.

**Decisions:** D41–D44.

**Known issues / notes for next phases:**
- Phase 11: Load / Due / Vehicle report tabs, vehicle income chart, trip receipt, the party statement as a proper print / share (today: browser print of the ledger page).
- The optional daily web-push due digest (§12.6) uses the v1 push code; Phase 12 checks it against the v2 reminders.

**Exit criteria:** `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm check:no-float` ✅ · `pnpm format:check` ✅ · `pnpm test` ✅ 297 passed, 1 skipped (28 files) · `pnpm build` ✅ · `pnpm check:bundle` ✅ Home JS 241.9 KB · `pnpm test:e2e` ✅ 15/15.
### v2 Phase 11 — Reports, print, export, voice, WhatsApp — 2026-11-25
**Built:**
- Reports (§13): `client/reports/model.ts` (exact cells, auto totals, per-Gola merge, CSV with BOM), `defs.ts` (32 reports: daily purchase, purchase register, farmer ledger; daily sales, sales register, customer ledger, delivery status; daily / category-wise (+ chart) / month-wise / unpaid expenses; load register grouped by date / party / mill / vehicle; due & advance, aging, reminders, party ledger; vehicle income (+ chart), vehicle profit by vehicle / month / day; mill dispatch, mill return, mill stock, milling conversion, second-party ledger; date-range report, monthly business summary with gross profit, Gola-wise, all Golas combined, daily overview, cash book / bank book, daily stock, paddy stock, rice & other stock), `run.ts` (scope: one Gola or all, D45). UI `components/reports/ReportView.tsx` (`ReportsTab`: report chips, date presets / one date, report filter incl. party / bank pickers; `ReportDoc` header with business + logo, Gola or সব গোলা, period, generated-at; table with sticky first column + totals; lazy `ReportChart`; `ReportActions`: Print, Excel, CSV, share image), `LazyReports` in every section's রিপোর্ট tab (all `NotBuiltYet` placeholders are gone; the component was removed), `/print/report` (A4 / 80 mm; 80 mm prints rows as label: value blocks). Print CSS: wide tables print whole. Excel writer takes `preface` lines.
- Receipts: "share as image" on every receipt (`ReceiptSheet`), `/print/trip` (vehicle hire receipt, linked from the trip), second-party statement and Due & Advance party statement print as the party-ledger report.
- Voice (§14.1): `components/voice/VoiceButton.tsx` (+ `VoiceText`), in rate fields (`RateInput`, `voice` prop on number fields), manual weight, every picker search, the expense title and the notes of all entry forms (D46).
- i18n: `rep`, `voice` namespaces; `veh.receipt*`.
- Tests: `tests/repo/reports.test.ts` (reports reconcile with the dashboard: purchase / sales / expense flows, cash book day by day = cashbook screen, daily overview = Daily Overview rows, Gola-wise = each Gola and total = combined = sum, merged per-Gola reports, due & advance = ledger, party ledger closing = balance, every report builds for one and all Golas; CSV exact decimals + BOM + escaping), `tests/unit/voice-button.test.tsx` (unsupported → disabled mic; spoken number confirmed before filling; text inserted). e2e `tests/e2e/reports.spec.ts` bn + en (purchase register with totals, Excel + CSV downloads with exact decimals, print page 80 mm, Gola-wise, every section's reports tab, mics present). Offline spec covers the report tabs and print pages. Screenshots in `test-results/v2-reports/` were reviewed (80 mm layout changed to blocks after review).

**Decisions:** D45–D47.

**Known issues / notes for Phase 12:**
- The v1 `due` and other partly used v1 i18n namespaces still exist; Phase 12 runs the i18n-usage cleanup (`tests/unit/i18n-usage.test.ts` is paused).
- Reports run over the device's data on demand; very long ranges (> 400 days) are capped for the per-day reports.

**Exit criteria:** `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm check:no-float` ✅ · `pnpm format:check` ✅ · `pnpm test` ✅ 307 passed, 1 skipped (30 files) · `pnpm build` ✅ · `pnpm check:bundle` ✅ Home JS 243.1 KB · `pnpm test:e2e` ✅ 17/17 · reports reconcile with the dashboard ✅.
### v2 Phase 12 — Hardening — 2026-11-25
**Built / fixed:**
- Header search (`/search`: parties in either script or by mobile, entries by number / party / vehicle / amount) and the notifications bell (overdue + today reminders → Due & Advance → রিমাইন্ডার), both loaded after start-up (D48). The logo mark is hidden on phones so the header fits 360 px.
- Settings (`/settings`, avatar menu): theme, where units / deductions / thresholds / language / sessions are set, Excel export of all registers (from the device), JSON backup per Gola or all (owner, online), the integrity check per Gola (trial balance, re-posting, stock that went below zero, stale unsent work, server comparison; D51). `domain/integrity.negativePositions`.
- Business-wide reports (Gola-wise, combined) always cover every active Gola (D49).
- Push digest counts automatic reminders (open bills with a due date + the owner's done / snooze state), links to the v2 reminders tab, says "ধান গোলা"; the English digest no longer prints a literal `{Gola}`.
- i18n: 323 unused (mostly v1) keys deleted, the "every key is used" test is back on (template keys counted), a new placeholder-parity test (D50).
- UI bugs found by the new acceptance e2e and fixed: the variety manager was wider than 360 px (search row without `min-w-0`; merge / put-away buttons on unused varieties) — the row now wraps.
- The migration guard `DATA_NOT_MIGRATED` (login and every authenticated call refuse a database not yet run through `migrate:v2`) was completed and tested before Phase 9.
- Tests: `tests/repo/edit-reversal.test.ts` (Test 10: purchase, payment, sale, expense, dispatch edited in quantity / amount / date → stock, cashbook on old and new dates, dues, register; edit-back restores; void restores every account total and stock position; no duplicates), `tests/unit/integrity-negative.test.ts`, `tests/unit/i18n.test.ts` (placeholders), `tests/sync/phase5.test.ts` (digest with an automatic reminder), e2e `tests/e2e/acceptance.spec.ts` (Test 7 two Golas + Gola-wise total = sum; Test 8 refresh, offline cold reload, logout / login, second browser profile; Test 11 search, bell, settings integrity "all good", empty state, every tab of every section at 360 / 768 / 1280 px in bn and en). Offline spec covers `/settings`, `/search`.

**§21 acceptance status:** Tests 1–6 (domain + repo + e2e bn/en), 7 and 8 (Vitest + e2e), 9 (Vitest: isolation, crafted requests, recomputation), 10 (repo + property tests), 11 (e2e) all pass; plus golden G1–G8, property tests, sync idempotency / conflicts, cold-offline for all 8 sections and every sub-route, voice parser and voice button, i18n parity.

**Known issues / for the client (UAT):**
- D10 is still OPEN for the client: whether a mill return's value can be a receivable (today: valuation only).
- Native-speaker review of the Bengali wording; `docs/UAT-CHECKLIST.md` is for the client's walk-through.
- Voice input needs the network on Chrome (shown as disabled offline, D46).

**Exit criteria:** `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm check:no-float` ✅ · `pnpm format:check` ✅ · `pnpm test` ✅ 313 passed (32 files) · `pnpm build` ✅ · `pnpm check:bundle` ✅ Home JS 242.3 KB · `pnpm test:e2e` ✅ 21/21 · `pnpm lighthouse` not run in this session.

### UI refresh (premium redesign) — 2026-11-26
**Built:** looks only; every behaviour, route and test id is unchanged (D52).
- Design system in `src/app/globals.css`: richer emerald + saffron palette (light + dark), a brand wash behind pages, one accent gradient per section (`.accent-*`), tones (`.tone-*`), `.hero` banners with a paddy-sheaf watermark, `.glass`, layered shadows; CSS-only motion (`anim-rise/zoom/pop/grow-x`, reduced motion → instant).
- Controls each have their own look: raised gradient `Button`s (new `gold` variant, 44 px default), underline `.tab`s in a sticky `.tabbar`, check-mark `.chip`s (all filter chips), corner-check `.choice` cards (form radios), `.seg` switches. Section "New …" tabs are now white buttons in the hero (same `stab-*` test ids).
- Shell: dark-green gradient sidebar with accent icon tiles, glass header, Gola initial avatar, glass bottom bar with an accent pill for the active section, gold quick-add FAB, coloured all-sections / quick-action tiles. Forms: section-coloured header, glass save bar with check icon. Auth: gradient band + white logo, segmented language switch. Splash / bootstrap / banners / toasts / dialogs / sheets restyled.
- Kit: `MetricCard` / `TxnCard` gradient tiles by tone, `StatusPill` with dot, `EmptyArt`, `Panel` with icon + tone.
- Charts: `components/charts/Donut` (SVG), `LazyTrendChart` / `LazyBarsChart` (recharts, lazy). Dashboard: "money in hand" hero, 30-day trend (cash / bank or purchase / sales; `golaTrend` / `trendFor`), dues donut, stock-by-variety donut, gradient bar chart. Expenses: by-category donut (day and all). Dues summary: donut + per-category icons / tones. Vehicles P&L: income / costs / net bars. `--chart-1…8` order validated for colour blindness (light + dark).
- Tests: `tests/repo/dashboard-trend.test.ts`. Visual baselines regenerated.

**Note:** entrance animations must fill `backwards` only — a transform that keeps filling turns the page wrapper into the containing block of the full-screen forms (found in the screenshots, fixed).

**Exit criteria:** `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm check:no-float` ✅ · `pnpm format:check` ✅ · `pnpm test` ✅ 316 passed (33 files) · `pnpm build` ✅ · `pnpm check:bundle` ✅ Home JS 244.3 KB · `pnpm test:e2e` ✅ 21/21 · `pnpm lighthouse` not run.
