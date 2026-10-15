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


test('WebKit long press disables selection on time gutter and moves a lesson using native touch events',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
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
  db.clients=[{id:1001,name:'Тестовое занятие'}];
  db.lessons=[{id:'native-ios-lesson',clientId:1001,date:todayISO(),time:'10:00',duration:60,status:'planned'}];
  calendarMode='day';calendarSelectedDate=todayISO();setPage('schedule');
 });
 const lesson=page.locator('[data-lesson-id="native-ios-lesson"]');
 await lesson.scrollIntoViewIfNeeded();
 await expect(lesson).toBeVisible();
 const gutter=await page.evaluate(()=>{
   const hour=document.querySelector('.calendar-hour');
   const time=hour.querySelector('span')||hour;
   const selectionEvent=new Event('selectstart',{bubbles:true,cancelable:true});
   time.dispatchEvent(selectionEvent);
   const menuEvent=new Event('contextmenu',{bubbles:true,cancelable:true});
   time.dispatchEvent(menuEvent);
   const styles=getComputedStyle(time);
   return {selectionPrevented:selectionEvent.defaultPrevented,menuPrevented:menuEvent.defaultPrevented,
     userSelect:styles.webkitUserSelect||styles.userSelect,callout:styles.webkitTouchCallout};
 });
 expect(gutter.selectionPrevented).toBe(true);
 expect(gutter.menuPrevented).toBe(true);
 expect(gutter.userSelect).toBe('none');
 expect(gutter.callout).toBe('none');
 const eventRect=await lesson.boundingBox();
 const cell=page.locator('.calendar-cell[data-minute="660"]').first();
 const cellRect=await cell.boundingBox();
 expect(eventRect&&cellRect).toBeTruthy();
 const from={x:eventRect.x+Math.min(eventRect.width/3,45),y:eventRect.y+Math.min(eventRect.height/3,18)};
 const to={x:cellRect.x+Math.min(cellRect.width/3,45),y:cellRect.y+8};
 const prevented=await page.evaluate(({from})=>{
  const el=document.querySelector('[data-lesson-id="native-ios-lesson"] .event-time');
  const touch=new Touch({identifier:31,target:el,clientX:from.x,clientY:from.y});
  const start=new TouchEvent('touchstart',{bubbles:true,cancelable:true,
    touches:[touch],targetTouches:[touch],changedTouches:[touch]});
  el.dispatchEvent(start);
  return start.defaultPrevented;
 },{from});
 expect(prevented).toBe(true);
 await page.waitForTimeout(520);
 await expect(lesson).toHaveClass(/touch-dragging/);
 page.on('dialog',dialog=>dialog.accept());
 await page.evaluate(({to})=>{
  const touch=new Touch({identifier:31,target:document.body,clientX:to.x,clientY:to.y});
  document.dispatchEvent(new TouchEvent('touchmove',{bubbles:true,cancelable:true,
    touches:[touch],changedTouches:[touch]}));
  document.dispatchEvent(new TouchEvent('touchend',{bubbles:true,cancelable:true,
    touches:[],changedTouches:[touch]}));
 },{to});
 expect(await page.evaluate(()=>db.lessons[0].time)).toBe('11:00');
 await expect(page.locator('.cv2-toast')).toContainText('11:00');
 expect(errors).toEqual([]);
});
