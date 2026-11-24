# MD Wellness Operations

Order, purchasing, accounting and traceability system for MD Wellness.

- `/admin` — owner dashboard (password protected)
- `/o/<token>` — private order link for a client, partner or vendor (and the public new-client link)
- `/po/<token>` — manufacturer purchase-order page (acknowledge, lot numbers, tracking)

## Develop

    bun build.js                       # builds dist/index.ts (single file, assets embedded)
    DATA_DIR=./data SETUP_CODE=dev PORT=3000 bun dist/index.ts
    node test.mjs                      # API flow test against localhost:3111

Edit files in `src/`, run `bun build.js`, commit `dist/index.ts`. Railway deploys the Dockerfile on push.

## Environment

- `SETUP_CODE` — one-time code needed to create the admin password on first visit
- `RAILWAY_VOLUME_MOUNT_PATH` / `DATA_DIR` — where `db.json` and daily backups live (attach a volume)

## Pricing

- Manufacturer cost: 25+ / 250+ / 500+ from the manufacturer price sheet. 1,000+ / 2,500+ / 5,000+ are projected in equal steps
  below the 500+ price (Settings → "Projected cost step", default 5%: 95% / 90% / 85%) until a real price is entered on the product.
- Wholesale tier → cost tier used for margin: 1+/10+/25+ → 25+, 250+ → 250+, 1,000+ → 1,000+, 2,500+ → 2,500+, 5,000+ → 5,000+.
- A discount (one rate, or per tier per account) never takes a price below cost ÷ (1 − margin floor). Default floor 10%.
- Order profit = order total − manufacturer cost (actual PO cost once on a sent PO) − packaging cost − PO freight share − your shipping cost.
- `node test2.mjs` checks the pricing rules (run after `test.mjs`).
