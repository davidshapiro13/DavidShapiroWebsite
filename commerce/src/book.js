export const BOOK_ID = 'campus-life-book';
export const BOOK_TITLE = 'The Old College Try — The Complete Campus Life Collection';

export function bookConfig(env) {
  const live = env.PAYMENT_MODE === 'live';
  const origin = new URL(env.SITE_ORIGIN);
  if (origin.origin !== env.SITE_ORIGIN || (origin.protocol !== 'https:' && origin.hostname !== 'localhost') ||
      !['live', 'test'].includes(env.PAYMENT_MODE) ||
      !(live ? /^(sk|rk)_live_/ : /^(sk|rk)_test_/).test(env.STRIPE_SECRET_KEY || '') ||
      !env.DB || !env.STRIPE_WEBHOOK_SECRET || env.BOOK_CHECKOUT_ENABLED !== 'true' ||
      !env.RESEND_API_KEY || !env.BOOK_ORDER_EMAIL || !env.BOOK_EMAIL_FROM ||
      !/^txcd_\d+$/.test(env.BOOK_TAX_CODE || '') ||
      !['true', 'false'].includes(env.AUTOMATIC_TAX)) throw new Error('Book checkout unavailable');
  const shipping = Number(env.BOOK_SHIPPING_CENTS);
  const countries = (env.BOOK_SHIPPING_COUNTRIES || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!/^\d+$/.test(env.BOOK_SHIPPING_CENTS || '') || !Number.isSafeInteger(shipping) || shipping !== 0 ||
      !countries.length || countries.some(c => !/^[A-Z]{2}$/.test(c))) throw new Error('Book shipping unavailable');
  return { live, shipping, countries };
}

export async function emailBookOrder(env, order, session, address) {
  const shipping = session.shipping_details || session.collected_information?.shipping_details;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json',
      'Idempotency-Key': `book-order-${order.id}` },
    body: JSON.stringify({
      from: env.BOOK_EMAIL_FROM, to: [env.BOOK_ORDER_EMAIL],
      subject: `Paid book order — DS-${order.id.slice(0, 8).toUpperCase()}`,
      text: [
        'Please order and mail one copy of:', BOOK_TITLE,
        `Order reference: DS-${order.id.slice(0, 8).toUpperCase()}`,
        `Stripe session: ${session.id}`,
        `Paid: $${(session.amount_total / 100).toFixed(2)} USD (book: $20.00)`,
        '', `Name: ${shipping.name}`, `Email: ${address.email}`, 'Mailing address:',
        address.address1, address.address2, `${address.city}, ${address.region} ${address.zip}`, address.country,
      ].filter(Boolean).join('\n'),
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok || !(await response.json()).id) throw new Error('book_email_failed');
}
