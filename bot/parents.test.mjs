import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dashboardText,subscriptionsText,homeButtons,paymentsText} from './presentation.mjs';
import {scheduleText} from './logic.mjs';
import {BotEngine} from './engine.mjs';

const uuid='22222222-2222-4222-8222-222222222222';
const owner='11111111-1111-4111-8111-111111111111';
const parent={id:uuid,role:'parent',owner_id:owner,student_id:'1',
  telegram_user_id:91,chat_id:91,notifications_enabled:true,status:'active'};
const app={
 clients:[{id:1,name:'Мой ребёнок'},{id:2,name:'Чужой ребёнок'}],
 lessons:[
  {id:'own',clientId:1,date:'2026-10-20',time:'16:30',duration:60,status:'planned'},
  {id:'other',clientId:2,date:'2026-10-20',time:'17:30',duration:60,status:'planned'}
 ],
 subscriptions:[
  {id:'own-sub',clientId:1,name:'Пакет моего ребёнка',total:10,remaining:4},
  {id:'other-sub',clientId:2,name:'Пакет другого ребёнка',total:12,remaining:9}
 ]};
test('Parent can see only their linked child schedule and subscription',()=>{
 const now=Date.parse('2026-10-19T11:30:00Z'),zone='Europe/Moscow';
 for(const visible of [
   scheduleText(app,parent,zone,'week',now),
   dashboardText(app,parent,zone,now),
   subscriptionsText(app,parent)
 ]){
   assert.doesNotMatch(visible,/Чужой ребёнок|другого ребёнка|17:30|12 занятий|9 из 12/);
 }
 assert.match(subscriptionsText(app,parent),/4 из 10/);
 assert.match(dashboardText(app,parent,zone,now),/Кабинет родителя/);
});
test('Parent menu has no teacher or student mutation actions',()=>{
 const actions=homeButtons(parent).flat().map(x=>x.callback_data);
 assert.ok(!actions.some(x=>/(payments|students|requests)/.test(x)));
 assert.match(paymentsText(app,parent),/только преподавателю/);
});
test('A parent cannot handle another owner teacher callback',async()=>{
 const log=[];
 const store={connections:async()=>[parent],app:async()=>app,
 prefs:async()=>({timezone:'Europe/Moscow'})};
 const tg={message:async(chat,text)=>log.push({chat,text}),answer:async()=>{}};
 const engine=new BotEngine(store,tg,{now:()=>Date.parse('2026-10-19T11:30:00Z')});
 await engine.handle({callback_query:{id:'cb',from:{id:91},message:{chat:{type:'private',id:91}},
   data:'v:33333333-3333-4333-8333-333333333333:students'}});
 assert.equal(log.length,0);
 await engine.handle({message:{from:{id:91},chat:{id:91,type:'private'},text:'/week'}});
 assert.match(log[0].text,/16:30/);
 assert.doesNotMatch(log[0].text,/17:30/);
});
