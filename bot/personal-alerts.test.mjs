import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BotEngine} from './engine.mjs';
import {resolvedAlerts,alertOptionsKeyboard,alertOptionsText,homeButtons} from './presentation.mjs';

const linkId='22222222-2222-4222-8222-222222222222';
const owner='11111111-1111-4111-8111-111111111111';
const parent={id:linkId,owner_id:owner,role:'parent',student_id:'101',
 telegram_user_id:10101,chat_id:10101,status:'active',notifications_enabled:true,
 reminder_24h_override:null,reminder_2h_override:null,changes_override:null};
const base={timezone:'Europe/Moscow',reminder_24h:true,reminder_2h:false,
 changes_enabled:true};
function fixture(){
 const payload={clients:[{id:101,name:'Тестовая Анна'}],
 lessons:[{id:'L-1',clientId:101,date:'2026-10-21',time:'14:00',status:'planned',duration:60}],
 subscriptions:[]};
 const messages=[],writes=[],link={...parent};
 const store={
  app:async()=>payload,prefs:async()=>base,
  connections:async params=>([link].filter(x=>Object.entries(params).every(([k,v])=>
    k==='select'||k==='limit'||String(x[k])===String(v).replace(/^eq\./,'')))),
  update:async(_table,id,patch)=>{assert.equal(id,linkId);Object.assign(link,patch);writes.push(patch);},
  snapshots:async()=>[],snapshot:async()=>{},claim:async()=>true,deliveryStatus:async()=>{}
 };
 const api={message:async(chat,text,keyboard)=>messages.push({chat,text,keyboard}),answer:async()=>{}};
 const engine=new BotEngine(store,api,{now:()=>Date.parse('2026-10-20T11:00:00Z')});
 const tap=(id,code)=>engine.handle({callback_query:{id:'cb1',from:{id},message:{chat:{id,type:'private'}},data:'v:'+linkId+':'+code}});
 return {engine,api,store,messages,writes,tap,link,payload};
}
test('Inherited reminder preferences preserve previous teacher settings',()=>{
 assert.deepEqual(resolvedAlerts(parent,base),{r24:true,r2:false,chg:true});
 const kb=alertOptionsKeyboard(parent,base);
 assert.equal(kb.length,4);
 assert.ok(kb.flat().every(x=>Buffer.byteLength(x.callback_data)<=64));
 assert.ok(homeButtons(parent).flat().some(x=>x.callback_data.endsWith(':alerts')));
 assert.match(alertOptionsText(parent,base),/24 часа/);
});
test('Parent can turn on 2h reminders for their own Telegram link',async()=>{
 const f=fixture();
 await f.tap(10101,'alerts');
 assert.equal(f.messages.length,1);
 assert.match(f.messages[0].text,/2 часа до урока: выключено/);
 await f.tap(10101,'r2');
 assert.deepEqual(f.writes,[{reminder_2h_override:true}]);
 assert.match(f.messages.at(-1).text,/2 часа до урока: включено/);
 await f.tap(10101,'r2');
 assert.deepEqual(f.writes.at(-1),{reminder_2h_override:false});
});
test('Foreign actors and wrong callbacks cannot change reminder settings',async()=>{
 const f=fixture();
 await f.tap(10102,'r2');
 assert.equal(f.writes.length,0);
 await f.engine.handle({callback_query:{id:'cb2',from:{id:10101},
  message:{chat:{id:10101,type:'private'}},
  data:'v:33333333-3333-4333-8333-333333333333:r24'}});
 assert.equal(f.writes.length,0);
});
test('Parent can disable only their own 24h reminder and change alerts without changing teacher defaults',async()=>{
 const f=fixture();
 await f.tap(10101,'r24');
 await f.tap(10101,'chg');
 assert.deepEqual(f.writes,[{reminder_24h_override:false},{changes_override:false}]);
 assert.deepEqual(resolvedAlerts(f.link,base),{r24:false,r2:false,chg:false});
 assert.equal(base.reminder_24h,true);
 assert.equal(base.changes_enabled,true);
});
test('Per-link preferences filter real reminder deliveries and change alerts',async()=>{
 const f=fixture();
 const snapshots=new Map(),deliveries=[];
 f.store.claim=async()=>true;
 f.api.message=async(chat,text)=>deliveries.push({chat,text});
 f.store.snapshots=async()=>[...snapshots.entries()].map(([lesson_id,state])=>({lesson_id,state}));
 f.store.snapshot=async(_o,id,state)=>snapshots.set(String(id),state);
 const now=Date.parse('2026-10-20T11:00:00Z'); // Lesson tomorrow 14:00 Moscow is 11:00 UTC.
 f.link.reminder_24h_override=false;
 f.link.reminder_2h_override=false;
 await f.engine.pollOwner(owner,[f.link],now);
 assert.equal(deliveries.filter(x=>x.text.includes('Напоминание')).length,0);
 // Detect a schedule change, but parent has opted out.
 f.link.changes_override=false;
 f.payload.lessons[0].time='15:00';
 await f.engine.pollOwner(owner,[f.link],now);
 assert.equal(deliveries.length,0);
 // Opt back in: only future changes should now be delivered.
 f.link.changes_override=true;
 f.payload.lessons[0].time='16:00';
 await f.engine.pollOwner(owner,[f.link],now);
 assert.equal(deliveries.filter(x=>x.text.includes('перенесено')).length,1);
});
