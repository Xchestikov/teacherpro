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
test('Real clicks: payments, calendar, birthdays and locked style',async({page})=>{
 const errors=await setup(page);await login(page);
 const nextDay=new Date();nextDay.setDate(nextDay.getDate()+1);
 const bday=String(nextDay.getDate()).padStart(2,'0')+'.'+String(nextDay.getMonth()+1).padStart(2,'0');
 await addStudent(page,'Екатерина Тестовая',bday);
 await page.evaluate(()=>setPage('dashboard'));
 await expect(page.locator('.birthday-widget')).toContainText('Екатерина Тестовая');
 await page.locator('#mobileSettingsBtn').click();
 await expect(page.locator('.background-choice')).toHaveCount(0);
 await expect(page.locator('.theme-choice')).toHaveCount(0);
 await expect(page.locator('body')).toHaveAttribute('data-background','plain');
 await expect(page.locator('body')).toHaveAttribute('data-theme','peach');
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
 await page.locator('#modalBody button[data-lesson-id]').first().click();
 await expect.poll(()=>page.evaluate(()=>db.lessons.find(l=>l.status==='deleted')?.status)).toBe('deleted');
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
  await page.locator('.calendar-event[data-lesson-id="two-hour-lesson"]').scrollIntoViewIfNeeded();
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
  await expect(page.locator('.lesson-quick-menu')).toContainText('Запланирован');
  await expect(page.locator('.lesson-quick-menu')).toContainText('Удалить');
  await page.keyboard.press('Escape');
  await expect(page.locator('.lesson-quick-menu')).toBeHidden();
  expect(errors).toEqual([]);
});

test('Deleting a consumed lesson refunds automatically without confirmation and keeps a deleted calendar marker',async({page})=>{
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
  const dialogs=[];page.on('dialog',d=>{dialogs.push(d.type());d.dismiss();});
  await page.locator('#modalBody button[data-lesson-id]').first().click();
  expect(await page.evaluate(()=>({count:db.lessons.length,remaining:db.subscriptions[0].remaining,status:db.lessons[0].status})))
    .toEqual({count:1,remaining:8,status:'deleted'});
  await expect(page.locator('.calendar-event[data-lesson-id="charged-refund"] .tp-lesson-mark')).toHaveText('×');
  expect(dialogs).toEqual([]);
  expect(errors).toEqual([]);
});


