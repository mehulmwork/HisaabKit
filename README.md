# HisabKit

**Your Business. Your Stock. Your Hisab.**

HisabKit is an inventory and transaction-management web app for Indian small and
medium trading businesses. It tracks stock as it moves through the business:

```
PURCHASE  →  STOCK IN  →  INVENTORY  →  SALE  →  STOCK OUT  →  STOCK LEDGER
```

It is a single self-contained `index.html` with no build step and no dependencies —
open it and it runs. All data lives in a Google Spreadsheet, reached through one
Google Apps Script Web App that serves every module.

---

## Live site

**https://mehulmwork.github.io/HisaabKit/**

Repository: **https://github.com/mehulmwork/HisabKit**

The site is public and needs no login.

---

## Architecture

```
HisabKit frontend (index.html)
        │  one endpoint, one API client
        ▼
Google Apps Script Web App  (apps-script/Code.gs)
        ▼
Google Spreadsheet — 11 tabs
   Items · Categories · Customers · Suppliers · Purchases · Purchase_Items
   Sales · Sales_Items · Stock_Ledger · Payments · Settings
```

The Apps Script is **generic**: it validates the requested tab against a schema,
reads column headers from row 1, and offers `list`, `get`, `create`, `update`,
`delete`, `transaction`, `dump`, `meta` and `setup` for every tab. There is no
per-sheet endpoint to maintain.

The frontend has one API client (the `API` object in section 4b of `index.html`).
No other part of the file calls `fetch()`.

### Writes that must not half-apply

Google Sheets has no transactions. A purchase touches four tabs — `Purchases`,
`Purchase_Items`, `Items` and `Stock_Ledger` — and a sale the same. So the app sends
them as **one `transaction` request**, and Apps Script:

1. validates every operation before touching anything,
2. takes a script lock,
3. snapshots every tab the batch will write,
4. applies the operations, and
5. on the first failure restores the snapshots and returns
   `Nothing was saved — <reason>`.

A purchase header therefore cannot be saved without its lines, and a failure part
way through leaves the sheet exactly as it was.

### Offline behaviour

The Google Sheet is the source of truth. `localStorage` holds only the last
successful read, so the app still opens when the network is down, and a small queue
of master-data writes (items, categories, customers, suppliers) made while offline,
pushed on the next successful load. A purchase, sale or payment that fails is
reported to the user instead of being queued — replaying half of one later would be
worse than not saving it.

---

## Features

| Area | Status |
| --- | --- |
| **Inventory** — item catalogue, summary cards, search / category / stock-status / supplier filters, sortable paginated table, row action menu | Working, sheet-backed |
| **Items** — add, edit, delete (with reference checks), auto-generated SKU, GST rate, low-stock level, opening stock written to the ledger | Working, sheet-backed |
| **Categories** — list, add, edit, delete, Active/Inactive, item counts and values per category; the item form's Category dropdown is built from this sheet | Working, sheet-backed |
| **Customers** and **Suppliers** — list, add, edit, delete, search, opening balance and balance type, credit limit, GSTIN, outstanding worked out from the transactions | Working, sheet-backed |
| **Party accounts** — open a supplier or customer for its ledger: opening balance, every bill or invoice, every payment, running balance, filters, and the document behind a line | Working, derived from the sheet |
| **Purchase Bills** — multi-line entry with a supplier dropdown, GST, discount and round-off; saving increases stock, writes a ledger row per line, and records a payment when part of the bill is paid | Working, sheet-backed |
| **Sales Invoices** — the same entry flow, validated against available stock, so an invoice can never take stock below zero | Working, sheet-backed |
| **Stock Ledger** — every movement with a running balance, filterable by item, date range and transaction type | Working, sheet-backed |
| **Payments** — money received from customers and paid to suppliers, filterable, with a party dropdown that follows the party type and optional settlement against a specific bill or invoice | Working, sheet-backed |
| **Settings** — business profile, currency symbol, tax defaults, invoice and purchase prefixes, low-stock alert, read from and written to the Settings sheet | Working, sheet-backed |
| **Dashboard** — live totals for sales, purchases, inventory value, receivables, payables, customer and supplier counts, plus stock alerts and top movers | Working, live from the sheet |
| **Reports** — Stock Report with date, category and item filters | Working |
| **Export & Print** — CSV export (UTF-8 BOM so Excel reads `₹` correctly) and print stylesheets | Working |
| **Cash & Bank**, **Sales Returns**, **Purchase Returns**, **Purchase / Sales / Profit reports** | Placeholder navigation — reserved for a later phase |

### Party accounts

A supplier's or customer's account is **derived, never stored**. `buildPartyAccount(partyType, partyId)`
gathers the party row, the bills or invoices raised against that party, and every payment
that names it, normalizes all of them into one set of ledger entries, sorts them by date
and works out the running balance. Outstanding is total debit less total credit, so the
figure on screen is always the sum of the transactions behind it.

* **Supplier** — a purchase, and an opening balance payable, increase what is owed
  (debit); paying the supplier reduces it (credit).
* **Customer** — a sale, and an opening balance receivable, increase what the customer
  owes (debit); being paid reduces it (credit).

A payment is matched to a party by **`PartyType` + `PartyID`**, never by `ReferenceID`.
`ReferenceID` only links it to a particular bill or invoice when there is one, so a
general payment, an advance or an opening adjustment still appears in the account. The
`BalanceType` column decides which side an opening balance falls on, so a supplier paid
in advance, or a customer in credit, reads as money owed the other way.

