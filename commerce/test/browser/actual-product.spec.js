import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
const snapshot = new URL('../../.local/deployed-product.json', import.meta.url);
for (const width of [390, 1440]) {
  test(`actual Reading Bunny product at ${width}px`, async ({ page }) => {
    test.skip(!existsSync(snapshot), 'Run the read-only deployed-backend verification to capture current product data.');
    const data = JSON.parse(readFileSync(snapshot, 'utf8'));
    await page.setViewportSize({ width, height: 1000 });
    await page.route('**/shop-config.js*', r => r.fulfill({ contentType: 'text/javascript', body: "window.SHOP_CONFIG = { apiBase: '' };" }));
    await page.route('**/api/product', r => r.fulfill({ json: data }));
    await page.goto('/shop.html');
    await expect(page.getByRole('heading', { name: data.product.title })).toBeVisible();
    await expect(page.locator('#product-price')).toHaveText('$20.00');
    await expect(page.locator('#shipping-note')).toContainText('$4.95');
    await expect(page.getByRole('button', { name: 'Buy the Shirt' })).toBeDisabled();
    expect(await page.locator('#shirt-size option').allTextContents()).toEqual(['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']);
    expect(await page.locator('#shirt-color option').count()).toBe(4);
    await expect.poll(() => page.locator('#product-image').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/reading-bunny-${width}.png`, fullPage: true });
  });
}
