(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const base = (window.SHOP_CONFIG?.apiBase || '').replace(/\/$/, '');
  const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
  let product, variant, busy = false, attempt;

  function notice(text) { $('shop-notice').textContent = text; $('shop-notice').hidden = false; }
  function option(value, label) { const el = document.createElement('option'); el.value = value; el.textContent = label; return el; }
  function images() {
    const matching = product.images.filter(i => !i.variantIds.length || i.variantIds.includes(variant?.id));
    const choices = matching.length ? matching : product.images;
    $('product-thumbnails').replaceChildren();
    $('product-image').hidden = choices.length === 0;
    $('image-unavailable').hidden = choices.length !== 0;
    choices.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', `View product photo ${index + 1}`);
      button.setAttribute('aria-pressed', String(index === 0));
      const image = document.createElement('img');
      image.src = item.src; image.alt = ''; image.loading = 'lazy';
      button.append(image);
      button.addEventListener('click', () => {
        $('product-image').src = item.src;
        $('product-image').alt = `${product.title}, photo ${index + 1}`;
        for (const node of $('product-thumbnails').children) node.setAttribute('aria-pressed', String(node === button));
      });
      $('product-thumbnails').append(button);
    });
    if (choices[0]) { $('product-image').src = choices[0].src; $('product-image').alt = product.title; }
  }
  function chooseSize() {
    variant = product.variants.find(v => String(v.id) === $('shirt-size').value);
    attempt = null;
    $('product-price').textContent = variant ? money(variant.price) : 'Currently unavailable';
    $('buy-shirt').disabled = busy || !product.checkoutEnabled || !variant;
    $('checkout-message').textContent = product.checkoutEnabled ? '' : 'Orders are not open just yet. Please check back soon.';
    images();
  }
  function chooseColor() {
    const previousSize = variant?.size;
    const options = product.variants.filter(v => v.color === $('shirt-color').value);
    $('shirt-size').replaceChildren(...options.map(v => option(v.id, v.size)));
    const sameSize = options.find(v => v.size === previousSize);
    if (sameSize) $('shirt-size').value = String(sameSize.id);
    chooseSize();
  }
  function sizeGuide(guide) {
    if (!guide?.sizes?.length || !guide.types?.length) return;
    const table = document.createElement('table');
    const caption = document.createElement('caption'); caption.textContent = 'Garment measurements'; table.append(caption);
    const head = document.createElement('thead'); const header = document.createElement('tr');
    for (const title of ['Size', ...guide.types.map(t => `${t.name} (${t.units})`)]) {
      const th = document.createElement('th'); th.scope = 'col'; th.textContent = title; header.append(th);
    }
    head.append(header); table.append(head);
    const body = document.createElement('tbody');
    guide.sizes.forEach((size, index) => {
      const tr = document.createElement('tr'); const th = document.createElement('th'); th.scope = 'row'; th.textContent = size; tr.append(th);
      for (const type of guide.types) {
        const td = document.createElement('td'); const range = type.ranges?.[index];
        td.textContent = range?.from == null ? '—' : range.to && range.to !== range.from ? `${range.from}–${range.to}` : range.from;
        tr.append(td);
      }
      body.append(tr);
    });
    table.append(body); $('size-guide-table').replaceChildren(table); $('size-guide').hidden = false;
  }
  $('shop-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !variant || !product.checkoutEnabled) return;
    busy = true; $('buy-shirt').disabled = true; $('buy-shirt').textContent = 'Opening secure checkout…';
    $('shirt-color').disabled = true; $('shirt-size').disabled = true;
    $('checkout-message').textContent = '';
    // Reuse the key after a network failure; one click cannot create duplicate sessions.
    attempt ||= crypto.randomUUID();
    try {
      const response = await fetch(`${base}/api/checkout`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: attempt, variantId: variant.id }), signal: AbortSignal.timeout(60000),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) attempt = null;
        throw new Error(data.error || 'Unable to open checkout. Please try again.');
      }
      const url = new URL(data.url);
      if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new Error('Unable to open secure checkout.');
      window.location.assign(url.href);
    } catch (error) {
      $('checkout-message').textContent = error.name === 'TypeError' || error.name === 'TimeoutError'
        ? 'We couldn’t connect to checkout. Please try again.' : error.message;
      busy = false; $('buy-shirt').disabled = false; $('buy-shirt').textContent = 'Buy the Shirt';
      $('shirt-color').disabled = false; $('shirt-size').disabled = false;
    }
  });
  $('shirt-color').addEventListener('change', chooseColor);
  $('shirt-size').addEventListener('change', chooseSize);
  if (new URLSearchParams(location.search).get('checkout') === 'cancelled') notice('Checkout was cancelled. You can choose your shirt and try again when you’re ready.');
  async function catalog() {
    try {
      const response = await fetch(`${base}/api/product`, { signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error('unavailable');
      return await response.json();
    } catch {
      const response = await fetch('assets/shop/product.json', { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      // The saved catalog is display-only. Stale availability must never permit payment.
      data.product.checkoutEnabled = false;
      return data;
    }
  }
  async function load() {
    try {
      const data = await catalog();
      if (!data.available) { $('shop-loading-text').textContent = data.message; return; }
      product = data.product;
      $('product-title').textContent = product.title;
      $('product-description').textContent = product.description;
      $('shipping-note').textContent = product.shipping == null ? 'Shipping and tax shown at checkout.' :
        `${product.shipping === 0 ? 'Free standard shipping' : `${money(product.shipping)} standard shipping`}. ${product.countries.join(', ')} delivery. Tax calculated at checkout.`;
      const colors = [...new Set(product.variants.map(v => v.color))];
      $('shirt-color').replaceChildren(...colors.map(c => option(c, c || 'Available color')));
      $('color-field').hidden = colors.length === 1 && !colors[0];
      const defaultVariant = product.variants.find(v => v.id === product.defaultVariantId);
      if (defaultVariant) $('shirt-color').value = defaultVariant.color;
      chooseColor(); sizeGuide(product.sizeGuide);
      if (product.testMode && product.checkoutEnabled) notice('Preview checkout: payments are in test mode. No shirt will be ordered.');
      $('shop-loading').hidden = true; $('shop-product').hidden = false;
    } catch { $('shop-loading-text').textContent = 'The shop is getting ready. Please check back soon.'; }
  }
  load();
})();
