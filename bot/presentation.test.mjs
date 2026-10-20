import {test} from 'node:test';
import assert from 'node:assert/strict';
import {homeButtons,dashboardText,studentsText,subscriptionsText,paymentsText} from './presentation.mjs';
import {BotEngine} from './engine.mjs';

const teacher='22222222-2222-4222-8222-222222222222';
const student='33333333-3333-4333-8333-333333333333';
const owner='11111111-1111-4111-8111-111111111111';
const data={
  clients:[{id:7,name:'Анна'},{id:8,name:'Данные другого ученика'}],
  lessons:[
    {id:1,clientId:7,date:'2026-10-20',time:'14:00',duration:60,status:'planned'},
    {id:2,clientId:8,date:'2026-10-21',time:'16:00',duration:90,status:'planned'}
  ],
  subscriptions:[
    {id:101,clientId:7,name:'Абонемент',total:10,remaining:3},
    {id:102,clientId:8,name:'Секретная запись',total:5,remaining:1}
  ],
  payments:[{clientId:7,status:'pending'},{clientId:8,status:'paid'}]
};
const t={id:teacher,owner_id:owner,role:'teacher',telegram_user_id:222,chat_id:222,notifications_enabled:true,status:'active'};
const s={id:student,owner_id:owner,role:'student',student_id:'7',telegram_user_id:111,chat_id:111,notifications_enabled:true,status:'active'};
const now=Date.parse('2026-10-20T07:00:00Z'),tz='Europe/Moscow';
test('Teacher and student menus have distinct purposeful actions and valid callback size',()=>{
  const teacherActions=homeButtons(t).flat().map(x=>x.callback_data);
  const studentActions=homeButtons(s).flat().map(x=>x.callback_data);
  assert.ok(teacherActions.some(x=>x.endsWith(':students')));
  assert.ok(teacherActions.some(x=>x.endsWith(':payments')));
  assert.ok(studentActions.some(x=>x.endsWith(':subs')));
  assert.ok(!studentActions.some(x=>x.endsWith(':payments')));
  for(const code of [...teacherActions,...studentActions])assert.ok(Buffer.byteLength(code)<64);
});
test('Student dashboard and billing never leak another student or payment details',()=>{
  const home=dashboardText(data,s,tz,now);
  assert.match(home,/14:00/);
  assert.doesNotMatch(home,/Данные другого ученика|16:00/);
  const subs=subscriptionsText(data,s);
  assert.match(subs,/3 из 10/);
  assert.doesNotMatch(subs,/Секретная запись|Данные другого ученика/);
  assert.match(paymentsText(data,s),/только преподавателю/);
});
test('Teacher dashboard includes next student; finance card never invents money amounts',()=>{
  assert.match(dashboardText(data,t,tz,now),/Анна/);
  assert.match(studentsText(data),/Данные другого ученика/);
  assert.match(paymentsText(data,t),/Ожидают оплаты: 1/);
  assert.doesNotMatch(paymentsText(data,t),/₽/);
});
test('Unknown subscription balance is not described as zero',()=>{
  assert.match(subscriptionsText({subscriptions:[{clientId:7,name:'Тест'}]},s),/остаток уточняется/);
});
test('Teacher views and student commands keep role isolation',async()=>{
  const messages=[];
  const store={
    connections:async()=>[t,s].filter(x=>x.telegram_user_id===111),
    app:async()=>data,prefs:async()=>({timezone:tz}),redeem:async()=>({status:'invalid'})
  };
  const api={message:async(chat,text,buttons)=>messages.push({chat,text,buttons}),answer:async()=>{}};
  const engine=new BotEngine(store,api,{now:()=>now});
  await engine.handle({message:{from:{id:111},chat:{id:111,type:'private'},text:'/menu'}});
  assert.match(messages.at(-1).text,/Мой кабинет/);
  assert.ok(messages.at(-1).buttons.flat().some(x=>x.callback_data.endsWith(':subs')));
  await engine.handle({message:{from:{id:111},chat:{id:111,type:'private'},text:'/payments'}});
  assert.match(messages.at(-1).text,/только преподавателю/);
  await engine.handle({callback_query:{id:'abc',from:{id:111},message:{chat:{id:111,type:'private'}},data:'v:'+student+':subs'}});
  assert.match(messages.at(-1).text,/3 из 10/);
});
