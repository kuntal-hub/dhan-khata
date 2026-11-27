# Requirement Specification v2 — "Dhan Gola" (ধান গোলা)
### Dhan Gola Management Software — offline-first business PWA for paddy brokers in West Bengal

> **Audience:** Claude Code and the developer supervising it.
> **Version:** 2.1. Version 2.0 merged the original technical spec (v1.1) with the client's full requirement document.
>
> **Changelog**
> - **v2.1 (2026-11-26) — money direction with mills corrected: mills pay the broker.** A mill dispatch is paddy the mill pays for (a receivable, পাওনা); money from a mill is always money received; a mill return is a credit to the mill; the final settlement adjusts the same dispatch (no separate sale). "Mill payable / মিলের দেনা", milling charges and the consignment-settlement sale are removed. Payment direction comes from the source type (§7.2). New acceptance Test 12 (§21). Details: `docs/BUGFIX_MILL_DIRECTION.md`.
> **Precedence:** where they differ, the **client's functional and UI/UX requirements win**. Technical choices from v1.1 (stack, offline-first sync, integer money, the posting engine) stay unless a client requirement needs a change.
> **Terminology:** **Gola (গোলা) = godown.** The UI always says "গোলা / Gola". Internal code may keep the existing `godownId` field and type names; renaming them is not required.

---

## 0. Rules for the implementer (read first)

1. Read the whole document before changing code. Sections 5–9 (single source of truth, money, dates & payments, accounting, stock engine) are the foundation for every screen.
2. **Non-negotiables** (breaking any of these is a bug):
   - No floating-point arithmetic on money or quantity. Money is integer **paise** and weight is integer **grams** (section 6).
   - **One financial event = one record.** A payment exists once in the unified payment ledger. Purchase history, party ledger, Due & Advance, the cashbook and reports all *read* that one record; none of them store a copy (section 7).
   - Stock and balances are **derived** from transactions, never typed in or hard-coded (sections 8–9).
   - Every business record belongs to exactly one Gola. No record from Gola 1 may ever appear in Gola 2, except in the explicit read-only combined report (section 2).
   - Credit purchases and sales don't move cash. Only actual payments and collections move cash or bank, on their **actual payment date** (section 7).
   - Paddy, rice and other products are separate stock figures and are never added together (section 9).
   - **Exactly eight main navigation sections** (section 11). No ninth.
   - Every visible control does something real. No dummy buttons, sample data or hard-coded numbers (section 15.6).
   - Bengali is the default language; the full app works in Bengali and English (section 16).
   - Everything works offline after the first login and syncs later (section 17).
3. When something is ambiguous, prefer the option that (a) can never lose, double-count or silently change money or stock, then (b) is simplest for a user who isn't comfortable with technology.

---

## 1. Product and business context

### 1.1 Product
- **Product:** Dhan Gola Management Software. **App name:** Dhan Gola (ধান গোলা).
- **Users:** paddy brokers/traders in West Bengal and their families. They may not be highly educated or technically experienced, so the app must be simple, with large text and buttons.
- Each broker **buys paddy from farmers and pays the farmers** (money out; the broker owes a farmer until paid: দেনা), keeps it in his golas, and **delivers it to rice mills, which pay him** (money in; a mill owes the broker until it pays: পাওনা). He may also sell to other customers. A mill can send paddy back, and its final accepted weight / rate / quality cut adjusts what it owes. He also runs a **vehicle (truck) business**, deals with **second parties** (other traders) and handles a lot of cash plus bank/UPI.
- Two current clients. **Each client gets his own deployment and his own database** from the same codebase. Each deployment has **one business owner account**, and that owner manages **two (or more) independent Golas** with one login.

### 1.2 Glossary (use these terms; natural West Bengal Bengali)

| Code / English | বাংলা (UI) | Meaning |
|---|---|---|
| Gola | গোলা | Godown/warehouse. Each Gola is an **independent set of books** |
| Paddy | ধান | Unhusked rice. The main commodity |
| Rice | চাল | Returned from a mill after milling. Separate stock |
| By-product / Other | অন্যান্য (খুদ, তুষ, কুঁড়ো…) | Broken rice, husk, bran etc. Separate stock per product name |
| Variety | ধানের জাত | e.g. স্বর্ণ, শতাব্দী, গোবিন্দভোগ, মিনিকিট, plus company varieties |
| Seed company | কোম্পানি | PAN, Mundra, Tiasa, GMS, other |
| Quintal | কুইন্টাল | 100 kg |
| Mon | মণ | 40 kg (configurable, default 40) |
| Bag | বস্তা | Individual weighed bag |
| Farmer / supplier | কৃষক / সরবরাহকারী | Sells paddy to us |
| Customer / buyer | ক্রেতা / খদ্দের | Buys paddy or rice from us (can be a mill) |
| Mill | মিল / চালকল | Rice mill: **the broker's main buyer and debtor**. It pays for the paddy delivered to it |
| Second party | সেকেন্ড পার্টি / পার্টি | Another trader we have a running account with |
| Mill dispatch | মিলে পাঠানো | Paddy delivered to a mill **that the mill pays for** (receivable). Listed in the Mill section, not in the Sales list |
| Mill return | মিল থেকে ফেরত | Paddy, rice or other product coming back from a mill. Paddy back = a **credit** to the mill |
| Final settlement | চূড়ান্ত হিসাব | The mill's accepted weight, final rate and quality cut for one dispatch; adjusts that dispatch's receivable |
| Milling conversion | ভাঙানোর হিসাব | Stock-only record of paddy consumed → rice/by-products/loss |
| Load khata | লোড খাতা | Daily register of truck loadings |
| Due | বাকি | Unpaid part of a bill |
| Advance | অগ্রিম / দাদন | Money paid or received before goods or a bill |
| Receivable | পাওনা | Others owe us |
| Payable | দেনা | We owe others |
| Cashbook | ক্যাশবই / নগদ খাতা | Daily cash register |
| Opening / Closing cash | শুরুর / শেষের নগদ | |
| Shortage / Excess | কম / বেশি | Difference between expected and actual |
| Vehicle business | গাড়ির ব্যবসা | Own trucks earning hire income |
| Payment mode | পেমেন্টের মাধ্যম | নগদ (Cash) / ব্যাংক (Bank) / UPI |

### 1.3 Calendar
- Business dates are calendar dates in **Asia/Kolkata (IST)**, stored as `YYYY-MM-DD`.
- Financial year: April–March. Season tag (আমন / বোরো / আউশ) is auto-suggested from the date and editable.

---

## 2. Accounts, authentication and Gola management

### 2.1 Account hierarchy
```
Business Owner Account (one per deployment)
  ├── Business profile (business name, address, mobile, logo)
  ├── Gola 1 ── all of Gola 1's transactions, parties, stock, cash, bank, reports
  └── Gola 2 ── all of Gola 2's transactions, …   (more Golas allowed; the client needs two)
```

### 2.2 Account features (all required)
- **Registration:** name, mobile number (10-digit Indian), password (min 8 chars, show/hide), business name, business address. **Registration is only open while the deployment has no owner.** After the first owner registers, the registration screen is replaced by login and `/api/auth/register` returns `REGISTRATION_CLOSED`. A server-side env flag `ALLOW_REGISTRATION` (default `auto`) lets the developer reopen it.
- **Recovery code:** at registration, generate a random 12-character recovery code (e.g. `DG-7KQ4-M2XP-9TRA`). Show it once on a full screen with "লিখে রাখুন / Write this down", a copy button, a print button and a confirmation checkbox. Store only its hash.
- **Login:** mobile number + password, with password show/hide. Rate-limited.
- **Forgot password:** mobile number + recovery code + new password (twice). Success generates a **new** recovery code (shown once). Developer fallback: a CLI script `pnpm admin:reset-password --mobile=…` that sets a temporary password and a new recovery code. No SMS or paid services.
- **Logout:** blocked while unsynced entries exist. Show the count and offer "Sync now" or "Export unsynced data" first.
- **Session management:** access + refresh tokens as in v1.1. The same owner can be logged in on several devices (phone, tablet, PC). Settings → Sessions lists devices with last-seen time and lets the owner sign out any of them. An offline PIN unlock keeps the app usable without network.
- **User profile:** name, mobile, change password, language, digit style, PIN.
- **Business profile:** business name, address, mobile, logo upload (compressed, stored small). Used on receipts, invoices and reports.
- **Gola creation & management:** create Gola (name, short code, address, phone, optional opening balances wizard), edit details, archive (read-only). A Gola can't be deleted once it has transactions.
- **Staff logins are out of scope for v2.** If the existing code has roles, they may stay internally, but only the owner experience is exposed.

