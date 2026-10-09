export function paymentMatches(order, session) {
  return session.mode === 'payment' && session.status === 'complete' && session.payment_status === 'paid' &&
    session.metadata?.order_id === order.id && session.client_reference_id === order.id &&
    (!order.stripe_session_id || session.id === order.stripe_session_id) &&
    session.currency === order.currency && session.amount_subtotal === order.unit_amount &&
    session.total_details?.amount_shipping === order.shipping_amount &&
    (session.total_details?.amount_discount || 0) === 0 &&
    session.amount_total === order.unit_amount + order.shipping_amount + (session.total_details?.amount_tax || 0) &&
    session.livemode === Boolean(order.live);
}

export function shippingAddress(session, order) {
  const shipping = session.shipping_details || session.collected_information?.shipping_details;
  const address = shipping?.address;
  const name = shipping?.name?.trim();
  const email = session.customer_details?.email;
  if (!name || !email || !address?.line1 || !address.city || !address.postal_code ||
      !order.countries.split(',').includes(address.country) || (address.country === 'US' && !address.state)) {
    throw new Error('invalid_shipping');
  }
  const [firstName, ...rest] = name.split(/\s+/);
  return {
    first_name: firstName, last_name: rest.join(' ') || firstName,
    email, phone: session.customer_details?.phone || '',
    country: address.country, region: address.state || '',
    address1: address.line1, address2: address.line2 || '', city: address.city, zip: address.postal_code,
  };
}

export async function fulfill(id, { store, stripe, printify, env }) {
  const order = await store.claim(id);
  if (!order) return;
  const finish = fields => store.update(id, { lease_until: 0, ...fields });
  try {
    // Retrieve from Stripe afresh; never trust a browser redirect as proof of payment.
    const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id, { expand: ['payment_intent.latest_charge'] });
    if (!paymentMatches(order, session)) {
      await finish({ state: 'needs_review', error_code: 'payment_mismatch' });
      return;
    }
    const charge = session.payment_intent?.latest_charge;
    if (!charge || typeof charge !== 'object' || charge.refunded || charge.amount_refunded > 0 || charge.disputed) {
      await finish({ state: 'needs_review', error_code: 'payment_review' });
      return;
    }
    // Printify has no sandbox. A Stripe test payment NEVER creates a Printify order.
    if (!order.live) {
      await finish({ state: 'test_complete', error_code: null });
      return;
    }
    if (env.PAYMENT_MODE !== 'live' || env.FULFILLMENT_ENABLED !== 'true') {
      await finish({ state: 'retry', error_code: 'fulfillment_disabled', next_attempt: Date.now() + 300000 });
      return;
    }
    if (['submitting', 'reconciling'].includes(order.state)) {
      const existing = await printify.findOrder(order.shop_id, order.id);
      await finish(existing?.id
        ? { state: 'submitted', printify_order_id: existing.id, error_code: null }
        : { state: 'needs_review', error_code: 'submission_uncertain' });
      return;
    }
    let address;
    try { address = shippingAddress(session, order); }
    catch {
      await finish({ state: 'needs_review', error_code: 'invalid_shipping' });
      return;
    }
    // Write intent BEFORE the remote call. A crash/timeout only permits reconciliation,
    // never a blind second POST that could print and bill for the same shirt twice.
    await store.update(id, { state: 'submitting' });
    try {
      const result = await printify.createOrder(order, address);
      if (!result.id) throw new Error('invalid_response');
      await finish({ state: 'submitted', printify_order_id: result.id, error_code: null });
    } catch {
      await finish({ state: 'reconciling', error_code: 'submission_uncertain', next_attempt: Date.now() + 300000 });
    }
  } catch {
    // Persist only an internal code, never a provider response, address, or email.
    const current = await store.get(id);
    await finish({
      state: order.attempts >= 8 ? 'needs_review' :
        (['submitting', 'reconciling'].includes(current.state) ? 'reconciling' : 'retry'),
      error_code: 'provider_unavailable',
      next_attempt: Date.now() + Math.min(3600000, 300000 * 2 ** Math.min(order.attempts, 4)),
    });
  }
}