test('Soft Editorial uses real workload data and presents actions on mobile',async({page})=>{
 const errors=await setup(page);await login(page);
 await addStudent(page,'Тестовая София','09.08');
 await page.clock.install({time:new Date('2026-10-15T12:00:00')});
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
 await page.locator('.calendar-event[data-lesson-id="se-menu-event"] .tp-event-more').click();
 await expect(page.locator('.lesson-quick-menu')).toBeVisible();
 await expect(page.locator('.lesson-quick-menu')).toContainText('Отменён со списанием');
 await expect(page.locator('#modal')).not.toHaveClass(/open/);
 await page.keyboard.press('Escape');
 await page.locator('.calendar-event[data-lesson-id="se-menu-event"]').click({position:{x:30,y:30}});
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


test('Lesson menu status transitions charge only once and refund safely',async({page})=>{
 const errors=await setup(page);await login(page);
 await addStudent(page,'Статус Тест','15.12');
 await page.evaluate(()=>{
   db.subscriptions=[{id:'test-status-sub',clientId:db.clients[0].id,name:'8 занятий',total:8,remaining:8,price:8000,paymentStatus:'paid',status:'active'}];
   db.lessons=[{id:'status-demo',clientId:db.clients[0].id,date:todayISO(),time:'15:00',duration:60,status:'planned',hourlyRate:1000}];
   calendarMode='day';calendarSelectedDate=todayISO();setPage('schedule');
 });
 page.on('dialog',dialog=>dialog.accept());
 await page.locator('.calendar-event[data-lesson-id="status-demo"] .tp-event-more').click();
 await page.locator('.lesson-quick-menu [data-action="status:done"]').click();
 expect(await page.evaluate(()=>({remaining:db.subscriptions[0].remaining,status:db.lessons[0].status}))).toEqual({remaining:7,status:'done'});
 await page.locator('.calendar-event[data-lesson-id="status-demo"] .tp-event-more').click();
 await page.locator('.lesson-quick-menu [data-action="status:cancelled_charged"]').click();
 expect(await page.evaluate(()=>({remaining:db.subscriptions[0].remaining,status:db.lessons[0].status}))).toEqual({remaining:7,status:'cancelled_charged'});
 await expect(page.locator('.calendar-event[data-lesson-id="status-demo"]')).toHaveClass(/event-cancelled/);
 await page.locator('.calendar-event[data-lesson-id="status-demo"] .tp-event-more').click();
 await page.locator('.lesson-quick-menu [data-action="status:cancelled"]').click();
 expect(await page.evaluate(()=>({remaining:db.subscriptions[0].remaining,status:db.lessons[0].status}))).toEqual({remaining:8,status:'cancelled'});
 await page.locator('.calendar-event[data-lesson-id="status-demo"] .tp-event-more').click();
 await page.locator('.lesson-quick-menu [data-action="status:no_show_charged"]').click();
 expect(await page.evaluate(()=>({remaining:db.subscriptions[0].remaining,status:db.lessons[0].status}))).toEqual({remaining:7,status:'no_show_charged'});
 expect(errors).toEqual([]);
});

test('Teacher profile accepts compressed photo and preserves it after refresh',async({page})=>{
 const errors=await setup(page);await login(page);
 await page.evaluate(()=>setPage('settings'));
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XOncAAAAASUVORK5CYII=','base64');
 await page.locator('.tp-avatar-upload input[type=file]').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:png});
 await expect.poll(()=>page.evaluate(()=>db.settings.avatarDataUrl?.startsWith('data:image/jpeg;base64,'))).toBe(true);
 await expect(page.locator('.top-actions .avatar img')).toHaveCount(1);
 await page.evaluate(()=>syncCloud());
 await page.reload();
 await expect(page.locator('.top-actions .avatar img')).toHaveCount(1);
 await page.evaluate(()=>setPage('settings'));
 await page.getByRole('button',{name:'Удалить фото'}).click();
 await expect(page.locator('.top-actions .avatar img')).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('Current-time marker and cancelled card rendering',async({page})=>{
 const errors=await setup(page);await login(page);
 await page.clock.install({time:new Date('2026-10-15T12:30:00')});
 await addStudent(page,'Для календаря','15.12');
 await page.evaluate(()=>{
   db.lessons=[{id:'cancel-event',clientId:db.clients[0].id,date:todayISO(),time:'13:00',duration:60,status:'cancelled_by_teacher'}];
   calendarMode='day';calendarSelectedDate=todayISO();setPage('schedule');
 });
 await expect(page.locator('.tp-now-indicator')).toHaveCount(1);
 await expect(page.locator('.tp-now-clock')).toContainText('12:30');
 await expect(page.locator('.calendar-event[data-lesson-id="cancel-event"]')).toHaveClass(/event-cancelled/);
 expect(errors).toEqual([]);
});


test('Calendar V2 assigns side-by-side lanes to lessons starting in different hours',async({page})=>{
 const errors=await setup(page);await login(page);
 await addStudent(page,'Пересечения В2','08.07');
 await page.setViewportSize({width:1280,height:900});
 await page.evaluate(()=>{
   const date=todayISO(),id=db.clients[0].id;
   db.lessons=[
     {id:'lane-a',clientId:id,date,time:'10:00',duration:120,status:'planned',hourlyRate:1000},
     {id:'lane-b',clientId:id,date,time:'11:00',duration:60,status:'planned',hourlyRate:1000},
     {id:'lane-c',clientId:id,date,time:'12:00',duration:60,status:'planned',hourlyRate:1000}
   ];
   calendarMode='day';calendarSelectedDate=date;setPage('schedule');
 });
 await page.locator('[data-lesson-id="lane-a"]').scrollIntoViewIfNeeded();
 const layout=await page.evaluate(()=>{
   const a=document.querySelector('[data-lesson-id="lane-a"]'),b=document.querySelector('[data-lesson-id="lane-b"]'),c=document.querySelector('[data-lesson-id="lane-c"]');
   const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();
   const secondHourY=br.top+br.height/2;
   const longLessonHit=document.elementFromPoint(ar.left+ar.width/2,secondHourY)?.closest('.calendar-event')?.dataset.lessonId||'';
   return {a:a.dataset.laneCount,b:b.dataset.laneCount,c:c.dataset.laneCount,separated:ar.right<br.left+8||br.right<ar.left+8,longLessonHit};
 });
 expect(layout).toEqual({a:'2',b:'2',c:'1',separated:true,longLessonHit:'lane-a'});
 await page.screenshot({path:'test-results/calendar-v2-overlapping-hours.png',fullPage:true});
 expect(errors).toEqual([]);
});

test('Calendar V2 keyboard resize changes duration and undo restores previous value',async({page})=>{
 const errors=await setup(page);await login(page);
 await addStudent(page,'Длительность В2','08.07');
 await page.evaluate(()=>{
   db.lessons=[{id:'resize-v2',clientId:db.clients[0].id,date:todayISO(),time:'10:00',duration:60,status:'planned',hourlyRate:1000}];
   calendarMode='day';calendarSelectedDate=todayISO();setPage('schedule');
 });
 page.on('dialog',dialog=>dialog.accept());
 const grip=page.locator('[data-lesson-id="resize-v2"] .cv2-resize-handle');
 await expect(grip).toBeVisible();
 await grip.focus();await page.keyboard.press('ArrowDown');
 expect(await page.evaluate(()=>db.lessons[0].duration)).toBe(75);
 await expect(page.locator('.cv2-toast')).toContainText('75 мин.');
 await page.locator('.cv2-toast').getByRole('button',{name:'Отменить'}).click();
 expect(await page.evaluate(()=>db.lessons[0].duration)).toBe(60);
 await page.evaluate(()=>openLessonByKey('resize-v2'));
 await expect(page.locator('#lDuration')).toHaveValue('60');
 await page.locator('#modalClose').click();
 expect(errors).toEqual([]);
});

test('Calendar V2 cancelled filter affects day and month without mutating lesson data',async({page})=>{
 const errors=await setup(page);await login(page);
 await addStudent(page,'Отмена В2','08.07');
 await page.evaluate(()=>{
   db.lessons=[{id:'cancel-v2',clientId:db.clients[0].id,date:todayISO(),time:'10:00',duration:60,status:'cancelled_by_teacher'},
     {id:'planned-v2',clientId:db.clients[0].id,date:todayISO(),time:'12:00',duration:60,status:'planned'}];
   calendarMode='day';calendarSelectedDate=todayISO();setPage('schedule');
 });
 await expect(page.locator('.calendar-event')).toHaveCount(2);
 await page.locator('.cv2-filter').click();
 await expect(page.locator('.calendar-event')).toHaveCount(1);
 await expect(page.locator('.cv2-filter')).toHaveAttribute('aria-pressed','false');
 await page.evaluate(()=>calendarSetMode('month'));
 await expect(page.locator('.se-month-day.is-today')).toContainText('1 занятие');
 await page.locator('.cv2-filter').click();
 await expect(page.locator('.se-month-day.is-today')).toContainText('2 занятия');
 expect(await page.evaluate(()=>db.lessons.length)).toBe(2);
 expect(errors).toEqual([]);
});

test('Calendar V2 moving lessons has an accessible undo and mobile layout',async({page})=>{
 const errors=await setup(page);await login(page);
 await addStudent(page,'Перенос В2','08.07');
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{
   db.lessons=[{id:'move-v2',clientId:db.clients[0].id,date:todayISO(),time:'10:00',duration:60,status:'planned'}];
   calendarMode='day';calendarSelectedDate=todayISO();setPage('schedule');
 });
 page.on('dialog',dialog=>dialog.accept());
 const changed=await page.evaluate(()=>window.tpCalendarMove(db.lessons[0],todayISO(),'11:15'));
 expect(changed).toBe(true);
 expect(await page.evaluate(()=>db.lessons[0].time)).toBe('11:15');
 await expect(page.locator('.cv2-toast')).toContainText('11:15');
 await page.locator('.cv2-toast').getByRole('button',{name:'Отменить'}).click();
 expect(await page.evaluate(()=>db.lessons[0].time)).toBe('10:00');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(2);
 await page.screenshot({path:'test-results/calendar-v2-mobile-day.png',fullPage:true});
 await page.setViewportSize({width:1280,height:900});
 await page.evaluate(()=>{calendarMode='week';weekOffset=0;setPage('schedule');});
 await page.screenshot({path:'test-results/calendar-v2-desktop-week.png',fullPage:true});
 expect(errors).toEqual([]);
});


test('Calendar V2 pointer resize grip extends event height in 15-minute steps',async({page})=>{
 const errors=await setup(page);await login(page);
 await addStudent(page,'Перетягивание В2','08.07');
 await page.setViewportSize({width:1280,height:900});
 await page.evaluate(()=>{
   db.lessons=[{id:'grip-v2',clientId:db.clients[0].id,date:todayISO(),time:'10:00',duration:60,status:'planned',hourlyRate:1000}];
   calendarMode='day';calendarSelectedDate=todayISO();setPage('schedule');
 });
 page.on('dialog',dialog=>dialog.accept());
 const grip=page.locator('.calendar-event[data-lesson-id="grip-v2"] .cv2-resize-handle');
 await grip.scrollIntoViewIfNeeded();
 const box=await grip.boundingBox();
 expect(box).toBeTruthy();
 const x=box.x+box.width/2,y=box.y+box.height/2;
 await page.mouse.move(x,y);
 await page.mouse.down();
 await page.mouse.move(x,y+42,{steps:8});
 await page.mouse.up();
 expect(await page.evaluate(()=>db.lessons[0].duration)).toBe(90);
 await expect(page.locator('.cv2-toast')).toContainText('90 мин.');
 await page.locator('.cv2-toast').getByRole('button',{name:'Отменить'}).click();
 expect(await page.evaluate(()=>db.lessons[0].duration)).toBe(60);
 expect(errors).toEqual([]);
});


test('Partial subscription payments split a single invoice without double-counting debt',async({page})=>{
 const errors=await setup(page);await login(page);await addStudent(page,'Финансы Тест','12.09');
 await page.evaluate(()=>openSubscription());
 await page.locator('#sPrice').fill('8000');
 await page.locator('#sPaymentStatus').selectOption('pending');
 await page.locator('#modalBody button.primary').click();
 const subId=await page.evaluate(()=>db.subscriptions[0].id);
 await page.evaluate(()=>setPage('subscriptions'));
 await expect(page.locator('.tp-finance-balance')).toContainText('8 000');
 page.on('dialog',dialog=>dialog.accept());
 await page.evaluate(id=>tpSubscriptionPayment(id),subId);
 await page.locator('#tpPartialAmount').fill('2500.25');
 await page.locator('#modalBody button.primary').click();
 let state=await page.evaluate(()=>({
   status:db.subscriptions[0].paymentStatus,
   invoice:db.payments.filter(p=>p.status==='pending').map(p=>p.amount),
   received:db.payments.filter(p=>p.status==='paid').map(p=>p.amount)
 }));
 expect(state).toEqual({status:'pending',invoice:[5499.75],received:[2500.25]});
 await page.evaluate(()=>openSubscription(db.subscriptions[0].id));
 await page.locator('#sPrice').fill('9000');
 await page.locator('#modalBody button.primary').click();
 expect(await page.evaluate(()=>db.subscriptions[0].price)).toBe(8000);
 await page.locator('#modalClose').click();
 await page.evaluate(id=>tpSubscriptionPayment(id),subId);
 await page.locator('#tpPartialAmount').fill('5499.75');
 await page.locator('#modalBody button.primary').click();
 state=await page.evaluate(()=>({
   status:db.subscriptions[0].paymentStatus,
   invoices:db.payments.filter(p=>p.status==='pending').length,
   total:db.payments.filter(p=>p.status==='paid').reduce((n,p)=>n+Math.round(p.amount*100),0)/100
 }));
 expect(state).toEqual({status:'paid',invoices:0,total:8000});
 await page.evaluate(()=>setPage('payments'));
 await expect(page.locator('#paymentRows tr')).toHaveCount(2);
 const paymentId=await page.evaluate(()=>db.payments[0].id);
 await page.evaluate(id=>togglePaymentStatus(id),paymentId);
 expect(await page.evaluate(()=>db.payments[0].status)).toBe('paid');
 expect(errors).toEqual([]);
});

test('Subscription debit and refund history reflects only successful transitions',async({page})=>{
 const errors=await setup(page);await login(page);await addStudent(page,'История Абонемента','12.09');
 await page.evaluate(()=>{
   const id=db.clients[0].id;
   db.subscriptions=[{id:'history-sub',clientId:id,name:'8 занятий',total:8,remaining:8,price:8000,paymentStatus:'paid',status:'active'}];
   db.lessons=[{id:'history-lesson',clientId:id,date:todayISO(),time:'13:00',duration:60,status:'planned'}];
   setPage('schedule');
 });
 page.on('dialog',dialog=>dialog.accept());
 await page.evaluate(()=>tpUpdateLessonStatus('history-lesson','done'));
 expect(await page.evaluate(()=>db.subscriptions[0].remaining)).toBe(7);
 expect(await page.evaluate(()=>db.subscriptionHistory.map(x=>x.action))).toEqual(['debit']);
 await page.evaluate(()=>tpUpdateLessonStatus('history-lesson','cancelled'));
 expect(await page.evaluate(()=>db.subscriptions[0].remaining)).toBe(8);
 expect(await page.evaluate(()=>db.subscriptionHistory.map(x=>x.action))).toEqual(['debit','refund']);
 await page.evaluate(()=>tpUpdateLessonStatus('history-lesson','cancelled'));
 expect(await page.evaluate(()=>db.subscriptionHistory.length)).toBe(2);
 await page.evaluate(()=>tpSubscriptionHistory('history-sub'));
 await expect(page.locator('#modalBody')).toContainText('Списано занятие');
 await expect(page.locator('#modalBody')).toContainText('Возврат занятия');
 expect(errors).toEqual([]);
});

test('Renewal alert appears only when the paid subscription is running low',async({page})=>{
 const errors=await setup(page);await login(page);await addStudent(page,'Продление Тест','12.09');
 await page.evaluate(()=>{
   db.subscriptions=[{id:'soon-renew',clientId:db.clients[0].id,name:'8 занятий',total:8,remaining:2,price:8000,paymentStatus:'paid',startDate:todayISO(),status:'active'}];
   setPage('dashboard');
 });
 await expect(page.locator('.tp-home-attention')).toContainText('Осталось 2');
 await page.locator('.tp-home-attention button').click();
 await expect(page.locator('#modalTitle')).toContainText('Продление');
 await expect(page.locator('#sTotal')).toHaveValue('8');
 await page.locator('#modalClose').click();
 await page.evaluate(()=>setPage('subscriptions'));
 await expect(page.locator('.tp-finance-attention')).toContainText('Скоро понадобится продление');
 expect(errors).toEqual([]);
});

test('Financial history survives account reload without recreating payments',async({page})=>{
 const errors=await setup(page);await login(page);
 await addStudent(page,'Финансы Сохранение','12.09');
 await page.evaluate(()=>{
   db.subscriptionHistory=[{id:'history-preserved',action:'refund',at:new Date().toISOString(),subscriptionId:'stored',lessonId:'lesson',clientId:db.clients[0].id}];
   save();
 });
 await page.evaluate(()=>syncCloud());
 await page.reload();
 await expect.poll(()=>page.evaluate(()=>db.subscriptionHistory?.length)).toBe(1);
 expect(errors).toEqual([]);
});


test('Series planner creates one group across months and skips holidays',async({page})=>{
 const issues=await setup(page);await login(page);await addStudent(page,'Серия проверка','12.04');
 page.on('dialog',dialog=>dialog.accept());
 await page.evaluate(()=>{
   const tomorrow=new Date(todayISO()+'T12:00:00');tomorrow.setDate(tomorrow.getDate()+1);
   const first=localDateISO(tomorrow),second=new Date(tomorrow);second.setDate(second.getDate()+7);
   db.scheduleBreaks=[{id:'leave-test',start:localDateISO(second),end:localDateISO(second),reason:'Каникулы'}];
   openLesson(null,first,'10:00');
 });
 await page.locator('#lRecurrence').selectOption('weekly');
 await expect(page.locator('#lWeeks')).toHaveCount(0);
 await page.locator('#modalBody .primary').last().click();
 const stats=await page.evaluate(()=>({
   count:db.lessons.length,series:[...new Set(db.lessons.map(l=>l.seriesId))].length,
   skipped:db.scheduleBreaks.some(b=>db.lessons.some(l=>l.date===b.start)),
   planned:db.lessons.every(l=>l.status==='planned')
 }));
 expect(stats).toEqual({count:51,series:1,skipped:false,planned:true});
 await page.evaluate(()=>{setPage('schedule');tpOpenSeriesManager();});
 await expect(page.locator('#modalBody')).toContainText('Регулярные занятия');
 expect(issues).toEqual([]);
});

test('Series batch edit changes only future planned lessons and rejects conflicting updates atomically',async({page})=>{
 const issues=await setup(page);await login(page);await addStudent(page,'Перенос серии','12.04');
 page.on('dialog',dialog=>dialog.accept());
 await page.evaluate(()=>{
   const d=todayISO(),id=db.clients[0].id;
   const dates=[0,7,14].map(n=>{const x=new Date(d+'T12:00:00');x.setDate(x.getDate()+n);return localDateISO(x)});
   db.lessons=[
    {id:'series-old',clientId:id,date:dates[0],time:'10:00',duration:60,status:'done',seriesId:'group-test',recurrence:'weekly'},
    {id:'series-next',clientId:id,date:dates[1],time:'10:00',duration:60,status:'planned',seriesId:'group-test',recurrence:'weekly'},
    {id:'series-last',clientId:id,date:dates[2],time:'10:00',duration:60,status:'planned',seriesId:'group-test',recurrence:'weekly'}];
   setPage('schedule');tpEditSeries('group-test');
 });
 await page.locator('#s4NewTime').fill('11:00');
 await page.locator('#s4Duration').selectOption('90');
 await page.locator('#modalBody button.primary').click();
 const results=await page.evaluate(()=>db.lessons.map(l=>[l.id,l.time,l.duration,l.status]));
 expect(results).toEqual([['series-old','10:00',60,'done'],['series-next','11:00',90,'planned'],['series-last','11:00',90,'planned']]);
 await page.evaluate(()=>{
   db.lessons.push({id:'outside',clientId:db.clients[0].id,date:db.lessons[1].date,time:'12:00',duration:60,status:'planned'});
   tpEditSeries('group-test');
 });
 await page.locator('#s4NewTime').fill('12:00');
 await page.locator('#modalBody button.primary').click();
 expect(await page.evaluate(()=>db.lessons.find(l=>l.id==='series-next').time)).toBe('11:00');
 expect(issues).toEqual([]);
});

test('Adding leave can cancel only planned lessons and does not affect completed debits',async({page})=>{
 const issues=await setup(page);await login(page);await addStudent(page,'Каникулы','12.04');
 page.on('dialog',dialog=>dialog.accept());
 await page.evaluate(()=>{
   db.lessons=[
    {id:'lesson-done',clientId:db.clients[0].id,date:todayISO(),time:'09:00',duration:60,status:'done'},
    {id:'lesson-future',clientId:db.clients[0].id,date:todayISO(),time:'13:00',duration:60,status:'planned'}];
   setPage('schedule');tpOpenSeriesManager();
 });
 await page.locator('#s4BreakReason').fill('Отпуск');
 await page.locator('#modalBody').getByRole('button',{name:'Добавить период'}).click();
 expect(await page.evaluate(()=>db.lessons.map(l=>l.status))).toEqual(['done','cancelled_by_teacher']);
 expect(await page.evaluate(()=>db.scheduleBreaks.length)).toBe(1);
 expect(issues).toEqual([]);
});

test('Series management and recurring lesson form work at 390px without overflow',async({page})=>{
 const issues=await setup(page);await login(page);await addStudent(page,'Телефон серия','12.04');
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>setPage('schedule'));
 await page.locator('.s4-manager-btn').click();
 await expect(page.locator('#modalBody')).toContainText('Каникулы и отпуск');
 await expect(page.locator('#s4BreakStart')).toBeVisible();
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
 expect(overflow).toBeLessThanOrEqual(2);
 expect(issues).toEqual([]);
});


