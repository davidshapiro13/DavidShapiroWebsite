import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, id } from './helpers.js';
import { createCheckout } from '../src/worker.js';
import { fulfill, paymentMatches } from '../src/fulfillment.js';
import { BOOK_ID } from '../src/book.js';

function setup(live = true) {
  const f = fixture(live);
  Object.assign(f.env, { BOOK_CHECKOUT_ENABLED: 'true', BOOK_SHIPPING_CENTS: '0',
    BOOK_SHIPPING_COUNTRIES: 'US', BOOK_TAX_CODE: 'txcd_35010000',
    BOOK_ORDER_EMAIL: 'seller@example.com', BOOK_EMAIL_FROM: 'shop@example.com', RESEND_API_KEY: 'fake' });
  f.session.amount_subtotal = 2000; f.session.amount_total = 2000;
  f.session.total_details.amount_shipping = 0;
  return f;
}
const input = { requestId: id, product: BOOK_ID };
test('book costs $20, collects mailing details, and does not depend on Printify', async () => {
  const f = setup();
  f.printify.product = () => { throw new Error('must not call'); };
  assert.equal((await createCheckout(input, f.deps)).status, 200);
  const p = f.calls.sessions[0].params;
  assert.equal(p.line_items[0].price_data.unit_amount, 2000);
  assert.equal(p.line_items[0].price_data.tax_behavior, 'inclusive');
  assert.equal(p.shipping_options[0].shipping_rate_data.fixed_amount.amount, 0);
  f.session.total_details.amount_tax = 125;
  assert.equal(paymentMatches(await f.store.get(id), f.session), true);
  f.session.amount_total = 2125;
  assert.equal(paymentMatches(await f.store.get(id), f.session), false);
  assert.deepEqual(p.shipping_address_collection.allowed_countries, ['US']);
  assert.equal((await f.store.get(id)).product_id, BOOK_ID);
  assert.equal((await createCheckout({ ...input, price: 1 }, f.deps)).status, 400);
  assert.equal((await createCheckout({ requestId: id, variantId: 10 }, f.deps)).status, 409);
});
test('missing email configuration prevents payment', async () => {
  for (const key of ['RESEND_API_KEY', 'BOOK_ORDER_EMAIL', 'BOOK_EMAIL_FROM', 'BOOK_SHIPPING_CENTS']) {
    const f = setup(); delete f.env[key];
    assert.equal((await createCheckout(input, f.deps)).status, 503);
    assert.equal(f.calls.sessions.length, 0);
  }
});
test('paid book emails customer details once, never prints, and retries email failure', async () => {
  const f = setup();
  await createCheckout(input, f.deps); await f.store.markPaid(id);
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.resend.com/emails');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.to, ['seller@example.com']);
    assert.match(body.text, /Test Customer/); assert.match(body.text, /test@example.com/);
    assert.match(body.text, /123 Test St/); assert.match(body.text, /02110/);
    assert.equal(options.headers['Idempotency-Key'], 'book-order-' + id);
    return calls === 1 ? new Response('', { status: 503 }) : Response.json({ id: 'email-id' });
  };
  try {
    await fulfill(id, f.deps);
    assert.equal((await f.store.get(id)).state, 'retry');
    await f.store.update(id, { next_attempt: 0 });
    await fulfill(id, f.deps); await fulfill(id, f.deps);
    assert.equal((await f.store.get(id)).state, 'book_notified');
    assert.equal(calls, 2); assert.equal(f.calls.orders.length, 0);
  } finally { globalThis.fetch = previous; }
});
test('test, unpaid, refunded, and invalid-address book orders never email', async () => {
  const previous = globalThis.fetch;
  let emails = 0;
  globalThis.fetch = async () => { emails++; throw new Error('unexpected email'); };
  try {
    for (const kind of ['test', 'unpaid', 'refunded', 'address']) {
      const f = setup(kind !== 'test');
      await createCheckout(input, f.deps); await f.store.markPaid(id);
      if (kind === 'unpaid') f.session.payment_status = 'unpaid';
      if (kind === 'refunded') f.session.payment_intent.latest_charge.refunded = true;
      if (kind === 'address') delete f.session.shipping_details;
      await fulfill(id, f.deps);
      assert.equal((await f.store.get(id)).state, kind === 'test' ? 'test_complete' : 'needs_review');
    }
    assert.equal(emails, 0);
  } finally { globalThis.fetch = previous; }
});

test('book checkout rejects shipping surcharges', async () => {
  const f = setup(); f.env.BOOK_SHIPPING_CENTS = '495';
  assert.equal((await createCheckout(input, f.deps)).status, 503);
  assert.equal(f.calls.sessions.length, 0);
});
