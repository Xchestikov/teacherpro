import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lowSubscriptions,paymentsText,subscriptionsText} from './presentation.mjs';
import {BotEngine} from './engine.mjs';
const own='11111111-1111-4111-8111-111111111111',teacher='22222222-2222-4222-8222-222222222222';
const payload={
 clients:[{id:1,name:'Первый'},{id:2,name:'Второй'}],
 lessons:[],
 subscriptions:[
  {id:1,clientId:1,name:'Абонемент',total:10,remaining:2},
  {id:2,clientId:2,name:'Пакет 2',total:10,remaining:1},
  {id:3,clientId:1,name:'Закрытый',total:10,remaining:0,archivedAt:'2026-01-01'},
  {id:4,clientId:1,name:'Без данных',remaining:null,total:null}
 ],
 payments:[
  {id:1,clientId:1,status:'pending',amount:3000},
  {id:2,clientId:1,status:'paid',amount:1000},
  {id:3,clientId:2,status:'pending',amount:2000}
 ]};
test('Finishing subscriptions use only known, active count, never null as zero',()=>{
 assert.deepEqual(lowSubscriptions(payload).map(x=>x.id),[1,2]);
 assert.deepEqual(lowSubscriptions(payload,1).map(x=>x.id),[1]);
 const view=subscriptionsText(payload,{role:'student',student_id:'1'});
 assert.match(view,/2 из 10/);
 assert.match(view,/остаток уточняется/);
 assert.doesNotMatch(view,/Пакет 2/);
});
test('Teacher debt shortlist is grounded in existing pending records, not fabricated sums',()=>{
 const view=paymentsText(payload,{role:'teacher'});
 assert.match(view,/Ожидают оплаты: 2/);
 assert.match(view,/Первый/);
 assert.match(view,/Второй/);
 assert.doesNotMatch(view,/3 000|5 000|₽/);
 assert.match(paymentsText(payload,{role:'parent',student_id:'1'}),/только преподавателю/);
});
test('Opt-in morning digest includes low balances but never duplicates notification',async()=>{
 const claimed=new Set(),messages=[];
 const link={id:teacher,owner_id:own,role:'teacher',student_id:null,status:'active',
   telegram_user_id:99,chat_id:99,notifications_enabled:true};
 const store={
   connections:async()=>[link],app:async()=>payload,
   prefs:async()=>({timezone:'Europe/Moscow',teacher_digest:true,digest_time:'08:00'}),
   claim:async(id,key)=>{if(claimed.has(key))return false;claimed.add(key);return true;},
   deliveryStatus:async()=>{}
 };
 const telegram={message:async(_id,text)=>messages.push(text)};
 const now=Date.parse('2026-10-20T05:00:00Z');
 const engine=new BotEngine(store,telegram,{now:()=>now,log:{warn(){}}});
 await engine.poll();await engine.poll();
 assert.equal(messages.length,1);
 assert.match(messages[0],/Первый: осталось 2/);
 assert.match(messages[0],/Второй: осталось 1/);
});