test('Student Profile V2 saves manual progress and shows the real completed counts',async({page})=>{
 const errors=await setup(page);await login(page);await addStudent(page,'Прогресс ученика','09.09');
 await page.evaluate(()=>{
  const id=db.clients[0].id;
  db.lessons=[{id:'s5-done',clientId:id,date:todayISO(),time:'11:00',duration:60,status:'done'}];
  db.homework=[{id:'s5-home',clientId:id,title:'Задание',description:'Текст',status:'done'}];
  openClient(id,'overview');
 });
 await expect(page.locator('.s5-student-banner')).toContainText('Прогресс ученика');
 await expect(page.locator('.s5-progress')).toContainText('1 / 1');
 await page.locator('#s5ProgressRange').fill('75');
 await page.locator('#s5ProgressNote').fill('Решает задачи самостоятельно');
 await page.getByRole('button',{name:'Сохранить прогресс'}).click();
 expect(await page.evaluate(()=>({value:db.clients[0].progressPercent,note:db.clients[0].progressNote})))
   .toEqual({value:75,note:'Решает задачи самостоятельно'});
 await page.evaluate(()=>syncCloud());await page.reload();
 await page.evaluate(()=>openClient(db.clients[0].id,'overview'));
 await expect(page.locator('#s5ProgressRange')).toHaveValue('75');
 expect(errors).toEqual([]);
});

