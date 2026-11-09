(() => {
  'use strict';
  const button = document.getElementById('buy-book');
  const message = document.getElementById('book-message');
  const base = (window.SHOP_CONFIG?.apiBase || '').replace(/\/$/, '');
  let attempt, busy = false, enabled = false;
  fetch(`${base}/api/book`, { signal: AbortSignal.timeout(20000) })
    .then(response => { if (!response.ok) throw new Error(); return response.json(); })
    .then(data => {
      enabled = data.checkoutEnabled === true;
      button.disabled = !enabled;
      message.textContent = enabled ? (data.live ? '' : 'Test checkout: no real book order will be placed.') : 'Book orders are not open yet. Please check back soon.';
      if (enabled) document.getElementById('book-shipping').textContent =
        `$20 total. Shipping and any applicable tax included. ${data.countries.join(', ')} delivery.`;
    }).catch(() => { message.textContent = 'Book checkout is temporarily unavailable. Please try again later.'; });
  document.getElementById('book-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!enabled || busy) return;
    busy = true; button.disabled = true; message.textContent = 'Opening secure checkout…';
    attempt ||= crypto.randomUUID();
    try {
      const response = await fetch(`${base}/api/checkout`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: attempt, product: 'campus-life-book' }),
        signal: AbortSignal.timeout(60000),
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
      message.textContent = ['TypeError', 'TimeoutError'].includes(error.name) ? 'Unable to connect. Please try again.' : error.message;
      busy = false; button.disabled = false;
    }
  });
})();
