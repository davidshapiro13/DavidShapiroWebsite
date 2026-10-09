import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { createCheckout, route, handleStripeEvent } from '../src/worker.js';
import { fulfill, shippingAddress } from '../src/fulfillment.js';
import { checkoutConfig, publicProduct } from '../src/catalog.js';
import { Printify } from '../src/providers.js';
import { fixture, id, sessionId, product } from './helpers.js';

const ctx = () => { const tasks = []; return { tasks, waitUntil(p) { tasks.push(p); } }; };

test('checkout uses server prices, fixed one-shirt quantity, hosted Stripe, and idempotency', async () => {
  const f = fixture();
  const response = await createCheckout({ requestId: id, variantId: 10 }, f.deps);
  assert.equal(response.status, 200);
  const { params, options } = f.calls.sessions[0];
  assert.equal(params.line_items[0].price_data.unit_amount, 2500);
  assert.equal(params.line_items[0].quantity, 1);
  assert.deepEqual(params.payment_method_types, ['card']);
  assert.deepEqual(params.shipping_address_collection.allowed_countries, ['US']);
  assert.equal(params.shipping_options[0].shipping_rate_data.fixed_amount.amount, 500);
  assert.equal(params.automatic_tax.enabled, true);
  assert.equal(options.idempotencyKey, `shirt-${id}`);
  assert.equal((await f.store.get(id)).stripe_session_id, sessionId);
});

test('client cannot choose prices, extra quantities, or return URLs', async () => {
  for (const field of ['price', 'quantity', 'success_url', 'productId']) {
    const f = fixture();
    assert.equal((await createCheckout({ requestId: id, variantId: 10, [field]: 1 }, f.deps)).status, 400);
    assert.equal(f.calls.sessions.length, 0);
  }
});

test('unavailable, disabled, and unlisted variants cannot be purchased', async () => {
  for (const variantId of [12, 13, 999]) {
    const f = fixture();
    assert.equal((await createCheckout({ requestId: id, variantId }, f.deps)).status, 409);
  }
  const f = fixture(); f.env.PRINTIFY_VARIANT_IDS = '11';
  assert.equal((await createCheckout({ requestId: id, variantId: 10 }, f.deps)).status, 409);
});

test('repeated checkout reuses the session without a second create', async () => {
  const f = fixture();
  await createCheckout({ requestId: id, variantId: 10 }, f.deps);
  f.session.status = 'open'; f.session.url = 'https://checkout.stripe.com/c/pay/test';
  assert.equal((await createCheckout({ requestId: id, variantId: 10 }, f.deps)).status, 200);
  assert.equal(f.calls.sessions.length, 1);
  assert.equal((await createCheckout({ requestId: id, variantId: 11 }, f.deps)).status, 409);
});

test('concurrent checkout for different variants cannot change the recorded purchase', async () => {
  const f = fixture();
  const responses = await Promise.all([10, 11].map(variantId => createCheckout({ requestId: id, variantId }, f.deps)));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(f.calls.sessions.length, 1);
});

test('disabled checkout and missing shipping or tax configuration fail closed', async () => {
  for (const [key, value] of [['CHECKOUT_ENABLED', 'false'], ['SHIPPING_CENTS', ''], ['RETAIL_PRICE_CENTS', ''], ['RETAIL_PRICE_CENTS', '-1'], ['STRIPE_TAX_CODE', ''], ['STRIPE_WEBHOOK_SECRET', '']]) {
    const f = fixture(); f.env[key] = value;
    assert.equal((await createCheckout({ requestId: id, variantId: 10 }, f.deps)).status, 503);
    assert.equal(f.calls.sessions.length, 0);
  }
});

test('live checkout requires a live key and enabled fulfillment', () => {
  const f = fixture(true); f.env.FULFILLMENT_ENABLED = 'false';
  assert.throws(() => checkoutConfig(f.env));
  f.env.FULFILLMENT_ENABLED = 'true'; f.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  assert.throws(() => checkoutConfig(f.env));
});

test('test payments NEVER submit an order to Printify even with fulfillment enabled', async () => {
  const f = fixture(); await f.paidOrder(); await fulfill(id, f.deps);
  assert.equal(f.calls.orders.length, 0);
  assert.equal((await f.store.get(id)).state, 'test_complete');
});

test('concurrent fulfillment only submits one paid live order', async () => {
  const f = fixture(true); await f.paidOrder();
  await Promise.all([fulfill(id, f.deps), fulfill(id, f.deps), fulfill(id, f.deps)]);
  assert.equal(f.calls.orders.length, 1);
  assert.equal((await f.store.get(id)).state, 'submitted');
  assert.equal(f.calls.orders[0].address.address1, '123 Test St');
});