test('Student Profile V2 stores and removes a compressed student photo',async({page})=>{
 const errors=await setup(page);await login(page);await addStudent(page,'Фото ученика','09.09');
 await page.evaluate(()=>openClient(db.clients[0].id,'overview'));
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XOncAAAAASUVORK5CYII=','base64');
 await page.locator('.s5-upload input[type=file]').setInputFiles({name:'student.png',mimeType:'image/png',buffer:png});
 await expect(page.locator('.s5-avatar-photo')).toHaveCount(1);
 expect(await page.evaluate(()=>db.clients[0].avatarDataUrl?.startsWith('data:image/jpeg;base64,'))).toBe(true);
 await page.getByRole('button',{name:'Удалить фото'}).click();
 await expect(page.locator('.s5-avatar-photo')).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('Reusable homework templates fill a new assignment and survive save',async({page})=>{
 const errors=await setup(page);await login(page);await addStudent(page,'Шаблоны ученика','09.09');
 await page.evaluate(()=>tpTemplatesManager(db.clients[0].id));
 await page.locator('#s5TemplateTitle').fill('Чтение');
 await page.locator('#s5TemplateText').fill('Прочитать главу и ответить на вопросы.');
 await page.locator('#modalBody').getByRole('button',{name:'Сохранить шаблон'}).click();
 expect(await page.evaluate(()=>db.homeworkTemplates.length)).toBe(1);
 await page.locator('.s5-template').getByRole('button',{name:'Использовать'}).click();
 await expect(page.locator('#hwTitle')).toHaveValue('Чтение');
 await expect(page.locator('#hwDescription')).toHaveValue('Прочитать главу и ответить на вопросы.');
 await page.locator('#modalBody').getByRole('button',{name:'Сохранить задание'}).click();
 expect(await page.evaluate(()=>db.homework.some(h=>h.title==='Чтение'))).toBe(true);
 expect(errors).toEqual([]);
});

test('Lesson notes are editable and the profile opens a student-filtered calendar',async({page})=>{
 const errors=await setup(page);await login(page);await addStudent(page,'Заметка к уроку','09.09');
 await page.evaluate(()=>{openLesson(null,todayISO(),'17:00');});
 await page.locator('#s5LessonTeacherNote').fill('Отработали условные предложения');
 await page.locator('#modalBody button.primary').last().click();
 const lessonId=await page.evaluate(()=>db.lessons.at(-1)?.id);
 expect(await page.evaluate(()=>db.lessons.at(-1)?.teacherNote)).toBe('Отработали условные предложения');
 await page.evaluate(id=>openLessonByKey(id),lessonId);
 await expect(page.locator('#s5LessonTeacherNote')).toHaveValue('Отработали условные предложения');
 await page.locator('#modalClose').click();
 await page.evaluate(()=>openClient(db.clients[0].id,'overview'));
 await page.getByRole('button',{name:'Открыть расписание ученика'}).click();
 expect(await page.evaluate(()=>({page,filter:calendarClientFilter}))).toMatchObject({filter:String(await page.evaluate(()=>db.clients[0].id))});
 await expect(page.locator('.calendar-top')).toBeVisible();
 expect(errors).toEqual([]);
});


test('Mobile V2 students: compact cards, searchable list and three-dot actions',async({page})=>{
 const errors=await setup(page);await login(page);
 await addStudent(page,'Карточка один','04.05');
 await addStudent(page,'Карточка два','05.05');
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>setPage('clients'));
 await expect(page.locator('.tp-mobile-clients .tp-mobile-record:visible')).toHaveCount(2);
 await expect(page.locator('#content .tp-mobile-original-table')).toBeHidden();
 await page.locator('#clientSearch').fill('Карточка один');
 await expect(page.locator('.tp-mobile-clients .tp-mobile-record:visible')).toHaveCount(1);
 await page.locator('#clientSearch').fill('');
 const card=page.locator('.tp-mobile-clients .tp-mobile-record').first();
 await card.getByRole('button',{name:'Действия'}).click();
 await expect(card.locator('[role=menu]')).toBeVisible();
 await card.getByRole('menuitem',{name:'Открыть карточку'}).click();
 await expect(page.locator('#modal')).toHaveClass(/open/);
 await page.locator('#modalClose').click();
 await card.getByRole('button',{name:'Действия'}).click();
 await card.getByRole('menuitem',{name:'Добавить занятие'}).click();
 await expect(page.locator('#lClient')).toHaveValue(String(await page.evaluate(()=>db.clients[0].id)));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(2);
 expect(errors).toEqual([]);
});

test('Mobile V2 subscriptions: no horizontal table and same edit/renew/history actions',async({page})=>{
 const errors=await setup(page);await login(page);await addStudent(page,'Пакет мобильный','04.05');
 await page.evaluate(()=>openSubscription());
 await page.locator('#sPrice').fill('9000');
 await page.locator('#modalBody button.primary').last().click();
 await page.evaluate(()=>setPage('subscriptions'));
 const card=page.locator('.tp-mobile-subscriptions .tp-mobile-record').first();
 await expect(card).toBeVisible();
 await expect(page.locator('#content .tp-mobile-original-table')).toBeHidden();
 await expect(card).toContainText('9 000');
 await card.getByRole('button',{name:'Действия'}).click();
 await expect(card.locator('[role=menu]')).toContainText('Продлить');
 await card.getByRole('menuitem',{name:'Продлить'}).click();
 await expect(page.locator('#modalTitle')).toContainText('Продление');
 expect(errors).toEqual([]);
});

test('Mobile V2 payments: all four KPI remain, filters sync cards, actions reuse audited editor',async({page})=>{
 const errors=await setup(page);await login(page);await addStudent(page,'Платёж один','04.05');
 await page.evaluate(()=>{
   const id=db.clients[0].id;
   db.payments=[
     {id:'mobile-paid',clientId:id,amount:2300,date:todayISO(),status:'paid',type:'single',paidAt:todayISO()},
     {id:'mobile-pending',clientId:id,amount:1500,date:todayISO(),status:'pending',type:'single'}];
   setPage('payments');
 });
 await expect(page.locator('.finance-cards .stat')).toHaveCount(4);
 await expect(page.locator('#content .tp-mobile-original-table')).toBeHidden();
 await expect(page.locator('.tp-mobile-payments .tp-mobile-record:visible')).toHaveCount(2);
 await page.locator('#paymentFilter').selectOption('pending');
 await expect(page.locator('.tp-mobile-payments .tp-mobile-record:visible')).toHaveCount(1);
 await page.locator('#paymentFilter').selectOption('all');
 const card=page.locator('.tp-mobile-payments .tp-mobile-record').filter({hasText:'2 300'}).first();
 await card.getByRole('button',{name:'Действия'}).click();
 await card.getByRole('menuitem',{name:'Редактировать'}).click();
 await expect(page.locator('#modalTitle')).toContainText('Исправить оплату');
 await page.locator('#modalClose').click();
 await page.setViewportSize({width:1280,height:900});
 await expect(page.locator('#content .tp-mobile-original-table')).toBeVisible();
 await expect(page.locator('.tp-mobile-payments')).toBeHidden();
 expect(errors).toEqual([]);
});

test('Mobile V2 lesson long hold prevents selection and pointer drop still moves lesson',async({page})=>{
 const errors=await setup(page);await login(page);await addStudent(page,'Жесты iOS','04.05');
 await page.evaluate(()=>{
   db.lessons=[{id:'touch-mobile-v2',clientId:db.clients[0].id,date:todayISO(),time:'10:00',duration:60,status:'planned'}];
   calendarMode='day';calendarSelectedDate=todayISO();setPage('schedule');
 });
 const event=page.locator('.calendar-event[data-lesson-id="touch-mobile-v2"]');
 await expect(event).toBeVisible();
 expect(await event.evaluate(el=>getComputedStyle(el).touchAction)).toBe('none');
 await expect(event.locator('.tp-event-more')).toBeVisible();
 const drop=page.locator('.calendar-cell[data-date][data-minute="660"]').first();
 await drop.scrollIntoViewIfNeeded();
 // Calculate both positions after scrolling. The taller calendar moves the
 // source event whenever the destination hour is brought into view.
 const rect=await event.boundingBox();
 const cell=await drop.boundingBox();
 const startX=rect.x+Math.min(28,rect.width/4),startY=rect.y+Math.min(20,rect.height/3);
 const endX=cell.x+Math.min(45,cell.width/2),endY=cell.y+cell.height*.12;
 page.on('dialog',dialog=>dialog.accept());
 await event.dispatchEvent('pointerdown',{pointerType:'touch',pointerId:8,isPrimary:true,clientX:startX,clientY:startY});
 await page.waitForTimeout(490);
 await expect(event).toHaveClass(/touch-dragging/);
 await page.evaluate(()=>document.querySelector('.calendar-event strong')?.dispatchEvent(new Event('selectstart',{bubbles:true,cancelable:true})));
 expect(await page.evaluate(()=>String(getSelection()))).toBe('');
 await page.evaluate(({x,y})=>document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerType:'touch',pointerId:8,isPrimary:true,clientX:x,clientY:y})),{x:endX,y:endY});
 await page.evaluate(({x,y})=>document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerType:'touch',pointerId:8,isPrimary:true,clientX:x,clientY:y})),{x:endX,y:endY});
 expect(await page.evaluate(()=>db.lessons[0].time)).toBe('11:00');
 expect(errors).toEqual([]);
});


