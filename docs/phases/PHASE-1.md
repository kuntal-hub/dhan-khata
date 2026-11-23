# Phase 1: Foundations & Domain Core (spec P0 + P1)

## Goal
Set up a working, type-safe, lint-guarded Next.js 16 project with a complete bilingual i18n framework and the **pure domain layer**. The domain layer covers money and weight math, Zod schemas, the per-godown chart of accounts, `postLedger`/`postStock` for every voucher type, the calc modules, allocation and aging, all proven by golden and property tests. This phase builds no database and no real screens.

## Read from `requirement.md`
§0 (how to use) · §1.2 glossary · §1.3 seasons · §1.4 godown isolation · §3.3 · §3.5 · §3.6 · §4 tech stack · §5 architecture · §6 accuracy rules (all) · §7 accounting model (all) · §8.1–8.3 data model · §11.4 bilingual · §20 project structure · §24 seed data

## Checklist

### A. Repo & tooling
- [x] `git init`. Add a `.gitignore` covering node_modules, .next, .env*, coverage, playwright artifacts and `*.local.*`.
- [x] `.npmrc` with `node-linker=hoisted` (the project lives in OneDrive).
- [x] Scaffold Next.js 16 with the latest stable versions: App Router, TypeScript `strict`, `src/` dir, Tailwind CSS v4, ESLint, the `@/*` alias. Pin **exact** versions in `package.json`. Turbopack is the default.
- [x] Extra tsconfig strictness: `noUncheckedIndexedAccess`, `noImplicitOverride`. Target ES2022 or higher, which BigInt literals need.
- [x] Prettier + `prettier-plugin-tailwindcss`.
- [x] shadcn/ui init with a paddy-green theme (`#2F7D32`-ish accent), light by default with dark tokens. Add only button, input, label, card, sheet/drawer (vaul), dialog, dropdown-menu, sonner, tabs, badge. Add lucide-react.
- [x] Redux Toolkit store skeleton in `src/store`: slices `session`, `activeGodown`, `locale` (language + digits), `sync`, `ui`. Add a provider in the root layout.
- [x] ESLint rules:
  - [x] **No-float rule** for `src/domain/**`: forbid `parseFloat`, `toFixed`, `Number(`, `Math.round`, and `*` or `/` on `number`. Use a custom local rule or `no-restricted-syntax` / `no-restricted-globals`, plus a CI grep script `scripts/check-no-float.mjs`.
  - [x] **No JSX literals** (`react/jsx-no-literals` or `eslint-plugin-i18next`), with an allowlist for ₹ % / × − + : · ▾ ◀ ▶ and similar symbols.
- [x] Vitest (jsdom for components, node for domain) and fast-check. Scripts: `dev`, `build`, `typecheck` (`tsc --noEmit`), `lint`, `test`, `test:watch`, `check:no-float`, `format`.
- [x] `.github/workflows/ci.yml`: install with pnpm, then typecheck, lint, check:no-float, test.
- [x] Update the **Commands** section of `CLAUDE.md` with the real scripts.

### B. i18n framework (`src/i18n`)
- [x] `bn.ts` is the canonical nested dictionary with namespaces from §11.4 (`common`, `nav`, `dashboard`, `purchase`, `sale`, `load`, `expense`, `due`, `vehicle`, `payment`, `stock`, `godown`, `reports`, `settings`, `sync`, `errors`, `account`, `voucherType`, `payMode`, `expenseCategory`, `variety`, `season`, `whatsapp`). Seed it with the glossary terms (§1.2), the seed data labels (§24), the account names (§7.1) and the shell strings. Later phases add keys as they go.
- [x] `en.ts` declared as `satisfies Dictionary`, so a missing key fails `tsc`.
- [x] `I18nProvider` and `useT()` with typed key paths, `{var}` interpolation and plurals via `Intl.PluralRules`. Switching is instant, with no reload and no URL locale. Update `<html lang>` on switch.
- [x] `format.ts`: `formatMoney(paise, {digits})` (Indian grouping, ₹), `formatWeight(grams, {mode: 'qtlKg'|'kg', lang, digits})`, `formatRate`, `formatDate(ymd, lang)` (date-fns `bn` / `enIN`), and `toBnDigits` / `normalizeDigits`.
- [x] `translit.ts`: a Bengali↔Latin phonetic `searchKey(name)` with unit tests for common names (রহিম শেখ ↔ rahim shekh, etc.).
- [x] `zodErrorMap.ts`: maps Zod issues to `errors.*` keys.
- [x] Test: both dictionaries have **identical key sets**, and no value is empty.
- [x] Fonts: self-hosted Noto Sans Bengali (or Hind Siliguri) + Inter via `next/font`, with the font stack chosen by language. Bengali line-height ≥ 1.5.

