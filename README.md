# HisabKit

**Your Business. Your Stock. Your Hisab.**

HisabKit is an inventory and transaction-management web app for Indian small and
medium trading businesses. It tracks stock as it moves through the business:

```
PURCHASE  →  STOCK IN  →  INVENTORY  →  SALE  →  STOCK OUT  →  STOCK LEDGER
```

This is a **Phase 1 prototype**. It is a single self-contained `index.html` with no
build step and no dependencies — open it and it runs. Inventory is synced with a
Google Sheet through a Google Apps Script Web App; everything else stays in the
browser's `localStorage`.

---

## Live site

**https://mehulmwork.github.io/HisaabKit/**

Repository: **https://github.com/mehulmwork/HisaabKit**

The site is public and needs no login. Inventory items are read from and written to
a Google Sheet, so the item list is shared between everyone who opens the site;
parties, purchases, sales, the stock ledger and settings live only in your own
browser's `localStorage`.

---

## Features currently implemented

| Area | Status |
| --- | --- |
| **Inventory** — item catalogue, 4 live summary cards, search / category / stock-status / supplier filters, sortable paginated table (10 / 25 / 50 per page), row action menu | Working |
| **Items** — add, edit, view, delete (with confirmation), auto-generated SKU, GST rate, low-stock alert level | Working |
| **Stock Adjustment** — Stock In, Stock Out, Damage, Correction, each writing a ledger entry | Working |
| **Stock Ledger** — full movement history with a running balance per item, filterable by item, date range and transaction type | Working |
| **Purchase Bills** — list with Paid / Unpaid / Total summary cards, period + supplier + payment-status filters | Working |
| **Add Purchase** — multi-line item entry, auto-filled unit and price, GST calculation, discount, round-off, payment type, balance due | Working |
| **Sales Invoices** — today's / this month's / receivables cards, recent sales, full invoice entry that deducts stock and writes ledger entries | Working |
| **Parties** — customers and suppliers with add / edit / delete / search | Working |
| **Dashboard** — Today's Sales, Today's Purchases, Inventory Value, Receivables, Payables, plus stock alerts and top movers | Working |
| **Reports** — Stock Report (opening / in / out / closing / value) with date, category and item filters | Working |
| **Export & Print** — CSV export (UTF-8 BOM so Excel reads `₹` correctly) and print stylesheets | Working |
| **Cash & Bank**, **Sales Returns**, **Purchase Returns**, **Purchase / Sales / Profit reports** | Placeholder navigation — reserved for a later phase |

### Correctness note

The stock ledger is the **source of truth**. Every stock movement writes a ledger
row, and each item's `currentStock` is reconciled from the sum of its movements, so
the inventory figure and the ledger can never disagree. Sales are validated against
available stock before anything is written, so a sale can never half-apply, and
stock cannot go negative except through an explicit *Correction* adjustment.

---

## Running it locally

No install, no build, no server required.

```
1. Download or clone this repository
2. Double-click index.html   (or drag it into any modern browser)
```

That's it. Because there are no external asset references, it also works fine when
opened directly from the filesystem via `file://` — the Google Sheets sync included.

If you prefer to serve it over HTTP:

```bash
python -m http.server 8000     # then open http://localhost:8000
```

### Google Sheets sync

The **Items** sheet is the source of truth for Inventory whenever the Apps Script
Web App is reachable. On startup the app calls it, and the Inventory table shows
the sheet's rows. Adding an item posts it to the sheet and then re-reads the list,
so what you see always came back from Google.

If the API cannot be reached, the app falls back to the last known items held in
`localStorage` and says so. An item added while the sheet is unreachable is kept on
that device and pushed to the sheet automatically on the next successful load.

Two things are deliberately local-only for now: **editing** and **deleting** an
item, because this phase of the API defines only GET and POST. An edit or delete
changes your browser's copy and will be overwritten the next time the sheet is read.

