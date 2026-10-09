(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const base = (window.SHOP_CONFIG?.apiBase || '').replace(/\/$/, '');
  const session = new URLSearchParams(location.search).get('session_id');
  let polls = 0, timer, busy = false;
  const messages = {
    checkout: ['Confirming your payment', 'Your payment confirmation is on its way. This page will update shortly.'],
    paid: ['Thank you for your order', 'Payment received. We’re preparing your shirt order.'],
    retry: ['Thank you for your order', 'Payment received. Your order is still being processed; there’s no need to pay again.'],
    submitting: ['Thank you for your order', 'Payment received. We’re sending your shirt order to the printer.'],
    reconciling: ['We’re checking your order', 'Payment received. We’re confirming the printing request; please don’t place the order again.'],
    needs_review: ['Your order needs a check', 'Payment received, but your order needs attention before we can confirm fulfillment. Please contact David with the reference below.'],
    cancelled: ['Order closed', 'This order has been closed. Please contact David if you have questions about its refund or cancellation.'],
    submitted: ['Thank you for your order', 'Your shirt order has been received by Printify. Check back here for shipment tracking.'],
    test_complete: ['Test checkout complete', 'The test payment worked. No real payment was collected and no shirt was ordered.'],
  };
  async function refresh() {
    if (busy) return;
    clearTimeout(timer);
    if (!session || !/^cs_(test|live)_[A-Za-z0-9]{10,240}$/.test(session)) {
      $('order-title').textContent = 'Find your order';
      $('order-message').textContent = 'Open the confirmation link from your checkout, or contact David for help.';
      $('order-refresh').hidden = true; return;
    }
    busy = true; $('order-refresh').disabled = true;
    try {
      const response = await fetch(`${base}/api/order?session_id=${encodeURIComponent(session)}`, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      const [title, message] = messages[data.state] || messages.retry;
      $('order-title').textContent = title; $('order-message').textContent = message;
      $('order-reference').textContent = `Order reference: ${data.reference}`; $('order-reference').hidden = false;
      $('order-tracking').replaceChildren();
      if (data.fulfillmentStatus === 'canceled') {
        $('order-title').textContent = 'Printing order cancelled';
        $('order-message').textContent = 'Please contact David for the status of your order and any refund.';
      }
      for (const tracking of data.tracking || []) {
        const url = new URL(tracking.url);
        if (url.protocol !== 'https:') continue;
        const p = document.createElement('p'), link = document.createElement('a');
        link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.textContent = `Track shipment${tracking.carrier ? ` (${tracking.carrier})` : ''}`;
        p.append(link); $('order-tracking').append(p);
      }
      if (['checkout', 'paid', 'retry', 'submitting', 'reconciling'].includes(data.state) && polls++ < 12) timer = setTimeout(refresh, 5000);
    } catch {
      $('order-title').textContent = 'Checking your order';
      $('order-message').textContent = 'We can’t load the latest status yet. Please refresh in a moment. If you completed payment, don’t pay again.';
      if (polls++ < 6) timer = setTimeout(refresh, 5000);
    } finally { busy = false; $('order-refresh').disabled = false; }
  }
  $('order-refresh').addEventListener('click', refresh);
  refresh();
})();
