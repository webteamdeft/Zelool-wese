# Zelool sync app: setup, operation and deployment

Written for: the Deftsoft developer deploying the app and the client's store admin.

## What the app does

- Reads the supplier feed (JSON or CSV) from the URL set under **Pricing & settings**.
- Matches each product by **SKU**. A SKU already in Shopify is updated, not duplicated.
- New products are created as **DRAFT**. The client publishes them manually.
- **Price** = source price × (1 + markup %), rounded **up** to the next whole dollar. Default markup is 85%, editable in settings.
- **Locked prices** (Products page) are never changed by sync. Editing a price on the Products page pushes it to Shopify immediately.
- **Stock**: negative source stock is pushed as 0 (warning logged). Zero stock is pushed as 0. Under the default rule, an ACTIVE product that reaches zero is moved back to DRAFT. Change this under settings ("Keep it published" to disable).
- Products that disappear from the feed are flagged in the logs. They are **never deleted** from Shopify.
- Every run is logged under **Sync & logs**, with per-SKU messages.

## Feed format

Each product needs `sku`, `name` and `price`. Optional: `stock`, `images`, `description`, `specs`.

JSON:

```json
[{ "sku": "WS-1001", "name": "Round Titanium", "price": 10, "stock": 4,
   "images": ["https://example.com/1.jpg"], "description": "…",
   "specs": { "Material": "Titanium", "Width": "140mm" } }]
```

CSV with a header row. Put several images in one cell separated by `|`. Put specs as `Key: value | Key: value`:

```
sku,name,price,stock,images,specs
WS-1001,Round Titanium,10,4,https://example.com/1.jpg|https://example.com/2.jpg,Material: Titanium | Width: 140mm
```

Bad rows are rejected and logged with their row number. Good rows still sync.

## Local setup

```bash
cd zelool-wese
cp .env.example .env          # fill in the values
npm install
npx prisma migrate deploy     # or: npm run setup
npx prisma generate
npm test                      # unit tests for pricing, stock rules and feed parsing
npm run dev                   # shopify app dev
```

Notes:
- The `read_locations` scope was added. Anyone who already installed the app on a store must re-approve it, or the location list will not load.
- `npm install` may print a warning that some install scripts were not run (Prisma, esbuild). If you see Prisma or esbuild errors, run `npm approve-scripts --allow-scripts-pending` and then `npm rebuild`.

## First-time configuration (in the app)

1. **Pricing & settings**: confirm the markup (85), paste the feed URL, choose the inventory location, choose the zero-stock rule, Save.
2. **Sync & logs**: click **Run sync now**. Watch the log. Fix any rejected rows in the feed and run again.
3. **Products**: review the created drafts. Publish the ones the client wants live.

## Scheduled sync

The app does not run its own timer. Schedule a POST from any cron service (for example every 6 hours):

```bash
curl -X POST https://YOUR-APP-HOST/api/sync \
  -H "Authorization: Bearer $SYNC_TOKEN"
```

- `202`: the run started.
- `409`: a run is already in progress.
- `401`: the token is wrong.

Set `SYNC_SHOP` to the store's `*.myshopify.com` domain, and `SYNC_TOKEN` to a long random string.

## Deployment

1. Use Postgres in production. The schema currently targets SQLite (`prisma/schema.prisma`); change `provider` and `DATABASE_URL`, then run `prisma migrate deploy`.
2. Set all `.env.example` variables on the host. Never commit `.env`.
3. Build and run: `npm run build`, then `npm run start`. The `Dockerfile` in the repo runs `npm run docker-start`, which applies migrations first.
4. Deploy the Shopify configuration: `shopify app deploy`. This publishes the scopes, including `read_locations`.
5. Add the cron job above.

## Known limits and things to verify on a development store first

These were written against the Shopify Admin GraphQL API. They have **not** been run against a live store yet:

- `productSet` with `inventoryQuantities` and `files` (image URLs). Check that images are attached and that a re-sync without new images does not remove existing media.
- Single-variant products (no options): confirm the default variant gets the SKU, price and stock.
- Price-lock edits: confirm `productVariantsBulkUpdate` updates the price.
- Duplicate protection: create a product by hand with a SKU that is also in the feed, run sync, and check that it is linked and not duplicated.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "No feed URL set" / "No inventory location selected" | Fill in **Pricing & settings**. |
| Locations list is empty or shows an error | The app lacks `read_locations`. Re-approve the app on the store. |
| `EPERM … query_engine` during `prisma generate` | Stop the running dev server first, then run `npx prisma generate` again. |
| A product is stuck in "A sync is already running" | A run crashed. It is ignored automatically after one hour. |
| Product shows "Not in latest feed" | Its SKU is missing from the feed. It stays unchanged in Shopify. |
