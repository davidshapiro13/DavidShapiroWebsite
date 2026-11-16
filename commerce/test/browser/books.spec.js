import { test, expect } from '@playwright/test';

test('each book opens checkout with its own product and total', async ({ page }) => {
  await page.route('**/api/product', route => route.fulfill({ json: { available: false } }));
  await page.route('**/api/book?*', route => {
    const id = new URL(route.request().url()).searchParams.get('product');
    return route.fulfill({ json: { checkoutEnabled: true, live: true, countries: ['US'],
      product: { id, price: id === 'kylo-kangaroo-book' ? 1600 : 2000 } } });
  });
  const purchases = [];
  await page.route('**/api/checkout', route => {
    purchases.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, json: { error: 'Checkout test complete' } });
  });
  await page.goto('/shop.html');
  for (const [id, price] of [['campus-life-book', '20'], ['kylo-kangaroo-book', '16']]) {
    const card = page.locator(`#${id}`);
    await expect(card.locator('[data-book-shipping]')).toContainText(`$${price}.00 total. Shipping and any applicable tax included. US delivery.`);
    await card.getByRole('button', { name: 'Buy the Book' }).click();
    await expect(card.getByRole('status')).toHaveText('Checkout test complete');
    expect(purchases.at(-1).product).toBe(id);
  }
  expect(purchases[0].requestId).not.toBe(purchases[1].requestId);
});
