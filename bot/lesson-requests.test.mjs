import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BotEngine} from './engine.mjs';
import {hashLessonId,lessonRequestKeyboard} from './presentation.mjs';
const owner='11111111-1111-4111-8111-111111111111';
const studentId='22222222-2222-4222-8222-222222222222';
const teacherId='33333333-3333-4333-8333-333333333333';
const lesson={id:'L-123456789',clientId:101,date:'2026-10-22',time:'18:00',duration:60,status:'planned'};
function fake(role='student'){
 const links=[
  {id:studentId,owner_id:owner,role:'student',status:'active',student_id:'101',telegram_user_id:10101,chat_id:10101},
  {id:teacherId,owner_id:owner,role:'teacher',status:'active',student_id:null,telegram_user_id:20202,chat_id:20202}
 ];
 const app={clients:[{id:101,name:'Тестовая Анна'},{id:102,name:'Другая ученица'}],
   lessons:[lesson,{...lesson,id:'private',clientId:102}]};
 const messages=[],requests=[];
 const store={
  connections:async params=>links.filter(x=>Object.entries(params||{}).every(([k,v])=>
    k==='select'||k==='limit'||String(x[k])===String(v).replace(/^eq\./,''))),
  app:async()=>app,prefs:async()=>({timezone:'Europe/Moscow'}),
  lessonRequest:async(id,actor,lessonId,kind)=>{
    assert.equal(id,studentId);assert.equal(actor,10101);assert.equal(lessonId,lesson.id);
    assert.ok(['cannot_attend','reschedule'].includes(kind));
    const row={id:'99999999-9999-4999-8999-999999999999',owner_id:owner,link_id:studentId,
      kind,student_id:'101',lesson_id:lessonId,status:'pending'};
    requests.push(row);
    return {status:'created',id:row.id,owner_id:owner};
  },
  decideRequest:async(req,actor,outcome)=>{
    assert.equal(actor,20202);assert.equal(req,'99999999-9999-4999-8999-999999999999');
    return {status:outcome,link_id:studentId};
  },
  lessonRequests:async()=>requests
 };
 const telegram={message:async(chat,text,keyboard)=>messages.push({chat,text,keyboard}),answer:async()=>{}};
 const engine=new BotEngine(store,telegram,{now:()=>Date.parse('2026-10-20T10:00:00Z')});
 return {engine,store,telegram,messages,requests,links,app};
}
const callback=(id,data)=>({callback_query:{id:'cb',from:{id},message:{chat:{id,type:'private'}},data}});
test('Student request callbacks fit Telegram limit and disclose no original ID',()=>{
 const rows=lessonRequestKeyboard({id:studentId},[{lesson}]);
 const callbacks=rows.flat().map(b=>b.callback_data);
 assert.ok(callbacks.some(x=>x.includes(hashLessonId(lesson.id))));
 assert.ok(callbacks.every(x=>Buffer.byteLength(x)<=64));
 assert.ok(callbacks.every(x=>!x.includes(lesson.id)));
});
test('Student request reaches teacher without changing lesson or subscription',async()=>{
 const f=fake();
 const before=structuredClone(f.app);
 const req='r:'+studentId+':'+hashLessonId(lesson.id)+':m';
 await f.engine.handle(callback(10101,req));
 assert.equal(f.requests.length,1);
 assert.equal(f.requests[0].kind,'reschedule');
 assert.ok(f.messages.some(m=>m.chat===20202&&m.text.includes('Тестовая Анна')));
 assert.deepEqual(f.app,before);
});
test('Student cannot submit requests for another student lesson',async()=>{
 const f=fake();
 const req='r:'+studentId+':'+hashLessonId('private')+':c';
 await f.engine.handle(callback(10101,req));
 assert.equal(f.requests.length,0);
 assert.ok(f.messages.some(m=>m.text.includes('изменилось')));
});
test('A teacher can triage but cannot silently change schedule or invoices',async()=>{
 const f=fake();
 await f.engine.handle(callback(10101,'r:'+studentId+':'+hashLessonId(lesson.id)+':c'));
 const before=structuredClone(f.app);
 await f.engine.handle(callback(20202,'q:99999999-9999-4999-8999-999999999999:s'));
 assert.deepEqual(f.app,before);
 assert.ok(f.messages.some(m=>m.chat===20202&&m.text.includes('бот не списывает')));
 assert.ok(f.messages.some(m=>m.chat===10101&&m.text.includes('взял его в работу')));
});
test('Foreign teacher callback is rejected before service request',async()=>{
 const f=fake();
 await f.engine.handle(callback(10101,'q:99999999-9999-4999-8999-999999999999:d'));
 assert.equal(f.messages.length,0);
});
