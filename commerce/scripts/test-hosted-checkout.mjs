// Sandbox only. Never prints Checkout URLs or customer/provider payloads.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { stripeClient } from '../src/providers.js';
const base = 'https://david-shirt-shop.david-shirt-shop.workers.dev';
assert.ok(process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'));
const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
assert.equal(config.vars.PAYMENT_MODE, 'test');
assert.equal(config.vars.FULFILLMENT_ENABLED, 'false');
await mkdir('.local', { recursive: true });
const stripe = stripeClient(process.env);
let session;
if (process.argv.includes('--resume')) {
  const saved = JSON.parse(await readFile('.local/test-checkout.json', 'utf8'));
  session = await stripe.checkout.sessions.retrieve(saved.id);
} else {
  const catalog = await (await fetch(`${base}/api/product`)).json();
  assert.equal(catalog.product.checkoutEnabled, true);
  const response = await fetch(`${base}/api/checkout`, { method: 'POST', headers: { 'Origin': config.vars.SITE_ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), variantId: catalog.product.variants[0].id }) });
  assert.equal(response.status, 200, `Checkout status ${response.status}`);
  const { url } = await response.json();
  const sessions = await stripe.checkout.sessions.list({ limit: 10 });
  session = sessions.data.find(s => s.url === url);
  assert.ok(session);
  await writeFile('.local/test-checkout.json', JSON.stringify({ id: session.id, url }), { mode: 0o600 });
}
assert.equal(session.livemode, false);
assert.equal(session.status, 'open', 'Use a new test for an already completed or expired session');
assert.equal(session.amount_subtotal, 2000);
assert.equal(session.total_details.amount_shipping, 495);
console.log('Verified real Stripe sandbox session: shirt $20, shipping $4.95.');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://davidsshapiro.com/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (!/^\/(order\.html|order\.js|components\.js|styles\.css|shop\.css|shop-config\.js|assets\/[a-zA-Z0-9_./-]+)$/.test(pathname) || pathname.includes('..')) return route.abort();
    const data = await readFile(`..${pathname}`);
    const ext = pathname.split('.').pop();
    await route.fulfill({ body: data, contentType: ({ html: 'text/html', js: 'text/javascript', css: 'text/css', jpg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml' })[ext] || 'application/octet-stream' });
  });
  await page.goto(session.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  await page.locator('#email').fill('checkout-test@example.com');
  await page.locator('#shippingName').fill('Test Customer');
  await page.getByRole('button', { name: 'Enter address manually' }).click();
  await page.locator('#shippingAddressLine1').fill('123 Test Street');
  await page.locator('#shippingLocality').fill('Boston');
  await page.locator('#shippingPostalCode').fill('02110');
  await page.locator('#shippingAdministrativeArea').selectOption('MA');
  await page.locator('#phoneNumber').fill('2025550123');
  await page.locator('#cardNumber').fill('4242424242424242');
  await page.locator('#cardExpiry').fill('1234');
  await page.locator('#cardCvc').fill('123');
  await page.locator('#enableStripePass').uncheck();
  await page.waitForTimeout(3000);
  await page.locator('button[type="submit"]').click();
  try { await page.waitForURL('https://davidsshapiro.com/order.html?**', { timeout: 60000 }); }
  catch {
    await page.screenshot({ path: '.local/stripe-checkout-result.png', fullPage: true });
    console.log('Checkout did not redirect. Inspect the private screenshot.');
    process.exitCode = 1;
  }
  if (!process.exitCode) {
    let status;
    for (let attempt = 0; attempt < 24; attempt++) {
      status = await (await fetch(`${base}/api/order?session_id=${session.id}`)).json();
      if (status.state === 'test_complete') break;
      await page.waitForTimeout(2500);
    }
    assert.equal(status.testMode, true);
    assert.equal(status.state, 'test_complete');
    const paid = await stripe.checkout.sessions.retrieve(session.id);
    assert.equal(paid.payment_status, 'paid');
    assert.equal(paid.livemode, false);
    await page.screenshot({ path: '.local/test-order-confirmation.png', fullPage: true });
    console.log(JSON.stringify({ paid: true, testMode: true, state: status.state, subtotal: paid.amount_subtotal, shipping: paid.total_details.amount_shipping, tax: paid.total_details.amount_tax, total: paid.amount_total }));
  }
} finally { await browser.close(); }
