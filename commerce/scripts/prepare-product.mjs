// Product assets and non-order shipping quote only; never creates a Printify order.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Printify } from '../src/providers.js';
const product = JSON.parse(await readFile('.local/product.json', 'utf8'));
const variant = product.variants.find(v => v.is_enabled && v.is_available && v.title.startsWith('S /'));
if (!variant) throw new Error('No available small variant');
const printify = new Printify(process.env);
try {
  // Synthetic destination for a quote, not a real customer or order.
  const rates = await printify.request(`/shops/${process.env.PRINTIFY_SHOP_ID}/orders/shipping.json`, {
    line_items: [{ product_id: product.id, variant_id: variant.id, quantity: 1 }],
    address_to: { first_name: 'Shipping', last_name: 'Quote', email: 'shipping-quote@example.com',
      country: 'US', region: 'MA', address1: '123 Test St', address2: '', city: 'Boston', zip: '02110' },
  });
  await writeFile('.local/shipping-quote.json', JSON.stringify(rates, null, 2));
  console.log(JSON.stringify({ shippingQuoteCents: rates }));
} catch (e) { console.log(JSON.stringify({ shippingQuoteError: e.code || 'request_failed', status: e.status || null })); }
await mkdir('../assets/shop', { recursive: true });
const chosen = product.images.find(i => i.is_default) || product.images[0];
const response = await fetch(chosen.src, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error('Product image download failed');
await writeFile('../assets/shop/reading-bunny-shirt.jpg', Buffer.from(await response.arrayBuffer()));
console.log('Saved the actual Printify product photo. No orders created.');
