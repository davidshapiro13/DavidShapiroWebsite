# Shirt shop setup and operations

The existing static website stays on its current host. `shop.html` talks to a separate Cloudflare Worker. Stripe hosts the payment page; Printify fulfills the paid order. The Worker uses D1 for a small order ledger and a five-minute scheduled recovery job.

**Current state (October 8, 2026):** backend deployed at `https://david-shirt-shop.david-shirt-shop.workers.dev`, Cloudflare D1 initialized, Printify credentials connected, and Stripe test webhook configured. Checkout and fulfillment remain disabled. The storefront is included in the GitHub Pages website; `_config.yml` excludes the backend directory from the published site. Stripe test tax settings are active. A real hosted Stripe sandbox checkout passed: $20 shirt + $4.95 shipping, signed webhook received, D1 state `test_complete`, `live=0`, and no Printify order ID. The local confirmation page was served through a browser route for that sandbox test. The selected product is `6a4fe213435f537ab70d3111`. The seller approved a $20 shirt price and US-only shipping. `RETAIL_PRICE_CENTS=2000` sets the same retail price for all enabled variants, independently of Printify’s retail prices. Artwork and options load from Printify; the seller approved $4.95 standard shipping, matching the Printify quote for a sample US address. Automated browser tests use fixtures; the additional hosted checkout test exercised the deployed backend and actual Stripe sandbox.

## What is built

- `shop.html`, `shop.js`, `shop.css`: responsive product photos, color/size choices, price, size guide, hosted checkout, cancellation and connection errors.
- `order.html`, `order.js`: confirmed payment/fulfillment states and tracking. The confirmation URL is a private bearer link; it returns no customer identity or shipping address.
- `src/worker.js`: product, checkout, signed Stripe webhook, and order-status endpoints.
- `src/fulfillment.js`: paid-order processing, atomic claim, retries, and ambiguous-submission reconciliation.
- `migrations/0001_orders.sql`: order references, product IDs, amounts, and processing states. No names, addresses, phone numbers, emails, or card data.
- `test/`: real SQLite ledger tests, Stripe signature tests, provider fixtures, and desktop/mobile browser tests.

## Remaining activation steps

- Add `STRIPE_LIVE_SECRET_KEY` privately in `.dev.vars`; keep the existing sandbox key for testing. Configure the live webhook and upload its matching secret before switching `PAYMENT_MODE`.
- Confirm the live Stripe account can accept charges and its tax settings are active.
- Confirm Printify billing and automatic order approval for shop `28189423`.
- Customer return policy approved: report damaged, defective, or incorrect shirts within 30 days of delivery; no change-of-mind or incorrect-size returns. Published on the shop and terms pages.
- Only then enable live checkout and fulfillment together. No real purchase has been made.

## Required launch information

1. Printify API shop ID and the shirt's product ID. Use an API-connected Printify shop; copy the existing design into it if needed. Review the title, description, mockups, and enabled colors/sizes in Printify. The backend charges the approved `RETAIL_PRICE_CENTS=2000` ($20) for every enabled variant; Printify retail prices do not override it. Confirm production costs for all sizes before launch.
2. Stripe account, test secret key, and webhook signing secret. Live keys are added only after review.
3. Approved shipping countries and flat shipping charge in cents. This version sells **one shirt per checkout** with standard shipping. It does not dynamically quote destination-specific Printify charges. Verify the flat charge covers the provider's shipping costs for the chosen countries and variants. Start with one market if possible.
4. A Stripe product tax code and the account's tax settings/registrations. Automatic tax defaults on; configuring it is an account setup step, not something the code can infer. If setting `AUTOMATIC_TAX=false`, confirm that choice deliberately with the seller before launch.
5. Cloudflare account for Worker/D1, current website hosting access, and the canonical website origin (including `www` if used). CORS permits exactly that origin; redirect alternative hostnames to the canonical site.
6. Final shirt copy, delivery expectations, and customer-facing return/cancellation policy. Add the agreed policy to the product page and terms before opening orders.

Never paste API keys into chat, browser JavaScript, source control, screenshots, or command arguments. Use secret prompts or a local ignored `.dev.vars` file.

## Local preview and verification

Node 22.13+ is required for the SQLite-backed tests. Install Chrome for the browser tests (or change the Playwright channel to an installed Chromium browser).

