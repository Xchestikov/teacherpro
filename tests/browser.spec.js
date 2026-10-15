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
 await page.locator('#modalBody').getByRole('button',{name:'Добавить ученика'}).click();
 await page.evaluate(()=>setPage('clients'));
 await expect(page.locator('#content')).toContainText(name);
 await page.evaluate(()=>syncCloud());
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
 await page.evaluate(()=>setPage('dashboard'));
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

test('Calendar deletion refunds consumed subscription; hour rate persists',async({page})=>{
 const errors=await setup(page);await login(page);
 await addStudent(page,'Проверка удаления','10.11');
 await page.evaluate(()=>openSubscription());
 await page.locator('#sTotal').fill('8');
 await page.locator('#sHourlyRate').fill('1350');
 await page.locator('#modalBody button.primary').click();
 await page.evaluate(()=>openLesson());
 await page.locator('#lTime').fill('09:45');
 await page.locator('#lDuration').selectOption('60');
 await page.locator('#lHourlyRate').fill('1350');
 await page.locator('#lStatus').selectOption('done');
 await page.locator('#modalBody button.primary').click();
 await expect.poll(()=>page.evaluate(()=>db.subscriptions[0].remaining)).toBe(7);
 await page.evaluate(()=>openLessonByKey(db.lessons[0].id));
 await expect(page.locator('#modalBody [data-lesson-id]')).toHaveCount(2);
 page.once('dialog',dialog=>dialog.accept());
 await page.locator('#modalBody button[data-lesson-id]').first().click();
 await expect.poll(()=>page.evaluate(()=>db.lessons.length)).toBe(0);
 await expect.poll(()=>page.evaluate(()=>db.subscriptions[0].remaining)).toBe(8);
 expect(errors).toEqual([]);
});
test('Calendar event visual duration follows 30, 60, 90 minute lessons',async({page})=>{
 const errors=await setup(page);await login(page);await addStudent(page,'Проверка длительности','15.12');
 await page.evaluate(()=>{
  const day=todayISO();
  db.lessons=[
   {id:'duration30',clientId:db.clients[0].id,date:day,time:'08:00',duration:30,status:'planned',hourlyRate:1000},
   {id:'duration60',clientId:db.clients[0].id,date:day,time:'10:00',duration:60,status:'planned',hourlyRate:1000},
   {id:'duration90',clientId:db.clients[0].id,date:day,time:'12:00',duration:90,status:'planned',hourlyRate:1000}
  ];
  calendarMode='day';calendarSelectedDate=day;setPage('schedule');
 });
 const heights=await page.evaluate(()=>['duration30','duration60','duration90'].map(id=>{
  const element=document.querySelector('.calendar-event[data-lesson-id="'+id+'"]');
  const cell=element.closest('.calendar-cell');
  return {height:element.getBoundingClientRect().height,slot:cell.getBoundingClientRect().height};
 }));
 expect(heights[0].height/heights[0].slot).toBeGreaterThan(.4);
 expect(heights[0].height/heights[0].slot).toBeLessThan(.6);
 expect(heights[1].height/heights[1].slot).toBeGreaterThan(.9);
 expect(heights[1].height/heights[1].slot).toBeLessThan(1.05);
 expect(heights[2].height/heights[2].slot).toBeGreaterThan(1.35);
 expect(heights[2].height/heights[2].slot).toBeLessThan(1.55);
 expect(errors).toEqual([]);
});
test('Refresh restores session without showing auth gate',async({page})=>{
 const errors=await setup(page);await login(page);await addStudent(page,'После перезагрузки','07.07');
 await page.reload();
 await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>setPage('clients'));
 await expect(page.locator('#content')).toContainText('После перезагрузки');
 expect(errors).toEqual([]);
});

