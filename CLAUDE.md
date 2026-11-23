# Dhan Khata (ধান খাতা): project guide for Claude Code

Dhan Khata is an offline-first, bilingual (বাংলা / English) PWA for a paddy broker in West Bengal who runs several godowns. **Each godown is an independent business with its own books.** It is built with Next.js 16, Dexie (IndexedDB), MongoDB Atlas (free tier) and Serwist, and hosted on Netlify Free.

**Source of truth: `requirement.md`.** It is about 1,280 lines and 42k tokens, so **never read it whole**. Find a section with Grep (for example pattern `^#{2,3} 9\.2` with `-n`), then Read it with `offset`/`limit`.

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
- `pnpm build` / `pnpm start`: production build and server
- `pnpm typecheck`: `tsc --noEmit`
- `pnpm lint`: ESLint, including the no-float rule (`src/domain`) and the no-JSX-literal rule (`src/app`, `src/components`)
- `pnpm check:no-float`: grep guard over `src/domain`. A line may opt out only with `// float-ok: <reason>`, and only for non-money integer indices.
- `pnpm test`: Vitest (unit + property). Component tests opt in with `// @vitest-environment jsdom`.
- `pnpm format` / `pnpm format:check`: Prettier
- `pnpm test:e2e`: Playwright (added in Phase 2)

## Key building blocks (from Phase 1)
- Money and weight: `src/domain/{money,weight,decimal,rounding,digits}.ts`, plus `divRoundHalfUp` and `allocateProportional`.
- Voucher calcs: `src/domain/calc/*`. `recomputeVoucher`, `verifyVoucher` (returns CALC_MISMATCH paths) and `validateVoucherRules` are in `calc/recompute.ts`. Linked-voucher builders (`paidNowPaymentDraft`, `saleLinkedDrafts`, `loadLinkedDrafts`) return drafts.
- Posting: `src/domain/posting`. `post`, `postLedger` and `postStock` take a `PostingContext` (stock position before the voucher). `replay` + `StockBook` rebuild everything in canonical order. `toLedgerLineDocs` / `toStockMoveDocs` serialize the results.
- Scope: `src/domain/scope.ts` provides `collectRefs`, `checkSameGodown` and `assertGodownUnchanged`.
- i18n: `useI18n()` / `useT()` from `src/i18n/I18nProvider.tsx`, plus framework-free `translate()` (`src/i18n/translate.ts`) and formatters (`src/i18n/format.ts`). Cross-script search lives in `src/i18n/translit.ts`.
- Test factories: `tests/helpers/factory.ts` (`mk`, `line`) and `tests/property/arbitraries.ts`.

## Environment notes
- Windows 11. **The Bash tool fails in this environment (fork errors). Use the PowerShell tool.**
- The project folder is **inside OneDrive** (the user chose to keep it there). `pnpm-workspace.yaml` sets `nodeLinker: hoisted` to avoid symlink problems. If `pnpm install` or a build fails with EPERM / EBUSY / file-locked errors, ask the user to **pause OneDrive sync** and retry.
- PowerShell 5.1 `Set-Content -Encoding utf8` writes a BOM. Write files with the Write/Edit tools, or with `[IO.File]::WriteAllText(..., (New-Object Text.UTF8Encoding $false))`.
- Next.js **16.4** has `cacheComponents` enabled. `AGENTS.md`, which `next dev` maintains, says to read `node_modules/next/dist/docs/` before using Next APIs. Prerender must be deterministic, so `src/app/providers.tsx` gates the whole app to the client: the static HTML is a splash, and the UI renders from the device. Keep it that way, because pages must never depend on server render.
- Node 24, pnpm 10, git 2.52.
- Client [CONFIRM] questions: build with the spec defaults, which are tracked in `docs/CLIENT-DEFAULTS.md`.
