# Requirement Specification — "Dhan Khata" (ধান খাতা)
### Offline-first business management PWA for paddy (ধান) brokers in West Bengal

> **Audience:** Claude Code (and the developer supervising it).
> **Status:** v1.1 — build-ready spec. **v1.1 changes:** (a) every godown is an independent business entity with its own books, parties, mills, cash and stock (section 1.4); (b) the app is fully bilingual — English and Bengali, switchable at any time (section 11.4). Items marked **[CONFIRM]** need a quick confirmation from the client but have a sensible default already written in, so the build does not have to wait.
> **Working name:** "Dhan Khata" — rename freely via `NEXT_PUBLIC_APP_NAME`.

---

## 0. How to use this document (instructions for Claude Code)

1. Read the whole file before writing code. Sections 5–8 (architecture, money rules, accounting model, data model) are the foundation; every module in section 9 depends on them.
2. Build in the phase order in **section 21**. Do not start UI modules before the money library, the posting engine and the sync engine have passing tests.
3. **Non-negotiables** (violating any of these is a bug, not a trade-off):
   - No floating-point arithmetic on money or weight. Ever. (section 6)
   - Every financial document produces balanced ledger lines via one pure function shared by client and server. (section 7)
   - Every write goes to IndexedDB first and is queued in the outbox; the UI never waits for the network. (section 12)
   - Nothing in the outbox is deleted until the server acknowledges it.
   - Every page must work on a cold start with the network fully off (after first login). (section 13)
   - Every business record belongs to exactly one godown (`godownId`). No query, total, report, khata or sync feed may mix godowns, except the owner's explicit read-only "All godowns" view. (section 1.4)
   - No user-facing string is hard-coded. Every screen, message, receipt and report must work fully in both English and Bengali. (section 11.4)
4. When a requirement here is ambiguous, prefer the choice that (a) can never silently lose or alter money data, then (b) is simplest for a non-technical Bengali-speaking user on a cheap Android phone.
5. Keep all hosting-specific code behind small adapters so the app can move between Netlify / Vercel / Cloudflare without rewrites (section 18).

---

## 1. Business context

### 1.1 Who the client is
A local paddy broker (ধানের ব্যবসায়ী / দালাল / আড়তদার) in West Bengal who:
- buys paddy (ধান) from many farmers (কৃষক) and from other parties/second parties (পার্টি),
- operates from **multiple godowns** (গোডাউন). **Each godown is run as a separate, independent business** with its own customers, mills, cash and khata (section 1.4). Paddy is either stored in the godown or loaded directly,
- sells and dispatches it to rice mills (রাইস মিল) by truck (গাড়ি),
- pays labour (লেবার/হামালি), transport (গাড়ি ভাড়া), and keeps advances (অগ্রিম/দাদন) and dues (বাকি/পাওনা) with everybody,
- also runs a **vehicle business** (own trucks earning hire),
- handles a lot of **cash**, plus several bank accounts, UPI, and cheques.

Today all of this lives in paper khatas (খাতা). The app replaces the khatas with one phone app that is **always correct, works without internet, and shows the business position at a glance**.

There are **two clients with identical needs**. Each gets an independent deployment and database from the same codebase (section 18). This is *not* a multi-tenant SaaS.

### 1.2 Domain glossary (use these Bengali labels in the UI)

| English (code) | Bengali UI label | Meaning |
|---|---|---|
| Paddy | ধান | Unhusked rice; the only commodity |
| Variety | ধানের ধরন | e.g. স্বর্ণ (Swarna), মিনিকিট, শতাব্দী, গোবিন্দভোগ, লাল স্বর্ণ, ১০১০, পুষা — editable master list |
| Quintal | কুইন্টাল (কু.) | 100 kg. Primary trading unit; rates are ₹/quintal |
| Maund | মণ | 40 kg. Optional display/input unit **[CONFIRM if client uses it]** |
| Bag | বস্তা | Count of bags; average bag weight varies |
| Gross weight | মোট ওজন | Weight on scale/weighbridge before deductions |
| Bag tare | বস্তার ওজন | Weight of empty bags deducted |
| Dhalta / allowance | ধলতা | Customary weight deduction (kg per quintal or per bag) for dust/moisture/handling |
| Moisture cut | ময়েশ্চার / জলীয় বাদ | % deduction for excess moisture |
| Net weight | নিট ওজন | Weight that is billed |
| Rate | রেট (₹/কুইন্টাল) | Price per quintal |
| Farmer | কৃষক | Seller |
| Party / Second party | পার্টি / সেকেন্ড পার্টি | Another trader/broker who sells to or buys from the client |
| Mill | মিল | Buyer (rice mill) |
| Godown | গোডাউন | An **independent business unit** with its own stock, parties, cash, bank accounts and books (section 1.4) |
| Load | লোড | One truck dispatch |
| Load place | লোডের স্থান | Village/field/godown where truck is loaded |
| Vehicle | গাড়ি | Truck / tractor / pickup; identified by vehicle number |
| Loading rate | লোডিং রেট | Labour cost per quintal to load |
| Delivery rate / freight | ডেলিভারি রেট / ভাড়া | Transport cost per quintal (or fixed per trip) |
| Vehicle advance | গাড়ি অগ্রিম | Advance paid to driver/owner against freight |
| Advance | অগ্রিম / দাদন | Money paid before goods/bill (to farmer) or received before delivery (from mill) |
| Due | বাকি | Amount still unpaid on a bill |
| Receivable | পাওনা | Others owe the client |
| Payable | দেনা / দিতে হবে | Client owes others |
| Cash in hand | হাতে নগদ | Cash account balance |
| Day close | দিন শেষ | End-of-day cash count and lock |
| Khata / ledger | খাতা | Party account statement |
| Voucher | ভাউচার / রসিদ | Any recorded document (purchase bill, payment, etc.) |

### 1.3 Seasons and calendar
- Paddy seasons: আমন (Aman, main, ~Nov–Jan), বোরো (Boro, ~Apr–Jun), আউশ (Aus). Every purchase/sale carries a `season` tag (auto-suggested by date, editable).
- Financial year: April–March (Indian FY). Reports default to the current FY.
- Business day = calendar date in **Asia/Kolkata**. All "today" computations use IST regardless of device timezone.

### 1.4 Each godown is an independent business entity
The client runs every godown as a separate business: **two godowns = two separate sets of books**. Model a godown like a "company" in accounting software (Tally-style). One deployment (one client) can have any number of godowns.

| Scoped per godown (fully separate, never mixed) | Shared across the deployment |
|---|---|
| Parties: farmers, second parties, mills, transporters, labour, pumps. The same real person dealing with two godowns = **two separate party records** with separate balances | User logins (each user is granted access to one or more godowns) |
| All vouchers: purchases, sales, loads, payments, receipts, expenses, trips, mill settlements, day close, opening balances | Registered devices |
| Chart of accounts and every ledger balance (পাওনা / দেনা) | App-level preferences: language, digit style, theme |
| Cash in hand and cash book | Seed templates (default varieties and expense categories), copied into each godown when it's created and independent after that |
| Bank accounts. A real bank account used by two godowns is added in each one, and each tracks only its own transactions **[CONFIRM]** | |
| Stock (variety-wise) | |
| Varieties, expense categories, places | |
| Vehicles and the vehicle business **[CONFIRM: default per godown]** | |
| Reminders, day close, day locks, voucher numbering | |
| Receipt/letterhead profile (godown or firm name, address, phone, proprietor, GSTIN) | |
| Reports, exports, integrity checks | |

**Rules**
1. Every synced business document has a required, **immutable** `godownId`. It cannot be changed after creation. To "move" a record, void it and re-enter it in the other godown.
2. A voucher may only reference parties, accounts, bank accounts, vehicles, varieties and categories of the **same godown**. This is checked on the client and on the server; the server rejects violations with `CROSS_GODOWN_REFERENCE`.
3. The app always has one **active godown**, shown in the header switcher ("গোডাউন: রামপুর ▾" / "Godown: Rampur ▾"). Every screen, list, search, total and report shows only the active godown. Switching is instant and works offline. The last active godown is remembered per device.
4. The **owner** (and any user given the `consolidated` permission on ≥ 2 godowns) gets a read-only **"সব গোডাউন / All godowns"** mode. It is available on the dashboard and on the comparison reports (9.14). It shows each godown side by side plus a total row. No entry can be made in this mode; the + buttons are hidden.
5. **Inter-godown transactions** are deals between two independent businesses. The **inter-godown transfer** wizard (paddy or money) creates a SALE or PAYMENT in the sending godown and a matching PURCHASE or RECEIPT in the receiving godown. Each one is posted against an auto-created party that represents the other godown ("গোডাউন: সোনাপুর"). The pair shares a `groupId` and is always edited or voided together, so both books stay in agreement. **[CONFIRM whether the client ever does this; default: supported]**
6. **Copy party from another godown** copies only the name, phone and address, never balances or history, to save typing when the same farmer sells at two godowns.
7. Adding a godown is owner-only and needs to be online. It creates the godown's chart of accounts, its TRANSIT location, its short code for voucher numbers, and its seeded masters. A godown can be **archived** (read-only) but never deleted.
8. Inside a godown, stock is tracked per variety. If a godown has several sheds/rooms that need separate stock, that's a v2 "storage locations" feature **[CONFIRM]**.

---

## 2. Users, roles and devices

| Role | Bengali | Typical person | Permissions |
|---|---|---|---|
| `owner` | মালিক | The broker | Everything, including settings, users, delete/void, day unlock, backups, reports with profit |
| `manager` | ম্যানেজার / মুন্সি | Trusted clerk | Create/edit vouchers of open days, all reports **except** profit & loss (configurable), no user/settings management, no voiding of locked days |
| `entry` | এন্ট্রি | Field staff at a godown/load point | Create purchase/load/expense entries; view only own entries and today's dashboard; cannot edit after 30 minutes or after sync **[CONFIRM]** |
| `viewer` | দর্শক | Family member / accountant | Read-only |

- **Access is granted per godown:** `godownAccess: Array<{ godownId, role, consolidated?: boolean }>`. For example, a munshi can be `manager` in রামপুর and have no access to সোনাপুর at all. The owner has every godown automatically. A user only sees, downloads (sync pull), stores on their device and writes data for the godowns they are granted. Removing a user's access to a godown purges that godown's data from the user's devices on next sync, but only after any pending outbox ops for it have been pushed.
- Expect 1–5 users and 1–6 devices per client. Several devices may be **offline simultaneously** and write data at the same time — the sync design must handle this (section 12).
- Each device is registered on first online login and gets a short **device code** (A, B, C … Z, then AA…) used in voucher numbers.

---

## 3. R&D findings that shape the design (read this before choosing anything)

### 3.1 Hosting: Vercel Hobby is not allowed for this app
Vercel's Fair Use Guidelines restrict Hobby teams to non-commercial personal use; commercial usage needs Pro or Enterprise. A broker's day-to-day business ledger is commercial use, even if internal and with 2–3 users.

**Decision:**
- **Default production host: Netlify Free plan**, which explicitly allows commercial projects with no credit card. Next.js 16 is supported via Netlify's adapter.
- **Alternative free host:** Cloudflare Workers (free plan) via Cloudflare's recommended Next.js path (vinext, or the OpenNext adapter). Watch the 3 MiB compressed worker size limit on the free plan.
- **If the client agrees to pay ~US$20/month:** Vercel Pro is fine.
- It is fine to use Vercel Hobby **for development previews with dummy data only**.
- Therefore: **no Vercel-only APIs** (no `@vercel/kv`, `@vercel/postgres`, Vercel Cron, `@vercel/blob`, Edge Config). Use plain Node.js route handlers + MongoDB driver + standard Web APIs. Keep platform specifics in `/deploy/*` config only.

### 3.2 MongoDB Atlas free cluster — real limits
- Storage cap: **512 MB** total data.
- Throughput cap: **100 operations per second** → sync must batch writes (`bulkWrite`, transactions), never one request per record.
- **Do not rely on Atlas backups for the free cluster** (docs are inconsistent on availability) → we run our own nightly backup (section 17).
- **Auto-pause after 30 days of zero connections** (reduced from 60). Off-season idleness can trigger this → a daily scheduled ping (section 17) keeps it alive.
- One free cluster per Atlas project → **one Atlas project per client**.
- Free clusters are 3-node replica sets → **multi-document transactions are available**; use them for sync pushes.
- Choose an AWS **Mumbai (ap-south-1)** region if offered for the free tier, otherwise Singapore.

**Capacity estimate:** ~200 vouchers/day × (voucher ≈1.2 KB + ledger lines ≈0.8 KB + stock moves + changelog) ≈ 0.6 MB/day ≈ 150–220 MB/year. Fits 2+ years. **All godowns of a client share the one free cluster**, so the estimate is for the whole client; the storage gauge in Settings shows usage per godown. Build an archival path (section 17.4) and a storage-usage gauge in Settings.