test('Subscription rate is calculated from the package total; changing lesson count keeps the total',async({page})=>{
 const errors=await setup(page);await login(page);
 await addStudent(page,'Ставка Авто','10.11');
 await page.evaluate(()=>openSubscription());
 await page.locator('#sPrice').fill('9600');
 await expect(page.locator('#sHourlyRate')).toHaveValue('1200');
 await page.locator('#sTotal').fill('12');
 await expect(page.locator('#sPrice')).toHaveValue('9600');
 await expect(page.locator('#sHourlyRate')).toHaveValue('800');
 await expect(page.locator('#sRemain')).toHaveValue('12');
 await page.locator('#sHourlyRate').fill('900');
 await expect(page.locator('#sPrice')).toHaveValue('10800');
 await page.locator('#modalBody button.primary').click();
 const data=await page.evaluate(()=>({price:db.subscriptions[0].price,total:db.subscriptions[0].total,remaining:db.subscriptions[0].remaining,hourlyRate:db.subscriptions[0].hourlyRate}));
 expect(data).toEqual({price:10800,total:12,remaining:12,hourlyRate:900});
 await page.evaluate(()=>openLesson());
 await expect(page.locator('#lHourlyRate')).toHaveValue('900');
 expect(errors).toEqual([]);
});
test('Session restore never reveals login gate while a session exists',async({page})=>{
 const errors=await setup(page);await login(page);
 await page.reload();
 await expect(page.locator('#authGate')).toBeHidden();
 await expect(page.locator('body')).not.toHaveClass(/teacherpro-loading/);
 expect(errors).toEqual([]);
});


test('Two-hour event is visible across both hour cells, with usable actions',async({page})=>{
  const errors=await setup(page);
  await login(page);
  await addStudent(page,'Проверка двух часов','15.12');
  await page.setViewportSize({width:1280,height:900});
  await page.evaluate(()=>{
    const day=todayISO();
    db.lessons=[{id:'two-hour-lesson',clientId:db.clients[0].id,date:day,time:'10:00',duration:120,status:'planned',hourlyRate:1000}];
    calendarMode='day';
    calendarSelectedDate=day;
    setPage('schedule');
  });
  const metrics=await page.evaluate(()=>{
    const event=document.querySelector('.calendar-event[data-lesson-id="two-hour-lesson"]');
    const cell=event.closest('.calendar-cell');
    const rect=event.getBoundingClientRect();
    const slot=cell.getBoundingClientRect();
    const hit=document.elementFromPoint(rect.left+rect.width/2,slot.top+slot.height*1.5);
    return {durationRatio:rect.height/slot.height,hitId:hit?.closest('.calendar-event')?.dataset.lessonId||''};
  });
  expect(metrics.durationRatio).toBeGreaterThan(1.9);
  expect(metrics.durationRatio).toBeLessThan(2.1);
  expect(metrics.hitId).toBe('two-hour-lesson');
  await page.locator('.calendar-event[data-lesson-id="two-hour-lesson"]').click({button:'right'});
  await expect(page.locator('.lesson-quick-menu')).toBeVisible();
  await expect(page.locator('.lesson-quick-menu')).toContainText('Редактировать');
  await expect(page.locator('.lesson-quick-menu')).toContainText('Удалить');
  await page.keyboard.press('Escape');
  await expect(page.locator('.lesson-quick-menu')).toBeHidden();
  expect(errors).toEqual([]);
});

test('Deleting a consumed lesson asks before refunding and respects cancellation',async({page})=>{
  const errors=await setup(page);await login(page);
  await addStudent(page,'Проверка подтверждения','15.12');
  await page.evaluate(()=>{
    const student=db.clients[0];
    db.subscriptions=[{id:'sub-refund',clientId:student.id,total:8,remaining:7,price:8000,paymentStatus:'paid',status:'active'}];
    db.lessons=[{id:'charged-refund',clientId:student.id,date:todayISO(),time:'11:00',duration:60,status:'done',consumedSubscriptionId:'sub-refund'}];
    setPage('schedule');
  });
  const lesson=page.locator('.calendar-event[data-lesson-id="charged-refund"]');
  await page.evaluate(()=>openLessonByKey('charged-refund'));
  page.once('dialog',dialog=>{
    expect(dialog.message()).toContain('вернётся в остаток');
    return dialog.dismiss();
  });
  await page.locator('#modalBody button[data-lesson-id]').first().click();
  expect(await page.evaluate(()=>({count:db.lessons.length,remaining:db.subscriptions[0].remaining}))).toEqual({count:1,remaining:7});
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#modalBody button[data-lesson-id]').first().click();
  expect(await page.evaluate(()=>({count:db.lessons.length,remaining:db.subscriptions[0].remaining}))).toEqual({count:0,remaining:8});
  expect(errors).toEqual([]);
});