### 2.3 Two-Gola management
- One login manages both Golas; the owner never creates a second account.
- **Gola switcher** always visible in the header (`গোলা: গোলা ১ ▾`), with the active Gola's name and a colour chip. It's also on the Dashboard.
- Switching **immediately refreshes all data**, with a smooth (≤ 250 ms) cross-fade. Every list, form, total, chart and report shows the active Gola only.
- Forms show the Gola name in their title ("নতুন ক্রয় · গোলা ১"). Switching Gola with an unsaved form asks for confirmation.
- Each Gola has independent: purchases, sales, stock (paddy, rice, mill, other), cashbook, bank balances, expenses, farmer ledger, customer ledger, due & advance, mill transactions, second-party ledger, vehicle transactions, load khata, reminders, day close, voucher numbering, reports.
- **Combined report (optional view):** the owner can choose "সব গোলা একসাথে / All Golas combined" on the Dashboard and in reports. It shows each Gola side by side plus a total. It's read-only: no entries can be made in combined mode.
- Parties are per Gola. If the same farmer sells to both Golas, he has two records. "Copy from other Gola" copies name/phone/address only.
- Moving paddy or money between Golas = a sale in one Gola and a purchase in the other, created as a linked pair by an "Inter-Gola transfer" action in Sales (each Gola's books stay complete).

### 2.4 Server-side enforcement
- Every API request is checked for a valid session, an owner who owns the Gola in every `godownId` touched, and same-Gola references (party, variety, bank, vehicle, linked record). The client filters are for convenience only.
- MongoDB has no row-level security (RLS), so the equivalent is server-side access checks on every read/write plus tests that prove crafted requests can't cross owners or Golas (section 21, Test 9).
- Every business document also stores `businessId` (the owner's business). The server checks `businessId` and `godownId` on every query, so a future multi-owner deployment stays safe.

---

## 3. Research constraints (unchanged from v1.1, still binding)

- **Hosting:** Vercel Hobby is non-commercial only. Production uses Netlify Free (commercial use allowed) or another host the developer already chose; no Vercel-only APIs.
- **MongoDB Atlas free cluster:** 512 MB, 100 ops/s (batch writes), no backup guarantee (own nightly backup), auto-pauses after 30 days idle (daily cron ping).
- **Offline routes:** no dynamic route segments for app pages (use `?id=`), so every page can be precached for offline use.
- **Bengali PDFs:** use HTML print views (browser shapes Bengali conjuncts correctly) + "Save as PDF". Share receipts as images.
- **Voice input:** Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`). Supported in Chrome on Android/desktop; recognition usually needs internet (Google's servers). Not reliably available on iOS Safari or Firefox. It's an optional extra with a clear fallback (section 14).
- **WhatsApp:** `https://wa.me/91XXXXXXXXXX?text=…` click-to-chat only. Never claim a message was sent automatically.

---

## 4. Technology (do not change the stack)

Keep the stack already used in the app: Next.js (App Router, TypeScript), MongoDB Atlas + official driver, Tailwind CSS, shadcn/ui, Redux Toolkit, Dexie (IndexedDB) offline store with outbox sync, Serwist PWA, Zod, react-hook-form, date-fns, Vitest/Playwright.

Free additions allowed for v2:

| Need | Library |
|---|---|
| Premium animations | `motion` (Framer Motion) — `LazyMotion` + `domAnimation` to keep the bundle small |
| Charts | `recharts` (already planned); animated, themed |
| Count-up numbers | small custom hook on `requestAnimationFrame` (no extra dependency needed) |
| Excel/CSV | `exceljs` (xlsx), native CSV writer |
| Image share | `html-to-image` |
| Icons | `lucide-react` + the custom Dhan Gola logo (SVG) |
| Fonts | Noto Sans Bengali / Hind Siliguri + Inter via `next/font` (self-hosted, offline) |

No paid APIs. No AI APIs.

---

## 5. Single source of truth

```
User actions ─► Source documents (Purchase, Sale, Expense, MillDispatch, MillReturn,
                Conversion, VehicleTrip, LoadEntry, StockCount, Opening, Contra, …)
            └─► Payments (ONE unified payment ledger; each payment links to its source document)

Pure functions (shared client + server):
   postLedger(doc | payment)  ─► ledgerLines   (balanced debit/credit, per Gola)
   postStock(doc)             ─► stockMoves    (per Gola, product, variety, location)

Every screen reads: documents + payments + ledgerLines + stockMoves.
Cashbook, party ledgers, Due & Advance, dashboard, reports = queries, never stored copies.
```

- Edits create a new revision. In the same transaction (Dexie locally, Mongo on the server), the old revision's ledger lines and stock moves are replaced, so **all later balances recalculate automatically** because they are sums by date.
- Delete in the UI = **reverse/void** (soft). The record stays in history, struck through, with a reason and audit entry, and is excluded from all totals.
- Linked records (a purchase and its payments, a load and its linked dispatch, an inter-Gola transfer pair) are edited or voided together or blocked with a clear message. Example: "এই কেনার সাথে ৩টি পেমেন্ট যুক্ত আছে — আগে পেমেন্টগুলো বাতিল করুন অথবা সব একসাথে বাতিল করুন / This purchase has 3 linked payments — reverse them first, or reverse all together".

---

## 6. Accuracy rules (zero calculation error)

### 6.1 Storage units

| Quantity | Stored as | Example |
|---|---|---|
| Money | integer paise | ₹1,34,400.00 → `13440000` |
| Weight | integer grams | 56 qtl → `5600000` |
| Rate | integer paise per quintal | ₹2,400/qtl → `240000` |
| Percent | basis points | 2.5% → `250` |
| Litres | millilitres | |

- JSON/IndexedDB: integers serialized as strings and parsed with `BigInt`. MongoDB: `Long`.
- All arithmetic happens in one `money`/`weight` module with branded types. ESLint/CI forbids `parseFloat`, `toFixed` and `number` math on money/weight in domain code.
- Inputs accept Bengali or English digits and commas. Parsing rejects more than 2 decimals for money and more than 3 decimals (kg) for weight, with a clear message (never silent rounding).

### 6.2 Units and conversion
- 1 quintal = 100 kg; 1 mon = **40 kg by default**, configurable in Settings (`monKg`).
- Quantity input has a unit selector (কেজি / কুইন্টাল / মণ); the value is stored in grams. Everywhere a quantity is shown, a small tappable line shows all three: `5,600.000 কেজি · 56.000 কু. · 140.000 মণ`.
- Rates are per quintal (as the client specified). Per-mon rate display is an optional helper.

### 6.3 Formulas
```
Bag-wise:   totalG = Σ bag.weightG;  avgBagG = divRoundHalfUp(totalG, bagCount)    (display only)
Manual:     totalG = entered
Deductions (OPTIONAL, off by default; enable in Settings → "ওজন বাদ / weight deductions"):
            netG = totalG − tare − dhalta − moisture − other     (formulas as v1.1)
            otherwise netG = totalG
Amount:     amountPaise = divRoundHalfUp(netG × ratePaisePerQtl, 100_000)
Sales total = Quantity × Rate                      (same formula)
Remaining due (any bill) = Bill total − Σ active linked payments
Expected closing cash = Opening cash + Cash received − Cash paid − Cash expenses
Closing paddy stock  = Opening + Purchases + Returned paddy − Confirmed sales − Mill dispatches ± Approved adjustments
Closing mill stock   = Opening mill stock + Dispatches − Returns − Consumed in milling − Final settlements (accepted + shortfall) ± Adjustments
Mill receivable (per dispatch) = Qty × Rate − Return credits − Final-settlement cut − Collections + Refunds
Vehicle net profit   = Total income − Driver cost − Diesel cost − Other expenses
```
Rounding: half-up (half away from zero), at exactly one point per formula. Optional "round bill to rupee" shows a visible round-off line.

### 6.4 Golden tests (must exist as unit tests)

| # | Case | Expected |
|---|---|---|
| G1 | 56 qtl × ₹2,400 | **₹1,34,400.00** (5600000 g × 240000 / 100000 = 13440000 paise) |
| G2 | 56 qtl in mon (40 kg) | **140 মণ**; in kg **5,600 কেজি** |
| G3 | bags 52.5, 48.25, 50.000 kg | total **150.750 kg**, avg **50.250 kg** |
| G4 | net 987.333 kg × ₹2,183.50 | **₹21,558.42** |
| G5 | 1,212.500 kg × ₹2,150 | **₹26,068.75** |
| G6 | parse "২৬,০৬৮.৭৫" | 2606875 paise |
| G7 | divRoundHalfUp(−5, 10) | −1 |
| G8 | Cashbook 50,000 + 25,000 − 40,000 − 5,000 | **₹30,000.00** |

Property tests (fast-check): every posting is balanced; void → previous state restored exactly; edit-then-edit-back is identical; stock never changes in another Gola.

---

## 7. Date and payment architecture

### 7.1 Separate, meaningful dates
Each record uses only the dates relevant to it:

| Field | Meaning | Used by |
|---|---|---|
| `transactionDate` | Business date of the deal | Purchase, Sale, Load, Vehicle trip, Second-party entry, Stock adjustment |
| `expenseDate` | When an expense was incurred | Expense |
| `dispatchDate` | Paddy left for the mill | Mill dispatch |
| `returnDate` | Product came back from the mill | Mill return |
| `conversionDate` | Milling conversion record | Conversion |
| `paymentDate` | When money **actually** moved | Payment (drives the cashbook) |
| `dueDate` | **Optional reminder** of when the remaining due is expected to be paid (farmer) / collected (mill, buyer). A reference only: never blocks, splits or schedules payments (§7.4) | Purchase, Sale, Mill dispatch **only** |
| `entryDate` | Business date the user entered the record (auto = today IST, read-only) | Every document and payment |
| `createdAt` / `updatedAt` | ISO timestamps (audit) | Everything |

**Rules**
- The cashbook and bank books use **`paymentDate` only**.
- Purchase/sale/expense reports use their own business date (`transactionDate` / `expenseDate`).
- Backdated records are allowed and affect their historical date. Future business dates (`transactionDate`, `expenseDate`, `dispatchDate`, `returnDate`, `conversionDate`, `paymentDate`) are blocked. `dueDate` is **not** a business date: it may be in the future (§7.4).
- If a backdated entry falls on a day already closed in the cashbook, the day shows "পরে এন্ট্রি হয়েছে — আবার মেলান / Entry added later — re-check", and its expected closing is recalculated.

### 7.2 Unified payment ledger (the only place money movement is recorded)
```ts
interface Payment extends BaseDoc {            // BaseDoc: _id(uuid v7), businessId, godownId, rev, status, createdAt, updatedAt, createdBy, deviceId
  direction: 'OUT' | 'IN';                     // OUT = we paid; IN = we received
  amountPaise: string;
  paymentDate: string;                         // actual date money moved
  entryDate: string;
  mode: 'CASH' | 'BANK' | 'UPI';               // BANK/UPI require bankAccountId
  bankAccountId?: string;
  reference?: string;                          // UTR, cheque no., UPI ref
  personName?: string;                         // who handed over / received the cash (e.g. driver)
  vehicleNumber?: string;                      // cash sent via a vehicle
  partyId?: string;
  source: {                                    // what this payment settles
    type: 'PURCHASE' | 'SALE' | 'EXPENSE' | 'MILL_DISPATCH' | 'MILL_REFUND' | 'VEHICLE_TRIP'
        | 'VEHICLE_COST' | 'SECOND_PARTY' | 'PARTY_ADVANCE' | 'OPENING_DUE';
    id: string | null;                         // null only for on-account money (advance, second party, refund to a mill)
  };
  isInitial: boolean;                          // the "initial payment" entered on the source form
  notes?: string;
  status: 'active' | 'reversed';
  reversal?: { reason: string; at: string; by: string };
}
```
- The **initial payment** typed on a Purchase/Sale/Expense/Dispatch/Trip form is saved as a Payment with `isInitial: true`. It is **never** also stored as a number on the source document. "Paid" and "remaining due" on any source = queries over its active payments.
- **Add payment / Add collection** buttons appear on each source's detail page, the party ledger and Due & Advance. They all create the same kind of record.
- **Edit payment** creates a new revision; **reverse payment** requires confirmation and a reason. Both are audited and recalculate dues and the cashbook.
- A payment can't exceed the remaining due of its source unless the user confirms "extra as advance". In that case the payment is split into the bill part and a `PARTY_ADVANCE` part (two records with a shared `groupId`; never double-counted).
- One payment can only be linked to one source (bulk "pay several bills" creates one payment per bill under one `groupId`).
- **Payment receipt:** every payment has a printable/shareable receipt (bilingual template, business logo, Gola, amount in words).
- **Direction comes from the source type, never from the screen.** One shared map in `/domain` (`domain/v2/direction.ts`) is used by the device's write path and enforced by the server; a mismatch is rejected with `PAYMENT_DIRECTION_MISMATCH`:

  | source.type | direction |
  |---|---|
  | PURCHASE | OUT |
  | SALE | IN |
  | MILL_DISPATCH | **IN** (the mill pays us) |
  | MILL_REFUND | OUT ("টাকা ফেরত দিলাম / Refund to mill": only when a mill paid more than it owed) |
  | EXPENSE, VEHICLE_COST | OUT |
  | VEHICLE_TRIP | IN |
  | MILL_RETURN | no payment allowed (a return is a credit, not cash) |
  | SECOND_PARTY, PARTY_ADVANCE, OPENING_DUE | the user's explicit choice: "দিলাম / Gave" = OUT, "পেলাম / Received" = IN |

- **The broker pays a mill only when the user records it explicitly:** a "Refund to mill" (OUT, `MILL_REFUND`), or a Daily Expense in category "মিলের খরচ / Mill charges" with the mill as party (e.g. unloading or milling charge). Nothing creates a mill payable automatically.
- **Part-payments:** a deal (purchase, sale, mill dispatch) takes **any number** of payments / collections, each with its own amount, actual date, mode and reference, any day from the deal's own date up to today (backdating allowed, never before the deal, never in the future). The initial payment on the form is optional (0 = fully on credit). The due date never restricts when or how much is paid. Each payment affects the cashbook / bank book only on its own `paymentDate`.

### 7.3 Cashbook categories (how each payment is classified)

| Cashbook line | Includes (mode = CASH only) |
|---|---|
| **Cash received** | IN payments: sale collections, **collections from mills (MILL_DISPATCH)**, vehicle income collections, second-party receipts, advances received, bank → cash withdrawals |
| **Cash paid** | OUT payments that are not expenses: farmer/supplier payments, refunds to mills (MILL_REFUND), second-party payments, advances given, cash → bank deposits. Money from a mill is **never** counted here |
| **Cash expenses** | OUT payments whose source is `EXPENSE` or `VEHICLE_COST` |
| Bank (separate book) | same lines for BANK/UPI mode, per bank account |

Note: the client listed **"Farmer payment" as an expense category**. In the Daily Expenses form it is selectable, but choosing it opens the farmer-payment flow (pick farmer → pick open purchase(s) or "advance") and saves a `PURCHASE`/`PARTY_ADVANCE` payment. It appears in the Daily Expenses list with a "পেমেন্ট" badge for visibility. It counts under **Cash paid**, not **Cash expenses**, and is never an expense in profit. Showing it in both places is a view, not a second record.

### 7.4 Due dates (DECISIONS D54)

**Where:** only on the deal itself.

| Record | Field (bn / en) | Settled by |
|---|---|---|
| Purchase from a farmer / supplier | বাকি দেওয়ার তারিখ / Pay-by date (optional) | OUT payments |
| Mill dispatch | টাকা পাওয়ার তারিখ / Expected payment date (optional) | IN collections |
| Sale (mill or other buyer) | টাকা পাওয়ার তারিখ / Expected payment date (optional) | IN collections |

No other form has a due date: payment / collection sheets, mill return, final settlement, milling conversion, load khata, expenses, vehicle trips, second-party entries, stock adjustments, contra, day close. A `dueDate` stored on an older record of another type (v2.0 allowed it on expenses, trips and second-party entries) stays in the database untouched and is hidden and ignored everywhere. The payment-date field reads "যেদিন টাকা দেওয়া/নেওয়া হল / Date paid / received" so it is never mistaken for a due date.

**Picker:** optional, empty by default, ✕ মুছুন / Clear. Today or any future date; quick chips "+৭ দিন", "+১৫ দিন", "+১ মাস" (from today, or from the deal date if that is later) plus the calendar. A date before the deal's own date is rejected ("বাকির তারিখ কেনার তারিখের আগে হতে পারে না"); a past date on/after the deal date is allowed with the soft warning "এই তারিখ পেরিয়ে গেছে / This date has already passed". On the new-deal form it sits under "Remaining due" in the payment block, marked optional; empty never blocks saving. Display: "বাকির তারিখ: ১৫ ডিসেম্বর (আর ১৯ দিন)" / "(৫ দিন পেরিয়ে গেছে)".

**Changing it later:** "তারিখ বদলান / Change due date" on the purchase, mill dispatch and sale detail pages, on each open bill of the party ledger (Due & Advance) and on the deal's automatic reminder: a small sheet with the same picker plus Clear. It is a **field update, not an edit**: money, stock, ledger lines, payments and the document revision used for postings are untouched. One push op `dueDate` (server: last writer wins on this field only, never a conflict; allowed on a day already closed in the cashbook since it has no cash effect; a date before the deal is rejected with `DUE_BEFORE_DEAL`); audited "old→new" with who and when. A full edit of the deal never changes the due date (the stored value is kept on the device and on the server), so a device that has not pulled the newer date can't put the old one back.

**Status (derived, never stored):** বাকি / Unpaid (no payments) · আংশিক / Partly paid (some paid, remaining > 0) · পরিশোধিত / Fully paid (remaining = 0); plus the extra badge **মেয়াদ পেরিয়েছে / Overdue** when remaining > 0 and a due date is set and today is after it. No due date = never overdue. Lists filter by status and by "overdue".

**Reminders and alerts:** an automatic reminder exists only for a deal with a due date and remaining > 0; its date is always the deal's due date; it closes by itself when fully paid and moves when the due date changes (a stored done / snooze applies only to the date it was set for). Dashboard due alerts and the reminders tab show due today, overdue and upcoming (next 7 days); deals without a due date appear in the outstanding lists only. WhatsApp templates mention the due date only when one is set. Manual (custom) reminders keep their own date.

**Payment sheet:** shows the deal total, already paid / received, remaining due and due date (if any); amount > 0 up to the remaining due, more only after "বাড়তি ₹X অগ্রিম হিসেবে রাখবেন?" (bill part + `PARTY_ADVANCE`); after saving it shows the new remaining due. The payment history lists every payment with the remaining due after it; each can be edited or reversed (confirmation, reason, audit). "+ বাকি টাকা দিন / Pay due" (purchase) and "+ টাকা পেলাম / Add collection" (sale, mill dispatch) are on the deal's detail page, on each open bill of the party ledger, and on the dashboard due alerts (opens the deal with the sheet).

**Existing data:** dates changed on the reminders tab before D54 were stored only in the reminder record; `pnpm fix:due-dates` (dry run by default, `--apply` to write) copies them onto their deals the same way as the `dueDate` op.

---

## 8. Accounting model (hidden from users)

Users see only দিলাম / পেলাম, পাওনা / দেনা, নগদ / ব্যাংক. Internally the double-entry chart of accounts from v1.1 is kept **per Gola**: `CASH`, `BANK:<id>`, `PARTY:<id>`, `STOCK_PADDY`, `STOCK_RICE`, `STOCK_OTHER:<product>`, `STOCK_AT_MILL:<millId>` (opening stock / adjustments at a mill only), `SALES`, `MILL_SALES`, `MILL_DEDUCTION`, `COGS`, `EXP:<category>`, `EXP_PAYABLE`, `VEH_INCOME:<vehicle>`, `VEH_EXP:<vehicle>:<type>`, `CASH_DIFF`, `STOCK_ADJ`, `OPENING_BAL`, `CAPITAL`, `DRAWINGS`, `SP_CLEARING`. (v2.0's `MILLING_CHARGES` and `MILLING_LOSS` are no longer posted.)

Party balance sign — **one convention everywhere: > 0 = they owe us (পাওনা)**, **< 0 = we owe them (দেনা)**. Every list, card, tab, ledger and report decides পাওনা vs দেনা by the **sign of the balance**, never by the party's role. A mill with a positive balance is always পাওনা; a mill with a negative balance (it paid too much) shows as "মিলকে ফেরত দিতে হবে / To refund to mill".

| Event | Debit | Credit | Cash effect |
|---|---|---|---|
| Purchase (credit or not) | STOCK_PADDY | PARTY:farmer | none |
| Payment to farmer | PARTY:farmer | CASH / BANK | on paymentDate |
| Sale confirmed | PARTY:customer | SALES (+ COGS/STOCK at avg cost) | none |
| Collection | CASH / BANK | PARTY:customer | on paymentDate |
| Expense incurred (with person/party) | EXP:cat | PARTY:person (or EXP_PAYABLE) | none |
| Expense payment | PARTY:person / EXP_PAYABLE | CASH / BANK | on paymentDate |
| Mill dispatch (quantity × rate the mill pays) | PARTY:mill (total) | MILL_SALES | none |
| Mill dispatch: cost of the paddy | COGS | STOCK_PADDY (avg cost) | none (quantity moves WAREHOUSE → MILL) |
| Collection from a mill (`MILL_DISPATCH`, IN) | CASH / BANK | PARTY:mill | on paymentDate (Cash received) |
| Paddy returned by a mill: credit (default qty × dispatch rate, editable) | MILL_SALES | PARTY:mill | none |
| Paddy returned by a mill: stock back at cost | STOCK_PADDY | COGS | none (quantity MILL → WAREHOUSE) |
| Final settlement: cut (moisture / quality / weight) | MILL_DEDUCTION | PARTY:mill | none |
| Final settlement: extra value | PARTY:mill | MILL_DEDUCTION | none |
| Refund to a mill that overpaid (`MILL_REFUND`, OUT) | PARTY:mill | CASH / BANK | on paymentDate (Cash paid) |
| Mill expense (Daily Expense "মিলের খরচ", mill as party) | EXP:MILL_CHARGES | PARTY:mill | none until paid |
| Rice / other returned by a mill | — | — | none (stock quantity only) |
| Milling conversion | — | — | none (stock only: consumed paddy leaves mill stock) |
| Vehicle trip income | PARTY:customer | VEH_INCOME | none |
| Vehicle cost | VEH_EXP | CASH / BANK / PARTY:driver/pump | if paid |
| Stock adjustment | STOCK_ADJ ↔ STOCK_* | | none |
| Day-close difference | CASH_DIFF ↔ CASH | | yes (makes cash = actual) |
| Cash ↔ bank | BANK ↔ CASH | | yes |

`postLedger` is shared by client and server. The server recomputes it and rejects mismatches (`CALC_MISMATCH`).

Profit: **gross profit = SALES + MILL_SALES − MILL_DEDUCTION − COGS**; net profit also subtracts expenses (and vehicle costs). Paddy at a mill is costed when it is dispatched; the MILL stock position keeps that cost as a memo only so a paddy return comes back at cost.

---

## 9. Stock engine

### 9.1 Stock dimensions
Every `StockMove` has: `godownId`, `product` (`PADDY` | `RICE` | `OTHER`), `otherProductName?` (খুদ, তুষ, কুঁড়ো…), `varietyId?`, `location` (`WAREHOUSE` | `MILL` | `TRANSIT`), `millPartyId?` (when location = MILL), `qtyG` (signed), `bags?` (signed, when known), `valuePaise` (signed, at cost), `sourceType`, `sourceId`, `date`.

- **Warehouse paddy stock** = Σ moves (PADDY, WAREHOUSE).
- **Mill stock** = Σ moves (PADDY, MILL), per mill and total. It is paddy that is ours but physically at mills.
- **Rice stock** = Σ moves (RICE, WAREHOUSE). Shown separately and **never** added to paddy.
- **Other product stock** = per product name.
- `TRANSIT` = direct deliveries (bought from a party and loaded straight to a buyer). In and out in the same linked group, so warehouse stock isn't touched.

### 9.2 Which transaction moves what (exactly once each)

| Transaction | Movement |
|---|---|
| Purchase (stored) | + PADDY WAREHOUSE |
| Purchase (direct delivery) | + PADDY TRANSIT (then − by the linked sale) |
| Sale confirmed (paddy) | − PADDY WAREHOUSE (or TRANSIT/MILL per source) |
| Sale confirmed (rice) | − RICE WAREHOUSE |
| Mill dispatch | − PADDY WAREHOUSE, + PADDY MILL(mill) |
| Mill return: paddy | − PADDY MILL(mill), + PADDY WAREHOUSE |
| Mill return: rice / other | + RICE / OTHER WAREHOUSE (quantity entered); **the paddy consumed is removed from MILL stock only through the Milling Conversion record** |
| Milling conversion | − PADDY MILL (paddy consumed). Rice/by-product quantities come from the linked return(s); loss = consumed − outputs (shown, user-confirmed) |
| Final settlement | − PADDY MILL(mill): accepted quantity, plus any weight shortfall (a reasoned stock loss). No sale is created |
| Stock adjustment (approved) | ± any product/location, reason required |
| Load khata entry | **none by itself.** It moves stock only through its linked sale or dispatch (section 12.5) |
| Opening stock | + per product/variety/location |

### 9.3 Rules
- Each source document has a deterministic set of moves. Editing replaces them atomically; voiding removes them (reversal). No duplicates (unique key `sourceType+sourceId+rev+line`).
- **No silent negative stock:** a sale, dispatch or adjustment that would make stock negative shows a warning with the current stock and needs an explicit "তবুও সেভ করুন / Save anyway" confirmation. It is also logged in the integrity check. This can happen legitimately with offline entries on two devices.
- Date-wise stock ledger: opening (sum of moves before the date), inward, outward, closing, per variety and in total, for any historical date.
- **Physical stock verification:** enter the actual counted stock (per product/variety/location, bags optional) → system shows shortage/excess → "Approve adjustment" posts a reasoned adjustment (শুকিয়ে কমা / ইঁদুর / ভিজে যাওয়া / ওজনের ভুল / অন্যান্য).
- **Low-stock alerts:** per-Gola threshold per variety (and a total threshold). Shown on the dashboard.

---

## 10. Data model (key documents)

All business documents extend `BaseDoc { _id, businessId, godownId, rev, status: 'active'|'void', voidReason?, entryDate, createdAt, updatedAt, createdBy, deviceId, serverSeq? }`. `godownId` is required and immutable.

```ts
interface Business { _id; name; address; mobile; logoAssetId?; ownerUserId; monKg: number /* default 40 */; settings: {...} }
interface User { _id; businessId; name; mobile; passwordHash; recoveryCodeHash; language: 'bn'|'en'; digits: 'bn'|'en'; pinHash? }
interface Gola { _id; businessId; code; name; address?; phone?; colour; status: 'active'|'archived'; lowStock: { totalQtlG?: string; perVariety?: Record<string,string> } }

interface Party extends BaseDoc {
  name; nameAlt?; searchKey; mobile?; address?;
  roles: Array<'FARMER'|'SUPPLIER'|'CUSTOMER'|'MILL'|'SECOND_PARTY'|'VEHICLE_CUSTOMER'|'DRIVER'|'LABOUR'|'OTHER'>;
  openingBalancePaise?: string; openingBalanceDate?: string;   // posted as OPENING_DUE
}
interface Variety extends BaseDoc { name; nameAlt?; company?: 'PAN'|'MUNDRA'|'TIASA'|'GMS'|'OTHER'; companyOther?; product: 'PADDY'|'RICE'; normalizedKey /* unique per Gola: lower(trim(name))+company */; verified: boolean; lastUsedAt? }
interface BankAccount extends BaseDoc { name; bank; last4; openingBalancePaise }
interface Vehicle extends BaseDoc { number /* normalized WB12AB3456 */; ownership: 'OWN'|'EXTERNAL'; driverName?; driverMobile? }

interface WeightBlock {                          // reused by Purchase, Sale, MillReturn, Dispatch
  mode: 'BAGS'|'MANUAL';
  bags?: Array<{ id: string; seq: number; weightG: string }>;   // unlimited; every bag kept in history
  totalG: string;                               // Σ bags or manual
  deductions?: { tareG?; dhaltaG?; moistureBps?; otherG? }; // optional feature
  netG: string;
}
interface Purchase extends BaseDoc { transactionDate; partyId; varietyId; storeAt: 'WAREHOUSE'|'TRANSIT'; weight: WeightBlock; ratePaisePerQtl; totalPaise; dueDate?; notes?; linkedLoadId? }
interface Sale extends BaseDoc {
  transactionDate; partyId /* buyer or mill */; product: 'PADDY'|'RICE'; varietyId; source: 'WAREHOUSE'|'TRANSIT'|'MILL'; sourceMillId?;
  weight: WeightBlock; ratePaisePerQtl; totalPaise;
  saleStatus: 'ORDER'|'CONFIRMED';                       // stock moves only when CONFIRMED; default CONFIRMED
  deliveryStatus: 'PENDING'|'LOADED'|'IN_TRANSIT'|'DELIVERED';
  deliveryLog: Array<{ status; at; note? }>;
  vehicleNumber?; driverName?; dueDate?; notes?;
  charges?: { loadingPaise?; freightPaise?; vehicleAdvancePaise? };   // optional, collapsed (from client's first brief)
  linkedLoadId?; interGolaGroupId?;
  invoiceNo: string;
  // v2.1: `consignmentDispatchId` is removed (v2.0 consignment-settlement sales are converted
  // into final settlements by scripts/fix-mill-direction.ts; the field only parses old records).
}
interface Expense extends BaseDoc { title; categoryCode; amountPaise; partyId?; personText?; expenseDate; dueDate? /* legacy, ignored (§7.4) */; notes?; vehicleId?; linkedTripId? }
   // paid / unpaid / partial is DERIVED from payments
interface LoadEntry extends BaseDoc { transactionDate /* loading date */; fromPartyId; destinationMillId; varietyId; weight: WeightBlock; ratePaisePerQtl; totalPaise; vehicleNumber; driverName?; secondPartyId?; notes?; link?: { type: 'SALE'|'MILL_DISPATCH'; id: string } }
interface MillDispatch extends BaseDoc {
  dispatchType?: 'MILLING'|'CONSIGNMENT';   // DEPRECATED: kept on v2.0 records, ignored by posting
  millPartyId; dispatchDate; varietyId; weight: WeightBlock;
  ratePaisePerQtl;   // price per quintal THE MILL PAYS
  totalValuePaise;   // quantity × rate = what the mill owes for this dispatch (receivable)
  vehicleNumber?; driverName?; dueDate? /* optional COLLECT reminder, §7.4 */; notes?; linkedLoadId?;
}
interface MillReturn extends BaseDoc { dispatchId; millPartyId; returnDate; product: 'PADDY'|'RICE'|'OTHER'; otherProductName?; varietyId?; weight: WeightBlock;
  ratePaisePerQtl?;  // paddy: the dispatch's rate (credit = qty × rate); absent when the credit is typed
  totalValuePaise?;  // paddy: the CREDIT to the mill; rice / other: informational only
  notes?; dedupeKey }
interface MillingConversion extends BaseDoc { dispatchId; conversionDate; paddyConsumedG; outputs: Array<{ returnId: string; product: 'RICE'|'OTHER'; name?; qtyG }>; lossG /* entered; system shows consumed − Σoutputs */; notes? }   // stock only
interface MillSettlement extends BaseDoc {   // "the dispatch's settlement": its own record so it posts on its own date (DECISIONS D53)
  dispatchId; millPartyId; varietyId; dispatchRatePaisePerQtl /* copied, verified */; transactionDate;
  acceptedG; finalRatePaisePerQtl; deductionPaise; shortfallG; shortfallReason?;
  billedPaise /* (accepted + shortfall) × dispatch rate */; finalValuePaise /* accepted × final rate − deduction */;
  adjustmentPaise /* billed − final: > 0 cut, < 0 extra */;
}   // one active settlement per dispatch; v2.0's ConsignmentSettlement (a Sale) is removed
interface VehicleTrip extends BaseDoc { transactionDate; customerPartyId; vehicleId; driverName?; loadingLocation; destination; qtyG?; rateMode: 'PER_QTL'|'FIXED'; ratePaise; totalIncomePaise; dueDate? /* legacy, ignored (§7.4) */; notes?; costs: Array<{ id; kind: 'DRIVER'|'DIESEL'|'OTHER'; amountPaise; litresMl?; payeeText?; note? }> }
   // cost payments = Payment(source VEHICLE_COST, id = trip._id + ':' + cost.id); income collections = Payment(source VEHICLE_TRIP)
interface SecondPartyEntry extends BaseDoc { partyId; transactionDate; kind: 'WE_OWE'|'THEY_OWE'; amountPaise; dueDate? /* legacy, ignored (§7.4) */; notes? }
   // money given/received = Payment(source SECOND_PARTY, id = entry or null for on-account)
interface StockCount extends BaseDoc { transactionDate; product; varietyId?; location; millPartyId?; systemG; countedG; diffG; bags?; reason; approved: boolean }
interface DayClose extends BaseDoc { date; expectedClosingPaise; actualClosingPaise; diffPaise; note?; recheckNeeded: boolean }
interface Contra extends BaseDoc { transactionDate; kind: 'DEPOSIT'|'WITHDRAW'|'TRANSFER'; fromAccount; toAccount; amountPaise; reference? }
interface Reminder extends BaseDoc { kind: 'PAY'|'COLLECT'|'CUSTOM'; partyId?; source?: { type; id }; dueDate; amountPaise?; title; status: 'OPEN'|'DONE'|'SNOOZED'; snoozeUntil? }
interface AuditLog { _id; businessId; godownId?; at; userId; deviceId; entity; entityId; action: 'create'|'edit'|'void'|'reverse'|'restore'|'login'|'export'|'day_close'; before?; after?; reason? }
```
Derived: `LedgerLine { godownId, account, debitPaise, creditPaise, date, partyId?, sourceType, sourceId, rev }`, `StockMove` (section 9.1), `DailyAgg` cache per Gola + date (rebuildable).

Indexes: every business index is prefixed with `businessId, godownId` (server) or `godownId` (Dexie), plus the date fields above.

---

## 11. Navigation — exactly eight main sections

| # | Section (bn / en) | Internal tabs / sub-pages |
|---|---|---|
| 1 | **ড্যাশবোর্ড / Dashboard** | সারাংশ (Overview) · ক্যাশবই (Daily Cashbook) · স্টক (Daily Stock) · দৈনিক হিসাব (Daily Overview) · রিপোর্ট (business-wide & combined reports) |
| 2 | **ধান কেনা / Purchase** | কেনার তালিকা · নতুন কেনা · কৃষকের হিসাব (Farmer history) · ধানের জাত (Variety management) · রিপোর্ট |
| 3 | **ধান বিক্রি / Sales** | বিক্রির তালিকা · নতুন বিক্রি · ক্রেতার হিসাব (Customer ledger) · ডেলিভারি · রিপোর্ট (+ Inter-Gola transfer action) |
| 4 | **দৈনিক খরচ / Daily Expenses** | আজকের খরচ · সব খরচ · বাকি খরচ (Unpaid) · রিপোর্ট |
| 5 | **দৈনিক লোড খাতা / Daily Load Khata** | তারিখ অনুযায়ী · পার্টি · মিল · গাড়ি · রিপোর্ট |
| 6 | **বাকি ও অগ্রিম / Due & Advance** | সারাংশ · পাওনা · দেনা · মিলের কাছে পাওনা · অগ্রিম · অন্যান্য · রিমাইন্ডার · রিপোর্ট |
| 7 | **গাড়ির ব্যবসা / Vehicle Business** | ট্রিপ · গাড়ি অনুযায়ী · খদ্দের অনুযায়ী · আয়-খরচ · রিপোর্ট |
| 8 | **মিল ও পার্টির হিসাব / Mill & Second Party** | সেকেন্ড পার্টি খাতা · মিলে পাঠানো (Dispatch) · মিল থেকে ফেরত (Return) · ভাঙানোর হিসাব (Conversion) · চূড়ান্ত হিসাব (Final settlement) · রিপোর্ট |

**Not main sections** (live in the header, never in the section list):
- Gola switcher, sync status badge, global search, notifications bell (due alerts).
- Avatar menu: প্রোফাইল (Profile), ব্যবসার তথ্য (Business profile), গোলা পরিচালনা (Gola management), ব্যাংক অ্যাকাউন্ট, সেটিংস (units, deductions, thresholds, language, digits, theme, backup/export, sessions, integrity check), ভাষা toggle, লগআউট.
- Bank deposit/withdrawal and day close live inside Dashboard → Cashbook. Stock count/adjustment lives inside Dashboard → Stock.

**Layout**
- Desktop/tablet (≥ 1024 px): left sidebar with the 8 sections (icon + label), collapsible; top header with switcher and utilities.
- Mobile: bottom bar with 4 primary sections (Dashboard, Purchase, Sales, Due & Advance) + a **"সব বিভাগ / All sections"** button that opens a sheet listing all 8 sections in a 2×4 grid with icons. The sheet is a menu of the same 8 sections, not a ninth section.
- A floating quick-add button on Dashboard and Purchase/Sales lists opens: নতুন কেনা, নতুন বিক্রি, খরচ, পেমেন্ট দিলাম, টাকা পেলাম, লোড, মিলে পাঠানো, গাড়ির ট্রিপ.

---

## 12. Section specifications

### 12.1 Section 1 — Dashboard

**Global filters:** Gola switcher (or "All Golas combined") · date filter: আজ (Today), গতকাল (Yesterday), এই সপ্তাহ (This Week, Mon–Sun), এই মাস (This Month), Custom range. All widgets respect the filters. Balances (cash, bank, stock, receivables, payables) show the position **at the end of the selected range**; flows (purchase, sales, expenses, cash in/out, vehicle income) show **totals within the range**.

#### A. Overview tab — metric cards (big numbers, count-up on change)

| Card | Definition |
|---|---|
| আজকের মোট কেনা / Total purchase | Σ purchase totals (₹) and quantity, by `transactionDate` in range |
| মোট বিক্রি / Total sales | Σ confirmed sales (₹, qty), by `transactionDate`. Sub-line "মিলে পাঠানো ₹X" = Σ mill dispatch value in range, so all income is visible (dispatches are not listed in the Sales section) |
| খরচ / Expenses | Σ expenses incurred, by `expenseDate` (+ vehicle costs, labelled) |
| নগদ ব্যালেন্স / Cash balance | CASH account balance at range end |
| ব্যাংক ব্যালেন্স / Bank balance | Σ BANK accounts at range end (tap → per account) |
| গোলার ধান / Warehouse paddy stock | PADDY @ WAREHOUSE (qtl, with kg/mon on tap) |
| চালের স্টক / Rice stock | RICE @ WAREHOUSE (separate) |
| মিলে থাকা ধান / Mill stock | PADDY @ MILL (tap → per mill) |
| ক্রেতার কাছে পাওনা / Customer receivables | Σ positive balances of customers, vehicle customers and other Golas (mills have their own card) |
| কৃষক/সরবরাহকারীর দেনা / Farmer-supplier payables | Σ negative balances of farmers/suppliers |
| মিলের কাছে পাওনা / Receivable from mills | Σ positive mill balances. Only when some mill balance is negative, a small line "মিলকে ফেরত দিতে হবে ₹X" |
| গাড়ির আয় / Vehicle income | Σ trip income in range |
| নগদ পেলাম / Cash received | Σ IN CASH payments by `paymentDate` in range |
| নগদ দিলাম / Cash paid | Σ OUT CASH payments (paid + expenses) in range |

Also on Overview:
- **Purchase vs Sales chart** (bar/area by day across the range; animated; tooltip; tap a bar → that day's list).
- **Cashflow summary** (opening → received → paid → expenses → closing waterfall or compact chart; cash and bank toggle).
- **Stock summary** (paddy warehouse / mill / rice / other, variety-wise donut or bars).
- **Recent transactions** (last 10 across modules: icon, party, amount, type chip, time; tap → detail).
- **Due alerts** (overdue + due within 3 days; collect vs pay; WhatsApp button).
- **Low-stock alerts.**
- **Quick action buttons** (same as the floating button).
- **Gola-wise report / combined report** shortcuts.

#### B. Daily Cashbook tab (most important feature)
- Date picker (any historical date) with ◀ ▶ day stepping; cash/bank toggle (bank per account).
- Lines: **শুরুর নগদ (Opening cash)**, **নগদ পেলাম (Cash received)**, **নগদ দিলাম (Cash paid)**, **নগদ খরচ (Cash expenses)**, **দিনশেষে থাকার কথা (Expected closing cash)**, **আসল নগদ (Actual closing cash)** (input), **কম (Shortage)** / **বেশি (Excess)** (auto), **ব্যাংক ব্যালেন্স (Bank balance)** shown separately.
- Formula shown under the result: `৫০,০০০ + ২৫,০০০ − ৪০,০০০ − ৫,০০০ = ৩০,০০০`.
- Below: the day's itemised entries in three groups (received / paid / expenses), each line linked to its source document. Each line has "সংশোধন / Correct": opens the source or payment editor (audited) → the cashbook and all later days recalculate.
- **Opening cash = previous day's closing.** If the previous day was closed with an actual count, opening = actual (the shortage/excess was posted as `CASH_DIFF`); otherwise opening = expected.
- **Day close:** enter actual cash (optional denomination helper ৫০০/২০০/১০০/৫০/২০/১০/coins) → shortage/excess shown → note required if ≠ 0 → close. The owner can reopen the day (audited).
- Rules enforced: credit purchases/sales don't touch cash; BANK/UPI never change physical cash; a payment is counted once; backdated payments land on their `paymentDate`; edits recalculate every following day.
- Actions here: ব্যাংকে জমা (cash → bank), ব্যাংক থেকে তোলা (bank → cash), মালিকের তোলা / মূলধন (owner drawings/capital).

#### C. Daily Stock tab
- Date picker; product toggle **ধান / চাল / অন্যান্য**; variety filter; total and variety-wise.
- Lines for paddy (warehouse): **Opening stock, Purchase/inward, Returned from mill, Sales/outward, Mill dispatch, Adjustments, Expected closing, Actual physical stock (input), Shortage/Excess** — each tappable to the source list.
- Separate blocks: **Mill stock** (per mill: opening, dispatched, returned, consumed, settled, closing) and **Rice stock** (opening, returned from mill, rice sales, adjustments, closing).
- Kg / quintal / mon toggle; bag counts where available.
- Date-wise stock history (table + small chart), daily movement list, historical report for any range.
- Physical verification → approve reasoned adjustment (section 9.3).

#### D. Daily Overview tab
Date-wise summary table (each row = a day in range; also a single-day card view): money received, money paid, expenses, purchase (₹/qty), sales (₹/qty), stock inward, stock outward, closing cash, closing paddy stock (+ rice). Totals row. Export/print.

### 12.2 Section 2 — Purchase (ধান কেনা)

**New purchase form** (one screen, sections collapse on mobile):
1. **Farmer:** name (searchable; create inline), mobile (auto-filled; editable; validated).
2. **Purchase date** (`transactionDate`, default today; backdating allowed).
3. **Paddy variety** (searchable variety picker with company chips and recents; "+ নতুন জাত").
4. **Quantity:** toggle **বস্তা ধরে (bag-wise)** / **মোট ওজন (manual total)**.
   - *Bag-wise:* "+ বস্তা যোগ করুন" adds a row with a numeric field (focus moves to it; Enter/Next adds the next bag, so typing is fast); unlimited bags; each row can be edited or deleted (with undo toast); compact chip grid view `#1 52.5 · #2 48.25 …`; live **total weight**, **bag count**, **average bag weight**, and the total in **kg / quintal / mon**. All individual weights are saved and visible in history.
   - *Manual:* total weight with unit selector (kg/qtl/mon), optional bag count.
   - Optional deductions block (only when enabled in Settings).
5. **Rate per quintal** (₹) → **Total amount** (auto, large, with a tappable formula `৫৬ কু. × ₹২,৪০০ = ₹১,৩৪,৪০০`).
6. **Initial payment:** amount (0 allowed = full credit), date (default = purchase date), mode (নগদ / ব্যাংক / UPI; bank/UPI → bank account + reference).
7. **Remaining due** (auto) and an optional **pay-by date** right under it (a reminder only; §7.4).
8. **Notes.** Optional: storage = Gola / direct delivery (direct needs a linked sale or load).

Save → toast "কেনা সেভ হয়েছে" → options: Print/Share receipt · Add another · Open detail.

**Purchase detail page:** all fields, bag list, payment ledger (each payment: date, amount, mode, reference, initial badge, status, remaining due after it) with **+ বাকি টাকা দিন (Add due payment)**, edit/reverse per payment, remaining due (big), the due date with **তারিখ বদলান**, receipt per payment and a purchase bill, audit history (who/when/what changed).

**Purchase list:** search (farmer, mobile, variety, bill no., amount), filters (date range, variety, paid status: paid / partial / unpaid, and overdue), sort, pagination/virtual scroll, totals for the filter.

**Farmer history (কৃষকের হিসাব):** farmer list with outstanding; per farmer: purchase history (date, variety, qty, rate, amount, paid, due), payment history, totals (quantity bought, amount, paid, remaining payable), date filter, statement print/share, WhatsApp, Add payment / Add advance.

**Variety management (ধানের জাত):**
- Searchable list; filter by company (**PAN, Mundra, Tiasa, GMS**, Other, No company) and product (paddy/rice).
- Add custom variety (name in either script, optional other-script name, company). **Duplicate prevention:** normalized name + company must be unique per Gola. Close matches (case, spaces, Bengali/English spelling via `searchKey`) show "এটা কি এই জাত? / Did you mean…".
- Recent varieties (last 8 used) at the top of every picker.
- Seed only widely known public varieties, marked `verified` (e.g. স্বর্ণ / Swarna MTU-7029, শতাব্দী / Satabdi IET-4786, গোবিন্দভোগ / Gobindobhog, মিনিকিট / Minikit, লাল স্বর্ণ / Lal Swarna, IR-36). Seed company names but **no invented company variety list**; the owner adds company varieties as he uses them.
- Edit/merge duplicates (re-points records), archive unused.

### 12.3 Section 3 — Sales (ধান বিক্রি)

**New sale form:** buyer/mill (party with CUSTOMER or MILL role; create inline), mobile, sales date, product (ধান / চাল), variety, quantity (bag-wise or manual, same component), rate/qtl → **Sales total = Quantity × Rate** (auto), **advance received** (amount, date, mode, reference → IN payment, `isInitial`), remaining due (auto), optional expected payment date (§7.4), vehicle number, driver, delivery status, source (Gola stock / direct delivery), optional collapsed charges (loading, freight, vehicle advance), notes. Save as **Confirmed** (default; stock deducted once) or **Order** (no stock effect until confirmed).

**Features:** multiple sales to the same buyer; **Add collection** (date, amount, mode, reference) any number of times; payment history; customer-wise ledger; remaining due; **sales invoice** (print/PDF/share; bilingual; business logo, Gola, invoice no., bag list optional, amount in words); **delivery tracking** (status timeline PENDING → LOADED → IN_TRANSIT → DELIVERED with timestamps; filter by status); search and filters; edit/void with confirmation; each collection updates the cashbook on its own payment date.

**Inter-Gola transfer** action (owner): creates a linked sale (sender) + purchase (receiver).

### 12.4 Section 4 — Daily Expenses (দৈনিক খরচ)

**Categories (seeded, editable; bilingual):** কৃষক পেমেন্ট (Farmer payment, special flow, section 7.3) · লেবার খরচ (Labour) · লোডিং/আনলোডিং · পরিবহন (Transport) · ডিজেল (Diesel) · গাড়ির খরচ (Vehicle expense) · অফিস খরচ (Office) · মিলের খরচ (Mill charges: e.g. unloading or milling charge paid to a mill; pick the mill as the party) · অন্যান্য (Other). Custom categories allowed.

**Fields:** expense title, category, amount, person/party (optional; pick or type), **expense date**, **entry date** (auto, shown read-only), **payment**: "এখনই পুরো দিলাম / Paid fully now" (default) | "কিছু দিলাম / Part paid" | "এখনও দিইনি / Unpaid"; for paid/part: amount, **actual payment date** (defaults to expense date, editable), mode, reference. Notes.

**Backdated payment system:**
- The expense record keeps its `expenseDate`. Each payment is a separate Payment with its own `paymentDate`.
- Status (paid / partial / unpaid) and unpaid balance are derived. "+ পেমেন্ট দিন" adds later payments.
- An unpaid expense doesn't reduce cash. Each payment reduces cash/bank on its own date.
- Edit/reverse with audit trail; full payment history on the detail page.

**Screens:** Today's expenses (grouped by category with subtotals; farmer payments block with "পেমেন্ট" badge; grand total of cash out), All expenses (filters: date range by expense date or payment date, category, status, person), Unpaid expenses (oldest first, pay buttons; expenses carry no due date, §7.4), Reports (category-wise, month comparison, chart).

### 12.5 Section 5 — Daily Load Khata (দৈনিক লোড খাতা)

**Fields:** loading date, party loaded from, destination mill, variety, quantity (bag-wise/manual), rate, total amount (auto), vehicle number, driver name, second party, notes.

**Behaviour (decided):** a load entry is a **register record with no money or stock effect by itself.** On the form and detail page:
- "বিক্রির সাথে যুক্ত করুন / Link to sale" or "মিলে পাঠানোর সাথে যুক্ত করুন / Link to mill dispatch": pick an existing record (filtered by date, vehicle, mill, variety), **or**
- "এখান থেকে বিক্রি/ডিসপ্যাচ তৈরি করুন / Create sale/dispatch from this load": prefilled form. The created record is the only one that moves stock and money, and it is linked back.
- One load ↔ at most one linked record, and vice versa (enforced). Editing quantities on a linked pair shows both values and offers "update the linked record too". It never creates a second stock deduction.
- Unlinked loads are flagged "যুক্ত নয় / Not linked" in the register so nothing is silently missed.

**Features:** add multiple records per day; date-wise register (daily totals); party-wise, mill-wise, vehicle-wise history; search; **printable loading slip** (bilingual; logo, Gola, vehicle, driver, bags/weights, party, mill); edit/void with confirmation.

### 12.6 Section 6 — Due & Advance (বাকি ও অগ্রিম)

A **unified view** over parties and their linked transactions and payments. It creates no independent financial records, **except** party-level entries that genuinely have no other home: opening balance (initial balance), on-account advance given/received, and payments recorded here against a chosen source.

- **Categories (tabs):** ক্রেতার পাওনা (Customer receivable) · কৃষক/সরবরাহকারীর দেনা (Farmer/supplier payable) · মিলের কাছে পাওনা (Receivable from mills) · অগ্রিম (Party advance: given and received) · অন্যান্য (Other party balances: second parties, drivers, labour…, and mills that paid too much: "মিলকে ফেরত দিতে হবে").
- **Classification by the sign of the balance first, then the role:** > 0 (they owe us) → মিলের কাছে পাওনা for mills, ক্রেতার পাওনা for customers / vehicle customers / Golas, অগ্রিম for farmers / suppliers (advance given), else অন্যান্য; < 0 (we owe them) → দেনা for farmers / suppliers, অগ্রিম for customers (advance received), অন্যান্য for mills ("to refund") and others. A positive mill balance is never shown as দেনা.
- **Per row:** party, mobile, last transaction date, initial balance, total amount, paid, remaining, earliest due date / overdue days, WhatsApp and call buttons.
- **Party ledger:** chronological lines from every source (purchase, sale, expense, mill dispatch/return, vehicle trip, second-party entry, opening, advance, payments) with running balance and links to the source. Date-range filter, print/share statement.
- **Add payment / collection here:** choose which open bill(s) it settles (default FIFO oldest first, editable) or "advance". This creates the same Payment records as the source screens.
- **Outstanding summary:** totals per category, aging buckets (0–30, 31–60, 61–90, 90+ days), top dues.
- **Reminder interface:** due today / overdue / upcoming (7 days); mark done, snooze, change date (for an automatic reminder this changes the deal's due date, §7.4). Reminders come automatically from the due dates of purchases, sales and mill dispatches with something still due, plus manual ones. In-app badge; optional daily web-push digest when online.
- **WhatsApp reminder:** button opens `wa.me` with the party's mobile and a prepared message (Bengali default, English option, editable before sending), for example:
  > নমস্কার {name}, {business} ({gola}) থেকে জানাচ্ছি — আপনার {amount} টাকা বাকি আছে, পরিশোধের তারিখ {dueDate}। অনুগ্রহ করে সময়মতো পরিশোধ করবেন। ধন্যবাদ।
  A separate template is used when **we** owe money (payment-promise/confirmation message). The template follows the sign of the balance; for a mill that owes us (the normal case) it is always the collection reminder ("আপনার কাছে আমাদের ₹X পাওনা আছে…"). The UI says "WhatsApp খুলুন / Open WhatsApp", never "Sent".

### 12.7 Section 7 — Vehicle Business (গাড়ির ব্যবসা)

**Trip form:** date, customer (name, mobile), vehicle (number; own vehicles list), driver name, loading location, destination, quantity (optional), rate (per qtl or fixed) → **total income** (auto), advance received (amount, date, mode → IN payment), remaining due (auto), **driver cost, diesel cost (₹ + litres optional), other expenses** (each: amount, paid now? mode, date), notes.

**Net profit = Total income − Driver cost − Diesel cost − Other expenses** (shown live).

**Features:** multiple entries; customer-wise and vehicle-wise history; driver details; payment tracking with multiple collections; daily and monthly income (with chart); vehicle expenses breakdown; net profit per trip / vehicle / month; printable receipt. Vehicle transactions stay separate from paddy purchase/sales unless explicitly linked (optional link to a sale/load for reference only, with no automatic money effect).

### 12.8 Section 8 — Mill & Second Party (মিল ও পার্টির হিসাব)

**A. Second Party Ledger:** party (create inline), mobile; entries of kind **"আমরা দেব / We owe"** or **"ওরা দেবে / They owe"** (amount, transaction date, notes; no due date, §7.4), plus money **given/received** (payment date, amount, mode, bank account/reference, cash/bank details, person who paid/received, notes) as Payments. Party-wise history, payment history, outstanding balance, multiple and partial payments, search and filters, statement print/share.

**B. Mill Dispatch (মিলে পাঠানো):** paddy delivered to a mill **that the mill pays for**. A mill is the broker's customer/debtor; the broker never owes a mill money because of a dispatch.
- **Fields:** mill name, dispatch date, variety, quantity (bag-wise/manual), **"মিলের রেট (মিল দেবে) / Rate the mill pays"** (per quintal), **"মোট পাওনা / Total receivable"** (= quantity × rate, auto), **"মিল দিয়েছে / Received from mill"** (initial collection: amount, date, mode, reference → an IN payment), **"মিলের কাছে বাকি পাওনা / Remaining receivable"** (auto), optional expected payment date (§7.4; creates a COLLECT reminder), vehicle number, driver, notes, optional linked load. No dispatch-type choice (v2.0's "for milling / consignment" toggle is removed; old records keep the field, posting ignores it).
- **Posting:** Dr PARTY:mill / Cr MILL_SALES (total); Dr COGS / Cr STOCK_PADDY at average cost. **No cash effect at dispatch.**
- **Detail page:** quantity sent / returned / accepted / still at the mill; value, return credits, final-settlement adjustment, collected, remaining receivable; **"+ মিল থেকে টাকা পেলাম / Add collection from mill"** (green, incoming; any number of collections, each with its own date and mode); the final settlement; WhatsApp with the collection-reminder template. Only when the mill has paid more than it owes: "মিলকে ফেরত দিতে হবে ₹X" and **"টাকা ফেরত দিলাম / Refund to mill"** (an OUT `MILL_REFUND` payment, Cash paid).
- **Rules:** warehouse paddy decreases once; mill stock increases once; dispatches are not listed in the Sales section (their value shows on the Total sales card's sub-line); multiple collections with separate dates; a collection can't exceed the remaining receivable unless the owner keeps the extra as the mill's advance.

**C. Mill Return (মিল থেকে ফেরত):**
- **Fields:** original dispatch (required; picker shows mill, date, variety, qty remaining at mill), mill name (auto), return date, product type **ধান / চাল / অন্যান্য** (+ name for other), variety, number of bags + **individual bag weights** (same bag component) or manual total, total quantity; for paddy a **"Credit value"** (auto = returned qty × that dispatch's rate, editable) with its effect shown: "মিলের পাওনা ₹X কমবে / Receivable from mill reduces by ₹X"; notes. **No payment fields**: a return is a credit, not cash.
- **Posting (paddy):** Dr MILL_SALES / Cr PARTY:mill for the credit; stock back MILL → WAREHOUSE at cost (Dr STOCK_PADDY / Cr COGS). **No cash effect.** Rice / other: stock only (separate rice / other stock, never added to paddy).
- **Rules:** returned paddy → back to warehouse paddy and out of mill stock. **Rice never offsets paddy quantity.** The paddy consumed is recorded through tab D. Returned paddy can't exceed the paddy remaining at the mill for that dispatch (warn + confirm). A dispatch with a final settlement takes no more returns. **Duplicate prevention:** same dispatch + date + product + quantity within 10 minutes → "একই ফেরত আগে সেভ হয়েছে? / Possible duplicate" confirmation; idempotent save IDs prevent double submit.

**D. Milling Conversion (ভাঙানোর হিসাব):** a **stock-only** record for any dispatch. Fields: linked dispatch, conversion date, original paddy quantity consumed, rice returned (linked return(s)), by-products (name + quantity, linked returns), milling loss. The user enters actual figures; the app **never assumes a conversion ratio**. It shows `consumed − rice − by-products = difference` and asks the user to confirm the loss. Posting removes the consumed paddy from mill stock (section 9.2); money and the mill's receivable don't change. Shows conversion % for information only.

**E. Final settlement (চূড়ান্ত হিসাব):** on the dispatch (tab "চূড়ান্ত হিসাব" lists dispatches waiting for it, and the dispatch page has the button). Fields: weight the mill accepted, final rate, moisture / quality cut (₹), date; the rest of the paddy still at the mill for that dispatch is a weight shortfall with a reason. Before saving it shows the value at the dispatch rate, what the mill finally pays, the difference ("মিলের পাওনা ₹X কমবে / বাড়বে") and the new receivable. It **adjusts the same dispatch's receivable**: a cut posts Dr MILL_DEDUCTION / Cr PARTY:mill, extra value the reverse; accepted + shortfall leave mill stock. **It never creates a Sale** (no double income). One active settlement per dispatch; reversing it restores the receivable and the mill stock. Paddy the mill did not accept and sent back is recorded as a return first (tab C).

---

## 13. Reports, print and export

**Placement:** reports live in a "রিপোর্ট" tab inside the relevant section (no Reports main section). Business-wide, Gola-wise and combined reports are in Dashboard → রিপোর্ট.

| Report | Section |
|---|---|
| Daily purchase; purchase register; farmer ledger | Purchase |
| Daily sales; sales register; customer ledger; delivery status | Sales |
| Daily expenses; category-wise; unpaid expenses | Daily Expenses |
| Load register (date/party/mill/vehicle) | Load Khata |
| Due & advance; party ledger; aging; reminders | Due & Advance |
| Vehicle income; vehicle profit (trip/vehicle/month) | Vehicle Business |
| Mill dispatch (value, collected, receivable); mill return (credit); mill stock; milling conversion; second-party ledger | Mill & Second Party |
| Daily cashbook; bank book; daily stock; paddy stock; rice stock; daily overview; monthly business summary (purchase, sales, expenses, gross profit, cash/bank movement, stock); date-range report; Gola-wise report; **combined report** | Dashboard |

**Every report:** uses real database records (never sample data); date range presets + custom; filters; totals row; header with **business name, logo, Gola name (or "সব গোলা"), date range, generated-at time**; labels in the current language (bn/en); **Print** (print-optimised CSS, A4 and 80 mm thermal-friendly receipt layouts) → **PDF** via browser "Save as PDF"; **Excel (.xlsx)** and **CSV** export; share as image for short reports. Empty state when there's no data.

---

## 14. Voice input and WhatsApp

### 14.1 Voice input (no AI, no paid API)
- A mic button inside these fields: farmer/party name, quantity, rate, expense description/title, party name in Due & Advance and Second Party, notes.
- Uses `SpeechRecognition`/`webkitSpeechRecognition` with `lang = 'bn-IN'` or `'en-IN'` (follows UI language; long-press the mic to switch).
- Name/text fields: insert the transcript (editable).
- Number fields: convert spoken numbers to digits with a local parser supporting Bengali number words (এক…নিরানব্বই, শো/একশো, হাজার, লাখ/লক্ষ, দশমিক/পয়েন্ট, সাড়ে/দেড়/আড়াই) and English words. Show the parsed value for confirmation before filling. Unit tests for the parser.
- States: listening animation (subtle pulse), "বুঝতে পারিনি, আবার বলুন / Didn't catch that", permission denied help.
- If unsupported or offline: hide the mic or show a disabled mic with tooltip "এই ফোনে ভয়েস চলে না — টাইপ করুন / Voice not supported here — please type". Typing is always available.

### 14.2 WhatsApp
Click-to-chat links (`https://wa.me/91XXXXXXXXXX?text=` URL-encoded) with prepared Bengali (or English) messages including name, amount due and due/payment date. Available on: party ledger, Due & Advance rows, purchase/sale/expense/trip detail, payment receipts (share as image via the Web Share API where supported). Never claim automatic sending.

---

## 15. Design system and UI/UX (must-have)

### 15.1 Identity
- **App name:** Dhan Gola / ধান গোলা. Tagline (optional): "ধানের ব্যবসার সম্পূর্ণ হিসাব".
- **Logo:** create a custom SVG: a golden paddy sheaf/stalk emblem (3–5 grain heads curving upward, clean geometric strokes) inside a **rounded golden square**. Variants: full colour (gold square, deep green or ivory emblem), monochrome, small favicon. Generate PWA icons (192, 512, maskable, apple-touch) from the SVG with a script. Use it on login, header, splash, receipts, reports.
- **Palette (design tokens; shadcn CSS variables):**

| Token | Value (guide) | Use |
|---|---|---|
| Deep Forest Green | `#1E4D3A` (900 `#123326`, 700 `#245E47`, 500 `#2F7A5B`, 100 `#E3F0EA`) | primary actions, header, active nav, positive money |
| Paddy Gold | `#C9A227` (600 `#B08A1C`, 300 `#E5C766`, 100 `#F7EDCC`) | accents, logo, highlights, selected chips, charts |
| Warm Ivory | `#FAF6EC` | app background |
| Card white | `#FFFFFF` | cards, sheets, tables |
| Neutral | slate/stone scale | text, borders, subtle backgrounds |
| Receivable / in | green 600 | পাওনা, received |
| Payable / out | red 600 (muted, not neon) | দেনা, paid, shortage |
| Warning | amber 600 | due soon, low stock |

  Dark mode optional (deep green-black surfaces, gold accents). Contrast must meet WCAG AA.
- **Surfaces:** white cards on ivory with `rounded-2xl`, 1 px warm-neutral borders, soft layered shadows (`shadow-sm` at rest, `shadow-md` on hover/press-lift). No heavy gradients; at most a very subtle green→deeper-green on the header/hero card.
- **Typography:** Noto Sans Bengali / Hind Siliguri (Bengali), Inter (English). Clear hierarchy: metric numbers 28–36 px semibold `tabular-nums`; section titles 18–20 px; body 15–16 px; minimum 14 px. Bengali line-height ≥ 1.5.
- **Icons:** lucide, consistent 1.75 px stroke, every main section has a distinct icon.

### 15.2 Components (premium SaaS look)
- **Metric cards:** icon tile (gold or green tint), label, big count-up number, small sub-line (qty in qtl, or "গতকালের চেয়ে +১২%"), tap → drill-down.
- **Transaction cards** (mobile lists): left type icon with colour chip, party name + variety, date, right-aligned amount (green in / red out), status pill (পরিশোধিত / আংশিক / বাকি / বাতিল), swipe or kebab for actions.
- **Data tables** (desktop): sticky header, zebra-free clean rows, right-aligned numbers, sortable columns, filter bar, pagination or virtual scroll, totals footer; they become cards on mobile.
- **Forms/modals:** shadcn Dialog (desktop) / Drawer bottom-sheet (mobile); sticky footer with live total and primary button; large inputs (≥ 48 px); inline validation messages; numeric keypad; sensible defaults (today's date, last used variety/rate/mode).
- **Charts:** recharts themed with the palette, rounded bars, soft grid, animated entrance, rich tooltips, legend; empty state when there's no data.
- **Status/feedback:** sonner toasts (success with check micro-animation, error with shake-free red state), inline alerts, skeleton loaders.

### 15.3 Animation (premium, smooth, never slowing work)
Implement with `motion` (LazyMotion), CSS transitions and Tailwind:
- Page/section transitions: fade + 8 px slide, 180–220 ms, ease-out.
- Dashboard numbers: count-up 600–800 ms on first render and when the filter/Gola changes (not on every keystroke elsewhere).
- Card entrance: staggered fade-up (30–40 ms stagger, max 8 items, then no stagger).
- Gola switching: content cross-fade ≤ 250 ms + the switcher chip animating its colour.
- Buttons: hover lift/colour, press scale 0.97, focus ring.
- Modal/drawer/dropdown: scale/fade or slide-up 180 ms.
- Tabs: animated underline/pill (`layoutId`).
- Charts: grow-in animation on load/filter change.
- Skeletons: soft shimmer while IndexedDB queries resolve (usually instant; show only if > 150 ms).
- Micro-interactions: save success check, add-bag row slide-in, payment added → due amount animates down.
- **Rules:** animations never block input (forms are interactive immediately); no animation > 400 ms except count-up; no animation in bag-weight typing paths beyond the row insert; respect `prefers-reduced-motion` (switch to instant/opacity-only and no count-up); no glow, neon, bouncy/childish effects or distracting gradients; target 60 fps on a mid-range Android (animate only `transform`/`opacity`).

### 15.4 Ease of use for non-technical users
- Large clear buttons (min 48 px height), plain Bengali words (দিলাম / পেলাম, বাকি, জমা) instead of accounting jargon. The word "debit/credit" never appears.
- Each form shows only essential fields; advanced ones are under "আরও / More".
- Sensible defaults everywhere; remember the last-used values per party.
- **Confirmation before every destructive action** (void/reverse/delete/logout with pending data/day reopen), stating exactly what will happen and its effect ("এর ফলে ১৫ নভেম্বরের ক্যাশ ₹৫,০০০ বাড়বে").
- Meaningful success/error messages that say what happened and what to do next.
- Show the calculation behind every computed number on tap.
- Undo for small actions (delete a bag row, remove a filter).

### 15.5 Responsiveness
Mobile-first (360 × 740), tablet (2-column), desktop (sidebar + 3–4-column dashboard). No horizontal page scroll; wide tables scroll inside their container with a sticky first column, or switch to cards.

### 15.6 Interaction completeness (client Part 9)
Working navigation, Gola switcher, forms with validation, search, sorting, filters, pagination where needed, add/edit/delete(void), confirmation dialogs, loading/empty/error states, success notifications, responsive tables, mobile cards, detail views, printable records. **Every visible control must perform a real action; remove anything that can't.** Build reusable components: `AmountInput`, `WeightInput` (bag-wise/manual), `UnitToggle`, `PartyPicker`, `VarietyPicker`, `PaymentList` + `AddPaymentSheet`, `DateField` (with backdate warning), `MetricCard`, `TxnCard`, `DataTable`, `ReportShell` (header/filters/export/print), `ConfirmDialog`, `EmptyState`, `VoiceButton`, `WhatsAppButton`.

---

## 16. Language

- **Bengali is the default** for new installs and new users. A visible বাংলা | English toggle in the header avatar menu and on the login screen switches instantly, offline, with no reload. The choice is saved per user and per device.
- Translate everything: navigation, forms, labels, buttons, placeholders, validation (Zod error map), toasts, notifications, empty states, receipts, invoices, reports, Excel headers, WhatsApp templates.
- Use **natural West Bengal Bengali** trade terms (section 1.2). Avoid Bangladeshi or formal-Sanskritised alternatives where a common local word exists (e.g. "বাকি", "দেনা-পাওনা", "গোলা", "মণ", "বস্তা", "ভাঙানো").
- Digits: separate setting বাংলা (০১২) / English (012), defaulting to Bengali digits in Bengali UI. All number inputs accept both. Indian grouping (১,৩৪,৪০০). Amount in words in both languages on receipts.
- Fonts with proper Bengali shaping (Noto Sans Bengali / Hind Siliguri), self-hosted.
- Typed dictionaries (`bn.ts` canonical, `en.ts` must have identical keys; CI fails on mismatch or hard-coded JSX strings). No locale in URLs (offline precache).
- User-entered names stay as typed; optional other-script name; cross-script search.

---

## 17. Offline-first and sync (unchanged principles from v1.1)

- Every write goes to Dexie first + outbox in one transaction; UI never waits for network. Sync push/pull with idempotent op IDs, server recomputation of postings, Mongo transactions, `serverSeq` changelog, filtered by business + Gola.
- Conflicts on money records (same record edited on two offline devices) are never auto-merged: first wins, second shows in a "মেলানো দরকার / Needs review" list for the owner.
- Payments, documents and their derived lines/moves sync together as one op group so the cashbook can never show half a transaction.
- Sync status badge in header (synced / N pending / offline / error) and a Sync detail page in Settings.
- Persistence test (client Test 8): refresh, logout/login, page changes — all records remain; after re-login on a new device, a full bootstrap pull restores everything.
- Request persistent storage; export-unsynced-data escape hatch; SW update never interrupts a dirty form or an active sync.

---

## 18. PWA
Manifest name "Dhan Gola – ধান গোলা", short name "ধান গোলা", `lang: bn`, standalone, portrait, theme colour Deep Forest Green, background Warm Ivory, logo icons (incl. maskable), shortcuts (নতুন কেনা, নতুন বিক্রি, খরচ, ক্যাশবই). Serwist precaches the shell, all routes, fonts and icons. Installation prompt (Android) and iOS instructions. A cold offline start must open every one of the 8 sections.

---

## 19. Security
- Password hashing (argon2id/bcrypt ≥ 12), recovery code hashed, login + recovery rate limiting, refresh token rotation bound to device, httpOnly cookies, security headers.
- Server enforcement of businessId + godownId + same-Gola references on every read/write/export (section 2.4); Zod validation; no client-trusted totals (server recomputes).
- Audit log for create/edit/void/reverse/day close/reopen/login/export/password reset.
- No full bank account numbers stored (last 4 only).

---

## 20. Operations, backup, deployment
Unchanged from v1.1: one deployment + one Atlas project per client; nightly `mongodump` via GitHub Actions (encrypted) + in-app owner export (JSON/Excel, per Gola or all); daily cron ping keeps the free cluster awake and sends reminder digests; storage gauge; restore doc. Env adds `ALLOW_REGISTRATION=auto` and `NEXT_PUBLIC_APP_NAME=Dhan Gola`.

---

## 21. Testing and acceptance (the app is NOT complete until all pass)

Automate each as Vitest (domain/sync) and/or Playwright (UI, mobile viewport, **run in Bengali and English**). Dates below use the current year.

**Test 1 — Purchase:** 56 qtl × ₹2,400 = **₹1,34,400**; initial payment ₹50,000 on 20 Nov (cash) → due **₹84,400**; + ₹30,000 on 22 Nov (bank) → ₹54,400; + ₹20,000 on 24 Nov (cash) → **₹34,400**. Verify: three payment records each with its own date; due reduces correctly; cashbook cash paid on 20 Nov includes ₹50,000, bank book on 22 Nov ₹30,000, cashbook 24 Nov ₹20,000; purchase date's cashbook unchanged otherwise; no duplicate deduction (sum of cash paid across 20–24 Nov from this purchase = ₹70,000 cash + ₹30,000 bank).

**Test 2 — Stock:** opening 100 qtl; purchase +56; sale −10; mill dispatch −20 → warehouse closing **126 qtl**; mill stock **+20 qtl**.

**Test 3 — Mill return:** return 5 qtl paddy against that dispatch → warehouse **131 qtl**, mill stock **15 qtl**; rice stock unchanged (and rice return of e.g. 3 qtl goes only to rice stock).

**Test 4 — Cashbook:** opening ₹50,000; cash received ₹25,000; cash paid ₹40,000; cash expenses ₹5,000 → expected **₹30,000**; enter actual ₹29,500 → shortage **₹500**; next day opening ₹29,500; enter actual ₹30,200 instead → excess **₹200**.

**Test 5 — Backdated expense:** labour ₹5,000, expense date 20 Nov, entry date 24 Nov; payments ₹3,000 on 20 Nov and ₹2,000 on 24 Nov → balance **0**; cashbook shows ₹3,000 expense on 20 Nov and ₹2,000 on 24 Nov; total counted once (₹5,000); entry history retained.

**Test 6 — Partial sales collection:** sale ₹25,000; collect ₹10,000 (date 1) and ₹5,000 (date 2) → due **₹10,000**; customer ledger and cashbook show both on their dates.

**Test 7 — Two Golas:** create Gola 1 and Gola 2 under one owner; different purchases, sales, expenses, stock; switch; records, cashbook, stock and dues remain separate; combined report totals = sum of both.

**Test 8 — Persistence:** refresh, logout/login, navigate — all records present (also offline, and after re-login on a second browser profile).

**Test 9 — Security:** separation between owners (set up a second business in the test DB) and between Golas; crafted API requests with another `godownId`/`businessId`/party id are rejected; frontend manipulation (editing IndexedDB, altering request payload totals) cannot bypass server rules (server recomputes and rejects). This replaces "RLS" with equivalent server-side enforcement on MongoDB.

**Test 10 — Edit and reversal:** edit a purchase, payment, sale, expense and mill dispatch (quantity, amount, date) → stock, cashbook (old and new dates), dues and historical reports recalculate; no duplicate transaction; void restores the exact previous state.

**Test 11 — UX:** mobile responsiveness (360 px, 768 px, 1280 px), Bengali and English complete, forms and validation, navigation (exactly 8 sections), Gola switching, print/PDF, empty and error states, reduced-motion mode.

**Test 12 — Mill money direction** (Vitest domain test + Playwright in Bengali and English):

| Step | Expected |
|---|---|
| Gola opening cash ₹2,00,000. Buy 56 qtl @ ₹2,400 = ₹1,34,400; pay the farmer ₹1,34,400 cash | cash **₹65,600**; farmer due 0 |
| Dispatch 56 qtl to a mill @ ₹2,600 | mill receivable **₹1,45,600** (shown under পাওনা, never দেনা); cash still ₹65,600; warehouse −56 qtl; mill stock +56 qtl |
| The mill pays ₹1,00,000 cash | cash **₹1,65,600**; Cash received +₹1,00,000; receivable **₹45,600** |
| The mill returns 5 qtl paddy | credit ₹13,000 → receivable **₹32,600**; warehouse +5 qtl; mill stock 51 qtl; cash unchanged |
| The mill pays ₹32,600 by bank | bank +₹32,600; receivable **0**; cash unchanged |
| Profit | gross profit **₹10,200** (51 × (2,600 − 2,400)) |
| Global check | no "mill payable" anywhere; "Cash paid" unaffected by mill collections |

Property tests: every MILL_DISPATCH payment increases CASH or BANK; a mill's balance goes negative only if collections exceed dispatched − returned − settlement-adjusted value; the direction map rejects wrong directions on the device and on the server.

**Plus (from v1.1):** golden money tests (6.4), property tests, sync idempotency/conflict tests, cold-offline Playwright test for all 8 sections, voice number-parser unit tests, i18n key parity test.

---

## 22. Defaults decided (confirm with client later; build with these)
1. **Mills pay the broker** (v2.1). A mill dispatch is paddy the mill pays for (a receivable at "rate the mill pays"); collections are IN; a paddy return is a credit (default qty × dispatch rate); the final settlement adjusts the same dispatch (no separate sale); the milling conversion is stock-only. The broker pays a mill only through an explicit "Refund to mill" or a "মিলের খরচ / Mill charges" expense. (Replaces v2.0's "milling or consignment, chosen per dispatch".)
2. Load khata = register; stock/money only via a linked sale or dispatch.
3. One deployment per client; owner-only login; registration closes after the first owner.
4. Password reset by recovery code + developer CLI reset.
5. Farmer payment selectable in Expenses but recorded as a payment (counts as cash paid, not expense).
6. Weight deductions (ধলতা etc.) optional and off by default.
7. 1 mon = 40 kg, configurable.
8. Sales default to Confirmed (stock out on save); Order status available.
9. A mill return has no money fields (a return is a credit to the mill, never cash); money from the mill is collected against its dispatch, and the mill's outstanding is its party ledger balance.

## 23. Out of scope for v2
Staff/munshi logins, GST/e-way bills, SMS/automated WhatsApp, Bluetooth printer, weighbridge integration, AI features, native app stores, multi-owner SaaS (code stays businessId-safe for later).