```sh
cd commerce
npm ci
npm test
npm run test:browser
npm run check
```

`npm run check` is a build-only dry run; it does not publish anything. Browser tests start/stop a localhost static server and stub external providers. They do not contact Stripe or Printify. Test images and prices exist only in test fixtures.

To browse the static site manually:

```sh
node scripts/preview.mjs
```

Visit `http://localhost:8080/shop.html`. To preview the real deployed catalog without starting a local Worker, run `node scripts/preview.mjs --remote-catalog`. This mode proxies only read-only product/health requests and cannot submit checkout. A saved public catalog also provides a display-only fallback during outages. The preview server only serves website files/assets, never `commerce/`, dotfiles, or secrets.

To connect real product data and Stripe **test mode** locally:

- Copy `.dev.vars.example` to `.dev.vars` and edit locally.
- Set product/shop IDs, shipping charge, tax code, and test keys.
- Set `SITE_ORIGIN=http://localhost:8080`, `CHECKOUT_ENABLED=true`, `PAYMENT_MODE=test`, and leave `FULFILLMENT_ENABLED=false`.
- Apply local schema, then start the backend:

```sh
npm run db:local
npm run dev
```

In another terminal start the preview server. It proxies `/api/` to local port 8787. Forward Stripe test events with Stripe CLI:

```sh
stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded --forward-to localhost:8787/api/stripe/webhook
```

Put the CLI's signing secret into local `.dev.vars` and restart the Worker. A successful Stripe test checkout must reach `test_complete`. **Even if fulfillment is accidentally enabled, a test payment never writes to Printify.** Printify does not provide a sandbox for this integration.

## Deploy the backend, initially closed

The initial database, closed backend, secrets, and Stripe test webhook have already been configured. The following commands document reproducible setup; do not create a duplicate database or webhook.

```sh
cd commerce
npx wrangler login
npx wrangler d1 create shop-orders
```

Replace the all-zero `database_id` in `wrangler.jsonc` with the returned ID. Set the non-secret product, shipping, tax, and site variables. Keep both enable flags false until configuration is complete.

```sh
npx wrangler d1 migrations apply shop-orders --remote
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put PRINTIFY_API_TOKEN
npm run deploy
```

The Printify token needs product/catalog read and order read/write access for the selected shop. No product-write access is used. Protect the Cloudflare account and rotate credentials when needed; Printify personal tokens expire.

Set `shop-config.js`'s public `apiBase` to the deployed HTTPS Worker origin, without `/api`. Keep all secret keys out of that file. Publish website files through the existing site's deployment process. Do not deploy `commerce/`, `node_modules/`, `.dev.vars`, or other private backend configuration as website assets.

