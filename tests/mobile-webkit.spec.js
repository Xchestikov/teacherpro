const {test,expect,devices}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const mock=fs.readFileSync(path.join(__dirname,'mock-supabase.js'),'utf8');
test.use({...devices['iPhone 13'],baseURL:'http://127.0.0.1:4173',serviceWorkers:'block'});
test('WebKit iPhone viewport keeps lesson text unselectable and mobile payment menu usable',async({page})=>{
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',r=>r.fulfill({status:200,contentType:'application/javascript',body:'/* test stub */'}));
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());
 await page.route('https://fonts.gstatic.com/**',r=>r.abort());
 await page.addInitScript({content:mock});
 await page.goto('/');
 await page.locator('#authEmail').fill('a@teacherpro.test');
 await page.locator('#authPassword').fill('DemoPass123');
 await page.locator('#authSubmit').click();
 await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>{
   db.clients=[{id:123,name:'Тестовый ученик',phone:'',billingMode:'subscription'}];
   db.lessons=[{id:'ios-event',clientId:123,date:todayISO(),time:'11:30',duration:60,status:'planned'}];
   calendarMode='day';calendarSelectedDate=todayISO();setPage('schedule');
 });
 const event=page.locator('.calendar-event[data-lesson-id="ios-event"]');
 await event.scrollIntoViewIfNeeded();
 await expect(event).toBeVisible();
 const styles=await event.evaluate(node=>({
   touch:getComputedStyle(node).touchAction,
   user:getComputedStyle(node).userSelect,
   webkit:getComputedStyle(node).webkitUserSelect
 }));
 expect(styles.touch).toBe('none');
 expect(styles.user==='none'||styles.webkit==='none').toBe(true);
 await event.locator('.tp-event-more').tap();
 await expect(page.locator('.lesson-quick-menu')).toBeVisible();
 await expect(page.locator('.lesson-quick-menu')).toContainText('Перенести');
 await page.keyboard.press('Escape');
 await page.evaluate(()=>{
   db.payments=[{id:'ios-payment',clientId:123,amount:1200,date:todayISO(),status:'paid',type:'single',paidAt:todayISO()}];
   setPage('payments');
 });
 await expect(page.locator('.tp-mobile-payments .tp-mobile-record')).toHaveCount(1);
 await page.locator('.tp-mobile-payments .tp-mobile-more').tap();
 await expect(page.locator('.tp-mobile-payments [role=menu]')).toBeVisible();
 await page.locator('.tp-mobile-payments').getByRole('menuitem',{name:'Редактировать'}).tap();
 await expect(page.locator('#modalTitle')).toContainText('Исправить оплату');
 expect(errors).toEqual([]);
});


test('Native iOS touches drag a planned lesson without selecting time labels',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',r=>r.fulfill({status:200,contentType:'application/javascript',body:'/* mock */'}));
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());
 await page.route('https://fonts.gstatic.com/**',r=>r.abort());
 await page.addInitScript({content:mock});
 await page.goto('/');
 await page.locator('#authEmail').fill('a@teacherpro.test');
 await page.locator('#authPassword').fill('DemoPass123');
 await page.locator('#authSubmit').click();
 await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>{
  db.clients=[{id:123,name:'Жесты',billingMode:'subscription'}];
  db.lessons=[{id:'native-drag',clientId:123,date:todayISO(),time:'10:00',duration:60,status:'planned'}];
  calendarMode='day';calendarSelectedDate=todayISO();setPage('schedule');
 });
 const event=page.locator('.calendar-event[data-lesson-id="native-drag"]');
 await event.scrollIntoViewIfNeeded();
 const moved=await page.evaluate(async()=>{
   const source=document.querySelector('.calendar-event[data-lesson-id="native-drag"]');
   const cell=source.closest('.calendar-cell');
   const a=source.getBoundingClientRect(),b=cell.getBoundingClientRect();
   const x=a.left+Math.min(a.width/3,24),y=a.top+Math.min(a.height/4,12);
   // Use the following hour's slot; coordinates stay inside the visible viewport.
   const next=document.querySelector('.calendar-cell[data-date="'+cell.dataset.date+'"][data-minute="660"]');
   next.scrollIntoView({block:'center'});
   const r=next.getBoundingClientRect(),endX=r.left+r.width*.5,endY=r.top+r.height*.1;
   const fire=(kind,cx,cy)=> {
     const touch={identifier:47,target:source,clientX:cx,clientY:cy,pageX:cx+scrollX,pageY:cy+scrollY};
     const ev=new Event(kind,{bubbles:true,cancelable:true});
     Object.defineProperties(ev,{touches:{value:kind==='touchend'?[]:[touch]},changedTouches:{value:[touch]}});
     source.dispatchEvent(ev);return ev.defaultPrevented;
   };
   // Touch start after repositioning: source may move due to scroll.
   const updated=source.getBoundingClientRect();
   const sx=updated.left+25,sy=updated.top+10;
   const prevented=fire('touchstart',sx,sy);
   await new Promise(resolve=>setTimeout(resolve,480));
   fire('touchmove',endX,endY);
   fire('touchend',endX,endY);
   return {prevented,selection:String(window.getSelection()),time:db.lessons[0].time};
 });
 expect(moved.prevented).toBe(true);
 expect(moved.selection).toBe('');
 expect(moved.time).toBe('11:00');
 expect(errors).toEqual([]);
});
