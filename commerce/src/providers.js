import Stripe from 'stripe';

export const STRIPE_API_VERSION = '2025-02-24.acacia';

export function stripeClient(env) {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
    timeout: 20000,
  });
}

export class ProviderError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export class Printify {
  constructor(env, fetcher = (...args) => globalThis.fetch(...args)) { this.env = env; this.fetcher = fetcher; }
  async request(path, body) {
    let response;
    try {
      response = await this.fetcher(`https://api.printify.com/v1${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${this.env.PRINTIFY_API_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'DavidShapiroShop/1.0',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
    } catch { throw new ProviderError('printify_network'); }
    // Never log or persist provider error bodies: they can contain customer data.
    if (!response.ok) throw new ProviderError('printify_response', response.status);
    try { return await response.json(); }
    catch { throw new ProviderError('printify_invalid_response'); }
  }
  product() {
    return this.request(`/shops/${encodeURIComponent(this.env.PRINTIFY_SHOP_ID)}/products/${encodeURIComponent(this.env.PRINTIFY_PRODUCT_ID)}.json`);
  }
  sizeGuide(blueprintId) {
    return this.request(`/catalog/blueprints/${Number(blueprintId)}/size_guide.json`);
  }
  createOrder(order, address) {
    return this.request(`/shops/${encodeURIComponent(order.shop_id)}/orders.json`, {
      external_id: order.id,
      label: `DS-${order.id.slice(0, 8).toUpperCase()}`,
      line_items: [{ product_id: order.product_id, variant_id: order.variant_id, quantity: 1 }],
      shipping_method: 1,
      send_shipping_notification: true,
      address_to: address,
    });
  }
  getOrder(shopId, orderId) {
    return this.request(`/shops/${encodeURIComponent(shopId)}/orders/${encodeURIComponent(orderId)}.json`);
  }
  async findOrder(shopId, externalId) {
    // Reconciliation is read-only. Never assume external_id is an idempotency guarantee.
    for (let page = 1; page <= 5; page++) {
      const result = await this.request(`/shops/${encodeURIComponent(shopId)}/orders.json?limit=100&page=${page}`);
      if (!Array.isArray(result.data)) throw new ProviderError('printify_invalid_response');
      const order = result.data.find(item => item.external_id === externalId);
      if (order) return order;
      if (!result.next_page_url) return null;
    }
    return null;
  }
}
