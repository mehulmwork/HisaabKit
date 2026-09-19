# HisabKit

**Your Business. Your Stock. Your Hisab.**

HisabKit is an inventory and transaction-management web app for Indian small and
medium trading businesses. It tracks stock as it moves through the business:

```
PURCHASE  →  STOCK IN  →  INVENTORY  →  SALE  →  STOCK OUT  →  STOCK LEDGER
```

This is a **Phase 1 prototype**. It is a single self-contained `index.html` with no
backend, no build step and no dependencies — open it and it runs.

---

## Live site

**https://mehulmwork.github.io/HisaabKit/**

Repository: **https://github.com/mehulmwork/HisaabKit**

The site is public. It is a purely front-end application: all data lives in your
browser's `localStorage`, so nothing is uploaded anywhere and no login is required.

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
opened directly from the filesystem via `file://`.

If you prefer to serve it over HTTP:

```bash
python -m http.server 8000     # then open http://localhost:8000
```

### Demo data

On first launch the app seeds realistic demo data — 24 inventory items, 10 suppliers,
12 customers, 12 purchase bills, 16 sales invoices and ~94 stock ledger entries —
covering an AC and refrigeration trading business.

Seeding happens **once**. It is stored in `localStorage` and is not re-created on
refresh, so your changes persist. To start over, use **Settings → Reset demo data**.

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

Deliberately out of scope for Phase 1: backend, database, authentication, real GST
invoices, PDF generation, barcode scanning, batch/serial numbers, multiple warehouses,
returns, and full accounting. The data model is kept compatible with adding them.