### C. Domain primitives (`src/domain`)
- [x] `rounding.ts`: `divRoundHalfUp(a, b)`, half away from zero (G8).
- [x] `money.ts`: branded `Paise`, `RatePaisePerQtl`, `Bps`. `parseRupees` accepts Bengali/English digits and both comma styles, rejects more than 2 decimals, and returns a typed error code, never a silent round. Also `paiseToJson` / `paiseFromJson` (decimal strings) and `nearestRupee`.
- [x] `weight.ts`: branded `Grams`, `parseKg` (≤ 3 decimals), quintal/kg conversions (integer only), and a parser for "12 কু. 45.5 কেজি" input.
- [x] `amountInWords.ts`: `amountInWords(paise, 'bn'|'en')` using the Indian system (lakh/crore, লক্ষ/কোটি), with unit tests for both languages.
- [x] `dates.ts`: IST "today", FY string ("2026-27"), season from date using a configurable season map (default from §24), and a `YYYY-MM-DD` validator.
- [x] `numbering.ts`: `formatVoucherNumber(godownCode, deviceCode, type, seq)` → `RP-A-PUR-000123`, the type code map, and the device code sequence A…Z, AA…
- [x] `scope.ts`: `assertSameGodown(voucher, refs)`, which throws/returns `CROSS_GODOWN_REFERENCE`.

### D. Schemas (`src/domain/schemas`)
- [x] `BaseDoc`, plus `Godown`, `Party`, `Variety`, `BankAccount`, `Vehicle`, `Place`, `ExpenseCategory`, `DeductionDefaults` (§8.1).
- [x] Voucher schemas as a discriminated union on `type`: PURCHASE, SALE, LOAD, PAYMENT, RECEIPT, EXPENSE, TRIP, CONTRA, STOCK_ADJUST, MILL_SETTLEMENT, DAY_CLOSE, OPENING, JOURNAL (§8.2). Design reasonable shapes for CONTRA, STOCK_ADJUST, DAY_CLOSE, OPENING and JOURNAL from §7.2.
- [x] `LedgerLine`, `StockMove`, `Reminder`, `GodownSettings`, `DayStatus`, `User` (with `godownAccess`), `Device`, `OutboxOp` (§8.3–8.4).
- [x] Money and weight fields are strings of integers, validated by regex. `.strict()` rejects unknown fields. `godownId` is required.

### E. Calc modules (`src/domain/calc`)
- [x] `purchase.ts`: line deductions (tare, dhalta in 3 modes, moisture on gross−tare, other), net > 0, line amount, charges, round-off, total (§6.3).
- [x] `sale.ts`: lines (same shape), loading amount, delivery/freight amount, vehicle-advance due, net receivable, profit estimate inputs.
- [x] `load.ts`: net, total at mill rate, commission, and builders for the linked PURCHASE (TRANSIT) + SALE in OWN_TRADE mode.
- [x] `trip.ts`: freight (per qtl or fixed), expenses total, due.
- [x] `settlement.ts`: mill net, final amount, difference, shortage.
- [x] `recomputeVoucher(v)`: recomputes every derived field for any voucher type. The server uses it to detect `CALC_MISMATCH`.

### F. Posting (`src/domain/posting`)
- [x] `accounts.ts`: account key builders (`CASH`, `BANK:<id>`, `PARTY:<id>`, `EXP:<code>`, `VEH_INCOME:<id>`, `VEH_EXP:<id>:<type>`, …), `seedChartOfAccounts(godownId)`, the account type map, and the sign convention (party > 0 = পাওনা).
- [x] `postLedger(voucher, ctx)` covers every row of §7.2, including COGS at weighted-average cost, mill pays freight directly, cheque in hand/clear/bounce, day-close diff, and both halves of the inter-godown pair. Every line carries `godownId` + dimension tags. A void produces no lines.
- [x] `postStock(voucher, ctx)`: STORE/TRANSIT moves with qty and value at cost, a weighted-average cost per (godown, variety), and specific cost for direct loads through TRANSIT.
- [x] `allocation.ts`: FIFO allocation of payments to the oldest open bills, manual override, and a bill status of Open / Partially paid / Settled.
- [x] `aging.ts`: buckets 0–30, 31–60, 61–90, 90+.

### G. Tests (`tests/unit`, `tests/property`)
- [x] Golden tests **G1–G10** (§6.4), exactly as written. G10 is a pure test that sums the CASH ledger lines per godown.
- [x] Table-driven `postLedger` expectations for **every** voucher type.
- [x] Property tests (§6.5), `numRuns: 1000` each: Σdebit == Σcredit for random valid vouchers of every type; party balance from lines == balance from replaying vouchers; stock per (godown, variety) correct, with no cross-godown effect, and void restores the state; edit then edit back gives an identical ledger; parse→format→parse round-trips for money and weight in both digit sets.

### H. App shell
- [x] Root layout with providers (Redux, I18n, sonner Toaster). A minimal home page shows the app name, a sample formatted amount (₹২৬,০৬৮.৭৫ / ₹26,068.75), a sample amount-in-words, and a 🌐 language toggle plus a digits toggle. Every string comes from i18n.

## Key files
`package.json`, `.npmrc`, `eslint.config.mjs`, `vitest.config.ts`, `.github/workflows/ci.yml`, `scripts/check-no-float.mjs`, `src/i18n/*`, `src/domain/**`, `src/store/*`, `src/app/layout.tsx`, `src/app/page.tsx`, `tests/unit/**`, `tests/property/**`

## Exit criteria (all must pass)
```
pnpm typecheck
pnpm lint
pnpm check:no-float
pnpm test          # golden G1–G10, every voucher-type posting test, property tests @1000 runs, i18n parity, amountInWords, translit
pnpm build
```
Also run `pnpm dev` and confirm the shell switches between বাংলা and English without a reload.

## Do NOT do in this phase
Dexie / IndexedDB, MongoDB, auth, sync, Serwist/PWA, and real feature screens all belong to later phases.
