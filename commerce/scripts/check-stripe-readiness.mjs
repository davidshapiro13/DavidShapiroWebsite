// Read-only check. Never print credentials, address values, or provider error bodies.
import { stripeClient } from '../src/providers.js';
if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) throw new Error('Test key required');
try {
  const stripe = stripeClient(process.env);
  const settings = await stripe.tax.settings.retrieve();
  console.log(JSON.stringify({ status: settings.status, missingFields: settings.status_details?.pending?.missing_fields || [] }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, type: error.type || 'request_failed', code: error.code || null, status: error.statusCode || null }));
  process.exitCode = 1;
}
