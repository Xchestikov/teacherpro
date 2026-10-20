import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getInitialOffset,pollBatch,serve} from './daemon.mjs';
import {reminders} from './reminders.mjs';

function fixture(events=[]){
 const processed=new Set(),handled=[];
 const store={
   rows:async()=>[...processed].sort((a,b)=>b-a).slice(0,1).map(update_id=>({update_id})),
   claimUpdate:async id=>{if(processed.has(id))return false;processed.add(id);return true;},
   releaseUpdate:async id=>{processed.delete(id);}
 };
 const telegram={call:async(method,args)=>{
   if(method==='getWebhookInfo')return {url:''};
   assert.equal(method,'getUpdates');
   assert.equal(args.timeout,8);
   return events.filter(x=>x.update_id>=args.offset);
 }};
 const engine={handle:async event=>handled.push(event.update_id),poll:async()=>{}};
 return {store,telegram,engine,handled,processed};
}
test('Persistent polling resumes from durable Supabase update cursor',async()=>{
 const f=fixture([{update_id:31},{update_id:32}]);
 assert.equal(await getInitialOffset(f.store),0);
 let a=await pollBatch(f.store,f.telegram,f.engine,0);
 assert.equal(a.offset,33);
 assert.deepEqual(f.handled,[31,32]);
 assert.equal(await getInitialOffset(f.store),33);
 a=await pollBatch(f.store,f.telegram,f.engine,33);
 assert.equal(a.count,0);
 assert.deepEqual(f.handled,[31,32]);
});
test('A failed handler releases claim and retries the same update',async()=>{
 const f=fixture([{update_id:12}]);let fail=true;
 f.engine.handle=async event=>{if(fail){fail=false;throw Error('transient')}f.handled.push(event.update_id)};
 await assert.rejects(pollBatch(f.store,f.telegram,f.engine,0),/transient/);
 assert.equal(f.processed.size,0);
 await pollBatch(f.store,f.telegram,f.engine,0);
 assert.deepEqual(f.handled,[12]);
});
test('Persistent mode loops over multiple batches immediately and maintains heartbeat',async()=>{
 const f=fixture([{update_id:1}]);let health=0,count=0;
 f.telegram.call=async method=>{
   if(method==='getWebhookInfo')return {url:''};
   if(method==='getUpdates'){count++;return count===1?[{update_id:1}]:[]}
 };
 await serve({...f,heartbeat:()=>{health++;},stopped:()=>count>=3,log:{log(){},warn(){}}});
 assert.equal(count,3);
 assert.equal(health,3);
 assert.deepEqual(f.handled,[1]);
});
test('A transient transport failure backs off then recovers',async()=>{
 const f=fixture();let calls=0,delayMs=[];
 f.telegram.call=async method=>{
   if(method==='getWebhookInfo')return {url:''};
   calls++;
   if(calls===1)throw Error('do not log secrets');
   return [];
 };
 await serve({...f,stopped:()=>calls>=2,delay:async ms=>{delayMs.push(ms)},
   log:{log(){},warn(s){assert.match(s,/^TELEGRAM_FAST_RETRY_1$/);}}});
 assert.deepEqual(delayMs,[1000]);
});
test('A webhook prevents competing polling on the same bot',async()=>{
 const f=fixture();f.telegram.call=async()=>({url:'https://example.org/webhook'});
 await assert.rejects(serve({...f}),/webhook is enabled/);
});
test('Reminder job never fetches Telegram updates',async()=>{
 let ran=0;
 await reminders({engine:{poll:async()=>{ran++}},log:{log(){}}});
 assert.equal(ran,1);
});
