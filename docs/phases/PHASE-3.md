# Phase 3: Masters, Parties & Trade Flow (spec P5 + P6)

## Goal
Build the real app UI and the full trade cycle: masters, parties, purchase, payments/receipts, due/advance and party khata, sale, daily load khata, mill settlement, voucher view, and receipts (print and share as image). After this phase the client can run purchases → loads → sales → collections end to end, offline, in both languages.

## Read from `requirement.md`
§9 intro ("General rules for every screen / entry form") · §9.2 Purchase · §9.3 Sale · §9.5 Load · §9.6 Due/Advance · §9.8 Mill/Second party payment · §9.12 Parties · §9.16 (only the "This godown → masters" part) · §11.1–11.3 · §11.5–11.6 · §3.5 Bengali in PDFs/receipts · §7.2 (re-check the posting rows used here)

## Checklist

### A. App layout & shared components
- [ ] `(app)` layout: header (godown switcher, sync badge, search icon placeholder, user menu with 🌐 language + digits toggle), mobile **bottom tabs** (হোম · ক্রয় · বিক্রি/লোড · খাতা · আরও), desktop sidebar, and a FAB quick-action sheet. The "আরও" menu lists the later modules, which can link to "coming soon" i18n placeholders.
- [ ] Form shell: a full-screen sheet with the godown name in the title ("নতুন ক্রয় · রামপুর") and a sticky bottom bar with live totals and Save. Includes draft autosave to Dexie (restored after an app kill), an unsaved-changes guard, and Android back closing sheets first.
- [ ] `src/components/money`: `AmountInput` (₹ prefix), `WeightInput` (qtl + kg dual entry, bags × avg helper), `RateInput` (₹/কু. suffix), `PercentInput`, `Money`, `Qty`. All accept Bengali digits, show inline parse errors and never round silently. Tapping a computed value shows its formula.
- [ ] Searchable pickers (party with role filter, variety, vehicle, place, bank account) with inline "+ নতুন যোগ করুন" creation that works offline.
- [ ] Remember last-used values per party (variety, rate, deductions) as suggestions.
- [ ] Empty, loading and error states for every list. Virtualized lists (`@tanstack/react-virtual`).
- [ ] Sync status icon (✓ / ⏳ / ⚠) per record.

### B. Masters (Settings → This godown)
- [ ] Varieties (seeded codes rendered via i18n; renamable; default deductions), expense categories (enable optional ones), bank accounts (last 4 digits only, UPI flag, opening balance), vehicles (number normalization, own/external), places.
- [ ] Godown deduction defaults and the `roundToRupee` setting (GodownSettings).

### C. Parties §9.12
- [ ] Party list for the active godown: role chips, cross-script search (name, phone, village via `searchKey` + digit normalization), recent first.
- [ ] Create/edit party (all §8.1 fields, +91 phone validation, `nameAlt` subtitle logic).
- [ ] Party profile tabs: সারাংশ (balance, aging, last activity), খাতা (statement with running balance), ক্রয়, বিক্রি, পেমেন্ট, লোড, রিমাইন্ডার (list only).
- [ ] "Copy from another godown": copies name, phone and address only.
- [ ] Call and WhatsApp buttons.
- [ ] Merge duplicates (owner, online): a server batch endpoint that re-points vouchers, writes changelog entries and posts to the audit log.

### D. Purchase §9.2
- [ ] List page (filters: date range, season, variety, status) and `purchase/new`, `purchase/view?id=`, `purchase/edit?id=`.
- [ ] Form: party, date, STORE/TRANSIT, multi-line (variety, bags, gross, collapsible "বাদ" deductions prefilled from defaults, computed net, rate, amount), charges add/deduct, round-off line, total. Shows "আগের বাকি ₹x / অগ্রিম দেওয়া আছে ₹y". Paid-now (amount, mode, bank) creates a linked PAYMENT in the same group. Due date creates a Reminder record.
- [ ] Validation: net > 0, rate > 0, a rate sanity warning at ±25% of the 30-day average (warn only), an overpayment warning (allowed as advance).
- [ ] Purchase history tab with the summary header (§9.2).