test('unpaid, mismatched amount, wrong session, wrong mode, and refunded/disputed payments do not print', async () => {
  for (const change of [
    s => s.payment_status = 'unpaid', s => s.amount_subtotal = 1,
    s => s.id = 'cs_test_wrong', s => s.livemode = false,
    s => s.total_details.amount_shipping = 0,
    s => s.payment_intent.latest_charge.refunded = true,
    s => s.payment_intent.latest_charge.amount_refunded = 100,
    s => s.payment_intent.latest_charge.disputed = true,
  ]) {
    const f = fixture(true); await f.paidOrder(); change(f.session);
    await fulfill(id, f.deps);
    assert.equal(f.calls.orders.length, 0);
    assert.equal((await f.store.get(id)).state, 'needs_review');
  }
});

test('unsupported or missing delivery address holds the paid order for review', async () => {
  const f = fixture(true); await f.paidOrder(); f.session.shipping_details.address.country = 'CA';
  await fulfill(id, f.deps);
  assert.equal(f.calls.orders.length, 0);
  assert.equal((await f.store.get(id)).error_code, 'invalid_shipping');
});

test('temporary provider failure persists a retry without storing exception details', async () => {
  const f = fixture(true); await f.paidOrder();
  f.stripe.checkout.sessions.retrieve = async () => { throw new Error('test@example.com 123 Test St'); };
  await fulfill(id, f.deps);
  const row = await f.store.get(id);
  assert.equal(row.state, 'retry'); assert.equal(row.error_code, 'provider_unavailable');
  assert.ok(row.next_attempt > Date.now());
  assert.ok(!JSON.stringify(row).includes('test@example.com'));
});

test('timeout after a possible Printify acceptance reconciles and never resubmits', async () => {
  const f = fixture(true); await f.paidOrder(); let posts = 0;
  f.printify.createOrder = async () => { posts++; throw new Error('timeout'); };
  await fulfill(id, f.deps);
  assert.equal((await f.store.get(id)).state, 'reconciling');
  await f.store.update(id, { next_attempt: 0 });
  f.printify.findOrder = async () => ({ id: 'accepted-before-timeout' });
  await fulfill(id, f.deps);
  assert.equal(posts, 1);
  assert.equal((await f.store.get(id)).printify_order_id, 'accepted-before-timeout');
});

test('ambiguous submission not found remotely requires manual review, never a new POST', async () => {
  const f = fixture(true); await f.paidOrder();
  await f.store.update(id, { state: 'submitting' }); // Simulate crash during POST.
  await fulfill(id, f.deps);
  assert.equal(f.calls.orders.length, 0);
  assert.equal((await f.store.get(id)).state, 'needs_review');
});

test('duplicate paid webhooks cannot downgrade fulfilled orders or print again', async () => {
  const f = fixture(true); await f.paidOrder(); await fulfill(id, f.deps);
  const context = ctx();
  const event = { type: 'checkout.session.completed', livemode: true, data: { object: f.session } };
  await handleStripeEvent(event, f.deps, context); await Promise.all(context.tasks);
  assert.equal(f.calls.orders.length, 1);
  assert.equal((await f.store.get(id)).state, 'submitted');
});

test('signed unpaid Stripe events do not fulfill', async () => {
  const f = fixture(); await f.paidOrder(); await f.store.update(id, { state: 'checkout' });
  f.session.payment_status = 'unpaid'; const context = ctx();
  await handleStripeEvent({ type: 'checkout.session.completed', livemode: false, data: { object: f.session } }, f.deps, context);
  assert.equal(context.tasks.length, 0); assert.equal((await f.store.get(id)).state, 'checkout');
});

test('real Stripe signature verification rejects spoofed and altered webhook payloads', async () => {
  const f = fixture(); f.stripe.webhooks = new Stripe('sk_test_fake').webhooks;
  const payload = JSON.stringify({ type: 'unrelated.event', data: { object: {} } });
  const header = f.stripe.webhooks.generateTestHeaderString({ payload, secret: f.env.STRIPE_WEBHOOK_SECRET });
  for (const [body, signature, expected] of [[payload, header, 200], [payload + ' ', header, 400], [payload, 'fake', 400]]) {
    const response = await route(new Request('https://api.example/api/stripe/webhook', {
      method: 'POST', headers: { 'Stripe-Signature': signature }, body,
    }), f.env, ctx(), f.deps);
    assert.equal(response.status, expected);
  }
});

test('checkout rejects foreign origins and oversized requests', async () => {
  const f = fixture();
  const req = (origin, body) => new Request('https://api.example/api/checkout', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body });
  assert.equal((await route(req('https://evil.example', '{}'), f.env, ctx(), f.deps)).status, 403);
  assert.equal((await route(req(f.env.SITE_ORIGIN, ' '.repeat(3000)), f.env, ctx(), f.deps)).status, 400);
});

test('public order response and persisted ledger contain no customer identity or address', async () => {
  const f = fixture(true); await f.paidOrder(); await fulfill(id, f.deps);
  const response = await route(new Request(`https://api.example/api/order?session_id=${sessionId}`), f.env, ctx(), f.deps);
  const data = await response.text(); const row = JSON.stringify(await f.store.get(id));
  for (const sensitive of ['test@example.com', '123 Test St', 'Test Customer', '+15555555555', '02110']) {
    assert.ok(!data.includes(sensitive)); assert.ok(!row.includes(sensitive));
  }
  assert.equal((await route(new Request('https://api.example/api/order?session_id=1'), f.env, ctx(), f.deps)).status, 404);
});

