import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const src=readFileSync(new URL('../supabase/functions/teacherpro-admin/insights.ts',import.meta.url),'utf8');
const {validPeriod,teacherFinancials,buildInsights}=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(src));
const period={from:'2026-01-01',to:'2026-10-27'};
function fixtures(){
 const teacher='11111111-1111-4111-8111-111111111111';
 const marg='m',vale='v',old='old-sub',fresh='new-sub';
 const lessons=[
  ...Array.from({length:3},(_,i)=>({id:'m'+i,clientId:marg,date:'2026-10-0'+(i+1),status:'done',billingMode:'per_lesson',hourlyRate:1500,duration:60})),
  ...Array.from({length:4},(_,i)=>({id:'o'+i,clientId:vale,date:'2026-10-'+String(i+2).padStart(2,'0'),status:'done',
    consumedSubscriptionId:old,billingMode:i<2?'subscription':undefined,hourlyRate:1350,duration:60})),
  {id:'n1',clientId:vale,date:'2026-10-23',status:'done',billingMode:'subscription',consumedSubscriptionId:fresh,duration:60},
  {id:'soon',clientId:marg,date:'2026-10-27',status:'planned',billingMode:'per_lesson',hourlyRate:1500,duration:60}
 ];
 const payments=[
  {clientId:marg,date:'2026-10-26',type:'single',financeV3Lesson:true,status:'paid',amount:6000},
  {clientId:vale,date:'2026-08-26',type:'subscription',status:'paid',amount:13500,subscriptionId:old},
  {clientId:vale,date:'2026-10-23',type:'subscription',status:'paid',amount:23600,subscriptionId:fresh},
 ];
 const row={user_id:teacher,payload:{clients:[{id:marg,name:'Личные данные Маргариты',telegram:'private'},{id:vale,name:'Личные данные Валерии'}],
 lessons,payments,subscriptions:[
  {id:old,clientId:vale,total:10,remaining:0,price:13500},
  {id:fresh,clientId:vale,total:20,remaining:19,price:23600}
 ],settings:{name:'Кристина'}}};
 return row;
}
test('valid period rejects inverted dates',()=>{
 assert.deepEqual(validPeriod(period),period);
 assert.throws(()=>validPeriod({from:'2026-10-30',to:'2026-10-01'}),/период/);
});
test('teacher ledger splits earned cash, advances and unverified historic debits',()=>{
 const a=teacherFinancials(fixtures(),period).info;
 assert.equal(a.done,8);
 assert.equal(a.planned,1);
 assert.equal(a.earned,11080);
 assert.equal(a.received,43100);
 assert.equal(a.advance,1500);
 assert.equal(a.reserve,22420);
 assert.equal(a.unverified,8100);
 assert.equal(a.unverifiedLessons,6);
 assert.equal(a.received-a.earned,32020);
});
test('fixed lesson price is not multiplied by 80 minutes',()=>{
 const row={user_id:'teacher',payload:{clients:[{id:'a',name:'Sensitive name'}],
 lessons:[{clientId:'a',date:'2026-10-03',status:'done',billingMode:'per_lesson',hourlyRate:1000,duration:80,priceUnit:'lesson'},
 {clientId:'a',date:'2026-10-04',status:'done',billingMode:'per_lesson',hourlyRate:1000,duration:80,priceUnit:'hour'}],
 payments:[],subscriptions:[]}};
 const info=teacherFinancials(row,period).info;
 assert.equal(info.earned,2333.33);
});
test('sensitive student names and contact fields never appear in owner report',()=>{
 const result=teacherFinancials(fixtures(),period);
 const response=JSON.stringify(result);
 assert.doesNotMatch(response,/Личные данные|private|telegram/);
 assert.match(response,/Ученик 1/);
});
test('platform totals exclude owners from callers and preserve periodic reporting',()=>{
 const row=fixtures();
 const out=buildInsights([{id:row.user_id,name:'Преподаватель',students:2,status:'active'}],[row],period);
 assert.equal(out.metrics.done,8);
 assert.equal(out.metrics.received,43100);
 assert.ok(out.trend.find(v=>v.period==='2026-08'&&v.received===13500));
 assert.ok(out.trend.find(v=>v.period==='2026-10'&&v.earned===11080));
});
test('insight module creates period filters and charts without external libraries',()=>{
 const html=readFileSync(new URL('../admin/admin-insights.js',import.meta.url),'utf8');
 const sandbox={window:{},console,Date,Intl};
 runInNewContext(html,sandbox);
 const w=sandbox.window.TPOwnerInsights;
 assert.equal(typeof w.renderDiagnostics,'function');
 assert.equal(typeof w.renderTeacherFinancials,'function');
 assert.equal(typeof w.exportReport,'function');
 const ctx={esc:String,rub:n=>String(n),count:n=>String(n),stat:()=>'',table:()=>'',empty:()=>'',statusBadge:()=>''};
 const rendered=w.renderAnalytics({insights:{period,metrics:{earned:100},teachers:[],trend:[{period:'2026-10',done:3,received:1500,earned:100}]}},ctx);
 assert.match(rendered,/data-action="export_report"/);
 assert.match(rendered,/data-period="30"/);
});