Because nothing is stored, nothing can go stale: every write re-reads the sheet, the
party lists recompute their outstanding column on each render, and recording a payment
from inside an account rebuilds that account straight away.

### Correctness note

The sheet's `CurrentStock` is authoritative, and the ledger records what this app has
done since. On every read the app compares the two and bridges the difference with a
local ledger entry that is never written to the sheet:

* the sheet shows **more** stock than the ledger accounts for — an **Opening Stock**
  entry, dated before the item's first movement, because that stock was there before
  the app recorded anything;
* the sheet shows **less** — a **Correction** entry, dated last, because stock the
  ledger counted is no longer in the spreadsheet: a stock take, or an edit made
  directly in the sheet.

Either way the figure on screen is the figure in the sheet, and the ledger adds up to
it. The bridging entries are rebuilt on every load, so an edit made in the spreadsheet
is never overwritten by what the app had worked out earlier.

---

## Running it locally

No install, no build, no server required.

```
1. Download or clone this repository
2. Double-click index.html   (or drag it into any modern browser)
```

If you prefer to serve it over HTTP:

```bash
python -m http.server 8000     # then open http://localhost:8000
```

---

## Google Apps Script setup

`apps-script/Code.gs` is the **complete** backend. It must be pasted into the Apps
Script project bound to the spreadsheet and redeployed before the frontend can use
the new modules.

1. Open the spreadsheet → **Extensions → Apps Script**.
2. Replace the whole contents of `Code.gs` with the file from this repository.
3. Save (**Ctrl+S**).
4. **Deploy → Manage deployments →** pencil icon on the existing deployment **→
   Version: New version → Deploy**. Editing the code without deploying a new version
   leaves the old code serving requests.
5. On its first call the app runs `setup`, which creates any missing tab with its
   header row. It never deletes or rewrites existing rows.

Then set the deployment URL in `API_CONFIG.url` near the top of `index.html` if
yours differs from the one in the repository.

### Why requests are sent as `text/plain`

Apps Script does not answer the CORS preflight, so a request with
`Content-Type: application/json` is rejected by the browser before it is sent. The
app posts JSON bodies as `text/plain;charset=utf-8`, which is a CORS "simple
request" and needs no preflight. Apps Script reads the body from
`e.postData.contents` regardless of the declared type. `GET` requests use query
parameters.

### ID generation

IDs follow the sheet's own sequence: the highest number already used for that
prefix, plus one. Prefixes are `ITM-`, `CAT-`, `CUS-`, `SUP-`, `PUR-`, `PI-`,
`SAL-`, `SI-`, `LED-`, `PAY-`, `SET-`. An ID that does not match the pattern (a
legacy row) is ignored rather than counted, and existing IDs are never rewritten.

A bill or invoice number is built from the prefix in Settings. If the numbers
already in the sheet carry a separator the setting does not (`PB` in Settings,
`PB-001` in the sheet) the separator on the highest existing number is reused, so
the next one is `PB-002` rather than `PB002`.

---

## Project structure

```
HisaabKit/
├── index.html                        # The entire application (HTML + CSS + JS)
├── apps-script/
│   └── Code.gs                       # The complete Apps Script backend
├── README.md
├── .gitignore
├── .nojekyll                         # Serve files as-is; skip Jekyll processing
└── .github/
    └── workflows/
        └── deploy-pages.yml          # Builds nothing; publishes the root to GitHub Pages
```

Inside `index.html` the code is organised into labelled sections so it can be
migrated to React/Next.js and a real database later without a rewrite:

1. Constants (storage keys, sheet schema mirror, settings definitions, units, GST rates)
2. State
3. Utilities (currency, date, escaping)
4. Persistence (`loadData`, `saveData`) and **4b. Google Sheets — API client and data access**
5. Toast notifications, busy indicator, sync banner
6. Modal system
7. Domain logic (stock status, ledger, items, purchases, sales, payments)
8. Rendering (one `render*` function per page)
9. Navigation and event listeners
10. Initialisation

### Sheet column mapping

Each tab has a mapper pair in `SHEET_MAP` — one function from a sheet row to an app
record, and one back: `ItemID`→`id`, `ItemName`→`name`, `CurrentStock`→`currentStock`,
and so on. The Items sheet has no columns for brand, GST rate, supplier or
description, so those four are kept in `localStorage` and re-applied on every read.

Records are plain JSON objects referenced by `id`, so they map directly onto
database tables later.

---

## Deployment

Hosted on **GitHub Pages**, deployed automatically by **GitHub Actions**
(`.github/workflows/deploy-pages.yml`) on every push to `main`. Because there is no
build step, the workflow simply uploads the repository root as the Pages artifact.

The Apps Script deployment is separate and manual — see **Google Apps Script
setup** above.

---

## Currency and locale

Amounts are grouped the Indian way (`₹1,25,000`), with decimals dropped on whole
amounts. The symbol comes from the `CurrencySymbol` row in the Settings sheet, so
changing it there changes every amount in the app. Dates display as `DD/MM/YYYY`.

---

## Not in this phase

Deliberately out of scope: users and authentication, real GST invoices, PDF
generation, barcode scanning, batch/serial numbers, multiple warehouses, and full
accounting. Sales Returns and Purchase Returns are navigation placeholders.