test('product response only exposes supported retail variants and safe image URLs', () => {
  const f = fixture();
  const data = publicProduct({ ...product, images: [{ src: 'javascript:alert(1)' }, { src: 'https://example.com/shirt.png' }] }, f.env, checkoutConfig(f.env));
  assert.deepEqual(data.variants.map(v => v.id), [10, 11]);
  assert.equal(data.variants[0].size, 'M'); assert.equal(data.variants[0].color, 'Blue');
  assert.equal(data.images.length, 1); assert.equal(data.description, 'A shirt.');
  assert.ok(!JSON.stringify(data).includes('fake'));
});

test('Printify adapter uses a stable external reference and address only in the request body', async () => {
  const f = fixture(true); const order = await f.paidOrder(); let request;
  const printify = new Printify(f.env, async (url, options) => {
    request = { url, options }; return Response.json({ id: 'order' });
  });
  await printify.createOrder(order, shippingAddress(f.session, order));
  const body = JSON.parse(request.options.body);
  assert.equal(body.external_id, id); assert.equal(body.line_items[0].quantity, 1);
  assert.equal(body.shipping_method, 1); assert.equal(body.send_shipping_notification, true);
  assert.ok(!request.url.includes('test@example.com'));
});

test('a signed paid webhook queues durable processing and completes a test order', async () => {
  const f = fixture(); await f.paidOrder(); await f.store.update(id, { state: 'checkout' });
  f.stripe.webhooks = new Stripe('sk_test_fake').webhooks;
  const payload = JSON.stringify({ type: 'checkout.session.completed', livemode: false, data: { object: f.session } });
  const signature = f.stripe.webhooks.generateTestHeaderString({ payload, secret: f.env.STRIPE_WEBHOOK_SECRET });
  const context = ctx();
  const response = await route(new Request('https://api.example/api/stripe/webhook', {
    method: 'POST', headers: { 'Stripe-Signature': signature }, body: payload,
  }), f.env, context, f.deps);
  assert.equal(response.status, 200);
  await Promise.all(context.tasks);
  assert.equal((await f.store.get(id)).state, 'test_complete');
  assert.equal(f.calls.orders.length, 0);
});

test('expired signed webhook is rejected', async () => {
  const f = fixture(); f.stripe.webhooks = new Stripe('sk_test_fake').webhooks;
  const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: f.session } });
  const signature = f.stripe.webhooks.generateTestHeaderString({ payload, secret: f.env.STRIPE_WEBHOOK_SECRET, timestamp: Math.floor(Date.now() / 1000) - 600 });
  const response = await route(new Request('https://api.example/api/stripe/webhook', {
    method: 'POST', headers: { 'Stripe-Signature': signature }, body: payload,
  }), f.env, ctx(), f.deps);
  assert.equal(response.status, 400);
});

test('paid webhook recovers a crash before checkout session ID was saved', async () => {
  const f = fixture();
  await f.store.create({ id, shop_id: 'shop', product_id: 'shirt', variant_id: 10, unit_amount: 2500,
    shipping_amount: 500, countries: 'US', live: 0 });
  const context = ctx();
  await handleStripeEvent({ type: 'checkout.session.completed', livemode: false, data: { object: f.session } }, f.deps, context);
  await Promise.all(context.tasks);
  assert.equal((await f.store.get(id)).stripe_session_id, sessionId);
  assert.equal((await f.store.get(id)).state, 'test_complete');
});

test('a paused live fulfillment remains queued without printing', async () => {
  const f = fixture(true); await f.paidOrder(); f.env.FULFILLMENT_ENABLED = 'false';
  await fulfill(id, f.deps);
  assert.equal(f.calls.orders.length, 0); assert.equal((await f.store.get(id)).state, 'retry');
});


test('the approved $20 price overrides Printify prices in both storefront and checkout', async () => {
  const f = fixture(); f.env.RETAIL_PRICE_CENTS = '2000';
  const data = publicProduct(product, f.env, checkoutConfig(f.env));
  assert.deepEqual(data.variants.map(v => v.price), [2000, 2000]);
  const response = await createCheckout({ requestId: id, variantId: 11 }, f.deps);
  assert.equal(response.status, 200);
  assert.equal(f.calls.sessions[0].params.line_items[0].price_data.unit_amount, 2000);
  assert.equal((await f.store.get(id)).unit_amount, 2000);
  assert.deepEqual(f.calls.sessions[0].params.shipping_address_collection.allowed_countries, ['US']);
});

test('default Printify transport preserves the Cloudflare fetch receiver', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = function () {
    assert.equal(this, globalThis, 'Workers fetch requires its global receiver');
    return Promise.resolve(Response.json({ id: 'shirt' }));
  };
  try {
    const printify = new Printify(fixture().env);
    assert.equal((await printify.product()).id, 'shirt');
  } finally { globalThis.fetch = previous; }
});
