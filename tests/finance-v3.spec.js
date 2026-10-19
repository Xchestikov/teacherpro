const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const mock=fs.readFileSync(path.join(__dirname,'mock-supabase.js'),'utf8');
test.use({baseURL:'http://127.0.0.1:4173',viewport:{width:1280,height:900},serviceWorkers:'block'});
async function setup(page){
 await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',r=>r.fulfill({status:200,contentType:'application/javascript',body:'/* mock */'}));
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());
 await page.route('https://fonts.gstatic.com/**',r=>r.abort());
 await page.addInitScript({content:mock});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');
 await page.locator('#authEmail').fill('a@teacherpro.test');
 await page.locator('#authPassword').fill('DemoPass123');
 await page.locator('#authSubmit').click();
 await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>openClient());
 await page.locator('#fName').fill('Тест Финансы');
 await page.locator('#modalBody').getByRole('button',{name:'Добавить ученика'}).click();
 return errors;
}
test('Pay-per-lesson charges conducted sessions and one receipt settles multiple lessons',async({page})=>{
 const errors=await setup(page);
 await page.evaluate(()=>openClient(db.clients[0].id,'overview'));
 await page.locator('#fBillingMode').selectOption('per_lesson');
 await page.locator('#fLessonRate').fill('1500');
 await page.locator('#fLessonDuration').fill('60');
 await page.getByRole('button',{name:'Сохранить профиль'}).click();
 await page.evaluate(()=>openLesson());
 await expect(page.locator('#lHourlyRate')).toHaveValue('1500');
 await page.locator('#lTime').fill('09:00');
 await page.locator('#lStatus').selectOption('done');
 await page.locator('#modalBody button.primary').click();
 await expect.poll(()=>page.evaluate(()=>tpLessonBalance(db.clients[0].id).due)).toBe(150000);
 await page.evaluate(()=>openLesson());
 await page.locator('#lTime').fill('11:00');
 await page.locator('#lStatus').selectOption('done');
 await page.locator('#modalBody button.primary').click();
 await expect.poll(()=>page.evaluate(()=>tpLessonBalance(db.clients[0].id).due)).toBe(300000);
 expect(await page.evaluate(()=>db.subscriptions.length)).toBe(0);
 await page.evaluate(()=>setPage('payments'));
 await expect(page.locator('.finance-cards .stat')).toHaveCount(4);
 await expect(page.locator('.tp-accrual-row')).toContainText('3 000');
 await page.evaluate(()=>openPayment(db.clients[0].id));
 await expect(page.locator('#pAmount')).toHaveValue('3000.00');
 await page.locator('#modalBody button.primary').click();
 expect(await page.evaluate(()=>tpLessonBalance(db.clients[0].id).due)).toBe(0);
 expect(await page.evaluate(()=>db.payments.filter(p=>p.financeV3Lesson).length)).toBe(1);
 expect(errors).toEqual([]);
});


test('Fixed lesson price stays 1000 for 80 minutes, with pending not overdue debt',async({page})=>{
 const errors=await setup(page);
 await page.evaluate(()=>openClient(db.clients[0].id,'overview'));
 await page.locator('#fBillingMode').selectOption('per_lesson');
 await page.locator('#fPriceUnit').selectOption('lesson');
 await page.locator('#fLessonRate').fill('1000');
 await page.locator('#fLessonDuration').fill('80');
 await page.getByRole('button',{name:'Сохранить профиль'}).click();
 await page.evaluate(()=>openLesson());
 await expect(page.locator('#lDuration')).toHaveValue('80');
 await expect(page.locator('#lPriceUnit')).toHaveValue('lesson');
 await expect(page.locator('#lessonRatePreview')).toContainText('1 000');
 await page.locator('#lTime').fill('09:00');
 await page.locator('#lStatus').selectOption('done');
 await page.locator('#modalBody button.primary').click();
 const result=await page.evaluate(()=>({
   cents:tpLessonBalance(db.clients[0].id).earned,
   due:tpLessonBalance(db.clients[0].id).due,
   unit:db.lessons[0].priceUnit
 }));
 expect(result).toEqual({cents:100000,due:100000,unit:'lesson'});
 await page.evaluate(()=>{const d=new Date(todayISO()+'T12:00:00');d.setDate(d.getDate()-6);db.lessons[0].date=localDateISO(d);setPage('payments');});
 await expect(page.locator('.tp-accrual-row')).toContainText('1 000');
 await expect(page.locator('.tp-accrual-row')).toContainText('Ожидает оплаты');
 await expect(page.locator('.tp-accrual-row')).not.toContainText('Просрочено');
 expect(errors).toEqual([]);
});

