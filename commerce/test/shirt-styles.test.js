import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, id, product } from './helpers.js';
import { createCheckout, route } from '../src/worker.js';
import { fulfill } from '../src/fulfillment.js';

test('long sleeves use the approved price and correct Printify product through fulfillment', async () => {
  const f = fixture(true);
  Object.assign(f.env, { PRINTIFY_LONG_SLEEVE_PRODUCT_ID: 'long-shirt', RETAIL_PRICE_CENTS: '2000' });
  f.printify.product = async productId => {
    assert.equal(productId, 'long-shirt');
    return { ...structuredClone(product), id: productId, title: 'Long Sleeve Tee' };
  };
  const input = { requestId: id, style: 'long-sleeve', variantId: 10 };
  assert.equal((await createCheckout(input, f.deps)).status, 200);
  const order = await f.store.get(id);
  assert.equal(order.product_id, 'long-shirt');
  assert.equal(order.unit_amount, 2000);
  assert.match(f.calls.sessions[0].params.line_items[0].price_data.product_data.name, /Long Sleeve Tee/);
  assert.equal((await createCheckout({ requestId: id, variantId: 10 }, f.deps)).status, 409);
  f.session.amount_subtotal = 2000; f.session.amount_total = 2500;
  await f.store.markPaid(id); await fulfill(id, f.deps);
  assert.equal(f.calls.orders[0].order.product_id, 'long-shirt');
  assert.equal(f.calls.orders[0].order.variant_id, 10);
});

test('unknown styles and unavailable long-sleeve variants cannot create a payment', async () => {
  const f = fixture();
  for (const style of ['long-sleeve', 'arbitrary-product']) {
    assert.equal((await createCheckout({ requestId: id, style, variantId: 10 }, f.deps)).status, 400);
  }
  f.env.PRINTIFY_LONG_SLEEVE_PRODUCT_ID = 'long-shirt';
  assert.equal((await createCheckout({ requestId: id, style: 'long-sleeve', variantId: 13 }, f.deps)).status, 409);
  assert.equal(f.calls.sessions.length, 0);
});

test('long-sleeve catalog selects its product and does not reuse short-sleeve description', async () => {
  const f = fixture();
  Object.assign(f.env, { PRINTIFY_LONG_SLEEVE_PRODUCT_ID: 'long-shirt', PRODUCT_DESCRIPTION: 'Short sleeve description' });
  f.printify.product = async productId => {
    assert.equal(productId, 'long-shirt');
    return { ...structuredClone(product), description: '<p>Long sleeve description</p>' };
  };
  const response = await route(new Request('https://shop.test/api/product?style=long-sleeve'), f.env, {}, f.deps);
  const data = await response.json();
  assert.equal(data.product.description, 'Long sleeve description');
  assert.equal(data.product.style, 'long-sleeve');
});