### E. Payments & Receipts §9.8 / Due-Advance §9.6
- [ ] PAYMENT/RECEIPT forms: party, date, amount, mode (Cash / Bank transfer / UPI / Cheque / DD / Other), our bank account, their bank text, UTR/ref, cheque no./date (→ CHEQUE_IN_HAND), cash via vehicle number **or** person name, TDS (receipt), purpose (BILL / ADVANCE / OTHER), FIFO auto-allocation with manual bill picking, advance due date → Reminder.
- [ ] "অগ্রিম দিলাম / অগ্রিম পেলাম" shortcuts.
- [ ] Due/Advance page: parties with non-zero balance, পাওনা/দেনা shown with color **and** text, filters (পাওনা / দেনা / অগ্রিম দেওয়া / অগ্রিম নেওয়া, role, overdue, amount range), sort, aging buckets, per-bill status.
- [ ] Party khata statement for a period (opening, running balance, closing), plus a "WhatsApp তাগাদা" `wa.me` link with bn/en templates.
- [ ] Transaction history per mill/party with a bank-wise filter.

### F. Sale §9.3
- [ ] List (with a settled/pending badge) and new/view/edit pages.
- [ ] Form: party, mill (if different), vehicle number (free text auto-creates an external vehicle), source STORE/TRANSIT, lines, advance received (→ linked RECEIPT), vehicle advance (→ linked PAYMENT to the transporter), loading rate/fixed (→ cash expense or labour party), delivery rate/fixed + payer (US/MILL/BUYER) posted per §7.2, expected payment date → Reminder.
- [ ] Live summary panel: goods value, freight, loading, vehicle advance, net receivable, and estimated profit (owner only).
- [ ] Stock check: if stock would go negative, show a warning and require an owner/manager confirm. Never block silently.

### G. Load khata §9.5
- [ ] LOAD form: load place, from party or from this godown's stock, variety, bags/gross/net, mill/second party, vehicle number, party-sell rate, mill rate, commission.
- [ ] `OWN_TRADE`: one save creates LOAD + PURCHASE (TRANSIT, if from a party) + SALE in one group. Linked vouchers are read-only and can be edited or voided only through the load.
- [ ] `AGENT`: books commission only.
- [ ] Register view: date-wise columns (date, place, party, variety, qty, mill, vehicle, amount, party-sell rate, mill rate, margin), daily totals, filters, and Excel export (`exceljs`, lazy-loaded, i18n headers).

### H. Mill settlement
- [ ] "মিলের ওজন দিন" from a SALE → MILL_SETTLEMENT form (mill gross, deductions in kg/%/₹, final rate, final amount). It posts the difference and shows the shortage. The sale becomes SETTLED.

### I. Voucher view, edit, void
- [ ] Common voucher view: number, created by/when, sync status, revision history (owner/manager), linked group vouchers.
- [ ] Edit while the day is open creates rev+1, with a reason required after sync. Void is owner-only with a reason; voided vouchers stay visible with strike-through and are excluded from totals.

### J. Receipts & sharing
- [ ] HTML print view for purchase/sale/payment/receipt vouchers and party statements: godown letterhead, receipt language (bn / en / both two-column), amount in words, `window.print()`.
- [ ] "রসিদ শেয়ার করুন": PNG via `html-to-image` (lazy) + Web Share API, with a download fallback. Check that conjuncts (ক্ষ, ন্দ্র, স্ব, ত্ত) render correctly.

### K. Tests
- [ ] Unit/integration: load creates exactly one SALE; load edit propagates to linked vouchers; FIFO allocation statuses; settlement difference and shortage; paid-now group atomicity.
- [ ] Playwright, run in **bn and en**: purchase (with paid-now) → payment → load (OWN_TRADE) → sale → mill receipt in cash via the driver → mill settlement. Assert party balances, cash and shortage against hand-computed values, and that both languages show the same numbers.
- [ ] Extend the offline e2e: all new routes work by direct URL with the network off.

## Exit criteria (all must pass)
```
pnpm typecheck && pnpm lint && pnpm check:no-float
pnpm test
pnpm build
pnpm test:e2e     # trade-flow e2e in bn + en, offline route test
```

## Do NOT do in this phase
The dashboard cards, expenses screen, cash/bank books, day close, vehicles/trips, stock screens, inter-godown transfer, reminder centre/push and reports belong to later phases. Reminder **records** are created here but have no UI centre yet.