test('Cancelled and no-show lesson status keeps full one-hour height, time and student name',async({page})=>{
 const errors=await setup(page);await login(page);
 await addStudent(page,'Имя остаётся в событии','15.10');
 await page.evaluate(()=>{
   db.lessons=[{id:'ux-preserve',clientId:db.clients[0].id,date:todayISO(),time:'10:00',
     duration:60,status:'planned'}];
   calendarMode='day';calendarSelectedDate=todayISO();setPage('schedule');
 });
 const item=page.locator('.calendar-event[data-lesson-id="ux-preserve"]');
 await item.scrollIntoViewIfNeeded();
 const height=await item.evaluate(el=>el.getBoundingClientRect().height);
 const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());d.dismiss();});
 await item.locator('.tp-event-more').click();
 await page.locator('.lesson-quick-menu [data-action="status:cancelled"]').click();
 expect(dialogs).toEqual([]);
 expect(await page.evaluate(()=>db.lessons[0].status)).toBe('cancelled');
 await expect(item).toContainText('Имя остаётся в событии');
 await expect(item).toContainText('10:00–11:00');
 await expect(item).toContainText('Отменён');
 const cancelledHeight=await item.evaluate(el=>el.getBoundingClientRect().height);
 expect(Math.abs(cancelledHeight-height)).toBeLessThanOrEqual(2);
 expect(errors).toEqual([]);
});

