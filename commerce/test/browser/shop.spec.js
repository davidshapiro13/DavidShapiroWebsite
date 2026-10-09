import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/shop-config.js*', r => r.fulfill({ contentType: 'text/javascript', body: "window.SHOP_CONFIG = { apiBase: '' };" }));
});

const product = {
  title: 'Test shirt', description: 'A product fixture for checkout testing.', currency: 'usd',
  shipping: 500, countries: ['US'], checkoutEnabled: true, testMode: true,
  images: [{ src: 'https://images.example.test/shirt.svg', variantIds: [] }],
  variants: [
    { id: 10, title: 'Blue / M', color: 'Blue', size: 'M', price: 2500 },
    { id: 11, title: 'Blue / L', color: 'Blue', size: 'L', price: 2700 },
    { id: 12, title: 'White / M', color: 'White', size: 'M', price: 2500 },
  ],
  sizeGuide: { sizes: ['M', 'L'], types: [{ name: 'Width', units: 'in', ranges: [{ from: '20', to: '20' }, { from: '22', to: '22' }] }] },
};
async function setup(page, value = product) {
  await page.route('https://fonts.googleapis.com/**', r => r.abort());
  await page.route('https://images.example.test/**', r => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#f5f9fb"/><text x="300" y="300" text-anchor="middle" font-size="28">Product photo fixture</text></svg>' }));
  await page.route('**/api/product', r => r.fulfill({ json: { available: true, product: value } }));
}
for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
  test(`product selection and checkout at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport); await setup(page);
    let submitted;
    await page.route('**/api/checkout', async route => {
      submitted = route.request().postDataJSON();
      await route.fulfill({ json: { url: 'https://checkout.stripe.com/c/pay/test' } });
    });
    await page.route('https://checkout.stripe.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Stripe checkout fixture</h1>' }));
    await page.goto('/shop.html');
    await expect(page.getByRole('heading', { name: 'Test shirt' })).toBeVisible();
    await expect(page.locator('#shop-notice')).toContainText('test mode');
    await page.getByLabel('Size', { exact: true }).selectOption('11');
    await expect(page.locator('#product-price')).toHaveText('$27.00');
    await page.getByText('Size guide', { exact: true }).click();
    await expect(page.getByRole('table')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `test-results/shop-${viewport.width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Buy the Shirt' }).click();
    await expect(page).toHaveURL('https://checkout.stripe.com/c/pay/test');
    expect(submitted.variantId).toBe(11);
    expect(Object.keys(submitted).sort()).toEqual(['requestId', 'variantId']);
  });
}

test('checkout network failure preserves the request key and allows retry', async ({ page }) => {
  await setup(page); const calls = [];
  await page.route('**/api/checkout', async route => {
    calls.push(route.request().postDataJSON());
    await route.fulfill({ status: 503, json: { error: 'Please try again shortly.' } });
  });
  await page.goto('/shop.html');
  await page.getByRole('button', { name: 'Buy the Shirt' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Please try again shortly.' })).toBeVisible();
  await page.getByRole('button', { name: 'Buy the Shirt' }).click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[0].requestId).toBe(calls[1].requestId);
});

test('unconfigured and sold-out products never offer a working buy button', async ({ page }) => {
  await page.route('**/api/product', r => r.fulfill({ json: { available: false, message: 'The shop is getting ready.' } }));
  await page.goto('/shop.html');
  await expect(page.locator('#shop-loading-text')).toHaveText('The shop is getting ready.');
  await expect(page.getByRole('button', { name: 'Buy the Shirt' })).toBeHidden();
  await page.unroute('**/api/product');
  await setup(page, { ...product, variants: [], checkoutEnabled: false });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Buy the Shirt' })).toBeDisabled();
});

test('cancellation is clear and mobile navigation includes the shop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await setup(page);
  await page.goto('/shop.html?checkout=cancelled');
  // The test mode notice takes precedence; use a live fixture for the cancellation message.
  await page.unroute('**/api/product'); await setup(page, { ...product, testMode: false }); await page.reload();
  await expect(page.locator('#shop-notice')).toContainText('Checkout was cancelled');
  await page.getByRole('button', { name: 'Toggle menu' }).click();
  await expect(page.getByRole('link', { name: 'Shop', exact: true })).toBeVisible();
});

test('confirmation only shows provider-confirmed status and safe tracking links', async ({ page }) => {
  await page.route('**/api/order?*', r => r.fulfill({ json: {
    reference: 'DS-12345678', state: 'submitted', testMode: false,
    tracking: [{ carrier: 'USPS', url: 'https://tools.usps.com/go/TrackConfirmAction' }],
  } }));
  await page.goto('/order.html?session_id=cs_live_abcdefghijklmnopqrstuvwxyz');
  await expect(page.getByRole('heading', { name: 'Thank you for your order' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Track shipment (USPS)' })).toHaveAttribute('rel', 'noopener noreferrer');
  await page.goto('/order.html');
  await expect(page.getByRole('heading', { name: 'Find your order' })).toBeVisible();
});

test('backend unavailable does not claim payment succeeded', async ({ page }) => {
  await page.route('**/api/order?*', r => r.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await page.goto('/order.html?session_id=cs_live_abcdefghijklmnopqrstuvwxyz');
  await expect(page.locator('#order-message')).toContainText('don’t pay again');
  await expect(page.getByRole('heading', { name: 'Thank you for your order' })).toHaveCount(0);
});


test('an offline product snapshot cannot enable checkout', async ({ page }) => {
  await page.route('**/api/product', r => r.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await page.route('**/assets/shop/product.json', r => r.fulfill({ json: { available: true, product } }));
  await page.goto('/shop.html');
  await expect(page.getByRole('heading', { name: 'Test shirt' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buy the Shirt' })).toBeDisabled();
});

test('changing color preserves the selected size when it is available', async ({ page }) => {
  await setup(page);
  await page.goto('/shop.html');
  await page.getByLabel('Size', { exact: true }).selectOption('10');
  await page.getByLabel('Color', { exact: true }).selectOption('White');
  await expect(page.getByLabel('Size', { exact: true })).toHaveValue('12');
});
