const {test,expect}=require('@playwright/test');

test.use({baseURL:'http://127.0.0.1:4173',viewport:{width:390,height:844},serviceWorkers:'block'});

test('blocked auth login restores the sign-in form with useful error',async({page})=>{
  await page.clock.install();
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  await page.route('https://fonts.gstatic.com/**',route=>route.abort());
  await page.route('**/vendor/supabase-sdk.js*',route=>route.fulfill({
    status:200,contentType:'application/javascript',
    body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null},error:null}),signInWithPassword:()=>new Promise(()=>{}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}})};'
  }));
  await page.route('**/supabase/auth/v1/health',route=>route.fulfill({status:404,body:'Not found'}));
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeVisible();
  await page.locator('#authEmail').fill('a@teacherpro.test');
  await page.locator('#authPassword').fill('TestPass123');
  await page.locator('#authSubmit').click();
  await page.clock.runFor(12500);
  await expect(page.locator('#authSubmit')).toBeEnabled();
  await expect(page.locator('#authSubmit')).toHaveText('Войти');
  await expect(page.locator('#authError')).toContainText('Сервер авторизации сейчас недоступен');
});