### 3.3 Next.js and PWA tooling
- Use the **latest stable Next.js 16.x** (App Router, TypeScript, React 19). Turbopack is the default bundler in 16.
- PWA/service worker: **Serwist** (`@serwist/next`), the maintained successor of `next-pwa`, and one of the approaches referenced in the Next.js PWA docs. Serwist ≥ 9.4 has a "configurator" mode that builds the service worker after Next.js prerenders, so it can **precache all prerendered routes** — use that mode (it avoids webpack/Turbopack coupling). Follow Serwist's current Next.js docs at build time.
- **Critical offline gotcha:** dynamic route segments (`/party/[id]`) cannot be precached for unknown IDs, so a cold offline start on such a URL fails. **Rule: no dynamic segments for app pages.** Use static routes + search params (`/party?id=…`, `/purchase/edit?id=…`). All app pages are client components rendering from IndexedDB; no page fetches data from the server at render time.
- Background Sync API exists only in Chromium browsers (Android Chrome works; iOS Safari doesn't). Use it as a bonus; the primary sync triggers must be foreground events (section 12.6).

### 3.4 Offline data layer
- **Dexie.js** (IndexedDB wrapper) is the client database and the **source of truth for the UI**. Use `dexie-react-hooks` `useLiveQuery` for reactive reads.
- Do **not** use Dexie Cloud (paid/hosted, and we already have MongoDB). Implement our own **outbox + changelog** sync protocol against Next.js route handlers (section 12). This is the well-established "outbox pattern" for offline-first apps.
- Dexie schema migrations must be **additive only** (never drop/rename stores or indexes that existing offline users depend on).

### 3.5 Bengali text in PDFs
Bengali conjuncts (যুক্তাক্ষর) need complex-script shaping. Many JS PDF libraries render Bengali incorrectly. **Decision:** generate receipts/statements as **HTML print views** (browser handles shaping) → "Print / Save as PDF" via `window.print()`, and **share as image** (PNG via `html-to-image`) through the Web Share API for WhatsApp. If a true PDF file is needed, verify the chosen library renders "ক্ষ, ন্দ্র, স্ব, ত্ত" correctly before adopting it.

### 3.6 Tax note
Unprocessed paddy is generally GST-exempt, so the app does **not** compute GST. TDS/TCS (e.g. sec. 194Q for large mill purchases) is **out of scope for v1**; leave an optional "TDS deducted" field on mill receipts so the mill's deduction can be recorded (section 9.8). **[CONFIRM with client's accountant]**

---

## 4. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js 16.x (App Router), React 19, TypeScript `strict` | Node.js runtime for route handlers (not Edge) |
| Styling | Tailwind CSS v4 | |
| UI kit | shadcn/ui (Radix primitives), lucide-react icons | Copy-in components; keep only what's used |
| Bottom sheets | `vaul` (shadcn Drawer) | Mobile-friendly forms |
| Toasts | `sonner` | |
| Forms | `react-hook-form` + `zod` + `@hookform/resolvers` | One Zod schema per voucher, shared client/server |
| UI/global state | Redux Toolkit + `react-redux` | Session, sync status, UI prefs, filters, wizard state. **Not** a copy of DB data. |
| Local DB | `dexie` + `dexie-react-hooks` | Source of truth for screens |
| Server DB | MongoDB Atlas (free) + official `mongodb` Node driver | No Mongoose (lighter, faster cold starts; Zod is the schema) |
| Money/weight math | Native `BigInt` in a single `lib/money` module | No `number` arithmetic on amounts |
| IDs | UUID v7 (`uuid` package) | Time-ordered, generated on device |
| Dates | `date-fns` + `date-fns-tz` (IST), `bn` and `enIN` locales | Store business dates as `YYYY-MM-DD` strings |
| i18n | Typed dictionaries (`bn.ts`, `en.ts`) + React context `useT()`; `Intl.PluralRules`/`Intl.NumberFormat` | No locale in URL (keeps routes static for offline); see 11.4 |
| PWA | Serwist | Precache app shell + all routes |
| Auth | Custom: `jose` (JWT) + `@node-rs/argon2` or `bcryptjs` for passwords; WebCrypto PBKDF2 for offline PIN | No third-party auth service |
| Lists | `@tanstack/react-virtual` | Long khatas on low-end phones |
| Charts (light) | `recharts` (only on Reports) | No charts on dashboard cards — numbers first |
| Excel export | `exceljs` | |
| Image share | `html-to-image` + Web Share API | WhatsApp receipts |
| Push (reminders) | `web-push` (VAPID) | Free |
| Fonts | Noto Sans Bengali / Hind Siliguri + Inter via `next/font` (self-hosted) | Must work offline |
| Testing | Vitest, `fast-check` (property tests), Playwright (incl. offline e2e), `fake-indexeddb` | |
| Lint/format | ESLint (next config), Prettier, `eslint-plugin-boundaries` optional | |
| Package manager | pnpm | |

Pin exact versions in `package.json` at project start; use whatever is the latest stable at that moment.

---

## 5. Architecture

```
┌──────────────────────────── Phone (installed PWA) ─────────────────────────────┐
│                                                                                │
│  React UI (shadcn)  ──reads──►  Dexie (IndexedDB)  ◄──writes── Domain services  │
│        │                         ├─ entity tables (parties, vouchers, …)        │
│        │                         ├─ ledgerLines, stockMoves (derived)           │
│        │                         ├─ outbox (pending ops)                        │
│        │                         └─ meta (cursor, device, session)              │
│        ▼                                                                       │
│  Redux (session, syncStatus, ui)        Sync Engine ──push/pull──┐             │
│                                                                  │             │
│  Service Worker (Serwist): precached shell + routes + fonts      │             │
└──────────────────────────────────────────────────────────────────┼─────────────┘
                                                                   │ HTTPS (JSON)
┌──────────────────────────── Next.js server (Netlify) ────────────▼─────────────┐
│  /api/auth/*     /api/sync/push     /api/sync/pull     /api/push/*  /api/cron/* │
│        │               │  validate (Zod) → recompute postings (same pure fn)    │
│        │               │  → Mongo transaction: doc + ledgerLines + stockMoves   │
│        │               │    + changelog(serverSeq) + appliedOps(opId)           │
└────────┼───────────────┼───────────────────────────────────────────────────────┘
         ▼               ▼
                MongoDB Atlas (free cluster, one per client)
```

**Key principles**
1. **Local-first:** every screen reads Dexie; every action writes Dexie + outbox in one Dexie transaction.
2. **Documents in, ledger out:** users create *vouchers* (documents). Ledger lines and stock movements are **derived** by pure functions `postLedger(voucher)` and `postStock(voucher)` that live in `/src/domain` and are imported by both client and server. The server **recomputes** them and rejects any mismatch.
3. **All balances are sums of ledger lines.** Dashboard, khatas, cash in hand, receivable/payable — all derived, never typed in or stored as mutable totals.
4. **Append-mostly history:** edits create a new revision; voids create reversal postings; nothing financial is hard-deleted.
5. **Server is the arbiter** of ordering (`serverSeq`) and conflicts; the client is the arbiter of user intent.
6. **Godown isolation:** `godownId` is the first key of every business query, index and sync filter. All repository functions take `godownId` as a required argument; there is no "fetch all vouchers" API. Consolidated owner views are built by running the per-godown query for each godown and combining the results in a separate, read-only module (`/client/queries/consolidated`).
7. **Bilingual by construction:** domain code and stored data never contain UI language strings. System items are stored as codes and rendered through the i18n dictionary.

---

## 6. Accuracy rules (zero calculation error)

### 6.1 Units of storage

| Quantity | Stored as | Type | Example |
|---|---|---|---|
| Money | **paise** | integer (`bigint` in memory, `Int64`/`Long` in Mongo, string in JSON) | ₹26,068.75 → `2606875` |
| Weight | **grams** | integer (same as above) | 12 কু. 12.5 কেজি → `1212500` |
| Rate | **paise per quintal** | integer | ₹2,150.00/কু. → `215000` |
| Percent (moisture etc.) | **basis points** (1/100 of a %) | integer | 2.5% → `250` |
| Diesel litres | **millilitres** | integer | 45.5 L → `45500` |
| Dates | `YYYY-MM-DD` string (IST business date) + ISO timestamps for audit | string | |

- In JSON (API and IndexedDB) serialize money/weight as **decimal strings of integers** (`"2606875"`) to avoid any JS number edge case; parse with `BigInt()`. Values stay well below 2^53 in practice, but the type discipline prevents accidental float math.
- In MongoDB store them as `Long` (Int64) via the driver, so `$sum` aggregations are exact.

### 6.2 The money module (`/src/lib/money`)
- Branded types: `type Paise = bigint & {__brand:'Paise'}`, `type Grams = bigint & {__brand:'Grams'}`, `type RatePaisePerQtl`, `type Bps`.
- Parsing from user input: `parseRupees("26,068.75") → 2606875n`, and the same for Bengali digits `parseRupees("২৬,০৬৮.৭৫") → 2606875n` (normalize ০-৯ to 0-9 first; accept both comma styles); reject more than 2 decimal places for money, more than 3 for kg, more than 2 for % (show inline error, never silently round input).
- Formatting: Indian grouping `₹26,068.75`, `₹1,23,45,678.00`; optional Bengali digits (০-৯) per user setting. Weight display: `12 কু. 12.500 কেজি` and/or `1,212.500 কেজি` per setting.
- **Rounding rule: round half up** (commercial rounding) at exactly one place per formula, documented below. Implement `divRoundHalfUp(a: bigint, b: bigint): bigint` handling negatives symmetrically (half away from zero).
- **Lint rule:** forbid `parseFloat`, `Number(` on fields typed as money/weight, `toFixed`, and `*`/`/` on `number` inside `/src/domain`. Add a custom ESLint rule or a grep check in CI.

### 6.3 Canonical formulas