test('Soft Editorial uses real workload data and presents actions on mobile',async({page})=>{
 const errors=await setup(page);await login(page);
 await addStudent(page,'Тестовая София','09.08');
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{
   const d=todayISO();
   db.settings.name='Елена';
   db.lessons=[
     {id:'se-completed',date:d,time:'08:00',duration:60,status:'done',clientId:db.clients[0].id},
     {id:'se-planned',date:d,time:'16:00',duration:60,status:'planned',clientId:db.clients[0].id}
   ];
   setPage('dashboard');
 });
 await expect(page.locator('body')).toHaveClass(/soft-editorial/);
 await expect(page.locator('.se-greeting h2')).toContainText('Елена');
 await expect(page.locator('.se-overview .se-card')).toHaveCount(2);
 await expect(page.locator('.se-hero')).toContainText('16:00');
 await expect(page.locator('.se-donut')).toHaveAttribute('aria-label',/50 процентов/);
 await expect(page.locator('.se-actions button')).toHaveCount(4);
 await expect(page.locator('.se-week-bar')).toHaveCount(7);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(2);
 await page.screenshot({path:'test-results/studio-mobile-390-dashboard.png',fullPage:true});
 await page.setViewportSize({width:1280,height:900});
 await page.evaluate(()=>setPage('dashboard'));
 await page.screenshot({path:'test-results/studio-desktop-1280-dashboard.png',fullPage:true});
 expect(errors).toEqual([]);
});

test('Soft Editorial calendar quick actions, month grid and day navigation',async({page})=>{
 const errors=await setup(page);await login(page);
 await addStudent(page,'Месячный урок','15.12');
 await page.setViewportSize({width:1280,height:900});
 await page.evaluate(()=>{
   const day=todayISO();
   db.lessons=[{id:'se-menu-event',clientId:db.clients[0].id,date:day,time:'10:00',duration:120,status:'planned'}];
   calendarMode='day';calendarSelectedDate=day;setPage('schedule');
 });
 await expect(page.locator('.calendar-grid-day')).toBeVisible();
 await page.locator('.calendar-event[data-lesson-id="se-menu-event"]').click();
 await expect(page.locator('.lesson-quick-menu')).toBeVisible();
 await expect(page.locator('#modal')).not.toHaveClass(/open/);
 await page.locator('.lesson-quick-menu [data-action="edit"]').click();
 await expect(page.locator('#modal')).toHaveClass(/open/);
 await page.locator('#modalClose').click();
 await page.evaluate(()=>calendarSetMode('month'));
 await expect(page.locator('.se-month-grid .se-month-day')).toHaveCount(42);
 const target=page.locator('.se-month-day.is-today');
 await target.click();
 await expect(page.locator('.calendar-grid-day')).toBeVisible();
 await page.screenshot({path:'test-results/studio-desktop-calendar.png',fullPage:true});
 await page.evaluate(()=>{
   calendarSetMode('week');
   const monday=new Date(todayISO()+'T12:00:00');
   monday.setDate(monday.getDate()-(monday.getDay()+6)%7);
   const d=new Date(monday);d.setDate(d.getDate()+1);
   db.lessons.push({id:'se-second',clientId:db.clients[0].id,date:localDateISO(d),time:'14:00',duration:90,status:'planned'});
   setPage('schedule');
 });
 await page.screenshot({path:'test-results/studio-desktop-week-calendar.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>calendarSetMode('day'));
 await page.screenshot({path:'test-results/studio-mobile-day-calendar.png',fullPage:true});
 expect(errors).toEqual([]);
});