In Stripe, create an event destination pointing to `https://YOUR-WORKER/api/stripe/webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Use the pinned API version `2025-02-24.acacia` where available; processing retrieves Checkout Sessions using that version. Save the destination's signing secret via `wrangler secret put`. Stripe CLI and dashboard destinations have different signing secrets.

Use a separate Worker/D1 database for staging if running live and test installations concurrently. Enable Stripe successful-payment receipt emails in account settings and verify delivery. The Printify request sets `send_shipping_notification=true`; verify the resulting customer shipping email with the real sample order. The order page also provides tracking directly.

Before enabling live sales:

- Complete a real Stripe test checkout through the deployed frontend and webhook, including a failed payment and a cancellation.
- Confirm product prices, shipping, tax configuration, approved policies, and support contact.
- Verify Printify billing and order-approval settings. The integration submits orders but does not call `send_to_production`; Printify's configured approval policy controls when the order starts printing. Set automatic approval if automatic production is desired, with an appropriate cancellation window.
- Review the shop with its actual shirt photos and publish the website changes when launch is ready.
- Configure a live Stripe key and matching live webhook secret, set `PAYMENT_MODE=live`, and enable `FULFILLMENT_ENABLED` and `CHECKOUT_ENABLED` together. This can result in real Printify charges.
- With explicit approval, place one real paid sample order and verify production, shipping notifications, tracking, and refund handling. No live sample has been placed by this build.

## Order operations and recovery

Use Stripe Dashboard for payments/receipts/refunds and Printify Dashboard for production/shipping. Their records hold the customer details; D1 does not need another copy.

The automatic job picks up `paid`, `retry`, `submitting`, and `reconciling` orders every five minutes. An atomic D1 lease prevents concurrent submissions. Printify creation timeouts are ambiguous: the recovery job searches by the stable external order ID. If found, it records the existing order. If not found, it moves to `needs_review` and **never blindly repeats the creation POST**. Reconciliation searches up to five pages of 100 orders; an older unresolved case is reviewed manually.

Check orders needing attention using Cloudflare D1's console or:

```sh
npx wrangler d1 execute shop-orders --remote --command "SELECT id, stripe_session_id, printify_order_id, state, error_code, attempts FROM orders WHERE state IN ('needs_review','retry','reconciling') ORDER BY updated_at"
```

There is no public admin endpoint and no automated seller-alert email in this version. Monitor this query and Stripe's webhook-delivery dashboard while selling.

- `payment_mismatch` / `payment_review`: inspect Stripe for amount, currency, refund, dispute, or mode problems. Do not force fulfillment.
- `invalid_shipping`: inspect the address in Stripe and resolve with the customer.
- `submission_uncertain`: search Printify for the **full D1 order ID** in `external_id`, including orders still processing. If an order exists, attach its Printify ID and mark `submitted`. Never reset this state merely to try again.
- If a rejection is definitively confirmed and no Printify order exists, fulfill manually once through Printify or refund through Stripe. Record the result in D1.
- To record a manually fulfilled order, set `printify_order_id` and `state='submitted'` for the verified D1 order ID. To close a refunded/cancelled case, set `state='cancelled'`. This prevents cron from retrying it.
- A Stripe refund does **not** cancel a Printify order. Check/cancel production separately before refunding; automatic cross-provider refunds/cancellations are not implemented. Refunds/disputes present before automatic submission prevent that submission.
- Stop new checkout by setting `CHECKOUT_ENABLED=false`. Already-paid orders still process. To pause fulfillment too, also set `FULFILLMENT_ENABLED=false`; paid orders remain queued. Do not remove valid payment credentials while unresolved payments need processing.

No provider payloads or personal data are intentionally logged. Worker observability is off by default to avoid recording private order-link query strings. Treat the confirmation link as private. Keep backend access logs and any future analytics from collecting those links or customer details.

## References

- [Printify API](https://developers.printify.com/)
- [Stripe Checkout](https://docs.stripe.com/payments/checkout)
- [Stripe security](https://docs.stripe.com/security/guide)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)

## Current setup verification

- Product `6a4fe213435f537ab70d3111` belongs to Printify shop `28189423` (currently labelled “My new store”, sales channel “disconnected”). Read access and the shipping quote work. Confirm API-store/approval configuration before any real production order. No Printify order has been created.
- Product: Reading Bunny T-shirt | My Day Is Fully Booked; four colors, S–4XL, 28 available variants. Production costs at inspection ranged from $12.65 to $18.34; the seller retained a $20 price for all sizes.
- Stripe key is verified test mode. Shirt tax code `txcd_30011000` was confirmed by Stripe as Clothing & Footwear.
- The public product feed, US shipping, CORS, disabled checkout, and webhook signature acceptance/rejection were checked against the deployed backend. A completed Stripe-hosted sandbox payment subsequently reached `test_complete` in remote D1, with no Printify order created. Checkout was disabled again afterward.
- `scripts/inspect-accounts.mjs` reads provider setup and saves private local product snapshots without printing credentials.
- `scripts/prepare-product.mjs` downloads the actual shirt image and requests a non-order shipping quote with a synthetic address.
- `scripts/connect-backend.mjs` configures/reuses the test webhook, saves its signing secret privately, and sends secrets to Wrangler via stdin.
- `scripts/verify-backend.mjs` verifies the closed deployment and saves a public, non-purchasable product fallback.
- `scripts/check-stripe-readiness.mjs` checks sandbox tax setup without printing the address.
- `scripts/test-hosted-checkout.mjs` completes a hosted sandbox payment with synthetic customer details and Stripe’s documented test card; it requires temporarily enabled test checkout. It never enables checkout or fulfillment itself. Use `--resume` only for an incomplete local test session; close checkout again after testing. Private screenshots and session references stay in `.local/`.
- Run credentialed scripts from `commerce/` with `node --env-file=.dev.vars scripts/NAME.mjs`. The `.local/` directory and `.dev.vars` are ignored by Git. Never publish either.
