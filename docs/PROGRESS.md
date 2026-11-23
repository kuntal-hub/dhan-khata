# Build progress

Legend: ⬜ not started · 🟡 in progress · ✅ done (exit criteria green + committed)

| Phase | Title | Spec phases | Status |
|---|---|---|---|
| 1 | Foundations & Domain Core | P0 + P1 | ✅ |
| 2 | Offline Data, Auth, Sync & PWA Shell | P2 + P3 + P4 | ⬜ |
| 3 | Masters, Parties & Trade Flow | P5 + P6 | ⬜ |
| 4 | Daily Money, Dashboard, Vehicles, Stock & Godowns | P7 + P8 | ⬜ |
| 5 | Reminders, Reports, Export, Ops & Hardening | P9 + P10 + P11 (automatable) | ⬜ |

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
