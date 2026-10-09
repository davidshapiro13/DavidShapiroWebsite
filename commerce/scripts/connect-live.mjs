// Live setup only: never creates a payment, customer, or Printify order.
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { stripeClient, STRIPE_API_VERSION } from '../src/providers.js';
const base = 'https://david-shirt-shop.david-shirt-shop.workers.dev';
const key = process.env.STRIPE_LIVE_SECRET_KEY?.trim();
if (!/^(sk|rk)_live_/.test(key || '')) throw new Error('Live server key required');
const stripe = stripeClient({ STRIPE_SECRET_KEY: key });
try {
  const account = await stripe.accounts.retrieve();
  const tax = await stripe.tax.settings.retrieve();
  console.log(JSON.stringify({ chargesEnabled: account.charges_enabled, payoutsEnabled: account.payouts_enabled, taxStatus: tax.status, missingFields: tax.status_details?.pending?.missing_fields || [] }));
  if (!account.charges_enabled || !account.payouts_enabled || tax.status !== 'active') throw new Error('Live account not ready');
  const catalog = await (await fetch(`${base}/api/product`)).json();
  if (catalog.product?.checkoutEnabled !== false) throw new Error('Close checkout before changing credentials');
  const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  if (config.vars.CHECKOUT_ENABLED !== 'false' || config.vars.FULFILLMENT_ENABLED !== 'false') throw new Error('Local enable flags must be false during setup');
  const events = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  let endpoint = endpoints.data.find(e => e.url === `${base}/api/stripe/webhook` && e.status === 'enabled');
  let secret = process.env.STRIPE_LIVE_WEBHOOK_SECRET;
  if (!endpoint) {
    endpoint = await stripe.webhookEndpoints.create({ url: `${base}/api/stripe/webhook`, api_version: STRIPE_API_VERSION, enabled_events: events, description: 'David shirt shop — live payments' });
    secret = endpoint.secret;
    if (!secret?.startsWith('whsec_')) throw new Error('Missing webhook signing secret');
    const content = await readFile('.dev.vars', 'utf8');
    const replacement = `STRIPE_LIVE_WEBHOOK_SECRET=${secret}`;
    await writeFile('.dev.vars', /^STRIPE_LIVE_WEBHOOK_SECRET=.*$/m.test(content) ? content.replace(/^STRIPE_LIVE_WEBHOOK_SECRET=.*$/m, replacement) : `${content.trimEnd()}\n${replacement}\n`, { mode: 0o600 });
    await chmod('.dev.vars', 0o600);
  }
  if (!secret?.startsWith('whsec_') || endpoint.api_version !== STRIPE_API_VERSION || !events.every(e => endpoint.enabled_events.includes(e) || endpoint.enabled_events.includes('*'))) throw new Error('Live webhook requires matching saved secret and event configuration');
  console.log('Live webhook ready; its signing secret is saved privately.');
  if (process.argv.includes('--connect')) {
    const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'secret', 'bulk'], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.resume(); child.stderr.resume(); child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: secret, PRINTIFY_API_TOKEN: process.env.PRINTIFY_API_TOKEN }));
    const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
    if (code !== 0) throw new Error('Secret upload failed');
    console.log('Live credentials uploaded. Checkout remains closed until live mode and enable flags are deployed.');
  }
} catch (error) {
  console.error(JSON.stringify({ setupFailed: true, type: error.type || 'setup_error', code: error.code || null, status: error.statusCode || null }));
  process.exitCode = 1;
}
