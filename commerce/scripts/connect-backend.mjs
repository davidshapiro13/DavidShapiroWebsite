// Configure a TEST webhook and transfer secrets through stdin, never command arguments.
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { stripeClient, STRIPE_API_VERSION } from '../src/providers.js';
const backend = 'https://david-shirt-shop.david-shirt-shop.workers.dev';
if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) throw new Error('Test key required');
const stripe = stripeClient(process.env);
try {
  const code = await stripe.taxCodes.retrieve('txcd_30011000');
  console.log(`Verified shirt tax category: ${code.name}`);
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const url = `${backend}/api/stripe/webhook`;
  let endpoint = endpoints.data.find(e => e.url === url && e.status === 'enabled');
  let secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!endpoint) {
    endpoint = await stripe.webhookEndpoints.create({ url, api_version: STRIPE_API_VERSION,
      enabled_events: ['checkout.session.completed', 'checkout.session.async_payment_succeeded'],
      description: 'David shirt shop — test payments only',
    });
    secret = endpoint.secret;
    if (!secret?.startsWith('whsec_')) throw new Error('Webhook did not return a signing secret');
    const path = '.dev.vars';
    const content = await readFile(path, 'utf8');
    const replacement = `STRIPE_WEBHOOK_SECRET=${secret}`;
    const next = /^STRIPE_WEBHOOK_SECRET=.*$/m.test(content) ? content.replace(/^STRIPE_WEBHOOK_SECRET=.*$/m, replacement) : `${content.trimEnd()}\n${replacement}\n`;
    await writeFile(path, next, { mode: 0o600 }); await chmod(path, 0o600);
  }
  if (!secret?.startsWith('whsec_') || secret.includes('replace_me')) throw new Error('Existing webhook requires its saved signing secret');
  console.log('Stripe test webhook configured; signing secret saved privately.');
  const keys = { STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    PRINTIFY_API_TOKEN: process.env.PRINTIFY_API_TOKEN, STRIPE_WEBHOOK_SECRET: secret };
  if (!keys.PRINTIFY_API_TOKEN || keys.PRINTIFY_API_TOKEN === 'replace_me') throw new Error('Printify token missing');
  const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'secret', 'bulk'], { stdio: ['pipe', 'pipe', 'pipe'] });
  // Discard CLI output: do not risk printing any secret-containing provider response.
  child.stdout.resume(); child.stderr.resume();
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify(keys));
  const exitCode = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
  if (exitCode !== 0) throw new Error(`Cloudflare secret upload failed (exit ${exitCode})`);
  console.log('Uploaded the three secret values to Cloudflare. Checkout remains disabled.');
  const settings = await stripe.tax.settings.retrieve();
  console.log(JSON.stringify({ stripeTaxStatus: settings.status, missingFields: settings.status_details?.pending?.missing_fields || [] }));
} catch (e) {
  // Stripe error messages can include submitted data. Report type/code only.
  console.error(JSON.stringify({ setupFailed: true, type: e.type || 'setup_error', code: e.code || null, status: e.statusCode || null }));
  process.exitCode = 1;
}
