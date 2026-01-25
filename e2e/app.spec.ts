import { test, expect } from '@playwright/test';

test.describe('App', () => {
  test('loads successfully', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to load (check for any rendered content)
    await expect(page.locator('body')).not.toBeEmpty();
  });
});
