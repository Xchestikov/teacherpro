import {test} from 'node:test';
import assert from 'node:assert/strict';
import {processUpdates,runCron} from './cron.mjs';

function fixture(events=[]){
 const processed=new Set(),handled=[],logs=[];
 let apiCalls=0,notifications=0;
 const store={
   async rows(){return [...processed].sort((a,b)=>b-a).slice(0,1).map(update_id=>({update_id}));},
   async claimUpdate(id){if(processed.has(id))return false;processed.add(id);return true;},
   async releaseUpdate(id){processed.delete(id);}
 };
 const telegram={async call(method,args){
   if(method==='getWebhookInfo')return {url:''};
   assert.equal(method,'getUpdates');
   apiCalls++;
   return events.filter(e=>e.update_id>=args.offset).slice(0,100);
 }};
 const engine={async handle(u){handled.push(u.update_id);},async poll(){notifications++;}};
 return {store,telegram,engine,processed,handled,logs,getCalls:()=>apiCalls,getNotifications:()=>notifications};
}
test('Cron polls each Telegram update once and resumes from durable offset',async()=>{
 const f=fixture([{update_id:1},{update_id:2},{update_id:3}]);
 await processUpdates(f.store,f.telegram,f.engine,{log:{log() {}}});
 await processUpdates(f.store,f.telegram,f.engine,{log:{log() {}}});
 assert.deepEqual(f.handled,[1,2,3]);
 assert.equal(f.getCalls(),2);
 assert.equal(f.processed.size,3);
});
test('Cron does not advance after handler failure; failed update retries',async()=>{
 const f=fixture([{update_id:20},{update_id:21}]);let once=true;
 f.engine.handle=async u=>{if(u.update_id===20&&once){once=false;throw Error('temporary')}f.handled.push(u.update_id)};
 await assert.rejects(processUpdates(f.store,f.telegram,f.engine,{log:{log() {}}}),/temporary/);
 assert.equal(f.processed.size,0);
 await processUpdates(f.store,f.telegram,f.engine,{log:{log() {}}});
 assert.deepEqual(f.handled,[20,21]);
});
test('Run refuses to consume updates while a Telegram webhook is active',async()=>{
 const f=fixture([{update_id:10}]);
 f.telegram.call=async name=>name==='getWebhookInfo'?{url:'https://other.example/webhook'}:[];
 await assert.rejects(runCron({store:f.store,telegram:f.telegram,engine:f.engine}),/webhook configured/);
 assert.equal(f.getNotifications(),0);
 assert.deepEqual(f.handled,[]);
});
test('Cron calls reminder scheduler after processing even with no updates',async()=>{
 const f=fixture();
 await runCron({store:f.store,telegram:f.telegram,engine:f.engine,log:{log() {}}});
 assert.equal(f.getNotifications(),1);
});
