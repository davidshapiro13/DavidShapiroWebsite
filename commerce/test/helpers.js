import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { OrderStore } from '../src/store.js';

export function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0001_orders.sql', import.meta.url), 'utf8'));
  return {
    sql,
    prepare(query) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return sql.prepare(query).get(...args) || null; },
        async all() { return { results: sql.prepare(query).all(...args) }; },
        async run() { return { meta: { changes: sql.prepare(query).run(...args).changes } }; },
      };
    },
  };
}
export const id = '12345678-1234-4123-8123-123456789012';
export const sessionId = 'cs_test_abcdefghijklmnopqrstuvwxyz';
export const product = {
  id: 'shirt', blueprint_id: 5, title: 'Test shirt', description: '<p>A shirt.</p>',
  options: [{ type: 'size', values: [{ id: 1, title: 'M' }, { id: 2, title: 'L' }] }, { type: 'color', values: [{ id: 3, title: 'Blue' }] }],
  variants: [
    { id: 10, title: 'Blue / M', options: [1, 3], price: 2500, is_enabled: true, is_available: true },
    { id: 11, title: 'Blue / L', options: [2, 3], price: 2700, is_enabled: true, is_available: true },
    { id: 12, title: 'Disabled', price: 2500, is_enabled: false, is_available: true },
    { id: 13, title: 'Sold out', price: 2500, is_enabled: true, is_available: false },
  ], images: [],
};
export function fixture(live = false) {
  const db = database();
  const env = {
    DB: db, SITE_ORIGIN: 'https://davidsshapiro.com', CHECKOUT_ENABLED: 'true',
    FULFILLMENT_ENABLED: 'true', PAYMENT_MODE: live ? 'live' : 'test',
    STRIPE_SECRET_KEY: live ? 'sk_live_fake' : 'sk_test_fake', STRIPE_WEBHOOK_SECRET: 'whsec_fake',
    PRINTIFY_API_TOKEN: 'fake', PRINTIFY_SHOP_ID: 'shop', PRINTIFY_PRODUCT_ID: 'shirt',
    RETAIL_PRICE_CENTS: '2500', SHIPPING_CENTS: '500', SHIPPING_COUNTRIES: 'US', STRIPE_TAX_CODE: 'txcd_30011000', AUTOMATIC_TAX: 'true',
  };
  const store = new OrderStore(db);
  const session = {
    id: sessionId, status: 'complete', mode: 'payment', payment_status: 'paid',
    metadata: { order_id: id }, client_reference_id: id, currency: 'usd', livemode: live,
    amount_subtotal: 2500, amount_total: 3000, total_details: { amount_shipping: 500, amount_tax: 0, amount_discount: 0 },
    payment_intent: { latest_charge: { refunded: false, amount_refunded: 0, disputed: false } },
    shipping_details: { name: 'Test Customer', address: { line1: '123 Test St', line2: '', city: 'Boston', state: 'MA', postal_code: '02110', country: 'US' } },
    customer_details: { email: 'test@example.com', phone: '+15555555555' },
  };
  const calls = { sessions: [], orders: [], finds: 0 };
  const stripe = { checkout: { sessions: {
    async retrieve() { return structuredClone(session); },
    async create(params, options) {
      calls.sessions.push({ params, options });
      return { id: sessionId, url: 'https://checkout.stripe.com/c/pay/test', status: 'open' };
    },
  } } };
  const printify = {
    async product() { return structuredClone(product); },
    async createOrder(order, address) { calls.orders.push({ order, address }); return { id: 'printify-order' }; },
    async findOrder() { calls.finds++; return null; },
    async getOrder() { return { status: 'on-hold', shipments: [] }; },
  };
  const deps = { env, store, stripe, printify };
  async function paidOrder() {
    await store.create({ id, shop_id: 'shop', product_id: 'shirt', variant_id: 10, unit_amount: 2500,
      shipping_amount: 500, countries: 'US', live: Number(live) });
    await store.attachSession(id, sessionId); await store.markPaid(id);
    return store.get(id);
  }
  return { ...deps, deps, calls, session, db, paidOrder };
}
