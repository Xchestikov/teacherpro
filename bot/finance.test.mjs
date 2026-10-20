import {test} from 'node:test';
import assert from 'node:assert/strict';
import {perLessonBalance,remainingBalance,studentFinances,teacherFinances,renewalCandidates} from './finance.mjs';
import {BotEngine} from './engine.mjs';
const owner='11111111-1111-4111-8111-111111111111',teacherId='22222222-2222-4222-8222-222222222222';
const payload={
 clients:[{id:10,name:'Анна',billingMode:'per_lesson'},{id:20,name:'Чужой ученик'}],
 lessons:[
  {clientId:10,status:'done',billingMode:'per_lesson',hourlyRate:1000,priceUnit:'lesson',duration:80},
  {clientId:10,status:'no_show_charged',billingMode:'per_lesson',hourlyRate:1000,priceUnit:'hour',duration:90},
  {clientId:10,status:'no_show',billingMode:'per_lesson',hourlyRate:1000,priceUnit:'lesson',duration:60},
  {clientId:20,status:'done',billingMode:'per_lesson',hourlyRate:6000,priceUnit:'lesson',duration:60}
 ],
 payments:[
  {clientId:10,financeV3Lesson:true,status:'paid',amount:1200},
  {clientId:10,financeV3Lesson:true,status:'pending',amount:400},
  {clientId:20,financeV3Lesson:true,status:'paid',amount:6500}
 ],
 subscriptions:[
  {id:'sub-10',clientId:10,name:'Абонемент',remaining:2,total:10},
  {id:'sub-20',clientId:20,name:'Секретный абонемент',remaining:1,total:6},
  {id:'old',clientId:20,name:'Закрытый',remaining:0,total:10,archivedAt:'2026-10-01'}
 ]
};
const link={id:teacherId,owner_id:owner,role:'teacher',status:'active',chat_id:222,notifications_enabled:true};
test('Per-lesson accrual mirrors billable status, lesson/hour price, paid-only receipts',()=>{
 const b=perLessonBalance(payload,10);
 assert.deepEqual(b,{earned:250000,paid:120000,due:130000,credit:0,lessons:2});
 assert.equal(perLessonBalance(payload,20).due,0);
});
test('Student financial summary cannot disclose another student or external payments',()=>{
 const s=studentFinances(payload,10);
 assert.match(s,/2 из 10/);
 assert.match(s,/1 300|1 300/);
 assert.doesNotMatch(s,/Чужой ученик|Секретный абонемент|6 000|6 000/);
 assert.equal(renewalCandidates(payload).length,2);
 assert.equal(remainingBalance({total:10}),null);
 assert.equal(remainingBalance({remaining:null,total:10}),null);
});
test('Teacher overview counts pending payments without mislabelling them overdue',()=>{
 const s=teacherFinances(payload);
 assert.match(s,/Ожидаемых платежей в TeacherPro: 1/);
 assert.match(s,/Абонементов с остатком до 2 занятий: 2/);
 assert.doesNotMatch(s,/Просрочен/);
 assert.doesNotMatch(s,/Закрытый/);
});
test('Renewal alert requires teacher digest opt-in and is deduplicated for each remaining value',async()=>{
 const calls=[],claimed=new Set(),prefs={timezone:'Europe/Moscow',teacher_digest:false,digest_time:'08:00',changes_enabled:false};
 const store={
  app:async()=>payload,prefs:async()=>prefs,snapshots:async()=>[],
  claim:async(linkId,key)=>{const k=linkId+'|'+key;if(claimed.has(k))return false;claimed.add(k);return true;},
  deliveryStatus:async()=>{},snapshot:async()=>{}
 };
 const tg={message:async(_chat,text)=>calls.push(text)};
 const engine=new BotEngine(store,tg,{now:()=>Date.parse('2026-10-20T08:30:00Z')});
 await engine.pollOwner(owner,[link],Date.parse('2026-10-20T08:30:00Z'));
 assert.equal(calls.length,0);
 prefs.teacher_digest=true;
 await engine.pollOwner(owner,[link],Date.parse('2026-10-20T08:30:00Z'));
 await engine.pollOwner(owner,[link],Date.parse('2026-10-20T08:30:00Z'));
 assert.equal(calls.filter(s=>s.includes('Абонемент заканчивается')).length,2);
 payload.subscriptions[0].remaining=1;
 await engine.pollOwner(owner,[link],Date.parse('2026-10-20T08:30:00Z'));
 assert.equal(calls.filter(s=>s.includes('Абонемент заканчивается')).length,3);
});
