const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const mock=fs.readFileSync(path.join(__dirname,'mock-supabase.js'),'utf8');
test.use({baseURL:'http://127.0.0.1:4173',viewport:{width:390,height:844},serviceWorkers:'block'});
async function setup(page){
 await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',route=>route.fulfill({status:200,contentType:'application/javascript',body:'/* Supabase SDK mocked by audit script */'}));
 await page.route('https://fonts.googleapis.com/**',route=>route.abort());
 await page.route('https://fonts.gstatic.com/**',route=>route.abort());
 await page.addInitScript({content:mock});
 const issues=[];page.on('pageerror',e=>issues.push(e.message));
 await page.goto('/');
 await expect(page.locator('#authGate')).toBeVisible();
 return issues;
}
async function login(page,email='a@teacherpro.test'){
 await page.locator('#authEmail').fill(email);
 await page.locator('#authPassword').fill('DemoPass123');
 await page.locator('#authSubmit').click();
 await expect(page.locator('#authGate')).toBeHidden();
}
async function addStudent(page,name,birthday){
 await page.locator('#addBtn').click();
 await page.locator('#fName').fill(name);
 await page.locator('#fBirthday').fill(birthday);
 await page.getByRole('button',{name:'Добавить ученика'}).click();
 await expect(page.locator('#content')).toContainText(name);
}
test('Account flows: authentication, distinct student data, logout/login, backup state',async({page})=>{
 const errors=await setup(page);
 await login(page);
 await addStudent(page,'Ученица Альфа','14.10');
 await expect(page.locator('#content')).toContainText('Ученица Альфа');
 await page.evaluate(()=>signOutCloud());
 await expect(page.locator('#authGate')).toBeVisible();
 await login(page,'b@teacherpro.test');
 await expect(page.locator('#content')).not.toContainText('Ученица Альфа');
 await addStudent(page,'Ученик Бета','05.05.2011');
 await page.evaluate(()=>signOutCloud());
 await login(page);
 await expect(page.locator('#content')).toContainText('Ученица Альфа');
 await expect(page.locator('#content')).not.toContainText('Ученик Бета');
 expect(errors).toEqual([]);
});
test('Real clicks: payments, calendar, birthdays and appearance selection',async({page})=>{
 const errors=await setup(page);await login(page);
 const nextDay=new Date();nextDay.setDate(nextDay.getDate()+1);
 const bday=String(nextDay.getDate()).padStart(2,'0')+'.'+String(nextDay.getMonth()+1).padStart(2,'0');
 await addStudent(page,'Екатерина Тестовая',bday);
 await expect(page.locator('.birthday-widget')).toContainText('Екатерина Тестовая');
 await page.locator('#mobileSettingsBtn').click();
 await page.locator('.background-choice[data-background-id="marble"]').click();
 await expect(page.locator('body')).toHaveAttribute('data-background','marble');
 await page.locator('.theme-choice[data-theme-id="wine"]').click();
 await expect(page.locator('body')).toHaveAttribute('data-theme','wine');
 await page.evaluate(()=>setPage('schedule'));
 await expect(page.locator('.calendar-grid')).toBeVisible();
 await page.evaluate(()=>openSubscription());
 await page.locator('#sTotal').fill('8');
 await page.locator('#sRemain').fill('8');
 await page.locator('#sPrice').fill('7200');
 await page.locator('#modalBody button.primary').click();
 await page.evaluate(()=>openLesson());
 await page.locator('#lTime').fill('09:45');
 await page.locator('#lStatus').selectOption('done');
 await page.locator('#modalBody button.primary').click();
 const accounting=await page.evaluate(()=>({remaining:db.subscriptions[0]?.remaining,lessonTime:db.lessons[0]?.time,lessonStatus:db.lessons[0]?.status}));
 expect(accounting).toEqual({remaining:7,lessonTime:'09:45',lessonStatus:'done'});
 expect(errors).toEqual([]);
});
for(const width of [320,360,390,768,1280]){
 test('Visual and responsive '+width+'px',async({page})=>{
  const errors=await setup(page);await login(page);
  await addStudent(page,'Мария Демонстрационная','21.12');
  await page.setViewportSize({width,height:844});
  for(const [section,change] of [['dashboard',()=>page.evaluate(()=>setPage('dashboard'))],['schedule',()=>page.evaluate(()=>{calendarMode='day';setPage('schedule')})],['clients',()=>page.evaluate(()=>setPage('clients'))],['subscriptions',()=>page.evaluate(()=>setPage('subscriptions'))],['payments',()=>page.evaluate(()=>setPage('payments'))],['settings',()=>page.evaluate(()=>setPage('settings'))]]){
   await change();
   await expect(page.locator('#content')).toBeVisible();
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
   expect(overflow,section+' has document-level horizontal overflow').toBeLessThanOrEqual(2);
   await page.screenshot({path:'test-results/'+width+'-'+section+'.png',fullPage:true});
  }
  expect(errors).toEqual([]);
 });
}