test('Hourly mode remains proportional and old receipts require explicit allocation',async({page})=>{
 const errors=await setup(page);
 await page.evaluate(()=>openClient(db.clients[0].id,'overview'));
 await page.locator('#fBillingMode').selectOption('per_lesson');
 await page.locator('#fPriceUnit').selectOption('hour');
 await page.locator('#fLessonRate').fill('1000');
 await page.locator('#fLessonDuration').fill('80');
 await page.getByRole('button',{name:'Сохранить профиль'}).click();
 await page.evaluate(()=>openLesson());
 await expect(page.locator('#lPriceUnit')).toHaveValue('hour');
 await expect(page.locator('#lessonRatePreview')).toContainText('1 333,33');
 await page.locator('#lTime').fill('09:00');
 await page.locator('#lStatus').selectOption('done');
 await page.locator('#modalBody button.primary').click();
 expect(await page.evaluate(()=>tpLessonBalance(db.clients[0].id).earned)).toBe(133333);
 await page.evaluate(()=>{
   db.payments.push({id:'old-receipt',clientId:db.clients[0].id,
     type:'single',amount:1000,status:'paid',date:todayISO(),paidAt:todayISO()});
   setPage('payments');
 });
 expect(await page.evaluate(()=>tpLessonBalance(db.clients[0].id).due)).toBe(133333);
 await page.locator('#paymentRows').getByRole('button',{name:'Зачесть за занятия'}).click();
 expect(await page.evaluate(()=>tpLessonBalance(db.clients[0].id).due)).toBe(33333);
 expect(await page.evaluate(()=>db.payments.filter(p=>p.financeV3Lesson).length)).toBe(1);
 expect(await page.evaluate(()=>db.paymentChanges.at(-1).kind)).toBe('allocate');
 expect(errors).toEqual([]);
});

test('Old hourly lesson remains unchanged until teacher explicitly corrects its price',async({page})=>{
 const errors=await setup(page);
 await page.evaluate(()=>{
   db.clients[0].billingMode='per_lesson';
   db.clients[0].hourlyRate=1000;
   db.clients[0].priceUnit='lesson';
   db.lessons.push({id:'old-bill',clientId:db.clients[0].id,date:todayISO(),
     time:'09:00',duration:80,status:'done',billingMode:'per_lesson',hourlyRate:1000});
 });
 expect(await page.evaluate(()=>tpLessonBalance(db.clients[0].id).due)).toBe(133333);
 await page.evaluate(()=>openLesson('old-bill'));
 await expect(page.locator('#lDuration')).toHaveValue('80');
 await expect(page.locator('#lPriceUnit')).toHaveValue('hour');
 await page.locator('#lPriceUnit').selectOption('lesson');
 await expect(page.locator('#lessonRatePreview')).toContainText('1 000');
 await page.locator('#modalBody button.primary').click();
 expect(await page.evaluate(()=>tpLessonBalance(db.clients[0].id).due)).toBe(100000);
 expect(await page.evaluate(()=>db.paymentChanges.at(-1).kind)).toBe('lesson_price');
 expect(await page.evaluate(()=>db.payments.length)).toBe(0);
 expect(errors).toEqual([]);
});

test('Subscription lessons and unlinked receipts are never silently reclassified',async({page})=>{
 const errors=await setup(page);
 const report=await page.evaluate(()=>{
   const id=db.clients[0].id;
   db.clients[0].billingMode='per_lesson';
   db.lessons=[{id:'sub-paid',clientId:id,date:todayISO(),time:'09:00',
     status:'done',billingMode:'subscription',duration:80,hourlyRate:1000,priceUnit:'lesson'}];
   db.payments=[{id:'sub-payment',clientId:id,type:'subscription',subscriptionId:'linked-package',
     amount:1000,status:'paid',date:todayISO()}];
   return tpLessonBalance(id);
 });
 expect(report.earned).toBe(0);
 expect(report.paid).toBe(0);
 expect(report.due).toBe(0);
 expect(await page.evaluate(()=>tpCreditLegacyPayment('sub-payment'))).toBe(false);
 expect(errors).toEqual([]);
});