test('Calendar drag and resizing apply without routine dialogs but preserve Undo',async({page})=>{
 const errors=await setup(page);await login(page);await addStudent(page,'Перенос без диалога','15.10');
 await page.evaluate(()=>{
   db.lessons=[{id:'ux-move',clientId:db.clients[0].id,date:todayISO(),time:'10:00',duration:60,status:'planned'}];
   calendarMode='day';calendarSelectedDate=todayISO();setPage('schedule');
 });
 const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());d.dismiss();});
 expect(await page.evaluate(()=>tpCalendarMove(db.lessons[0],todayISO(),'10:15'))).toBe(true);
 expect(await page.evaluate(()=>db.lessons[0].time)).toBe('10:15');
 await expect(page.locator('.cv2-toast')).toContainText('10:15');
 await page.locator('.cv2-toast').getByRole('button',{name:'Отменить'}).click();
 expect(await page.evaluate(()=>db.lessons[0].time)).toBe('10:00');
 expect(await page.evaluate(()=>tpCalendarResize('ux-move',75))).toBe(true);
 expect(await page.evaluate(()=>db.lessons[0].duration)).toBe(75);
 expect(dialogs).toEqual([]);
 expect(errors).toEqual([]);
});

test('Backdated subscription receipt uses actual selected payment date, not today',async({page})=>{
 const errors=await setup(page);await login(page);await addStudent(page,'Августовская оплата','15.10');
 await page.clock.install({time:new Date('2026-10-15T12:00:00')});
 await page.evaluate(()=>openSubscription());
 await page.locator('#sStart').fill('2026-08-03');
 await expect(page.locator('#sPaidAt')).toHaveValue('2026-08-03');
 await page.locator('#sPaidAt').fill('2026-08-12');
 await page.locator('#sStart').fill('2026-08-04');
 await expect(page.locator('#sPaidAt')).toHaveValue('2026-08-12');
 await page.locator('#sPrice').fill('13500');
 await page.locator('#modalBody button.primary').click();
 const actual=await page.evaluate(()=>({
   start:db.subscriptions[0].startDate,
   date:db.payments[0].date,paidAt:db.payments[0].paidAt,reported:paymentDate(db.payments[0])
 }));
 expect(actual).toEqual({start:'2026-08-04',date:'2026-08-12',paidAt:'2026-08-12',reported:'2026-08-12'});
 await page.evaluate(()=>setPage('payments'));
 await expect(page.locator('.finance-cards .stat').first().locator('.value')).toContainText('0 ₽');
 await expect(page.locator('.finance-cards .stat').nth(1).locator('.value')).toContainText('13 500 ₽');
 // Existing receipts are not silently rewritten. Their date is correctable via payment editor.
 await page.evaluate(()=>tpOpenPaymentEdit(db.payments[0].id));
 await expect(page.locator('#tpEditDate')).toHaveValue('2026-08-12');
 expect(errors).toEqual([]);
});

