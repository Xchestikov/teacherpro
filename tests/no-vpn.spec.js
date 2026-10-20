const { test, expect } = require('@playwright/test');

test.use({
  baseURL: 'http://127.0.0.1:4173',
  viewport: { width: 390, height: 844 },
  serviceWorkers: 'block'
});

test('stalled Supabase initialization must reveal an error instead of a blank screen', async ({ page }) => {
  await page.clock.install();
  const sdkRequests = [];
  page.on('request', request => {
    if (request.url().includes('/vendor/supabase-sdk.js')) sdkRequests.push(request.url());
  });
  await page.route('**/vendor/supabase-sdk.js*', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: 'window.supabase={createClient:()=>({auth:{getSession:()=>new Promise(()=>{})}})};'
  }));
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.goto('/');
  await page.clock.runFor(12500);
  await expect(page.locator('#authGate')).toBeVisible();
  await expect(page.locator('#authError')).toContainText('Сервер авторизации не отвечает');
  expect(sdkRequests.length).toBe(1);
});

test('missing local SDK shows a meaningful notice', async ({ page }) => {
  await page.route('**/vendor/supabase-sdk.js*', route => route.abort());
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeVisible();
  await expect(page.locator('#cloudNotice')).toContainText('Не загрузился клиент облачного хранилища');
});
