const {test,expect}=require('@playwright/test');

test.use({baseURL:'http://127.0.0.1:4173',serviceWorkers:'block'});

for (const [label,width,height] of [['desktop',1440,900],['mobile',390,844],['small-mobile',320,700]]) {
  test('Landing: '+label+' layout, navigation, conversion links and assets',async({page})=>{
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.setViewportSize({width,height});
    await page.route('https://fonts.googleapis.com/**',route=>route.abort());
    await page.route('https://fonts.gstatic.com/**',route=>route.abort());
    await page.goto('/landing/');
    await expect(page).toHaveTitle(/TeacherPro/);
    await expect(page.getByRole('heading',{level:1})).toContainText('Больше времени');
    await expect(page.locator('.preview-window')).toBeVisible();
    await expect(page.locator('.mock-disclaimer')).toContainText('данные условные');
    await expect(page.locator('.feature-card')).toHaveCount(4);
    await expect(page.getByRole('link',{name:/Начать работу/}).first()).toHaveAttribute('href','../');
    await expect(page.locator('.preview-brand img')).toHaveJSProperty('complete',true);
    const logoLoaded=await page.locator('.preview-brand img').evaluate(img=>img.naturalWidth>0);
    expect(logoLoaded).toBe(true);
    if (width<941) {
      await page.locator('.mobile-nav summary').click();
      await expect(page.locator('.mobile-menu-panel').getByRole('link',{name:'Возможности'})).toBeVisible();
      await page.locator('.mobile-nav summary').click();
    }
    await page.locator('.faqs details').first().locator('summary').click();
    await expect(page.locator('.faqs details').first()).toHaveAttribute('open','');
    const hasOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+2);
    expect(hasOverflow).toBe(false);
    expect(errors).toEqual([]);
    await page.screenshot({path:'test-results/landing-'+label+'.png',fullPage:true});
  });
}