test('Day and week calendar date headings stay sticky as the schedule scrolls vertically',async({page})=>{
 const errors=await setup(page);await login(page);await addStudent(page,'Закреплённые даты','15.10');
 await page.setViewportSize({width:390,height:844});
 for(const mode of ['day','week']){
   await page.evaluate(mode=>{
     calendarMode=mode;calendarSelectedDate=todayISO();setPage('schedule');
   },mode);
   const result=await page.evaluate(()=>{
     const shell=document.querySelector('.calendar-shell');
     shell.scrollTop=0;
     const header=shell.querySelector('.calendar-day-head');
     const first=header.getBoundingClientRect().top;
     const initialRow=shell.querySelector('.calendar-cell').getBoundingClientRect().top;
     shell.scrollTop=400;
     return {scrollTop:shell.scrollTop,first,after:header.getBoundingClientRect().top,
       rowShift:shell.querySelector('.calendar-cell').getBoundingClientRect().top-initialRow,
       position:getComputedStyle(header).position,shellTop:shell.getBoundingClientRect().top};
   });
   expect(result.scrollTop).toBeGreaterThan(100);
   expect(result.position).toBe('sticky');
   expect(Math.abs(result.after-result.first)).toBeLessThan(3);
   expect(result.rowShift).toBeLessThan(-100);
   expect(Math.abs(result.after-result.shellTop)).toBeLessThan(4);
 }
 expect(errors).toEqual([]);
});


test('Students have distinct warm pastel calendar colors and completed/cancelled/deleted status icons',async({page})=>{
 const errors=await setup(page);await login(page);
 await addStudent(page,'Янтарь','01.02');await addStudent(page,'Мята','02.02');
 await page.evaluate(()=>{
  const a=db.clients[0].id,b=db.clients[1].id,day=todayISO();
  db.lessons=[
   {id:'student-first',clientId:a,date:day,time:'06:00',duration:60,status:'planned'},
   {id:'student-second',clientId:b,date:day,time:'07:00',duration:60,status:'done'},
   {id:'student-cancelled',clientId:a,date:day,time:'08:00',duration:60,status:'cancelled'},
   {id:'student-deleted',clientId:b,date:day,time:'09:00',duration:60,status:'deleted'}];
  calendarMode='day';calendarSelectedDate=day;setPage('schedule');
 });
 const color=await page.evaluate(()=>{
  const a=document.querySelector('.calendar-event[data-lesson-id="student-first"]');
  const b=document.querySelector('.calendar-event[data-lesson-id="student-second"]');
  return [getComputedStyle(a).getPropertyValue('--tp-student-edge'),getComputedStyle(b).getPropertyValue('--tp-student-edge')];
 });
 expect(color[0]).not.toBe(color[1]);
 await expect(page.locator('.calendar-event[data-lesson-id="student-second"] .tp-lesson-mark')).toHaveText('✓');
 await expect(page.locator('.calendar-event[data-lesson-id="student-cancelled"] .tp-lesson-mark')).toHaveText('×');
 await expect(page.locator('.calendar-event[data-lesson-id="student-deleted"] .tp-lesson-mark')).toHaveText('×');
 await page.evaluate(()=>deleteLesson('student-first'));
 expect(await page.evaluate(()=>db.lessons.find(l=>l.id==='student-first').status)).toBe('deleted');
 await expect(page.locator('.calendar-event[data-lesson-id="student-first"] .tp-lesson-mark')).toHaveText('×');
 expect(errors).toEqual([]);
});

test('Custom calendar time supports 05:15 and lessons ending at 00:00',async({page})=>{
 const errors=await setup(page);await login(page);await addStudent(page,'Ранние уроки','01.02');
 await page.evaluate(()=>{calendarMode='day';calendarSelectedDate=todayISO();setPage('schedule');});
 expect(await page.locator('.calendar-hour').allTextContents()).toEqual(expect.arrayContaining(['05:00','23:00']));
 await expect(page.locator('.calendar-hour')).toHaveCount(19);
 await page.evaluate(()=>openLesson(null,todayISO(),'05:15'));
 await expect(page.locator('#lTime')).toHaveAttribute('type','text');
 await page.locator('#lTime').fill('05:15');
 await page.locator('#modalBody button.primary').last().click();
 expect(await page.evaluate(()=>db.lessons[0].time)).toBe('05:15');
 await page.evaluate(()=>openLesson(null,todayISO(),'22:15'));
 await page.locator('#lTime').fill('22:15');
 await page.locator('#lDuration').selectOption('30');
 await page.locator('#modalBody button.primary').last().click();
 expect(await page.evaluate(()=>db.lessons.some(l=>l.time==='22:15'))).toBe(true);
 page.once('dialog',dialog=>dialog.dismiss());
 await page.evaluate(()=>openLesson(null,todayISO(),'23:00'));
 await page.locator('#lTime').fill('23:00');
 await page.locator('#lDuration').selectOption('60');
 await page.locator('#modalBody button.primary').last().click();
 expect(await page.evaluate(()=>db.lessons.some(l=>l.time==='23:00'))).toBe(true);
 await expect(page.locator('#modal')).toBeHidden();
 await page.evaluate(()=>openLesson(null,todayISO(),'23:30'));
 await page.locator('#lTime').fill('23:30');
 await page.locator('#lDuration').selectOption('60');
 await page.locator('#modalBody button.primary').last().click();
 expect(await page.evaluate(()=>db.lessons.some(l=>l.time==='23:30'))).toBe(false);
 expect(errors).toEqual([]);
});

