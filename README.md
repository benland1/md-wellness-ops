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
