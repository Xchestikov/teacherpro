const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const mock=fs.readFileSync(path.join(__dirname,'mock-supabase.js'),'utf8');
test.use({baseURL:'http://127.0.0.1:4173',serviceWorkers:'block'});
test('Switching billing mode preserves historical charges',async({page})=>{
 await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',r=>r.fulfill({status:200,contentType:'application/javascript',body:'/* mock */'}));
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());
 await page.route('https://fonts.gstatic.com/**',r=>r.abort());
 await page.addInitScript({content:mock});
 await page.goto('/');
 await page.locator('#authEmail').fill('a@teacherpro.test');
 await page.locator('#authPassword').fill('DemoPass123');
 await page.locator('#authSubmit').click();
 await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>openClient());
 await page.locator('#fName').fill('Ретро');
 await page.locator('#modalBody').getByRole('button',{name:'Добавить ученика'}).click();
 await page.evaluate(()=>{
  const id=db.clients[0].id;
  db.lessons=[{id:'old',clientId:id,date:'2026-01-10',time:'10:00',duration:60,hourlyRate:1500,status:'done'},
   {id:'future',clientId:id,date:todayISO(),time:'11:00',duration:60,hourlyRate:1000,status:'planned'}];
  db.payments=[{id:'receipt',clientId:id,status:'paid',amount:1500,date:'2026-01-10',type:'single'}];
  openClient(id,'overview');
 });
 await page.locator('#fBillingMode').selectOption('per_lesson');
 await page.locator('#fLessonRate').fill('1700');
 await page.getByRole('button',{name:'Сохранить профиль'}).click();
 expect(await page.evaluate(()=>tpLessonBalance(db.clients[0].id).due)).toBe(0);
 expect(await page.evaluate(()=>db.lessons[0].billingMode||null)).toBe(null);
 expect(await page.evaluate(()=>db.lessons[1].billingMode)).toBe('per_lesson');
});
