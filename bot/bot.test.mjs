import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lessonStart,dateParts,reminderDue,scheduleText,changeText,lessonState} from './logic.mjs';
import {BotEngine} from './engine.mjs';
import {createWebhookServer} from './server.mjs';

const owner='11111111-1111-4111-8111-111111111111';
const linkId='22222222-2222-4222-8222-222222222222';
const teacherId='33333333-3333-4333-8333-333333333333';
const sample={clients:[{id:1,name:'Анна'},{id:2,name:'Секретный ученик'}],
 lessons:[{id:'one',clientId:1,date:'2026-10-20',time:'16:30',duration:80,status:'planned'},
          {id:'two',clientId:2,date:'2026-10-20',time:'16:00',duration:60,status:'planned'}]};
function fixture(now='2026-10-19T11:30:00Z'){
 const calls=[],claimed=new Set(),state=new Map(),links=[
   {id:linkId,role:'student',student_id:'1',owner_id:owner,telegram_user_id:111,chat_id:111,status:'active',notifications_enabled:true},
   {id:teacherId,role:'teacher',student_id:null,owner_id:owner,telegram_user_id:222,chat_id:222,status:'active',notifications_enabled:true}
 ];
 const prefs={timezone:'Europe/Moscow',reminder_24h:true,reminder_2h:false,teacher_digest:false,digest_time:'08:00',changes_enabled:true};
 const store={
   links,payload:structuredClone(sample),prefs,claims:claimed,
   async connections(filters){return links.filter(l=>Object.entries(filters).every(([k,v])=>k==='select'||k==='limit'||v===undefined||
     String(l[k])===String(v).replace(/^eq\./,'')));},
   async app(){return this.payload},
   async prefs(){return prefs},
   async claim(id,key){const k=id+'|'+key;if(claimed.has(k))return false;claimed.add(k);return true;},
   async deliveryStatus(){},
   async snapshot(o,id,value){state.set(id,value);},
   async snapshots(){return [...state].map(([lesson_id,s])=>({lesson_id,state:s}));},
   async update(_table,id,patch){Object.assign(links.find(l=>l.id===id),patch);},
   async redeem(){return {status:'invalid'};}
 };
 const tg={
   async message(chat,text,keyboard){calls.push({chat,text,keyboard});},
   async answer(){calls.push({answer:true});}
 };
 const engine=new BotEngine(store,tg,{now:()=>Date.parse(now),log:{warn(){}}});
 return {store,tg,engine,calls,claimed,state,prefs,links};
}
test('Timezone: 16:30 Moscow = 13:30 UTC, 16:30 Almaty = 11:30 UTC',()=>{
 const l=sample.lessons[0];
 assert.equal(new Date(lessonStart(l,'Europe/Moscow')).toISOString(),'2026-10-20T13:30:00.000Z');
 assert.equal(new Date(lessonStart(l,'Asia/Almaty')).toISOString(),'2026-10-20T11:30:00.000Z');
 assert.equal(dateParts(new Date('2026-10-19T11:30:00Z'),'Europe/Moscow').time,'14:30');
});
test('Fixed reminder windows never fire before due or after grace',()=>{
 const start=Date.parse('2026-10-20T13:30:00Z'),due=start-24*3600000;
 assert.equal(reminderDue(start,due,24),true);
 assert.equal(reminderDue(start,due-1000,24),false);
 assert.equal(reminderDue(start,due+5*60000,24),false);
});
test('Student only sees own lessons; teacher sees all matching schedule',()=>{
 const student={role:'student',student_id:'1'},teacher={role:'teacher'};
 const at=Date.parse('2026-10-19T10:00:00Z');
 assert.ok(scheduleText(sample,student,'Europe/Moscow','week',at).includes('80 мин'));
 assert.ok(!scheduleText(sample,student,'Europe/Moscow','week',at).includes('Секретный ученик'));
 assert.ok(scheduleText(sample,teacher,'Europe/Moscow','week',at).includes('Секретный ученик'));
});
test('Changes distinguish move, cancellation and duration adjustment',()=>{
 const before=lessonState(sample.lessons[0]);
 assert.match(changeText(before,{...before,time:'17:00'}),/перенесено/);
 assert.match(changeText(before,{...before,status:'cancelled'}),/отменено/);
 assert.match(changeText(before,{...before,duration:60}),/длительность/);
 assert.equal(changeText(before,before),null);
});
test('Engine sends 24 hour reminder once despite scheduler reruns',async()=>{
 const f=fixture('2026-10-19T13:30:00Z');
 await f.engine.poll();await f.engine.poll();
 assert.equal(f.calls.filter(c=>c.text?.includes('Напоминание')).length,1);
 assert.equal(f.calls[0].chat,111);
 assert.doesNotMatch(f.calls[0].text,/Секретный ученик/);
});
test('Cancelled lessons never receive reminders and changes are deduplicated',async()=>{
 const f=fixture('2026-10-19T13:30:00Z');
 await f.engine.poll();
 f.store.payload.lessons[0].time='17:15';
 await f.engine.poll();await f.engine.poll();
 assert.equal(f.calls.filter(c=>c.text?.includes('перенесено')).length,1);
 f.store.payload.lessons[0].status='cancelled';
 await f.engine.poll();await f.engine.poll();
 assert.equal(f.calls.filter(c=>c.text?.includes('отменено')).length,1);
 assert.equal(f.calls.filter(c=>c.text?.includes('Напоминание')).length,1);
});
test('Teacher daily summary stays optional and once per day',async()=>{
 const f=fixture('2026-10-20T05:00:00Z');
 f.prefs.teacher_digest=true;
 await f.engine.poll();await f.engine.poll();
 assert.equal(f.calls.filter(c=>c.text?.includes('Утренняя сводка')).length,1);
});
test('Callback cannot use someone else\'s connection and group chats are ignored',async()=>{
 const f=fixture();
 await f.engine.handle({callback_query:{id:'x',from:{id:111},message:{chat:{id:111,type:'private'}},
   data:'v:'+teacherId+':today'}});
 assert.equal(f.calls.filter(c=>c.text?.includes('Сегодня')).length,0);
 await f.engine.handle({message:{from:{id:111},chat:{id:-23,type:'group'},text:'/today'}});
 assert.equal(f.calls.filter(c=>c.text?.includes('Сегодня')).length,0);
});
test('Webhook rejects missing secret, blocks replay and malformed body',async()=>{
 const updates=new Set(),calls=[];
 const store={
   async claimUpdate(id){if(updates.has(id))return false;updates.add(id);return true;},
   async releaseUpdate(id){updates.delete(id);}
 };
 const engine={async handle(update){calls.push(update.update_id);}};
 const server=createWebhookServer(engine,store,'TestSecret_For_Telegram_123');
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
   const root='http://127.0.0.1:'+server.address().port+'/telegram/webhook';
   const payload=JSON.stringify({update_id:1,message:{text:'/start'}});
   let response=await fetch(root,{method:'POST',body:payload});
   assert.equal(response.status,403);
   for(let n=0;n<2;n++){
     response=await fetch(root,{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'TestSecret_For_Telegram_123'},body:payload});
     assert.equal(response.status,200);
   }
   assert.deepEqual(calls,[1]);
   response=await fetch(root,{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'TestSecret_For_Telegram_123'},body:'x'});
   assert.equal(response.status,500);
 } finally{await new Promise(resolve=>server.close(resolve));}
});
