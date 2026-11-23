# Phase 4: Daily Money, Dashboard, Vehicles, Stock & Godowns (spec P7 + P8)

## Goal
Complete the daily operating picture: expenses, cash and bank books, day close, the home dashboard (fast, correct, per godown), the vehicle business, stock management, inter-godown transfers, godown management, the owner's read-only "All godowns" mode and global search.

## Read from `requirement.md`
§9.1 Dashboard · §9.4 Daily Expense · §9.7 Vehicle business · §9.9 Cash & Bank · §9.10 Day close · §9.11 Stock & Godowns · §9.15 Search · §1.4 rules 3–7 · §7.2–7.3 (contra, stock adj, inter-godown, vehicle rows) · §10 (only the godown setup wizard steps reused by "add godown") · §15 performance budgets

## Checklist

### A. Expenses §9.4
- [ ] EXPENSE form: date, category, amount, mode + bank, payee party or text, **required** description, optional load/vehicle tag.
- [ ] Daily Expense screen (date selectable): (1) a "কৃষকদের পেমেন্ট" block listing today's farmer PAYMENTs with a subtotal, (2) category blocks with subtotals, (3) the grand total of cash outflow.
- [ ] Monthly view by category compared with the previous month.

### B. Cash & Bank §9.9
- [ ] Cash book and bank book per account with running balance and a date range.
- [ ] CONTRA forms: cash deposit, withdrawal, transfer between own accounts, cheque deposit → clear / bounce (cheques-in-hand list with actions).
- [ ] Owner capital in / drawings (মালিকের তোলা).

### C. Day close §9.10
- [ ] Day close screen: expected cash, counted cash with a denomination helper (৫০০, ২০০, ১০০, ৫০, ২০, ১০, coins), a required note when the difference ≠ 0, and a DAY_CLOSE voucher posting `CASH_DIFF`.
- [ ] Per-godown DayStatus. Closing locks the day for manager/entry. Owner unlock is audited.
- [ ] `lockAfterDays` auto-lock for non-owners. A `dayCloseRequired` banner on the next day.
- [ ] Banner for "পরে এন্ট্রি এসেছে" (late entry on a closed day, from the server) so the owner re-checks cash.

### D. Dashboard §9.1
- [ ] All 10 cards exactly as defined (opening cash, expected closing cash, stock STORE-only in quintals with a tap-through to the variety breakdown, today's sale qty, purchases qty + amount, sale amount, expenses incl. own-vehicle expenses, total পাওনা, total দেনা, collect/pay reminders due with overdue in red). They are derived from `dailyAgg` and ledger queries, and the numbers are ≥ 28 px.
- [ ] Date selector ◀ ▶, a bank balances row (+ cheques in hand), quick actions, আজকের তালিকা (today's vouchers), top 5 reminders with "সব দেখুন", the দিন শেষ করুন button, and the install-app button.
- [ ] Owner-only "আজকের লাভ" toggle, hidden by default.
- [ ] Performance: seed 50k vouchers into Dexie and assert the dashboard queries finish in < 300 ms (Vitest perf test plus a manual check). Make sure `dailyAgg` is used and can be rebuilt.

### E. Vehicles §9.7
- [ ] Vehicles master UI (own/external, driver, capacity). Number normalization and search.
- [ ] TRIP form: date, vehicle, driver, loading/unloading place, hirer, qty, rate per qtl or fixed → freight, advance received, expenses (diesel litres + ₹, driver, toll, loading, unloading, repair, other) each with a mode, and due.
- [ ] Own vehicle carrying the client's own trade load: record costs against the vehicle + load, with no freight income (default).
- [ ] Per-vehicle khata and P&L. Vehicle dashboard: this month's trips, freight earned, expenses by type, net profit, due from hirers, diesel litres, ₹/km if an odometer reading is entered.

### F. Stock §9.11
- [ ] Stock page for the active godown: by variety, quintals, estimated bags, average cost per quintal, value.
- [ ] Stock register per variety with running balance.
- [ ] Physical count → STOCK_ADJUST with a reason (শুকিয়ে কমা / ইঁদুর / ভেজা / other).
- [ ] **Inter-godown transfer wizard** (paddy or money): pick the receiving godown, variety, qty and rate (or an amount for money). It creates SALE/PAYMENT in the sender + PURCHASE/RECEIPT in the receiver, posted against auto-created "গোডাউন: X" parties, sharing a `groupId`, and edited or voided together. If the user lacks access to the receiver, the receiving side appears there as "অপেক্ষমাণ গ্রহণ / Pending receipt" for a user of that godown to accept. Add server support in applyOp if Phase 2 didn't cover it.

### G. Godown management (owner)
- [ ] Godown list with status, code and a quick summary. Add-godown wizard (online): profile + short code → varieties → bank accounts with opening balances → opening cash → opening stock → opening party balances (posted as OPENING vouchers). Edit profile and letterhead. Archive (read-only).

### H. All-godowns mode
- [ ] `src/client/queries/consolidated/*`: runs the per-godown queries and combines them, read-only.
- [ ] Dashboard "সব গোডাউন" mode: a compact table with one column per godown plus a total column, an inter-godown balances row, columns tappable to switch godown, and + buttons hidden. Available to the owner and to users with `consolidated` on ≥ 2 godowns.

### I. Global search §9.15
- [ ] Search across parties, vehicle numbers, voucher numbers, amounts ("26068" / "২৬০৬৮") and phones, in either script, within the active godown, offline. Owner gets a "সব গোডাউনে খুঁজুন" option with results grouped by godown; opening a result switches godown.

### J. Tests
- [ ] Playwright **G5-style dashboard e2e** in bn and en: opening cash ₹50,000 → farmer payment ₹20,000 → labour ₹1,200 → mill cash via driver ₹75,000 → expected closing **₹1,03,800.00** → day close with a counted difference → CASH_DIFF posted.
- [ ] Two-godown e2e (G10): enter data in A, switch to B and verify B is unchanged, then check the owner All-godowns view totals.
- [ ] Unit: consolidated totals == Σ per-godown; vehicle P&L; stock adjustment; inter-godown pair created/voided together; day lock enforcement for each role.

## Exit criteria (all must pass)
```
pnpm typecheck && pnpm lint && pnpm check:no-float
pnpm test        # includes the dashboard perf test (50k vouchers < 300 ms)
pnpm build
pnpm test:e2e    # G5 dashboard (bn + en), two-godown G10, offline routes
```

## Do NOT do in this phase
The reminder centre UI, web push, the reports module, backup/export, cron/ops, the full first-run onboarding wizard (only the add-godown wizard is built here) and the integrity endpoint belong to Phase 5.