The endpoint is configured by `API_CONFIG.url` near the top of the script in
`index.html`. Requests are sent as `text/plain` rather than `application/json` —
Apps Script does not answer the CORS preflight, so a JSON content-type would be
rejected by the browser.

### Demo data

If the sheet is unreachable on a first visit, the app seeds realistic demo data —
24 inventory items, 10 suppliers, 12 customers, 12 purchase bills, 16 sales invoices
and ~94 stock ledger entries — covering an AC and refrigeration trading business.

When the Google Sheet answers, **no demo data is created** and none of it is mixed
with the sheet's rows.

Seeding happens **once**, and is stored in `localStorage`. To start over, use
**Settings → Reset demo data**.

---

## Building

**There is no build step.** The project is plain HTML, CSS and JavaScript in a single
file. `index.html` at the repository root is both the source and the production output.

---

## Project structure

```
HisaabKit/
├── index.html                        # The entire application (HTML + CSS + JS)
├── README.md
├── .gitignore
├── .nojekyll                         # Serve files as-is; skip Jekyll processing
└── .github/
    └── workflows/
        └── deploy-pages.yml          # Builds nothing; publishes the root to GitHub Pages
```

Inside `index.html` the code is organised into labelled sections so it can be migrated
to React/Next.js and a real database later without a rewrite:

1. Constants (storage keys, units, GST rates, payment and adjustment types)
2. State
3. Utilities (currency, date, id generation, escaping)
4. Persistence (`loadData`, `saveData`, `seedDemoData`)
5. Toast notifications
6. Modal system
7. Domain logic (stock status, ledger, adjustments, purchases, sales)
8. Rendering (one `render*` function per page)
9. Navigation and event listeners
10. Initialisation

### Data model

Records are plain JSON objects referenced by `id`, so they map directly onto database
tables later. Persisted under `localStorage` keys:
`hisabkit_items`, `hisabkit_suppliers`, `hisabkit_customers`, `hisabkit_purchases`,
`hisabkit_sales`, `hisabkit_stock_ledger`, `hisabkit_settings`.

`hisabkit_items` acts as the offline cache of the **Items** sheet. The sheet's
columns map onto the item record as: `ItemID`→`id`, `SKU`→`sku`, `ItemName`→`name`,
`Category`→`category`, `Unit`→`unit`, `PurchasePrice`→`purchasePrice`,
`SellingPrice`→`sellingPrice`, `CurrentStock`→`currentStock`,
`LowStockLevel`→`lowStockLevel`, `Status`→`sheetStatus`. The app has no column of
its own for brand, GST rate, supplier or description, so those are kept locally and
preserved across syncs.

The Inventory badge is **derived** from stock levels (`In Stock` / `Low Stock` /
`Out of Stock`), not read from the sheet's `Status` column — that value is stored on
the item as `sheetStatus` but is not displayed.

---

## Deployment

Hosted on **GitHub Pages**, deployed automatically by **GitHub Actions**
(`.github/workflows/deploy-pages.yml`) on every push to `main`. Because there is no
build step, the workflow simply uploads the repository root as the Pages artifact.

No secrets, tokens or credentials are required by the application or the workflow —
the workflow uses GitHub's own OIDC-based Pages deployment, so there is nothing to
configure.

---

## Currency and locale

All amounts are formatted with `Intl.NumberFormat('en-IN', { style: 'currency',
currency: 'INR' })`, giving Indian lakh/crore grouping (`₹1,25,000`), with decimals
dropped on whole amounts. Dates display as `DD/MM/YYYY`.

---

## Not in this phase

Deliberately out of scope for Phase 1: users and authentication, real GST invoices,
PDF generation, barcode scanning, batch/serial numbers, multiple warehouses, returns,
and full accounting. Only the **Items** sheet is wired up so far — parties, purchases,
sales and the ledger are not yet synced to Google Sheets. The data model is kept
compatible with adding them.
