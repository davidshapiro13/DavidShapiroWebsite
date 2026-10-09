// Opens and expires one unpaid live checkout. Never enters card details or pays.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { stripeClient } from '../src/providers.js';
const base = 'https://david-shirt-shop.david-shirt-shop.workers.dev';
const stripe = stripeClient({ STRIPE_SECRET_KEY: process.env.STRIPE_LIVE_SECRET_KEY });
let browser, session, stage = "catalog";
try {
 const catalog = await (await fetch(`${base}/api/product`)).json();
 assert.equal(catalog.product.checkoutEnabled, true);
 assert.equal(catalog.product.testMode, false);
 assert.ok(catalog.product.variants.every(v => v.price === 2000));
 assert.equal(catalog.product.shipping, 495);
 assert.deepEqual(catalog.product.countries, ['US']);
 const payload = JSON.stringify({ id: 'evt_live_connection_check', type: 'shop.connection_check', livemode: true, data: { object: {} } });
 const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_LIVE_WEBHOOK_SECRET });
 assert.equal((await fetch(`${base}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature }, body: payload })).status, 200);
 console.log('Live catalog and webhook signature checks passed.');
 stage = 'browser_launch';
 browser = await chromium.launch({ channel: 'chrome', headless: true });
 const page = await browser.newPage();
 stage = 'storefront_load';
 await page.goto('https://davidsshapiro.com/shop.html', { waitUntil: 'domcontentloaded' });
 stage = 'product_load';
 await page.locator('#shop-product').waitFor({ timeout: 60000 });
 assert.equal(await page.locator('#buy-shirt').isDisabled(), false);
 stage = 'buy_button';
 let checkoutURL;
 await page.route(`${base}/api/checkout`, async route => {
  const upstream = await route.fetch();
  const data = await upstream.json();
  checkoutURL = data.url;
  await route.fulfill({ response: upstream });
 });
 const checkoutResponse = page.waitForResponse(r => r.url() === `${base}/api/checkout` && r.request().method() === 'POST', { timeout: 60000 });
 await page.locator('#buy-shirt').click();
 const response = await checkoutResponse;
 if (response.status() !== 200) {
  console.log(JSON.stringify({ checkoutStatus: response.status(), code: response.headers()['x-shop-error-code'], upstreamStatus: response.headers()['x-upstream-status'] }));
  throw new Error('Live checkout failed');
 }
 stage = 'session_validation';
 const url = checkoutURL;
 const sessions = await stripe.checkout.sessions.list({ limit: 20 });
 session = sessions.data.find(s => s.url === url);
 assert.ok(session);
 assert.equal(session.livemode, true);
 assert.equal(session.payment_status, 'unpaid');
 assert.equal(session.amount_subtotal, 2000);
 assert.equal(session.total_details.amount_shipping, 495);
 assert.equal(session.automatic_tax.enabled, true);
 assert.deepEqual(session.shipping_address_collection.allowed_countries, ['US']);
 stage = 'stripe_page';
 await page.waitForURL('https://checkout.stripe.com/**', { timeout: 60000 });
 await page.locator('#email').waitFor({ timeout: 60000 });
 console.log('Published Buy button opens live Stripe checkout: $20 shirt + $4.95 US shipping, automatic tax enabled. No payment submitted.');
} catch (error) {
 console.error(JSON.stringify({ verificationFailed: true, stage, type: error.type || error.name, code: error.code || null, status: error.statusCode || null }));
 process.exitCode = 1;
} finally {
 if (session?.status === 'open') {
  try { await stripe.checkout.sessions.expire(session.id); console.log('Unpaid verification checkout expired.'); }
  catch { console.log('Could not expire verification checkout; it will expire at its scheduled time.'); process.exitCode = 1; }
 }
 if (browser) await browser.close();
}