**Weight deductions (purchase or sale line)**
```
grossG                         // entered (kg with up to 3 decimals → grams), or bags × avgBagKg
tareG      = bags × tarePerBagG
dhaltaG    = mode PER_QUINTAL : divRoundHalfUp(grossG × dhaltaGPerQtl, 100_000)
             mode PER_BAG     : bags × dhaltaGPerBag
             mode FIXED       : dhaltaFixedG
moistureG  = divRoundHalfUp((grossG − tareG) × moistureBps, 10_000)
otherDedG  = entered
netG       = grossG − tareG − dhaltaG − moistureG − otherDedG     // must be > 0
```
Default deduction settings (tare, dhalta mode/value) come from **Settings → defaults per variety/party**, and are editable per entry. The order above (moisture applied on gross − tare) is the default **[CONFIRM the client's actual practice]**; make the order a setting only if the client confirms a different practice.

**Line amount**
```
amountPaise = divRoundHalfUp(netG × ratePaisePerQtl, 100_000)   // 100,000 g per quintal
```

**Bill total**
```
subTotal    = Σ lineAmounts
charges     = Σ (+additions) − Σ (deductions borne by counter-party, e.g. hamali cut)
roundOff    = if settings.roundToRupee: nearestRupee(subTotal + charges) − (subTotal + charges)   // shown as its own line
billTotal   = subTotal + charges + roundOff
```

**Per-quintal charges (loading, delivery/freight, commission)**
```
chargePaise = divRoundHalfUp(netG × ratePaisePerQtl, 100_000)   // same formula; or fixed amount per trip
```

### 6.4 Golden test cases (must be unit tests)

| # | Inputs | Expected |
|---|---|---|
| G1 | 25 bags, gross 1,250.000 kg, tare 0.500 kg/bag, dhalta 2.000 kg per quintal (of gross), moisture 0, rate ₹2,150.00 | tare 12.500 kg; dhalta 25.000 kg; net **1,212.500 kg**; amount **₹26,068.75** |
| G2 | net 987.333 kg, rate ₹2,183.50 | 987333 × 218350 / 100000 = 2155841.6055 → **₹21,558.42** |
| G3 | gross 1,000.000 kg, tare 0, moisture 2.00% | moisture 20.000 kg; net 980.000 kg |
| G4 | net 12,000.000 kg (120 q), delivery ₹40.00/q, vehicle advance ₹2,000 | freight **₹4,800.00**; due to vehicle **₹2,800.00** |
| G5 | opening cash ₹50,000; cash paid farmer ₹20,000; cash labour ₹1,200; cash received from mill via driver ₹75,000 | expected closing cash **₹1,03,800.00** |
| G6 | subtotal ₹26,068.75, roundToRupee on | roundOff **+₹0.25**, total **₹26,069.00** |
| G7 | subtotal ₹21,558.42, roundToRupee on | roundOff **−₹0.42**, total **₹21,558.00** |
| G8 | negative half: divRoundHalfUp(−5, 10) | **−1** (half away from zero) |
| G9 | parse "২৬,০৬৮.৭৫" and "26,068.75"; format 2606875n in bn digits and en digits | both parse to **2606875n**; format → **₹২৬,০৬৮.৭৫** / **₹26,068.75** |
| G10 | Godown A: cash ₹50,000; Godown B: cash ₹30,000. Payment ₹5,000 entered in A | A cash **₹45,000.00**, B cash **₹30,000.00** (unchanged); All-godowns total **₹75,000.00** |

### 6.5 Property-based tests (fast-check)
- For random valid vouchers of every type: `Σ debit == Σ credit` in `postLedger` output.
- Party balance computed by summing ledger lines == balance computed by replaying vouchers.
- Stock: Σ stock moves per (godown, variety) after a random sequence of purchases/inter-godown transfers/sales == expected, and moves in one godown never change another godown's stock; voiding a voucher restores the previous state exactly.
- Edit then edit back → ledger identical to original.
- Parse → format → parse round-trips for money and weight.

### 6.6 Runtime invariant checks (in-app "হিসাব যাচাই" / Integrity check)
Run on the device after every sync and on demand (owner → Settings → Integrity):
1. Trial balance: Σ all debits == Σ all credits (to the paisa).
2. For every voucher, re-run `postLedger`/`postStock` and compare with stored lines.
3. No outbox op older than 7 days without an error displayed.
4. Server-side same checks via `/api/admin/integrity` (owner only), comparing per-account totals with the device's totals → show "✅ সার্ভারের সাথে মিলেছে" or the exact accounts that differ.

---

## 7. Accounting model (double entry under the hood, simple on the surface)

Users never see the words debit/credit. They see "দিলাম / পেলাম", "পাওনা / দেনা", "ক্যাশ / ব্যাংক". Internally every voucher posts balanced lines. This is what makes "0 room for error" achievable and auditable.

### 7.1 Chart of accounts (seeded, extendable)
**Each godown has its own complete chart of accounts**, seeded when the godown is created. Account keys are unique *within* a godown, and every ledger line carries `godownId`, so `CASH` in Rampur and `CASH` in Sonapur are different accounts. Account display names are i18n keys for system accounts (e.g. `account.CASH` → "হাতে নগদ" / "Cash in hand"), and the party name for `PARTY:*` accounts.

| Code | Name (bn) | Type | Notes |
|---|---|---|---|
| `CASH` | হাতে নগদ | asset | One cash box per godown |
| `BANK:<id>` | ব্যাংক – <name> | asset | One per bank account; UPI linked to a bank |
| `CHEQUE_IN_HAND` | হাতে চেক | asset | Cheques received, not yet deposited/cleared |
| `PARTY:<id>` | <party name> | party | One per party; **balance > 0 = they owe us (পাওনা), < 0 = we owe them (দেনা)** |
| `STOCK` | ধানের স্টক (মূল্য) | asset | Inventory at cost (weighted average) |
| `PURCHASE` | ধান ক্রয় | expense/COGS | Used if perpetual inventory is off; see 7.3 |
| `SALES` | ধান বিক্রয় | income | |
| `SALES_DEDUCTION` | মিলের কাটতি | expense | Mill moisture/quality/weight cuts at settlement |
| `COMMISSION_INCOME` | দালালি আয় | income | Agent-mode loads |
| `EXP:<category>` | খরচ – <category> | expense | Labour, Transport, Godown rent, Electricity, Tea/Food, Mobile, Misc… |
| `VEH_INCOME:<vehicleId>` | গাড়ি ভাড়া আয় | income | Own vehicle business |
| `VEH_EXP:<vehicleId>:<type>` | গাড়ি খরচ (ডিজেল/ড্রাইভার/টোল/মেরামত) | expense | |
| `CASH_DIFF` | ক্যাশ কম/বেশি | expense | Day-close differences |
| `STOCK_ADJ` | স্টক ঘাটতি/বাড়তি | expense | Godown shrinkage, physical count differences |
| `TDS_RECEIVABLE` | টিডিএস কাটা | asset | Optional, mill TDS |
| `CAPITAL` | মূলধন | equity | Owner capital in |
| `DRAWINGS` | মালিকের তোলা | equity | Owner personal withdrawals |
| `OPENING_BAL` | প্রারম্ভিক ব্যালেন্স | equity | For go-live opening balances only |

### 7.2 Posting rules (`postLedger(voucher)`)

| Voucher | Debit | Credit |
|---|---|---|
| Purchase bill from farmer/party F | `STOCK` (billTotal) | `PARTY:F` (billTotal) |
| Payment to F (cash/bank/UPI/cheque) | `PARTY:F` | `CASH` / `BANK:x` |
| Advance to F (দাদন) | `PARTY:F` | `CASH` / `BANK:x` — same as payment; party goes positive (=they owe goods/money) |
| Sale bill to mill M (at dispatch) | `PARTY:M` (billTotal) | `SALES` (billTotal) |
| COGS on sale (perpetual inventory) | `COGS` (avg cost × qty) | `STOCK` |
| Receipt from M | `CASH` / `BANK:x` / `CHEQUE_IN_HAND` (+ `TDS_RECEIVABLE`) | `PARTY:M` |
| Mill settlement cut (moisture/weight/quality) | `SALES_DEDUCTION` | `PARTY:M` |
| Loading labour (paid now) | `EXP:LABOUR` | `CASH` |
| Loading labour (on credit to contractor C) | `EXP:LABOUR` | `PARTY:C` |
| Freight on a sale, payable to vehicle V | `EXP:TRANSPORT` | `PARTY:V` |
| Vehicle advance to V | `PARTY:V` | `CASH` / `BANK:x` |
| Mill pays driver freight directly and deducts from our bill | `PARTY:V` | `PARTY:M` |
| Agent-mode commission | `PARTY:M` (or `PARTY:seller`) | `COMMISSION_INCOME` |
| Own-vehicle trip | `PARTY:hirer` (freight) | `VEH_INCOME:veh` |
| Diesel/driver/toll for own vehicle | `VEH_EXP:veh:type` | `CASH` / `PARTY:pump` |
| Cash deposited to bank | `BANK:x` | `CASH` |
| Bank withdrawal | `CASH` | `BANK:x` |
| Cheque deposited & cleared | `BANK:x` | `CHEQUE_IN_HAND` |
| Cheque bounced | `PARTY:M` | `CHEQUE_IN_HAND` |
| Day-close shortage | `CASH_DIFF` | `CASH` (excess: reverse) |
| Owner capital / drawings | `CASH`/`BANK` ↔ `CAPITAL`/`DRAWINGS` | |
| Opening balances | per account | `OPENING_BAL` (balancing) |
| Inter-godown transfer A → B (section 1.4 rule 5) | Books of A: `PARTY:godown-B` / Cr `SALES` (+ COGS/STOCK). Books of B: `STOCK` / Cr `PARTY:godown-A` | Two vouchers, one in each godown's books, linked by `groupId` |
| Stock adjustment | `STOCK_ADJ` | `STOCK` (value at avg cost) |

Every ledger line carries the mandatory `godownId` plus dimension tags: `partyId?`, `varietyId?`, `vehicleId?`, `loadId?`, `season`, `date`, `voucherId`, `voucherType`.

### 7.3 Inventory valuation
- Quantity: exact grams per (godown, variety) from `stockMoves`.
- Value: **weighted average cost per (godown, variety)**, recomputed on every inbound move. Godowns never share stock or cost.
- Direct loads (farmer → mill without entering the store) use **specific cost** (the linked purchase amount). The stock passes in and out of a virtual location `TRANSIT` inside the same godown's books within one voucher group, so physical store stock is unaffected.
- Profit per load = sale billTotal − cost of goods − loading − freight borne − other direct costs (tagged with `loadId`).

---

## 8. Data model

Common fields on **every** synced business document:
```ts
interface BaseDoc {
  _id: string;            // UUID v7, generated on device
  godownId: string;       // REQUIRED, IMMUTABLE — the independent business this record belongs to (section 1.4)
  rev: number;            // 1, 2, 3… incremented on every edit
  createdAt: string;      // ISO, device time
  createdBy: string;      // userId
  deviceId: string;
  updatedAt: string;
  updatedBy: string;
  serverSeq?: number;     // assigned by server on apply (absent until synced)
  status: 'active' | 'void';
  voidReason?: string;
}
```

### 8.1 Master data
```ts
interface Party extends BaseDoc {
  name: string;               // required, stored exactly as typed (Bengali or English script)
  nameAlt?: string;           // optional spelling in the other script; shown as subtitle when UI language differs; searched
  searchKey: string;          // generated phonetic key (bn↔latin transliteration, lowercase) for cross-script search
  roles: Array<'farmer'|'party'|'mill'|'transporter'|'driver'|'labour'|'pump'|'other'>;
  phone?: string;             // +91 10-digit validation
  altPhone?: string;
  village?: string; postOffice?: string; block?: string; district?: string;
  millName?: string;          // for role 'mill' (firm name vs contact person)
  gstin?: string; pan?: string;
  bankDetails?: { holder?: string; bank?: string; accountLast4?: string; ifsc?: string; upiId?: string }; // never full account numbers
  defaultRatePaisePerQtl?: string;
  defaultDeductions?: DeductionDefaults;
  openingBalancePaise?: string;   // signed; posted via OPENING_BAL voucher at go-live
  notes?: string;
  tags?: string[];
}
// Godown = top-level business entity. NOT scoped by godownId (it IS the scope).
interface Godown {
  _id: string; rev: number; createdAt: string; updatedAt: string;
  code: string;               // short unique code, e.g. "RP" — used in voucher numbers
  name: string; nameAlt?: string;
  firmName?: string; proprietor?: string; address?: string; phone?: string; gstin?: string; logoAssetId?: string;
  capacityG?: string;
  receiptLanguage: 'bn' | 'en' | 'both';
  status: 'active' | 'archived';
}
interface Variety extends BaseDoc { name: string; nameAlt?: string; systemKey?: string /* i18n key for seeded varieties */; defaultDeductions?: DeductionDefaults; }
interface BankAccount extends BaseDoc { name: string; bank: string; last4: string; ifsc?: string; isUpiLinked: boolean; openingBalancePaise: string; }
interface Vehicle extends BaseDoc { number: string; ownership: 'own'|'external'; ownerPartyId?: string; type?: 'truck'|'tractor'|'pickup'|'other'; capacityG?: string; driverPartyId?: string; }
interface Place extends BaseDoc { name: string; }             // load places / villages
interface ExpenseCategory extends BaseDoc { code: string; isSystem: boolean; name?: string /* user-created only; system ones render via i18n key `expenseCategory.<code>` */; }
interface DeductionDefaults { tarePerBagG?: string; dhaltaMode?: 'PER_QUINTAL'|'PER_BAG'|'FIXED'; dhaltaValueG?: string; moistureBps?: number; }
```
Vehicle numbers: normalize to uppercase without spaces (`WB 12 AB 3456` → `WB12AB3456`) for search; display formatted.

### 8.2 Vouchers (one collection, discriminated by `type`)
```ts
type VoucherType =
 | 'PURCHASE' | 'SALE' | 'LOAD'          // trade
 | 'PAYMENT' | 'RECEIPT'                 // money with parties
 | 'EXPENSE'                             // daily expenses
 | 'TRIP'                                // own vehicle business
 | 'CONTRA'                              // cash↔bank, cheque deposit/clear/bounce
 | 'STOCK_ADJUST'                        // inter-godown moves are SALE/PURCHASE pairs, see 1.4 rule 5
 | 'MILL_SETTLEMENT'                     // mill's final weight/cuts against a sale
 | 'DAY_CLOSE'
 | 'OPENING' | 'JOURNAL';                // go-live balances; owner-only manual journal

interface VoucherBase extends BaseDoc {
  type: VoucherType;
  number: string;            // `${godownCode}-${deviceCode}-${typeCode}-${seq}` e.g. "RP-A-PUR-000123"
  date: string;              // business date YYYY-MM-DD (IST)
  season?: 'AMAN'|'BORO'|'AUS';
  fy: string;                // "2026-27"
  notes?: string;
  attachments?: AttachmentRef[];   // v2 (weighbridge slip photo)
  groupId?: string;          // links vouchers created together (e.g. LOAD → PURCHASE + SALE)
}
```

**PURCHASE**
```ts
interface PurchaseVoucher extends VoucherBase {
  type: 'PURCHASE';
  partyId: string;                    // farmer or party (same godown)
  storeAt: 'STORE' | 'TRANSIT';       // STORE = into this godown's stock; TRANSIT = direct load
  lines: Array<{
    varietyId: string;
    bags?: number;
    grossG: string;
    tarePerBagG?: string; dhaltaMode?: 'PER_QUINTAL'|'PER_BAG'|'FIXED'; dhaltaValueG?: string;
    moistureBps?: number; otherDedG?: string;
    netG: string;                     // computed, stored, re-verified
    ratePaisePerQtl: string;
    amountPaise: string;              // computed, stored, re-verified
  }>;
  charges: Array<{ label: string; kind: 'add'|'deduct'; amountPaise: string }>;
  roundOffPaise: string;
  totalPaise: string;
  paidNow?: { amountPaise: string; mode: PayMode; bankAccountId?: string; ref?: string }; // creates a linked PAYMENT voucher in same group
  dueDate?: string;                   // বাকি দেওয়ার তারিখ → reminder
  loadId?: string;
}
type PayMode = 'CASH'|'BANK_TRANSFER'|'UPI'|'CHEQUE'|'DD'|'OTHER';
```

**SALE**
```ts
interface SaleVoucher extends VoucherBase {
  type: 'SALE';
  partyId: string;               // the buying party (Party Name)
  millPartyId?: string;          // Mill (if party ≠ mill, e.g. second party delivering to a mill)
  vehicleId?: string; vehicleNumber: string;     // free text allowed, auto-creates external Vehicle
  source: 'STORE' | 'TRANSIT';   // from this godown's stock, or direct load
  lines: SaleLine[];             // same shape as purchase lines
  loading?: { ratePaisePerQtl?: string; fixedPaise?: string; amountPaise: string; payTo: 'CASH_NOW'|'LABOUR_PARTY'; labourPartyId?: string };
  delivery?: { ratePaisePerQtl?: string; fixedPaise?: string; amountPaise: string; payer: 'US'|'MILL'|'BUYER'; transporterPartyId?: string };
  vehicleAdvance?: { amountPaise: string; mode: PayMode; bankAccountId?: string };
  advanceReceived?: { amountPaise: string; mode: PayMode; bankAccountId?: string; via?: string };  // Advance Payment from buyer
  totalPaise: string;            // goods value
  duePaise: string;              // derived = total − advances applied (display only; truth = ledger)
  expectedPaymentDate?: string;  // → reminder
  settlementStatus: 'PENDING'|'SETTLED';   // after MILL_SETTLEMENT
  loadId?: string;
}
```

**LOAD** (daily load khata entry; see 9.5 — often the *creator* of a SALE and optionally a PURCHASE)
```ts
interface LoadVoucher extends VoucherBase {
  type: 'LOAD';
  mode: 'OWN_TRADE' | 'AGENT';       // OWN_TRADE: we buy & sell. AGENT: we only broker for commission ("Party Sell") [CONFIRM]
  loadPlaceId?: string; loadPlaceText?: string;
  fromPartyId?: string;              // seller (farmer/party) or null if from this godown's stock
  fromStore?: boolean;               // true = loaded from this godown's stock
  toMillPartyId: string;             // Mill / second party
  secondPartyId?: string;            // when sold via another party to a mill
  vehicleNumber: string;
  varietyId: string;
  bags?: number; grossG: string; netG: string;
  partySellRatePaisePerQtl?: string; // price the seller party sold at ("Party Sell")
  millRatePaisePerQtl?: string;      // price to the mill
  totalAmountPaise: string;          // at mill rate
  commission?: { ratePaisePerQtl?: string; amountPaise: string; payer: 'MILL'|'SELLER' };
  linkedPurchaseId?: string; linkedSaleId?: string;
}
```

**PAYMENT / RECEIPT** (covers Mill / Second Party payment section)
```ts
interface MoneyVoucher extends VoucherBase {
  type: 'PAYMENT' | 'RECEIPT';
  partyId: string;
  amountPaise: string;
  mode: PayMode;
  ourBankAccountId?: string;          // কোন ব্যাংক অ্যাকাউন্ট থেকে / অ্যাকাউন্টে
  theirBankText?: string;             // party's bank (free text), for receipts from mill
  utrOrRef?: string; chequeNo?: string; chequeDate?: string;
  cashVia?: { vehicleNumber?: string; personName?: string };   // Cash হলে Vehicle Number অথবা Person Name
  tdsPaise?: string;                  // receipt only
  purpose: 'BILL'|'ADVANCE'|'OTHER';
  allocations?: Array<{ voucherId: string; amountPaise: string }>;   // which bills this settles
  dueDate?: string;                   // for an advance: expected adjustment date
}
```

**EXPENSE**
```ts
interface ExpenseVoucher extends VoucherBase {
  type: 'EXPENSE';
  categoryId: string;               // LABOUR, TRANSPORT, OTHERS, + user-defined
  amountPaise: string;
  mode: PayMode; bankAccountId?: string;
  payeePartyId?: string; payeeText?: string;
  description: string;              // required (বিবরণ)
  loadId?: string; vehicleId?: string;   // godown is implicit via BaseDoc.godownId
}
```
> Note: the client listed "which farmer was paid how much" under Daily Expense. **Farmer payments are PAYMENT vouchers, not expenses** (they reduce what we owe, they are not a cost). The Daily Expense screen must still *show* today's farmer payments in a separate block so the client sees everything that left the cash box in one place (section 9.4).

**TRIP** (own vehicle business)
```ts
interface TripVoucher extends VoucherBase {
  type: 'TRIP';
  vehicleId: string; driverPartyId?: string;
  hirerPartyId?: string;
  loadingPlace: string; unloadingPlace: string;
  qtyG?: string;
  rateMode: 'PER_QUINTAL'|'FIXED'; ratePaise: string;
  freightPaise: string;                   // computed
  advanceReceivedPaise?: string; advanceMode?: PayMode;
  expenses: Array<{ kind: 'DIESEL'|'DRIVER'|'TOLL'|'LOADING'|'UNLOADING'|'REPAIR'|'OTHER'; amountPaise: string; litresMl?: string; mode: PayMode; note?: string }>;
  duePaise: string;                       // derived = freight − advance received
  ownTradeLoadId?: string;                // if our own vehicle carried our own load (internal: no income line, cost only) [CONFIRM]
}
```

**CONTRA, STOCK_ADJUST, MILL_SETTLEMENT, DAY_CLOSE, OPENING, JOURNAL** — fields obvious from section 7.2; MILL_SETTLEMENT:
```ts
interface MillSettlement extends VoucherBase {
  type: 'MILL_SETTLEMENT';
  saleId: string;
  millReceivedGrossG: string; millDeductions: Array<{ label: string; g?: string; bps?: number; paise?: string }>;
  millNetG: string; finalRatePaisePerQtl: string; finalAmountPaise: string;
  differencePaise: string;     // finalAmount − sale.totalPaise (negative = cut) → posts SALES_DEDUCTION or extra SALES
  shortageG: string;           // dispatched netG − millNetG
}
```

### 8.3 Derived collections (server stores them; client stores them too for fast queries)
```ts
interface LedgerLine { _id: string; godownId: string; voucherId: string; voucherRev: number; date: string; account: string; debitPaise: string; creditPaise: string; partyId?: string; varietyId?: string; vehicleId?: string; loadId?: string; season?: string; fy: string; }
interface StockMove { _id: string; godownId: string; location: 'STORE' | 'TRANSIT'; voucherId: string; voucherRev: number; date: string; varietyId: string; qtyG: string /* signed */; valuePaise: string /* signed, at cost */; }
```
On edit: delete the old revision's lines/moves and insert new ones **in the same transaction** (client: Dexie tx; server: Mongo tx).

### 8.4 System collections
```ts
interface User { _id; name; phone; passwordHash; isOwner: boolean; godownAccess: Array<{ godownId: string; role: 'manager'|'entry'|'viewer'; consolidated?: boolean }>; language: 'bn'|'en'; digits: 'bn'|'en'; active; createdAt; }
interface Device { _id; userId; code: string; label: string; lastSeenAt; userAgent; revokedAt?; }
interface OutboxOp { opId: string; seq: number; entity: string; entityId: string; op: 'upsert'|'void'; baseRev: number; payload: unknown; createdAt: string; attempts: number; lastError?: string; status: 'pending'|'sending'|'error'|'conflict'; }  // client only
interface AppliedOp { _id: string /* opId */; deviceId; appliedAt; result; }        // server: idempotency
interface ChangeLog { serverSeq: number; godownId: string | null /* null = global (users, godowns) */; entity; entityId; rev; at; }   // server: pull feed, filtered by godown access
interface Counter { _id: 'serverSeq'; value: number; }
interface AuditLog { _id; at; userId; deviceId; godownId?; entity; entityId; action: 'create'|'edit'|'void'|'unlock'|'login'|'export'; before?: unknown; after?: unknown; }
interface Reminder { _id; godownId; kind: 'PAY_DUE'|'COLLECT_DUE'|'CHEQUE'|'CUSTOM'; partyId?; voucherId?; dueDate; amountPaise?; title; status: 'open'|'done'|'snoozed'; snoozeUntil?; }
interface AppSettings { _id: 'app'; defaultLanguage: 'bn'|'en'; reminderDigestTime: string; }                 // global
interface GodownSettings { _id: string /* godownId */; godownId; defaults: {...}; rounding: {...}; dayCloseRequired: boolean; lockAfterDays: number; seasonMap: {...}; }   // per godown
interface DayStatus { _id: string /* `${godownId}:${YYYY-MM-DD}` */; godownId: string; date: string; closed: boolean; countedCashPaise?; expectedCashPaise?; closedBy?; closedAt?; }
```

### 8.5 MongoDB indexes
**Every business index starts with `godownId`.**
- `vouchers`: `{godownId:1,type:1,date:-1}`, `{godownId:1,partyId:1,date:-1}`, `{number:1}` unique (the number includes the godown code), `{godownId:1,groupId:1}`, `{godownId:1,loadId:1}`, `{serverSeq:1}`
- `ledgerLines`: `{godownId:1,account:1,date:1}`, `{godownId:1,partyId:1,date:1}`, `{voucherId:1}`
- `stockMoves`: `{godownId:1,varietyId:1,location:1,date:1}`, `{voucherId:1}`
- `changelog`: `{serverSeq:1}` unique, `{godownId:1,serverSeq:1}`
- `appliedOps`: `_id` (opId) — TTL optional after 180 days
- `parties`: `{godownId:1,name:1}`, `{godownId:1,phone:1}`, `{godownId:1,roles:1}`, `{godownId:1,searchKey:1}`
- `godowns`: `{code:1}` unique

### 8.6 Dexie schema (v1)
```ts
db.version(1).stores({
  godowns: '_id, code, status',
  parties: '_id, godownId, [godownId+name], [godownId+phone], [godownId+searchKey], *roles, serverSeq',
  varieties: '_id, godownId', bankAccounts: '_id, godownId', vehicles: '_id, godownId, [godownId+number]', places: '_id, godownId', expenseCategories: '_id, godownId, [godownId+code]',
  vouchers: '_id, godownId, [godownId+type+date], [godownId+date], [godownId+partyId+date], number, [godownId+groupId], [godownId+loadId], status, serverSeq',
  ledgerLines: '_id, voucherId, [godownId+account+date], [godownId+partyId+date], [godownId+date]',
  stockMoves: '_id, voucherId, [godownId+varietyId+location], [godownId+date]',
  dailyAgg: '[godownId+date]',
  reminders: '_id, [godownId+dueDate], [godownId+status], partyId',
  dayStatus: '_id, [godownId+date]',
  outbox: '++seq, opId, status, godownId, entity, entityId',
  meta: 'key',          // cursor, deviceId, deviceCode, lastSyncAt, activeGodownId, voucherSeq:<godownId>:<type>
  auditLocal: '++id, at, godownId'
});
```

---

## 9. Functional requirements by module

General rules for every screen:
- The header always shows the **active godown switcher** (section 1.4 rule 3) and a language toggle shortcut in the user menu (section 11.4). All lists, forms, pickers and totals use only the active godown. Every form shows the godown name in its title bar ("নতুন ক্রয় · রামপুর" / "New purchase · Rampur") so the user never enters data into the wrong godown. Switching godown with an unsaved form open asks for confirmation.
- All labels, messages, toasts and receipts come from the i18n dictionary; the Bengali text quoted in this section is the `bn` value of the key, and an `en` value must exist for each.

General rules for every entry form:
- Opens as a full-screen sheet on mobile; sticky bottom bar with **live totals** and the Save button.
- Numeric fields use `inputMode="decimal"`; big inputs (min 48 px tall).
- Party/variety/godown/vehicle pickers are searchable comboboxes with **"+ নতুন যোগ করুন"** inline creation (works offline).
- Remember last-used godown, variety, rate, deductions per party (suggest, don't force).
- Date defaults to today (IST); past dates allowed if the day isn't locked; future dates disallowed except reminders/due dates.
- Save → writes Dexie + outbox in one transaction → toast "সেভ হয়েছে" → option "রসিদ শেয়ার করুন" (WhatsApp image) → back.
- Every voucher view shows: number, created by/when, sync status icon (✓ synced / ⏳ pending / ⚠ error), revision history (owner/manager).
- Edit allowed while the day is open; creates rev+1; requires a reason after the voucher has been synced.
- Void (বাতিল) owner-only; requires reason; voided vouchers stay visible with strike-through and are excluded from totals.

### 9.1 Home Dashboard (প্রথম স্ক্রিন)

Top: active godown name with switcher (▾), date selector (default today; ◀ ▶ to browse past days), sync badge (🟢 অনলাইন · সব সিঙ্ক / 🟡 ৫টি অপেক্ষায় / 🔴 অফলাইন).

**Big cards (2-column grid on phones, numbers ≥ 28 px, label ≤ 14 px):**

| # | Card | Definition (all derived from ledger/stock on the selected date) |
|---|---|---|
| 1 | আজ শুরুর ক্যাশ | `CASH` balance at start of the date = previous day's closing. If previous day was closed with a count, the counted amount (difference already posted to `CASH_DIFF`) |
| 2 | দিনশেষে হাতে থাকার কথা | opening + today's `CASH` debits − today's `CASH` credits (live) |
| 3 | মোট ধানের স্টক | Σ stock grams in **this godown** (STORE location only, excl. TRANSIT) — shown in quintals; tap → variety breakdown |
| 4 | আজ মোট বিক্রি (পরিমাণ) | Σ net grams on today's active SALE vouchers |
| 5 | আজ ক্রয় | quantity and amount of today's PURCHASE vouchers |
| 6 | আজ বিক্রি (টাকা) | amount of today's SALE vouchers |
| 7 | আজকের খরচ | Σ today's EXPENSE vouchers + own-vehicle expenses (tap → by category) |
| 8 | পাওনা (মোট) | Σ positive party balances (others owe us) |
| 9 | দেনা (মোট) | Σ |negative| party balances (we owe) |
| 10 | আজ আদায়যোগ্য / আজ দিতে হবে | reminders with dueDate ≤ today: collect vs pay, count + amount; overdue in red |

Below cards:
- **Bank balances** row (each account, plus cheques in hand).
- **Quick actions** (large icon buttons): +ক্রয়, +বিক্রি/লোড, +পেমেন্ট দিলাম, +টাকা পেলাম, +খরচ, +গাড়ির ট্রিপ.
- **আজকের তালিকা**: today's vouchers, newest first (tap to open).
- **Reminders due** (top 5, "সব দেখুন").
- **দিন শেষ করুন** button (section 9.10) after 6 pm or any time.

All cards above are **for the active godown only**.

**"সব গোডাউন / All godowns" mode** (owner / consolidated permission): the same cards in a compact table, one column per godown, plus a total column (cash, stock, today's purchase/sale/expense, receivable, payable). Each godown column is tappable and switches to that godown. Read-only: quick actions are hidden. Totals are a simple sum of the independent books; there is no elimination of inter-godown balances in v1. Inter-godown party balances are shown in a separate row so the owner can see them **[CONFIRM]**.

Owner-only toggle: **আজকের লাভ** (today's gross profit) — hidden by default for privacy when showing the phone to others.

Performance: dashboard must render < 300 ms from IndexedDB with 50k vouchers on a mid-range Android. Maintain a small `dailyAgg` cache table (per date: cash in/out, purchase qty/amt, sale qty/amt, expense) updated in the same Dexie tx as voucher writes; rebuildable from scratch.

### 9.2 Purchase (ধান কেনা)

**Entry form fields** (client's list, plus improvements):
- Farmer/supplier (name, phone — pick or create), village
- Date; where it goes: গোডাউনে রাখা (into this godown's stock) or সরাসরি লোড (direct load = TRANSIT, links to a load). The godown itself is the active godown and is not selectable in the form.
- Lines (multiple varieties allowed in one bill): variety, bags, gross weight, deductions (tare, dhalta, moisture, other — prefilled from defaults, collapsible "বাদ" section), net weight (computed, read-only), rate per quintal, line amount (computed)
- Charges (add/deduct), round-off (auto, visible)
- **Total amount** (automatic)
- **আজ কত টাকা দেওয়া হয়েছে** (paid now): amount + mode (+ bank) → linked PAYMENT voucher
- **কত টাকা বাকি** = total − paid now − unadjusted advance already given to this farmer (show the farmer's prior balance so the user sees the full picture: "আগের বাকি ₹x / অগ্রিম দেওয়া আছে ₹y")
- Payment date (the date of paid-now), **বাকি টাকা দেওয়ার তারিখ** (due date) → creates Reminder
- Notes, (v2) weighbridge slip photo

**Validation:** net > 0; rate > 0 and within a sanity band (warn if > ±25% from last 30-day average for the variety — warn only); paid now ≤ total + prior payable (warn on overpayment, allow as advance).

**Customer-wise purchase history** (Party → ক্রয় ইতিহাস tab), filterable by date range/season/variety:
- table: date, bill no., variety, bags, net qty, rate, amount, paid, due
- summary header: total qty bought, total amount, total paid, current balance (বাকি/অগ্রিম), average rate
- share full statement as image/print

### 9.3 Sale (ধান বিক্রি)

Fields exactly as requested plus links:
- Party name, Mill name (if different), phone (from party), vehicle number
- Source: this godown's stock or direct (TRANSIT/linked load)
- Lines: variety, bags, gross, deductions, **net quintals**, rate/qtl, **amount (automatic)**
- **Advance payment** received (amount, mode, via) → linked RECEIPT
- **Due amount** (derived)
- **Vehicle advance** (amount, mode) → linked PAYMENT to transporter
- **Loading rate** (₹/qtl or fixed) → loading amount → EXPENSE (labour) linked
- **Delivery rate** (₹/qtl or fixed) → freight amount, who pays freight (us / mill / buyer) → posts per 7.2
- Expected payment date → reminder
- Live summary panel: goods value, freight, loading, vehicle advance, net receivable from buyer, **estimated profit on this sale** (owner only)

**Mill settlement (মিলের হিসাব মেলানো)**: from a SALE, "মিলের ওজন দিন" → MILL_SETTLEMENT: mill's received weight, mill deductions (moisture %, kg, ₹), final rate (if renegotiated), final amount → posts difference; shows **shortage (ঘাটতি)** quantity. Sales list shows a "settled / pending" badge.

**Stock check:** sale from the godown's stock cannot exceed this godown's available stock for that variety; if it would go negative (possible due to unsynced entries from another device), show a warning and require owner/manager confirmation; never block silently.

### 9.4 Daily Expense (দৈনিক খরচ)

- Categories are per godown (seeded into each new godown, editable independently): লেবার (Labour), পরিবহন (Transport), অন্যান্য (Others), plus suggested extras the client can enable: গোডাউন ভাড়া, বিদ্যুৎ, চা/খাবার, মোবাইল/নেট, বস্তা কেনা, মেরামত, অফিস.
- Each expense: date, category, amount, mode (cash/bank/UPI), payee (optional party or text), **description (required)**, optional load/vehicle tag (the godown is always the active godown).
- **Daily Expense screen layout** (date selectable):
  1. "কৃষকদের পেমেন্ট" block — today's PAYMENT vouchers to farmers (name, amount, mode) with subtotal *(shown here for visibility, accounted as payments, not expenses)*
  2. Category blocks with subtotals
  3. Grand total of cash outflow today
- Monthly view by category with comparison to previous month.

### 9.5 Daily Load Khata (দৈনিক লোড খাতা)

A register of every truck loaded, in the khata format the client is used to. One LOAD entry captures:
- Load place (লোডের স্থান), from which party (or this godown's stock), total load quantity (bags, gross, net), which mill it's going to, total amount, variety, **Party Sell** (rate at which the seller party sold), Mill / Second party name, vehicle number, commission (agent mode)
- **Mode `OWN_TRADE`** (default): saving the load auto-creates (in one group) a PURCHASE from the seller (if from a party, into TRANSIT) and a SALE to the mill (from TRANSIT or the godown). The user fills one form, not three. Editing the load updates the linked vouchers; the linked vouchers can't be edited independently (edit via the load).
- **Mode `AGENT`** **[CONFIRM]**: the broker doesn't own the paddy; only the commission is booked (and any advances passed through are recorded as payments/receipts).
- Register view: date-wise list with columns (date, place, party, variety, qty, mill, vehicle, amount, party-sell rate, mill rate, margin) and daily totals; filters by mill/party/vehicle/variety; export to Excel.
- **Rule: a load and its sale are the same transaction — never double count.** Dashboard "sold today" counts SALE vouchers only (a load creates exactly one SALE).

### 9.6 Due / Advance (বাকি / অগ্রিম)

- List of all parties with non-zero balance: name, role, phone, **পাওনা (they owe us) / দেনা (we owe them)** clearly color-coded (green = receivable, red = payable) **and** labelled with text (never color alone).
- Filters: পাওনা / দেনা / অগ্রিম দেওয়া / অগ্রিম নেওয়া, role, overdue, amount range; sort by amount or oldest due.
- Manual entries: "অগ্রিম দিলাম" (advance given → PAYMENT purpose ADVANCE), "অগ্রিম পেলাম" (RECEIPT purpose ADVANCE), opening dues at go-live (OPENING).
- Per-bill status: each PURCHASE/SALE shows `Open / Partially paid / Settled` from allocations. Payments are auto-allocated **FIFO to the oldest open bill** unless the user picks bills manually.
- **Aging** buckets: 0–30, 31–60, 61–90, 90+ days.
- Party khata (statement): running balance, every voucher, opening/closing for a period; share as image/print; "WhatsApp তাগাদা" button sends a polite Bengali reminder text with balance via `wa.me` link (free, no API).
- Payment status & full history per party.

### 9.7 Vehicle Business (গাড়ির হিসাব)

- Vehicles master (own + external), kept per godown like all other masters **[CONFIRM: if one truck serves several godowns, the default is to register it in each godown where it earns or spends; its trips are booked in the godown that ran the trip]**. Own vehicles get a per-vehicle khata and P&L within the godown; the owner's "All godowns" vehicle report groups the same vehicle number across godowns.
- TRIP entry: date, vehicle, driver, loading place, unloading place, hirer party, quantity, rate (per qtl or fixed) → freight, advance received, **driver expenses, diesel (litres + ₹), toll, other**, **due** (= freight − advance received).
- Vehicle dashboard: this month's trips, freight earned, expenses by type, net profit, due from hirers, diesel litres and ₹/km (if odometer entered, optional).
- If own vehicle carries own trade load: record expenses against the vehicle and the load (cost), no freight income **[CONFIRM: or charge internal freight]**.

### 9.8 Mill / Second Party Payment (মিল / সেকেন্ড পার্টি পেমেন্ট)

Handled by RECEIPT (money from mill/party) and PAYMENT (money to party) vouchers with all requested fields:
- Mill / second party name, payment date
- **Which of our bank accounts** the money came into / went out of
- Mode: Cash / Bank transfer (NEFT/RTGS/IMPS) / UPI / Cheque / DD
- **If Cash:** vehicle number **or** person name through whom cash came/went (mills often send cash with the truck driver)
- Amount, UTR/reference, cheque no./date (cheque → `CHEQUE_IN_HAND` until cleared; clearance/bounce actions)
- Optional TDS deducted by mill
- Allocation to sale bills
- **Transaction history** per mill/party with running balance and bank-wise filter
- **[CONFIRM]** whether "কোন Bank Account থেকে টাকা পাঠানো হয়েছে" means the *mill's* account (record as free text) or *our* account; the form supports both fields.

### 9.9 Cash & Bank (নতুন — required to make the dashboard correct)
- Cash book and bank book (per account) with running balance.
- CONTRA vouchers: cash deposit, withdrawal, transfer between own accounts, cheque deposit/clear/bounce.
- Owner capital in / personal withdrawal (মালিকের তোলা) so personal cash movements don't distort business cash.

### 9.10 Day Close (দিন শেষ)
- Shows expected cash; user enters counted cash (optional denomination helper: ৫০০×, ২০০×, ১০০×, ৫০×, ২০×, ১০×, coins).
- Difference ≠ 0 → requires a note; posts `CASH_DIFF`.
- **Day close is per godown:** each godown counts its own cash box and is closed independently ("রামপুর: দিন শেষ ✓, সোনাপুর: খোলা").
- Closing locks that godown's day for `manager`/`entry` roles; owner can unlock (audited).
- Settings: `dayCloseRequired` (if on, next day shows a banner until the previous day is closed). Auto-lock days older than `lockAfterDays` (default 7) for non-owners.
- Day close can be done offline; it syncs like any voucher. If a voucher for a closed date arrives later from another device (it was created offline before the close), the server accepts it, flags the day as **"পরে এন্ট্রি এসেছে"**, and the owner sees a banner to re-check that day's cash.

### 9.11 Stock & Godowns (নতুন)
- Stock of the active godown by variety (quintals, bags estimate, avg cost/qtl, value).
- Physical stock count → STOCK_ADJUST with reason (শুকিয়ে কমা / ইঁদুর / ভেজা etc.).
- Stock register (movement history) per variety with running balance.
- **Inter-godown transfer** wizard (section 1.4 rule 5): pick receiving godown, variety, quantity, transfer rate → creates the linked SALE (sender) + PURCHASE (receiver) pair. It is only offered to users with access to both godowns; otherwise the receiving side shows as "অপেক্ষমাণ গ্রহণ / Pending receipt" for a user of that godown to accept.
- **Godown management (owner):** list of godowns with status, code and a quick summary; add godown (wizard, section 10), edit profile, archive. Owner's "All godowns" stock report shows variety × godown.

### 9.12 Parties (পার্টি / খাতা)
- Unified party list **of the active godown** with role chips, search by name/phone/village in either script (Bengali or English letters, via `searchKey`), recent first.
- "অন্য গোডাউন থেকে কপি / Copy from another godown" (section 1.4 rule 6) for users with access to more than one godown.
- Party profile tabs: সারাংশ (balance, aging, last activity), খাতা (statement), ক্রয়, বিক্রি, পেমেন্ট, লোড, রিমাইন্ডার.
- Merge duplicates (owner-only): re-points all vouchers to the kept party (implemented as server-side batch + changelog).
- Call / WhatsApp buttons.

### 9.13 Reminders (রিমাইন্ডার)
- Auto-created from: purchase due dates, sale expected payment dates, advance adjustment dates, cheque dates. Manual reminders too.
- In-app reminder center with Today / Overdue / Upcoming; mark done, snooze (1 day / 3 days / pick date).
- **Notifications:**
  1. In-app: badge + banner on open (always works offline).
  2. Web Push (VAPID) daily digest at a configurable time (default 8:00 IST) sent by the scheduled job (section 17.3) when the phone is online. Android installed PWA supports this; on iOS only for installed home-screen apps (16.4+).
- Reminder auto-closes when the related bill becomes Settled.

### 9.14 Reports (রিপোর্ট)
All reports are **for the active godown** and print that godown's letterhead (name, address, phone) in the selected receipt language. They are generated in the current UI language: titles, column headers and Excel sheet names all come from i18n. Date range (presets: আজ, গতকাল, এই সপ্তাহ, এই মাস, এই সিজন, এই অর্থবছর, custom), filters, totals row, **Print/PDF (HTML print)**, **Excel**, **share as image** (short reports).

| Report | Contents |
|---|---|
| Day book (দৈনিক খাতা) | all vouchers of a day, cash/bank effect, totals |
| Cash book / Bank book | running balance per account |
| Party statement | as 9.6 |
| Purchase register | farmer-wise & variety-wise, qty, amount, avg rate |
| Sales register | mill-wise & variety-wise; settlement status |
| Load register | as 9.5 |
| Stock register / summary | variety-wise for the godown |
| Outstanding & aging | receivable / payable |
| Expense report | by category, by load/vehicle |
| Vehicle P&L | per vehicle, per trip |
| Shortage report | dispatched vs mill-received weight per sale/mill/vehicle |
| Profit & loss (owner) | sales − COGS − deductions − expenses + commission + vehicle income |
| Load profitability (owner) | per load margin |
| Trial balance (owner, "Advanced") | integrity |
| Season summary | totals per season |
| **Godown comparison (owner / consolidated)** | side-by-side per godown: purchase, sale, expense, profit, cash, bank, stock, receivable, payable for a period, plus a total column |
| **All-godowns stock (owner)** | variety × godown matrix |
| **All-godowns cash & bank (owner)** | cash and each bank balance per godown + total |

### 9.15 Search
Global search (top bar icon) within the active godown: parties, vehicle numbers, voucher numbers, amounts ("26068" or "২৬০৬৮"), phone numbers. Queries typed in either script match both (via `searchKey` and digit normalization). Works offline over Dexie. Owner can tick "সব গোডাউনে খুঁজুন / Search all godowns"; results are grouped by godown and opening one switches to that godown.

### 9.16 Settings (সেটিংস)
Settings are split into **My preferences** (per user/device), **This godown** (per godown) and **App** (owner, global):
- *My preferences:* language (বাংলা / English), digits (বাংলা ০১২ / English 012), weight display (quintal+kg / kg), theme, change password/PIN
- *This godown:* godown profile for receipts (name, firm name, proprietor, address, phone, logo, GSTIN optional), receipt language (বাংলা / English / both), masters (varieties + default deductions, expense categories, bank accounts, vehicles, places), rounding to rupee on bills, deduction defaults, day close required, lock after N days, season date map
- *App (owner):* godowns (add / archive), users with per-godown access & roles, devices (revoke), default language for new users
- Reminder digest time
- Backup & export (section 17), storage usage gauge, integrity check, "Force full resync"
- About: version, last sync, pending ops count, "Export unsynced data" (escape hatch, 12.9)

---

## 10. Go-live / opening balances
First-run wizard (owner, online): choose language → owner profile → **create the first godown** → godown setup steps below → invite users with per-godown access.

**Godown setup wizard** (runs for the first godown and again every time a godown is added): godown profile and short code → varieties (pre-filled from templates) → bank accounts with opening balances → opening cash → opening stock per variety (qty + value) → opening party balances (bulk entry screen; import from Excel template as v1.1). Each godown's go-live date is independent. All of that godown's opening entries are posted as OPENING vouchers dated its go-live date; `OPENING_BAL` must net to zero after stock/party/cash/bank are entered, otherwise show the difference as "মূলধন" (capital) with confirmation.

---

## 11. UI / UX specification

### 11.1 Look & feel
- Clean, modern, light theme by default; optional dark theme. White/neutral surfaces, one brand accent (paddy green, e.g. `#2F7D32`-ish; final palette via shadcn theme tokens), green = money in / receivable, red = money out / payable, amber = pending/warnings. **Always pair color with text/icon.**
- Typography: Noto Sans Bengali (or Hind Siliguri) for Bengali and Inter for English, chosen by the active language (details in 11.4); tabular numerals for amounts (`font-variant-numeric: tabular-nums`). Amounts right-aligned in tables.
- Minimal animation: only 150–200 ms opacity/translate transitions on sheets, toasts, and tab switches; no page-transition choreography, no parallax, no Lottie. Respect `prefers-reduced-motion`.
- Mobile-first: designed for 360×740; scales to tablets (2-column) and desktop (sidebar nav, 3-column dashboard). Fully responsive; no horizontal scroll except inside data tables (sticky first column).

### 11.2 Navigation
- Bottom tab bar (mobile): **হোম · ক্রয় · বিক্রি/লোড · খাতা (Parties/Due) · আরও** (Expenses, Vehicles, Stock, Cash/Bank, Reports, Reminders, Settings).
- Floating "+" button on Home opening the quick-action sheet.
- Back button behaves predictably (Android hardware back closes sheets first); unsaved-changes guard on forms.

### 11.3 Input ergonomics
- Large tap targets (≥ 44×44 px), 16 px+ input text (prevents iOS zoom).
- Weight entry helper: "বস্তা × গড় ওজন" calculator; quintal/kg dual entry ("12 কু. 45.5 কেজি").
- Rate field shows ₹/কুইন্টাল suffix; amount fields show ₹ prefix.
- Show computed values live as the user types; show the formula on tap ("১২.১২৫ কু. × ₹২,১৫০ = ₹২৬,০৬৮.৭৫") so the user can trust the math.
- Draft autosave of open forms to Dexie (restore after app kill).

### 11.4 Bilingual UI — English and Bengali (required, both complete)
**Scope:** every screen, button, label, placeholder, validation error, toast, empty state, confirmation dialog, Sync/conflict message, notification and push text, WhatsApp message template, onboarding step, receipt, report, Excel header and sheet name exists in **both** বাংলা and English. A missing translation is a release blocker, not a fallback.

**Switching**
- Language picker on the login screen, in the first-run wizard, under Settings → My preferences, and as a one-tap toggle in the user menu (🌐 বাংলা | English).
- The switch applies **instantly, without reload and without network**: both dictionaries are bundled and precached.
- Stored per user (synced, so it follows the user to a new phone) with an optional per-device override. Default for new users = the owner's "default language" setting (initially Bengali). **[CONFIRM if any staff prefer English]**
- `<html lang>` and `dir` update on switch (both are LTR).

**Implementation**
- **No locale segment in URLs.** Routes stay static (`/purchase/new`, never `/bn/purchase/new`) so the one precached route set works offline in both languages. Use a typed dictionary + React context (`I18nProvider`, `useT()`), or a library in client/non-routing mode (e.g. `next-intl` without i18n routing). No middleware-based locale detection.
- `bn.ts` defines the key shape; `en.ts` is typed `satisfies Dictionary`, so a missing key fails `tsc`. CI also fails on unused keys and on raw string literals in JSX (`eslint-plugin-i18next` or `react/jsx-no-literals`, with an allowlist for symbols like ₹, %, /).
- Interpolation and plurals: `t('sync.pendingCount', { count })` with plural rules (`Intl.PluralRules` for `en` and `bn`).
- Namespaced keys by module: `common.*`, `nav.*`, `dashboard.*`, `purchase.*`, `sale.*`, `load.*`, `expense.*`, `due.*`, `vehicle.*`, `payment.*`, `stock.*`, `godown.*`, `reports.*`, `settings.*`, `sync.*`, `errors.*`, `account.*`, `voucherType.*`, `payMode.*`, `expenseCategory.*`, `variety.*`, `season.*`, `whatsapp.*`.
- Server error responses return **codes** (`CROSS_GODOWN_REFERENCE`, `DAY_LOCKED`, `CALC_MISMATCH`…), never sentences; the client maps codes to `errors.*` keys.
- Zod error messages are mapped to i18n keys through a custom error map; no English-only Zod defaults reach the user.

**Numbers, money, dates**
- Separate setting for digits: বাংলা (০১২৩) or English (0123); it defaults to match the language but can be set independently (many Bengali users prefer English digits).
- Indian grouping in both: `₹1,23,456.00` / `₹১,২৩,৪৫৬.০০`. Weight: `12 কু. 45.500 কেজি` / `12 qtl 45.500 kg`.
- **Inputs accept both digit sets** in every numeric field and normalize to ASCII before parsing (golden test G9). The keyboard is `inputMode="decimal"`. Users may type Bengali digits from a Bengali keyboard.
- Dates through `date-fns` with `bn` and `enIN` locales (e.g. "২৩ নভেম্বর ২০২৬, সোমবার" / "Mon, 23 Nov 2026"). Business dates are still stored as `YYYY-MM-DD`.
- Amount in words on receipts in the selected language ("ছাব্বিশ হাজার আটষট্টি টাকা পঁচাত্তর পয়সা মাত্র" / "Rupees Twenty-Six Thousand Sixty-Eight and Seventy-Five Paise Only"), using the Indian system (lakh/crore, লক্ষ/কোটি). Write an `amountInWords(paise, lang)` utility with unit tests for both languages.

**Typography & layout**
- Fonts: Noto Sans Bengali (or Hind Siliguri) + Inter, self-hosted via `next/font`, precached. Font stack chosen per language; amounts always `tabular-nums`.
- Bengali needs more vertical room for conjuncts and vowel signs: line-height ≥ 1.5 for Bengali text, and don't clip text in fixed-height inputs or buttons.
- Bengali labels are often 20–40% wider than English. Layouts must not depend on label length: buttons wrap or truncate with a tooltip, cards use `min-w-0` and `line-clamp`, tables allow header wrapping. Visual snapshot tests at 360 px in **both** languages.

**User-entered data**
- Party, village, variety and place names are stored **exactly as typed**, in any script, and never auto-translated.
- Optional `nameAlt` holds the other-script spelling. When the UI language differs from the script of `name` and `nameAlt` exists, lists show `nameAlt` as a subtitle.
- Cross-script search: a generated `searchKey` (simple Bengali↔Latin phonetic transliteration, e.g. "রহিম শেখ" ↔ "rahim shekh"), plus digit normalization, so typing in either script finds the record. Keep the transliteration table in `/src/i18n/translit.ts` with unit tests for common names.

**System master data is language-neutral**
- Seeded items (expense categories, payment modes, seasons, voucher types, system accounts, default varieties) are stored as **codes** and rendered through the dictionary, so they switch language with the UI. User-created items render as typed.

**Receipts, reports, sharing**
- Receipts print/share in the godown's receipt-language setting (বাংলা / English / both = two-column bilingual layout). The default is the user's current UI language.
- Reports and Excel exports use the current UI language.
- WhatsApp reminder/receipt texts have both language templates; the sender picks per message (default = UI language).
- Voucher numbers, codes, phone numbers and amounts stay identical in both languages (only digit glyphs change), so a receipt in English and a khata in Bengali always refer to the same entry.

**PWA**
- Manifest `name`: "Dhan Khata – ধান খাতা"; `short_name`: "ধান খাতা". Shortcut labels are bilingual ("নতুন ক্রয় / New purchase").

**Glossary consistency**
- The dictionary uses exactly the terms in section 1.2 (English column ↔ Bengali column). Add every new domain term to 1.2 first.

**Tests**
- Playwright core daily-flow e2e runs twice (bn and en) and asserts the same numbers.
- Unit tests: formatter (both digit sets), parser (both digit sets), `amountInWords` (both languages), transliteration search, and a check that both dictionaries have identical key sets.

### 11.5 Accessibility
- WCAG AA contrast; labels on all inputs; focus states visible; screen-reader text for icons.

### 11.6 Empty, loading, error states
- Every list has a friendly empty state with the primary action.
- Errors in Bengali, plain language, with what to do next.

---

## 12. Offline & sync specification

### 12.1 Guarantees
1. Any feature that doesn't strictly need the server works offline: all entries, edits, voids, reports, dashboard, search, day close, receipts.
2. Needs network: first login, adding users/devices, push notification registration, server integrity check, backup download, full resync.
3. No data loss on: airplane mode, app killed mid-save, phone restart, browser update, service-worker update, token expiry while offline.

### 12.2 Local write path (single Dexie transaction)
```
validate(Zod) → compute derived fields (money lib) → assign number (meta voucherSeq) →
write voucher (rev n) → regenerate ledgerLines + stockMoves for that voucher →
update dailyAgg → append outbox op {opId: uuidv7, entity, entityId, op, baseRev: n-1, payload} →
append auditLocal → commit
```
If anything throws, nothing is written.

### 12.3 Push (`POST /api/sync/push`)
Request: `{ deviceId, ops: OutboxOp[] (≤ 50 per batch, in outbox seq order) }` with `Authorization: Bearer <access>`.

Server, per op, in a Mongo transaction (or one transaction per batch when small):
1. If `appliedOps[opId]` exists → return its stored result (**idempotent**).
2. AuthZ: does the user have access to `op.godownId`, and does their role **in that godown** permit this op? Is that godown's day locked for this role? Is the godown archived? Does every referenced id (party, account, bank, vehicle, variety, category, linked voucher) belong to the same `godownId` (`CROSS_GODOWN_REFERENCE`)? Does `godownId` differ from the stored doc's (`GODOWN_IMMUTABLE`)?
3. Zod-validate payload. Recompute derived fields + `postLedger` + `postStock` with the **same shared code**. If client's stored computed fields differ → `rejected: CALC_MISMATCH` (should never happen; log loudly).
4. Concurrency: if `op.baseRev !== current.rev` → **conflict** (see 12.5).
5. Write doc (rev), replace ledgerLines/stockMoves for the voucher, `$inc` counter → serverSeq, write changelog, write appliedOps, write audit.
6. Respond `{ opId, result: 'applied'|'duplicate'|'conflict'|'rejected', serverSeq?, rev?, reason? }`.

Client marks applied/duplicate ops as done (deletes from outbox only now), stores `serverSeq` on the doc. Rejected/conflict → `status:'error'|'conflict'`, surfaced in the Sync screen; subsequent independent ops continue; ops depending on a failed entity (same entityId) pause.

Retries: exponential backoff (2s → 4s → … max 5 min), jitter. Network errors don't count as "rejected".

### 12.4 Pull (`GET /api/sync/pull?since=<serverSeq>&limit=500`)
Returns changed documents (and their derived lines/moves) ordered by serverSeq, **filtered to the godowns the user can access** (plus global docs: godowns list, own user record), plus `nextSince` and `hasMore`. If the user's godown access changes, the response includes `accessChanged: true`. The client then pulls newly granted godowns from the start (per-godown bootstrap) and purges revoked godowns locally after their pending ops are pushed. Client upserts in a Dexie transaction **unless** the entity has a pending local op (then keep local, it'll be resolved via push result). Store cursor in `meta` only after the transaction commits.

Initial bootstrap after login: pull everything in pages with a progress bar ("ডেটা নামানো হচ্ছে… ৪২%"). The app is usable only after bootstrap completes on a new device.

### 12.5 Conflict policy
- **Creates** never conflict (UUIDs).
- **Master data edits** (party phone, names…): field-level last-writer-wins by `updatedAt`, server merges non-overlapping fields; overlapping field → server value kept, loser stored in `conflicts` for owner review.
- **Voucher edits/voids** (money!): **never auto-merge.** If two devices edited the same voucher from the same baseRev, the first to reach the server wins; the second becomes a **conflict item** shown to the owner side by side ("এই ডিভাইসের সংস্করণ" vs "সার্ভারের সংস্করণ") with actions *Keep server* / *Apply mine as new revision*. Until resolved, the voucher shows a ⚠ badge, and totals use the server version.
- Void vs edit → void wins; edit becomes a conflict item.

### 12.6 Sync triggers
App start; `online` event; `visibilitychange` to visible; every 60 s while visible and online; 2 s debounce after any local write; manual "এখনই সিঙ্ক" button; Background Sync registration (Chromium) as a bonus. A single-flight lock (Web Locks API, fallback to a Dexie meta lock) prevents two tabs syncing concurrently.

Online detection: don't trust `navigator.onLine` alone; treat a successful `/api/health` (cheap, no DB) as truth.

### 12.7 Voucher numbering offline
`{godownCode}-{deviceCode}-{typeCode}-{6-digit seq}` (e.g. `RP-A-PUR-000123`), with a per-godown, per-device, per-type sequence in `meta` (`voucherSeq:<godownId>:<type>`). Each godown's numbering is independent. Type codes: PUR, SAL, LOD, PAY, RCP, EXP, TRP, CON, SAD, MST, DCL, OPN, JNL. Optionally restart per FY ("RP-A-PUR-2627-000123") **[CONFIRM]**. Unique index on server; godown code + device code guarantee no collision.

### 12.8 Auth while offline
- Access token (15 min) + refresh token (90 days, rotating, httpOnly cookie, bound to deviceId).
- Offline the app doesn't need tokens; it's unlocked by **PIN** (4–6 digits; PBKDF2-SHA256 ≥ 200k iterations with per-device salt via WebCrypto; stored in Dexie). Biometric unlock via WebAuthn platform authenticator optional (v1.1).
- When tokens are expired and the device comes online: sync pauses, a non-blocking banner asks to log in again; outbox stays intact; after login, sync resumes. **Logout with pending ops is blocked** (show count; offer "export unsynced data" first).
- Revoked device: server returns 401 `DEVICE_REVOKED` → app locks, but local data is not wiped until the owner confirms (prevents losing unsynced entries).

### 12.9 Safety nets
- `navigator.storage.persist()` requested after login; if denied, show a one-time explanation and the install-app prompt (installed PWAs are less likely to be evicted).
- "Export unsynced data" → JSON file of outbox + affected docs (owner can re-import on another device).
- Service-worker update never activates while the outbox is sending or a form is dirty; prompt "নতুন সংস্করণ এসেছে — আপডেট করুন" and reload only on user tap.
- Device clock check: when online, compare with server `Date`; if skew > 5 min, show a warning (business dates come from user selection, but audit timestamps should be sane).
- Dexie upgrade failures: catch `VersionError`/`UpgradeError`, show recovery screen with "export local data" before any reset.

### 12.10 Multi-tab
BroadcastChannel to notify other tabs of writes; Dexie liveQuery handles re-render. Only one tab runs sync (Web Locks).

---

## 13. PWA specification
- Web App Manifest via `app/manifest.ts`: `name` "Dhan Khata – ধান খাতা", `short_name` "ধান খাতা", `lang: "bn"`, `display: "standalone"`, `orientation: "portrait"`, `start_url: "/?source=pwa"`, `scope: "/"`, theme/background colors, icons 192/512 + maskable + Apple touch icon, `shortcuts` with bilingual labels ("নতুন ক্রয় / New purchase", "নতুন বিক্রি / New sale", "খরচ / Expense"). Shortcuts open in the last active godown.
- Service worker (Serwist): precache app shell, **all app routes**, fonts, icons; runtime: `NetworkOnly` for `/api/*` (sync engine handles retries; never cache API JSON in SW), `CacheFirst` for static assets.
- Offline fallback page for anything unexpected (should never show for app routes).
- Install UX: capture `beforeinstallprompt` → "অ্যাপ ইনস্টল করুন" button on Home (Android/desktop); iOS: one-time illustrated instructions (Share → Add to Home Screen).
- Splash/theme color consistent; status bar color matches header.
- **Acceptance test (Playwright):** log in online → close browser → disable network → open start URL → navigate to every route via UI **and** by direct URL → create a purchase, payment, load, expense → reload → data still there → re-enable network → outbox drains → server has identical ledger totals.
- Lighthouse PWA/installability checks pass; Performance ≥ 85 on mobile emulation for Home.

---

## 14. Security
- HTTPS only; secure, httpOnly, SameSite=Strict cookies for refresh token.
- Passwords: argon2id (or bcrypt cost ≥ 12). Login rate limiting (per phone + per IP, stored in Mongo with TTL).
- Every API route: verify JWT, device not revoked, **godown access**, role permission per op type within that godown.
- Godown isolation is enforced on the server for every read and write (pull filter, push authZ, reports/exports endpoints). The client filter is for convenience only and never trusted. A user without access to a godown must not be able to obtain any of its data, even by crafting requests. Write automated tests for this.
- Zod validation on every input; reject unknown fields.
- No full bank account numbers, Aadhaar, or card numbers stored anywhere (last 4 digits only).
- Mongo user with least privilege (readWrite on the app DB only); Atlas IP access list: `0.0.0.0/0` is unavoidable for serverless hosts → compensate with strong generated DB password stored only in host env vars.
- Security headers (CSP allowing self + fonts, `X-Frame-Options: DENY`, `Referrer-Policy`), no third-party analytics by default.
- Audit log for logins, edits, voids, unlocks, exports, role changes.
- Keep Next.js patched — Next.js now publishes scheduled security releases; check monthly and redeploy both clients.

---

## 15. Performance budgets
- First load (3G fast, mid Android): < 4 s; subsequent (cached) launch: < 1.5 s to interactive.
- JS for Home route < 250 KB gzipped (lazy-load reports, charts, exceljs, html-to-image).
- Any list of 10k rows scrolls at 60 fps (virtualized).
- Push of 500 queued ops completes < 60 s on 3G; server stays under Atlas 100 ops/s by batching (`bulkWrite` + transactions; throttle on 429/`TooManyRequests` style errors).
- Mongo connection: cache client on `globalThis` across invocations; `maxPoolSize: 5`; `serverSelectionTimeoutMS: 8000`.

---

## 16. Error handling & observability
- Client error boundary per route with "রিপোর্ট পাঠান" → stores error in Dexie and uploads on next sync to `clientErrors` collection (owner can view in Settings → Diagnostics).
- Server logs structured JSON (opId, deviceId, route, duration, result).
- Sync screen lists every pending/error/conflict op in plain Bengali with retry.

---

## 17. Backup, export, retention

### 17.1 In-app export (owner)
- Full backup JSON — the **active godown** or **all godowns** (owner) — downloadable/shareable file.
- Excel workbook per godown: parties, vouchers, ledger, stock, per-party balances (headers in the current UI language).
- Report-level exports (section 9.14).

### 17.2 Restore
- Owner-only restore from full-backup JSON into an **empty** database (setup wizard option) — for disaster recovery or moving clusters. Document the procedure in `docs/RESTORE.md`.

### 17.3 Scheduled jobs (free)
Use **GitHub Actions cron** (works regardless of host) calling protected endpoints with a secret header, plus a direct `mongodump`:
- Nightly 02:00 IST: `mongodump --archive --gzip` → encrypt (age/gpg) → upload as a GitHub Actions artifact (retention 30 days) **and/or** to the developer's private storage (Google Drive via rclone). One workflow per client (matrix), secrets per client.
- Daily 07:55 IST: `POST /api/cron/daily` → keeps the Atlas free cluster active (prevents 30-day auto-pause), sends the reminder push digest, recomputes server integrity summary.
- Weekly: storage usage check → if > 400 MB, alert the developer (email via GitHub Actions failure or a push to the owner).

### 17.4 Archival (when nearing 512 MB)
- Close a financial year: owner-initiated "বছর বন্ধ" → server exports the FY to a backup file, keeps vouchers but compacts `changelog` and `appliedOps` (TTL), and optionally moves FY ledger lines to an archive collection in a second free cluster/project (documented, not automatic). Upgrade path: Atlas Flex/M10 if the client grows.

---

## 18. Deployment & per-client setup

### 18.1 One codebase, one deployment per client
```
GitHub repo (private) ──► Netlify site "client-a" (env: client A) ──► Atlas project A (free cluster)
                     └──► Netlify site "client-b" (env: client B) ──► Atlas project B (free cluster)
```
Each client: own domain/subdomain (e.g. free `*.netlify.app` or a cheap custom domain), own users, own data. Deploy both on every release (same tag).

### 18.2 Environment variables
```
MONGODB_URI=            # per client
MONGODB_DB=dhankhata
AUTH_JWT_SECRET=        # 32+ random bytes
AUTH_REFRESH_SECRET=
CRON_SECRET=
VAPID_PUBLIC_KEY= / VAPID_PRIVATE_KEY= / VAPID_SUBJECT=mailto:dev@example.com
NEXT_PUBLIC_APP_NAME=ধান খাতা
NEXT_PUBLIC_CLIENT_SLUG=client-a
TZ=Asia/Kolkata
```

### 18.3 Host portability rules
- Node runtime route handlers only; no Edge-only APIs, no host-specific SDKs.
- `deploy/netlify.toml`, `deploy/vercel.json` (if ever on Pro), `deploy/cloudflare/` (if moved) are the only host-specific files.
- First-run seed script `pnpm seed --owner-phone=… --owner-name=… [--godown-name=… --godown-code=…]` creates the owner user and, optionally, the first godown with its chart of accounts and default categories/varieties. Otherwise the owner creates godowns in the first-run wizard.

---

## 19. Testing & acceptance

### 19.1 Automated
- **Unit (Vitest):** money lib (all golden cases 6.4), every formula, `postLedger`/`postStock` for every voucher type (table-driven expected lines), allocation FIFO, aging buckets, dashboard aggregations, voucher numbering.
- **Property (fast-check):** section 6.5.
- **Sync engine (Vitest + fake-indexeddb + in-memory Mongo `mongodb-memory-server` replica set):**
  - idempotent re-push of the same op
  - two devices offline create vouchers → both sync → totals equal sum
  - edit/edit conflict → conflict item, no silent overwrite
  - kill mid-push (simulate network error after server applied) → retry → `duplicate`, no double posting
  - pull while local pending edits → local preserved
  - token expiry mid-queue → resumes after login, nothing lost
- **Godown isolation tests:**
  - entries in godown A never change any balance, stock or total in godown B (G10)
  - server rejects a voucher whose party/account/bank belongs to another godown
  - server rejects changing `godownId` on edit
  - pull for a user with access to A only never returns B documents (including derived lines and changelog)
  - revoking access purges B locally only after B's pending ops are pushed
  - inter-godown transfer creates exactly one voucher in each godown; voiding one voids both
  - "All godowns" totals == sum of per-godown totals
- **i18n tests:** see 11.4 (key parity, both digit sets, amount in words, both-language e2e)
- **E2E (Playwright, mobile viewport, run in both `bn` and `en`):** section 13 offline acceptance; two-godown flow (enter data in A, switch to B, verify B untouched, owner All-godowns view); full daily flow (opening → purchases → load → sale → mill receipt via driver cash → expenses → day close) asserting every dashboard number against hand-computed expected values.
- CI (GitHub Actions): typecheck, lint (incl. no-float rule), unit, sync, e2e on every PR.

### 19.2 Manual UAT with the client (before go-live)
- Run one real week in parallel with the paper khata **for every godown**; reconcile each godown's daily cash and party balances to the rupee.
- Have at least one user work in English and one in Bengali during UAT.
- Test on the client's actual phones (and one cheap Android) in a low-network area.

### 19.3 Definition of Done (v1)
- All modules in section 9 implemented, in both languages, with godown isolation verified; all golden & property tests pass; offline acceptance passes; integrity check green for client data after parallel-run week; both clients deployed with nightly backups verified by a test restore.

---

## 20. Project structure
```
/src
  /app                      # Next.js routes — ALL static, client pages read Dexie
    (app)/page.tsx          # Home dashboard
    (app)/purchase/page.tsx, /purchase/new/page.tsx, /purchase/view/page.tsx (?id=)
    (app)/sale/…  (app)/load/…  (app)/expense/…  (app)/vehicle/…  (app)/party/…  (app)/due/…
    (app)/cash/…  (app)/stock/…  (app)/reports/[static report pages]…  (app)/reminders/…  (app)/settings/…  (app)/sync/…
    (auth)/login/page.tsx, (auth)/unlock/page.tsx, (setup)/onboarding/page.tsx
    api/auth/{login,refresh,logout}/route.ts
    api/sync/{push,pull}/route.ts
    api/push/{subscribe,unsubscribe}/route.ts
    api/cron/daily/route.ts
    api/admin/{integrity,export,users,devices}/route.ts
    api/health/route.ts
    manifest.ts
    sw.ts                   # Serwist worker source
  /domain                   # PURE, shared client+server, 100% unit tested
    money.ts  weight.ts  rounding.ts  amountInWords.ts (bn/en)
    scope.ts                # godown scoping helpers: assertSameGodown(), godown-aware id refs
    schemas/ (zod: parties, vouchers…)
    posting/ (postLedger.ts, postStock.ts, accounts.ts)
    calc/ (purchase.ts, sale.ts, load.ts, trip.ts, settlement.ts)
    allocation.ts  aging.ts  numbering.ts  dates.ts (IST, FY, season)
  /client
    db/ (dexie.ts, migrations.ts)
    repo/ (createVoucher.ts, editVoucher.ts, voidVoucher.ts — the single local write path)
    sync/ (engine.ts, push.ts, pull.ts, locks.ts, triggers.ts)
    queries/ (dashboard.ts, ledger.ts, stock.ts, reports/*.ts — all take godownId)
    queries/consolidated/ (read-only All-godowns views)
    godown/ (activeGodown.ts, switcher logic, copy-party)
    auth/ (pin.ts, session.ts)
  /server
    db.ts (cached MongoClient)  auth.ts  rbac.ts  apply/ (applyOp.ts)  cron/  backup/
  /store                    # Redux Toolkit slices: session, activeGodown, locale, sync, ui, filters
  /components
    ui/ (shadcn)  forms/  money/ (AmountInput, WeightInput, RateInput, Money, Qty)  layout/  cards/  lists/
  /i18n  bn.ts (canonical key shape)  en.ts (satisfies Dictionary)  I18nProvider.tsx  useT.ts  format.ts (money/weight/date/digits)  translit.ts  zodErrorMap.ts
/tests  unit/ property/ sync/ e2e/
/scripts seed.ts  backup.sh  restore.md
/deploy netlify.toml
/.github/workflows ci.yml  nightly-backup.yml  daily-cron.yml
/docs  RESTORE.md  OPERATIONS.md  CHANGELOG.md
```

---

## 21. Build phases (do them in order)

| Phase | Scope | Exit criteria |
|---|---|---|
| **P0 Foundations** | repo, Next 16, Tailwind 4, shadcn, Redux, ESLint no-float + no-JSX-literal rules, CI; **i18n framework (bn/en dictionaries, `useT`, formatter, digit normalization, language toggle)**; `/domain` money/weight/rounding/amountInWords + golden tests | all golden tests pass; app shell renders in both languages |
| **P1 Domain core** | Zod schemas (with `godownId`), per-godown chart of accounts, `postLedger`/`postStock` for all voucher types, calc modules, allocation, aging, same-godown reference checks, property tests | property tests pass (1000 runs each) |
| **P2 Local data, godowns & auth** | Dexie schema (godown-prefixed indexes), godown entity + active-godown switcher, local write path, per-godown numbering, server auth (login/refresh), per-godown access, device registration, PIN unlock, seed script | create/edit/void offline in two godowns with correct, isolated ledgers in Dexie |
| **P3 Sync engine** | push/pull APIs, idempotency, transactions, changelog, godown-filtered pull, access-change handling, conflicts, triggers, Sync screen | all sync + godown isolation tests pass |
| **P4 PWA shell** | Serwist, manifest, install prompt, update flow, offline acceptance skeleton | Playwright cold-offline test passes on empty app |
| **P5 Masters + Parties + Purchase + Payments** | screens 9.2, 9.6 (basic), 9.12, receipts share | client can run purchases end-to-end |
| **P6 Sale + Load + Mill settlement + Receipts** | 9.3, 9.5, 9.8 | load creates exactly one sale; shortage report correct |
| **P7 Expenses + Cash/Bank + Day close + Dashboard** | 9.1, 9.4, 9.9, 9.10 | dashboard e2e (G5-style) passes |
| **P8 Vehicles + Stock + Godown management** | 9.7, 9.11 (incl. inter-godown transfer, add/archive godown wizard), All-godowns dashboard mode | vehicle P&L correct; consolidated totals == Σ godowns |
| **P9 Reminders + Push + Reports + Export** | 9.13, 9.14, 17.1 | all reports reconcile with ledger |
| **P10 Ops** | backups, cron, integrity endpoint, onboarding wizard, docs | test restore succeeds |
| **P11 UAT & hardening** | parallel-run week per godown, translation review of every screen by a native Bengali speaker, perf budgets, a11y, bug fixes | DoD 19.3 |

---

## 22. Open questions for the client (defaults already assumed)

1. Deduction practice: is ধলতা per quintal, per bag, or fixed? Typical value? Is moisture cut applied to farmers? (default: per quintal on gross; moisture optional)
2. Does the client also quote in মণ (40 kg)? (default: quintal only, মণ display optional)
3. Rounding bills to the nearest rupee? (default: yes, shown as a round-off line)
4. "Party Sell" in the load khata — does the broker sometimes act only as an agent on commission? (default: support both modes; OWN_TRADE default)
5. Mill payment section — is the bank account the mill's or ours? (default: record both)
6. Who usually pays freight — broker or mill? Does the mill pay the driver directly and deduct? (default: selectable per sale)
7. Own vehicle carrying own load — charge internal freight or only record costs? (default: costs only)
8. How many staff/devices, and should field staff see amounts/rates? (default: `entry` role sees own entries)
9. Should voucher numbers restart every financial year? (default: no)
10. Does the client want the app to show his profit on the dashboard? (default: owner-only, hidden toggle)
11. Payment to Vercel Pro (~$20/month) acceptable, or stay on Netlify Free? (default: Netlify Free)
12. Does paddy or money ever move between the client's own godowns? (default: supported via the inter-godown transfer wizard, posted as a sale/purchase between the two books)
13. Are bank accounts and vehicles shared between godowns in real life? (default: registered separately in each godown, each tracking only its own transactions)
14. Should the owner's "All godowns" view also be available to a trusted manager? (default: owner only; grantable via `consolidated` permission)
15. Does any godown have several sheds that need separate stock? (default: one stock per godown; sheds = v2)
16. Which language does each staff member prefer, and should receipts to farmers be Bengali-only or bilingual? (default: UI Bengali, receipts Bengali, switchable)

---

## 23. Out of scope for v1 (candidates for v2)
- GST invoicing, e-way bills, TDS/TCS computation (only TDS recording)
- Weighbridge/scale hardware integration, Bluetooth thermal printer (v2: ESC/POS via Web Bluetooth on Android)
- Photo attachments (weighbridge slips) — v2 with compressed images to a free object store (e.g. Cloudflare R2 free tier) rather than MongoDB to protect the 512 MB cap
- SMS/WhatsApp Business API automation (v1 uses free `wa.me` share links)
- Rice (চাল) / by-product trading, multi-commodity
- Multi-tenant SaaS (explicitly a separate future product)
- Native app store builds (TWA wrapper possible later)

---

## 24. Appendix — Seed data (copied into every new godown; labels are i18n keys)

| Group | Code | বাংলা | English |
|---|---|---|---|
| Variety | `SWARNA` | স্বর্ণ | Swarna |
| Variety | `MINIKIT` | মিনিকিট | Minikit |
| Variety | `SATABDI` | শতাব্দী | Satabdi |
| Variety | `GOBINDOBHOG` | গোবিন্দভোগ | Gobindobhog |
| Variety | `LAL_SWARNA` | লাল স্বর্ণ | Lal Swarna |
| Variety | `V1010` | ১০১০ | 1010 |
| Variety | `PUSA` | পুষা | Pusa |
| Variety | `OTHER` | অন্যান্য | Other |
| Expense (system) | `LABOUR` / `TRANSPORT` / `OTHERS` | লেবার / পরিবহন / অন্যান্য | Labour / Transport / Others |
| Expense (optional) | `GODOWN_RENT` / `ELECTRICITY` / `FOOD` / `MOBILE` / `BAGS` / `REPAIR` | গোডাউন ভাড়া / বিদ্যুৎ / চা-খাবার / মোবাইল / বস্তা / মেরামত | Godown rent / Electricity / Tea & food / Mobile / Bags / Repair |
| Pay mode | `CASH` / `BANK_TRANSFER` / `UPI` / `CHEQUE` / `DD` / `OTHER` | নগদ / ব্যাংক ট্রান্সফার / ইউপিআই / চেক / ডিডি / অন্যান্য | Cash / Bank transfer / UPI / Cheque / DD / Other |
| Season | `AMAN` / `BORO` / `AUS` | আমন / বোরো / আউশ | Aman / Boro / Aus |

- Default season date map: Aman Nov–Feb, Boro Apr–Jul, Aus Aug–Oct (editable per godown).
- Godowns: created in the first-run wizard. Each has a system location `TRANSIT` (hidden; label "সরাসরি লোড / Direct load").
- Seeded varieties are editable/renamable per godown after creation (a renamed variety keeps its code but uses the typed name).

---

## 25. Reference links (verified Nov 2026)
- Vercel Fair Use (Hobby = non-commercial): https://vercel.com/docs/platform/fair-use-policy
- Netlify Free plan (commercial allowed): https://www.netlify.com/blog/introducing-netlify-free-plan/
- MongoDB Atlas free cluster limits: https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/
- Atlas pause policy: https://www.mongodb.com/docs/atlas/pause-terminate-cluster/
- Next.js PWA guide: https://nextjs.org/docs/app/guides/progressive-web-apps
- Serwist (Next.js): https://serwist.pages.dev/docs/next/config
- Dexie.js: https://dexie.org/
- Cloudflare Next.js (alternative host): https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/
