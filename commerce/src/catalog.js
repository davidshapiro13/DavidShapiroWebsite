export function retailPrice(env) {
  if (!/^\d+$/.test(env.RETAIL_PRICE_CENTS || '')) throw new Error('Retail price is not configured');
  const price = Number(env.RETAIL_PRICE_CENTS);
  if (!Number.isSafeInteger(price) || price <= 0 || price > 100000) throw new Error('Invalid retail price');
  return price;
}

export function checkoutConfig(env) {
  retailPrice(env);
  const origin = new URL(env.SITE_ORIGIN);
  if (origin.origin !== env.SITE_ORIGIN || (origin.protocol !== 'https:' && origin.hostname !== 'localhost')) {
    throw new Error('Invalid site origin');
  }
  if (!['test', 'live'].includes(env.PAYMENT_MODE)) throw new Error('Invalid payment mode');
  const live = env.PAYMENT_MODE === 'live';
  if (!(live ? /^(sk|rk)_live_/ : /^(sk|rk)_test_/).test(env.STRIPE_SECRET_KEY || '')) throw new Error('Payment key mode mismatch');
  if (!env.STRIPE_WEBHOOK_SECRET || !env.PRINTIFY_API_TOKEN || !env.PRINTIFY_SHOP_ID || !env.PRINTIFY_PRODUCT_ID || !env.DB) {
    throw new Error('Store is not configured');
  }
  if (!/^\d+$/.test(env.SHIPPING_CENTS || '')) throw new Error('Shipping price is not configured');
  const shipping = Number(env.SHIPPING_CENTS);
  if (!Number.isSafeInteger(shipping) || shipping > 100000) throw new Error('Invalid shipping price');
  const countries = (env.SHIPPING_COUNTRIES || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!countries.length || countries.some(c => !/^[A-Z]{2}$/.test(c))) throw new Error('Shipping destinations are not configured');
  if (!/^txcd_\d+$/.test(env.STRIPE_TAX_CODE || '')) throw new Error('Product tax code is not configured');
  if (!['true', 'false'].includes(env.AUTOMATIC_TAX)) throw new Error('Tax configuration is required');
  if (live && env.FULFILLMENT_ENABLED !== 'true') throw new Error('Live fulfillment is not enabled');
  return { live, shipping, countries };
}

export function allowedVariants(product, env) {
  const selected = env.PRINTIFY_VARIANT_IDS?.split(',').map(Number);
  return (product.variants || []).filter(v => v.is_enabled && v.is_available === true &&
    Number.isSafeInteger(v.id) &&
    (!selected || selected.includes(v.id)));
}

function textFromHTML(value = '') {
  return String(value).replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
export function safeImage(url) {
  try { return new URL(url).protocol === 'https:' ? url : null; } catch { return null; }
}

export function publicProduct(product, env, config) {
  const sizeOrder = new Map((product.options || []).find(o => o.type === 'size')?.values.map((v, i) => [v.id, i]) || []);
  const variants = allowedVariants(product, env).sort((a, b) => {
    const rank = v => Math.min(...(v.options || []).filter(id => sizeOrder.has(id)).map(id => sizeOrder.get(id)), 999);
    return rank(a) - rank(b) || a.id - b.id;
  });
  const optionMap = new Map((product.options || []).flatMap(o => (o.values || []).map(v => [v.id, { type: o.type, title: v.title }])));
  return {
    title: product.title,
    description: textFromHTML(env.PRODUCT_DESCRIPTION || product.description),
    defaultVariantId: variants.find(v => v.is_default)?.id || variants[0]?.id,
    currency: 'usd',
    shipping: config?.shipping ?? null,
    countries: config?.countries ?? [],
    testMode: env.PAYMENT_MODE !== 'live',
    checkoutEnabled: Boolean(config && env.CHECKOUT_ENABLED === 'true' && variants.length),
    images: (product.images || []).filter(i => safeImage(i.src)).map(i => ({ src: i.src, variantIds: i.variant_ids || [] })),
    variants: variants.map(v => {
      const options = (v.options || []).map(id => optionMap.get(id)).filter(Boolean);
      return { id: v.id, title: v.title, price: retailPrice(env),
        color: options.find(o => o.type === 'color')?.title || '',
        size: options.find(o => o.type === 'size')?.title || v.title };
    }),
  };
}