test('Hourly rate is blank without a saved rate and repeat UI has no weeks input',async({page})=>{
 const errors=await setup(page);await login(page);await addStudent(page,'Новая стоимость','04.05');
 await page.evaluate(()=>openClient(db.clients[0].id,'overview'));
 await expect(page.locator('#fLessonRate')).toHaveValue('');
 await page.locator('#modalClose').click();
 await page.evaluate(()=>openLesson());
 await expect(page.locator('#lHourlyRate')).toHaveValue('');
 await expect(page.locator('#lWeeks')).toHaveCount(0);
 await expect(page.locator('#lRecurrence')).toBeVisible();
 expect(errors).toEqual([]);
});

test('Greeting reflects local browser hour without locale or geolocation access',async({page})=>{
 const errors=await setup(page);await login(page);await addStudent(page,'Приветствие','04.05');
 for(const [hour,expected] of [[3,'Доброй ночи'],[8,'Доброе утро'],[14,'Добрый день'],[19,'Добрый вечер']]){
  await page.clock.setFixedTime(new Date('2026-10-16T'+String(hour).padStart(2,'0')+':10:00'));
  await page.evaluate(()=>setPage('dashboard'));
  await expect(page.locator('.se-greeting h2')).toContainText(expected);
 }
 expect(errors).toEqual([]);
});

test('Routine status and repeat actions have no native confirm prompts',async({page})=>{
 const errors=await setup(page);await login(page);await addStudent(page,'Без лишних окон','04.05');
 await page.evaluate(()=>{
  db.lessons=[{id:'no-confirm-lesson',clientId:db.clients[0].id,date:todayISO(),time:'11:00',duration:60,status:'planned'}];
  calendarMode='day';calendarSelectedDate=todayISO();setPage('schedule');
 });
 const dialogs=[];page.on('dialog',d=>{dialogs.push(d.type());d.dismiss();});
 await page.locator('.calendar-event[data-lesson-id="no-confirm-lesson"] .tp-event-more').click();
 await page.locator('.lesson-quick-menu [data-action="status:cancelled"]').click();
 expect(await page.evaluate(()=>db.lessons[0].status)).toBe('cancelled');
 expect(dialogs).toEqual([]);
 expect(errors).toEqual([]);
});


test('Recurring lessons can run twice weekly on separate days and at different times',async({page})=>{
 const errors=await setup(page);await login(page);await addStudent(page,'Два занятия в неделю','04.05');
 await page.evaluate(()=>openLesson(null,todayISO(),'16:00'));
 await page.locator('#lRecurrence').selectOption('weekly');
 await expect(page.locator('#tpRecurrenceDays')).toBeVisible();
 await expect(page.locator('#lWeeks')).toHaveCount(0);
 await page.evaluate(()=>{
   const group=document.querySelector('#tpRecurrenceDays');
   group.dataset.customized='true';
   for(const input of group.querySelectorAll('[data-weekday]'))input.checked=['1','4'].includes(input.dataset.weekday);
   tpToggleRecurrenceDays();
 });
 await page.locator('#tpWeekdayTime1').fill('16:00');
 await page.locator('#tpWeekdayTime4').fill('18:30');
 await page.locator('#modalBody button.primary').last().click();
 const result=await page.evaluate(()=>{
   const all=db.lessons.slice().sort((a,b)=>a.date.localeCompare(b.date));
   return {count:all.length,series:new Set(all.map(l=>l.seriesId)).size,weekdays:[...new Set(all.map(l=>{const d=new Date(l.date+'T12:00:00');return (d.getDay()+6)%7;}))].sort(),times:[...new Set(all.map(l=>l.time))].sort(),allPlanned:all.every(l=>l.status==='planned')};
 });
 expect(result).toEqual({count:104,series:1,weekdays:[1,4],times:['16:00','18:30'],allPlanned:true});
 expect(errors).toEqual([]);
});

test('Payments clearly distinguish package total, remaining balance and scheduled lessons',async({page})=>{
 const errors=await setup(page);await login(page);await addStudent(page,'Пакет десять','04.05');
 await page.evaluate(()=>{
   const c=db.clients[0],day=todayISO();
   db.subscriptions=[{id:'ten-plan',clientId:c.id,name:'10 занятий',total:10,remaining:8,price:13500,paymentStatus:'paid',status:'active',startDate:day}];
   db.payments=[{id:'ten-payment',clientId:c.id,subscriptionId:'ten-plan',type:'subscription',status:'paid',amount:13500,date:day,paidAt:day,description:'Предоплата: 10 занятий'}];
   db.lessons=[{id:'pending-a',clientId:c.id,date:day,time:'10:00',duration:60,status:'planned'}];
   setPage('payments');
 });
 await expect(page.locator('#paymentRows .tp-subscription-progress')).toContainText('Всего 10 · осталось 8 · запланировано 1');
 expect(await page.evaluate(()=>db.subscriptions[0].remaining)).toBe(8);
 expect(errors).toEqual([]);
});

test('Long calendar has fast jump controls that scroll within the calendar only',async({page})=>{
 const errors=await setup(page);await login(page);await addStudent(page,'Навигация по времени','04.05');
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{calendarMode='day';calendarSelectedDate=todayISO();setPage('schedule');});
 const jumps=page.locator('.cv2-time-jumps');
 await expect(jumps.getByRole('button',{name:'Утро'})).toBeVisible();
 await jumps.getByRole('button',{name:'Вечер'}).click();
 const evening=await page.evaluate(()=>{
   const shell=document.querySelector('.calendar-shell'),cell=shell.querySelector('.calendar-cell[data-minute="1080"]');
   return {scroll:shell.scrollTop,near:Math.abs(cell.getBoundingClientRect().top-shell.getBoundingClientRect().top)};
 });
 expect(evening.scroll).toBeGreaterThan(400);
 expect(evening.near).toBeLessThan(220);
 await jumps.getByRole('button',{name:'Утро'}).click();
 const morning=await page.evaluate(()=>document.querySelector('.calendar-shell').scrollTop);
 expect(morning).toBeLessThan(evening.scroll);
 expect(errors).toEqual([]);
});
