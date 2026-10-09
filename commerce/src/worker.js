import Stripe from 'stripe';
import { OrderStore } from './store.js';
import { Printify, stripeClient } from './providers.js';
import { checkoutConfig, allowedVariants, publicProduct, retailPrice } from './catalog.js';
import { fulfill, paymentMatches } from './fulfillment.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{10,240}$/;
const CLOSED = 'The shop is getting ready. Please check back soon.';

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  } });
}
async function readBody(request, maxBytes) {
  if (Number(request.headers.get('Content-Length')) > maxBytes) throw new Error('body_too_large');
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maxBytes) { await reader.cancel(); throw new Error('body_too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

export function dependencies(env) {
  return { env, store: new OrderStore(env.DB), stripe: stripeClient(env), printify: new Printify(env) };
}

export async function createCheckout(input, deps) {
  const { env, store, stripe, printify } = deps;
  if (env.CHECKOUT_ENABLED !== 'true') return reply({ error: CLOSED }, 503);
  let config;
  try { config = checkoutConfig(env); } catch { return reply({ error: CLOSED }, 503); }
  if (!input || !UUID.test(input.requestId || '') || !Number.isSafeInteger(input.variantId) ||
      Object.keys(input).some(k => !['requestId', 'variantId'].includes(k))) {
    return reply({ error: 'Choose an available shirt size and try again.' }, 400);
  }
  let order = await store.get(input.requestId);
  if (order && (order.variant_id !== input.variantId || order.live !== Number(config.live))) {
    return reply({ error: 'Your selection changed. Refresh the page and try again.' }, 409);
  }
  if (order && order.state !== 'checkout') return reply({ error: 'This checkout has already been paid. Check your confirmation email.' }, 409);
  if (order?.stripe_session_id) {
    const existing = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
    if (existing.status !== 'open') return reply({ error: 'This checkout has ended. Refresh the page to start again.' }, 409);
    return reply({ url: existing.url });
  }
  // Do not replay an old key after Stripe's idempotency retention window.
  if (order && Date.now() - order.created_at > 23 * 60 * 60 * 1000) {
    return reply({ error: 'This checkout has expired. Refresh the page to start again.' }, 409);
  }
  const product = await printify.product();
  const variant = allowedVariants(product, env).find(v => v.id === input.variantId);
  if (!variant) return reply({ error: 'That size or color is currently unavailable. Please choose another.' }, 409);
  if (!order) order = await store.create({
    id: input.requestId, shop_id: env.PRINTIFY_SHOP_ID, product_id: env.PRINTIFY_PRODUCT_ID,
    variant_id: variant.id, unit_amount: retailPrice(env), shipping_amount: config.shipping,
    countries: config.countries.join(','), live: Number(config.live),
  });
  // A concurrent request may have inserted the same request ID for another variant.
  if (order.variant_id !== input.variantId || order.live !== Number(config.live)) return reply({ error: 'Please refresh and try again.' }, 409);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment', payment_method_types: ['card'],
    client_reference_id: order.id,
    metadata: { order_id: order.id },
    payment_intent_data: { metadata: { order_id: order.id } },
    line_items: [{ quantity: 1, price_data: {
      currency: 'usd', unit_amount: order.unit_amount, tax_behavior: 'exclusive',
      product_data: { name: `${product.title} — ${variant.title}`, tax_code: env.STRIPE_TAX_CODE },
    } }],
    shipping_address_collection: { allowed_countries: order.countries.split(',') },
    shipping_options: [{ shipping_rate_data: {
      type: 'fixed_amount', display_name: 'Standard shipping',
      fixed_amount: { amount: order.shipping_amount, currency: 'usd' },
      tax_behavior: 'exclusive', tax_code: 'txcd_92010001',
    } }],
    automatic_tax: { enabled: env.AUTOMATIC_TAX === 'true' },
    phone_number_collection: { enabled: true },
    billing_address_collection: 'required',
    success_url: `${env.SITE_ORIGIN}/order.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.SITE_ORIGIN}/shop.html?checkout=cancelled`,
    expires_at: Math.floor(order.created_at / 1000) + 3600,
  }, { idempotencyKey: `shirt-${order.id}` });
  await store.attachSession(order.id, session.id);
  return reply({ url: session.url });
}

export async function handleStripeEvent(event, deps, ctx) {
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return reply({ received: true });
  const eventSession = event.data.object;
  const order = await deps.store.get(eventSession.metadata?.order_id || '');
  if (!order) return reply({ received: true }); // Other Stripe products may use this account.
  if (event.livemode !== Boolean(order.live)) return reply({ error: 'Payment mode mismatch.' }, 400);
  const session = await deps.stripe.checkout.sessions.retrieve(eventSession.id);
  if (session.payment_status !== 'paid') return reply({ received: true });
  if (!paymentMatches(order, session)) {
    // Preserve a previously completed fulfillment if an unrelated session reuses metadata.
    if (order.state === 'checkout') await deps.store.update(order.id, { state: 'needs_review', error_code: 'payment_mismatch' });
    return reply({ received: true });
  }
  await deps.store.attachSession(order.id, session.id);
  await deps.store.markPaid(order.id);
  // Durable 'paid' state is committed before acknowledgement. Cron recovers an interrupted task.
  ctx.waitUntil(fulfill(order.id, deps).catch(() => {}));
  return reply({ received: true });
}

