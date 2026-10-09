// Read-only checks; never print keys or provider error payloads.
import { mkdir, writeFile } from 'node:fs/promises';
import { Printify, stripeClient } from '../src/providers.js';
const env = process.env;
const cleanError = e => ({ status: e.statusCode || e.status || null, type: e.type || e.code || 'request_failed' });
const output = {};
if (!env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
  output.stripe = { ok: false, issue: 'Expected a Stripe test secret key.' };
} else {
  try {
    const stripe = stripeClient(env);
    const balance = await stripe.balance.retrieve();
    output.stripe = { ok: true, live: balance.livemode };
    const code = await stripe.taxCodes.retrieve('txcd_30011000');
    output.stripe.shirtTaxCode = { id: code.id, name: code.name };
    try {
      const s = await stripe.tax.settings.retrieve();
      output.stripe.tax = { status: s.status, missingFields: s.status_details?.pending?.missing_fields || [], defaultTaxCode: s.defaults?.tax_code || null };
    } catch (e) { output.stripe.tax = { ok: false, ...cleanError(e) }; }
  } catch (e) { output.stripe = { ok: false, ...cleanError(e) }; }
}
if (!env.PRINTIFY_API_TOKEN || env.PRINTIFY_API_TOKEN === 'replace_me') {
  output.printify = { ok: false, issue: 'Printify token is not configured.' };
} else {
  const printify = new Printify(env);
  try {
    const shops = await printify.request('/shops.json');
    output.printify = { ok: true, shops: shops.map(s => ({ id: s.id, title: s.title, channel: s.sales_channel })), matches: [] };
    for (const shop of shops.filter(s => !env.PRINTIFY_SHOP_ID || String(s.id) === env.PRINTIFY_SHOP_ID)) {
      try {
        const p = await printify.request(`/shops/${shop.id}/products/${encodeURIComponent(env.PRINTIFY_PRODUCT_ID)}.json`);
        await mkdir('.local', { recursive: true });
        await writeFile('.local/product.json', JSON.stringify(p, null, 2));
        const enabled = (p.variants || []).filter(v => v.is_enabled);
        const available = enabled.filter(v => v.is_available === true);
        const costs = available.map(v => v.cost).filter(Number.isFinite);
        const match = { shopId: shop.id, productId: p.id, title: p.title, blueprintId: p.blueprint_id, providerId: p.print_provider_id,
          enabledVariants: enabled.length, availableVariants: available.length,
          minCostCents: costs.length ? Math.min(...costs) : null, maxCostCents: costs.length ? Math.max(...costs) : null,
          imageCount: (p.images || []).length };
        try {
          const shipping = await printify.request(`/catalog/blueprints/${p.blueprint_id}/print_providers/${p.print_provider_id}/shipping.json`);
          await writeFile('.local/shipping.json', JSON.stringify(shipping, null, 2));
          match.variantCosts = available.map(v => ({ title: v.title, costCents: v.cost }));
          match.usShipping = (shipping.profiles || []).filter(v => (v.countries || []).includes('US')).map(v => ({ firstItem: v.first_item, additionalItems: v.additional_items, profileKeys: Object.keys(v), eligibleVariantCount: available.filter(a => v.variant_ids.includes(a.id)).length, type: v.shipping_type || v.type || null }));
          match.handlingTime = shipping.handling_time;
        } catch (e) { match.shippingError = cleanError(e); }
        output.printify.matches.push(match);
      } catch (e) {
        if (e.status !== 404) (output.printify.lookupErrors ||= []).push({ shopId: shop.id, ...cleanError(e) });
      }
    }
  } catch (e) { output.printify = { ok: false, ...cleanError(e) }; }
}
console.log(JSON.stringify(output, null, 2));