async function orderStatus(sessionId, deps) {
  if (!SESSION_ID.test(sessionId || '')) return reply({ error: 'Order not found.' }, 404);
  const order = await deps.store.bySession(sessionId);
  if (!order) return reply({ error: 'Order not found.' }, 404);
  const result = { reference: `DS-${order.id.slice(0, 8).toUpperCase()}`, state: order.state, testMode: !order.live, tracking: [] };
  if (order.printify_order_id) {
    try {
      const fulfillment = await deps.printify.getOrder(order.shop_id, order.printify_order_id);
      result.fulfillmentStatus = fulfillment.status;
      result.tracking = (fulfillment.shipments || []).flatMap(shipment => {
        try {
          const url = new URL(shipment.url);
          return url.protocol === 'https:' ? [{ carrier: shipment.carrier, url: url.href }] : [];
        } catch { return []; }
      });
    } catch { /* Keep the last durable order state if tracking is temporarily unavailable. */ }
  }
  return reply(result);
}

export async function route(request, env, ctx, providedDeps) {
  const path = new URL(request.url).pathname;
  if (path === '/api/health' && request.method === 'GET') return reply({ ok: true });
  if (path === '/api/product' && request.method === 'GET') {
    if (!env.PRINTIFY_API_TOKEN || !env.PRINTIFY_SHOP_ID || !env.PRINTIFY_PRODUCT_ID) return reply({ available: false, message: CLOSED });
    const printify = providedDeps?.printify || new Printify(env);
    const product = await printify.product();
    let config;
    try { config = checkoutConfig(env); } catch { /* Product can be previewed before payments are configured. */ }
    const data = publicProduct(product, env, config);
    try { data.sizeGuide = await printify.sizeGuide(product.blueprint_id); } catch { data.sizeGuide = null; }
    return reply({ available: true, product: data });
  }
  if (path === '/api/checkout' && request.method === 'POST') {
    if (request.headers.get('Origin') !== env.SITE_ORIGIN) return reply({ error: 'Request origin is not allowed.' }, 403);
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return reply({ error: 'Expected JSON.' }, 415);
    if (env.CHECKOUT_ENABLED !== 'true') return reply({ error: CLOSED }, 503);
    let input;
    try { input = JSON.parse(await readBody(request, 2048)); } catch { return reply({ error: 'Invalid request.' }, 400); }
    return createCheckout(input, providedDeps || dependencies(env));
  }
  if (path === '/api/stripe/webhook' && request.method === 'POST') {
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET || !env.DB) return reply({ error: 'Webhook unavailable.' }, 503);
    const deps = providedDeps || dependencies(env);
    let event;
    try {
      event = await deps.stripe.webhooks.constructEventAsync(
        await readBody(request, 262144), request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET,
        300, Stripe.createSubtleCryptoProvider(),
      );
    } catch { return reply({ error: 'Invalid webhook signature.' }, 400); }
    return handleStripeEvent(event, deps, ctx);
  }
  if (path === '/api/order' && request.method === 'GET') {
    if (!env.DB || !env.STRIPE_SECRET_KEY) return reply({ error: 'Order service unavailable.' }, 503);
    return orderStatus(new URL(request.url).searchParams.get('session_id'), providedDeps || dependencies(env));
  }
  return reply({ error: 'Not found.' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    let response;
    const origin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') {
      response = origin === env.SITE_ORIGIN ? new Response(null, { status: 204 }) : reply({ error: 'Origin not allowed.' }, 403);
    } else {
      try {
        if (env.RATE_LIMITER && !new URL(request.url).pathname.endsWith('/stripe/webhook')) {
          const { success } = await env.RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' });
          if (!success) response = reply({ error: 'Please wait a moment and try again.' }, 429);
        }
        if (!response) response = await route(request, env, ctx);
      } catch (error) {
        console.error('shop_api_failure', { code: error.code || error.name || 'unknown', status: error.status || error.statusCode || null });
        response = reply({ error: 'The shop is temporarily unavailable. Please try again shortly.' }, 503);
        response.headers.set('X-Shop-Error-Code', error.code || error.name || 'unknown');
        if (error.status) response.headers.set('X-Upstream-Status', String(error.status));
      }
    }
    if (origin === env.SITE_ORIGIN) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
      response.headers.set('Vary', 'Origin');
    }
    return response;
  },
  async scheduled(_event, env) {
    if (!env.DB || !env.STRIPE_SECRET_KEY) return;
    const deps = dependencies(env);
    for (const order of await deps.store.pending()) {
      try { await fulfill(order.id, deps); } catch { /* Lease expiry allows recovery; never log customer data. */ }
    }
  },
};
