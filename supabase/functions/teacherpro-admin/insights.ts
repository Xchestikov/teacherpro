// Aggregate-only analytics for TeacherPro owner console. Never returns student names, contacts or lesson notes.
const billable = new Set(["done","no_show_charged","cancelled_charged"]);
const cancelled = new Set(["cancelled","cancelled_by_teacher","no_show","deleted"]);
const arr = value => Array.isArray(value) ? value : [];
const num = v => { const x=Number(v); return Number.isFinite(x) ? x : 0; };
const kop = v => Math.round(num(v)*100);
const rub = kopecks => Math.round(kopecks)/100;
const utcDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s||"")) ? String(s) : "";
const price = l => l.priceUnit==="lesson" ? kop(l.hourlyRate) : Math.round(kop(l.hourlyRate)*(num(l.duration)||60)/60);
const useOn = (v,from,to)=>{const d=utcDate(v);return !!d&&d>=from&&d<=to;};
const pickDate=p=>utcDate(String(p.paidAt||p.date||"").slice(0,10));
const subUnit =s=>num(s.total)>0?Math.round(kop(s.price)/num(s.total)):0;

export function validPeriod(raw){
 const to=utcDate(raw?.to),from=utcDate(raw?.from);
 if(!from||!to||from>to||from<"2000-01-01"||to>"2100-01-01"||
    !Number.isFinite(Date.parse(from+"T00:00:00Z"))||!Number.isFinite(Date.parse(to+"T00:00:00Z")))
   throw Error("Некорректный период");
 if((Date.parse(to+"T00:00:00Z")-Date.parse(from+"T00:00:00Z"))>3660*86400000)throw Error("Слишком большой период");
 return {from,to};
}
export function teacherFinancials(row,period){
 const d=row?.payload||{}, lessons=arr(d.lessons),payments=arr(d.payments),subscriptions=arr(d.subscriptions),clients=arr(d.clients);
 const subMap=new Map(subscriptions.map(s=>[String(s.id),s]));
 const groups=new Map(clients.map((s,i)=>[String(s.id),{
   label:"Ученик "+(i+1),done:0,planned:0,cancelled:0,charged:0,received:0,factEarned:0,factPaid:0,subEarned:0,subReceipts:0,
   unconfirmed:0,reserve:0
 }]));
 let unknown=0;
 function group(id){
   if(groups.has(id))return groups.get(id);
   unknown++;
   const rec={label:"Архивная запись "+unknown,done:0,planned:0,cancelled:0,charged:0,received:0,factEarned:0,factPaid:0,subEarned:0,subReceipts:0,unconfirmed:0,reserve:0};
   groups.set(id,rec);return rec;
 }
 const trend=new Map(),ensure=date=>{
  const key=date.slice(0,7);
  if(!trend.has(key))trend.set(key,{period:key,done:0,earnedCents:0,receivedCents:0,scheduled:0});
  return trend.get(key);
 };
 let fixed=0,hourly=0,legacy=0,unassigned=0;
 for(const l of lessons){
   if(!useOn(l.date,period.from,period.to))continue;
   const g=group(String(l.clientId||"legacy")); const t=ensure(l.date);
   if(l.status==="planned"){g.planned++;t.scheduled++;continue;}
   if(cancelled.has(String(l.status))){g.cancelled++;continue;}
   if(l.status==="done"){g.done++;t.done++;}
   if(!billable.has(String(l.status)))continue;
   g.charged++;
   if(l.billingMode==="per_lesson"){
     const money=price(l);g.factEarned+=money;t.earnedCents+=money;
     if(l.priceUnit==="lesson")fixed++;else if(l.priceUnit==="hour")hourly++;else legacy++;
   }else {
     const sub=subMap.get(String(l.consumedSubscriptionId||""));
     if(sub){const money=subUnit(sub);g.subEarned+=money;t.earnedCents+=money;}
     else unassigned++;
   }
 }
 for(const p of payments){
   if(p.status!=="paid")continue;
   const day=pickDate(p);
   if(!useOn(day,period.from,period.to))continue;
   const g=group(String(p.clientId||"legacy"));const amount=kop(p.amount);
   g.received+=amount;ensure(day).receivedCents+=amount;
   if(p.financeV3Lesson===true||p.financeV3Lesson==="true")g.factPaid+=amount;
   if(p.type==="subscription")g.subReceipts+=amount;
 }
 let unverified=0,reserve=0,gapCount=0;
 for(const s of subscriptions){
   const g=group(String(s.clientId||"legacy")),rate=subUnit(s);
   const spent=Math.max(0,num(s.total)-num(s.remaining));
   const linked=lessons.filter(l=>String(l.consumedSubscriptionId||"")===String(s.id)&&billable.has(String(l.status))&&String(l.date||"")<=period.to).length;
   // A historical balance can contain pre-migration lessons not present in current history.
   const missing=Math.max(0,spent-linked);
   if(missing){gapCount+=missing;unverified+=missing*rate;g.unconfirmed+=missing*rate;}
   // Outstanding subscription lessons are reserved future service, not earned revenue.
   const remainder=Math.max(0,num(s.remaining));
   reserve+=remainder*rate;g.reserve+=remainder*rate;
 }
 const rows=[...groups.values()].filter(g=>g.done||g.planned||g.cancelled||g.received||g.unconfirmed||g.reserve);
 const sum=k=>rows.reduce((total,g)=>total+num(g[k]),0);
 const factPaid=sum("factPaid"),factEarned=sum("factEarned");
 const overpaid=rows.reduce((total,g)=>total+Math.max(0,g.factPaid-g.factEarned),0);
 const factDebt=rows.reduce((total,g)=>total+Math.max(0,g.factEarned-g.factPaid),0);
 const info={
   done:sum("done"),planned:sum("planned"),cancelled:sum("cancelled"),chargeable:sum("charged"),
   received:rub(sum("received")),earned:rub(factEarned+sum("subEarned")),
   factEarned:rub(factEarned),factPaid:rub(factPaid),
   subEarned:rub(sum("subEarned")),subReceipts:rub(sum("subReceipts")),
   advance:rub(overpaid),debt:rub(factDebt),reserve:rub(reserve),
   unverified:rub(unverified),unverifiedLessons:gapCount,
   priceUnitMissing:legacy,priceFixed:fixed,priceHourly:hourly,
   subChargesUnlinked:unassigned,
   historicalDisclaimer:gapCount>0?"Есть использованные занятия по остатку абонемента без подтверждённых списаний в текущей истории. Не включены в подтверждённый заработок.":""
 };
 return {info,students:rows.map(g=>({
   label:g.label,done:g.done,planned:g.planned,earned:rub(g.factEarned+g.subEarned),
   received:rub(g.received),debt:rub(Math.max(0,g.factEarned-g.factPaid)),
   advance:rub(Math.max(0,g.factPaid-g.factEarned)),reserve:rub(g.reserve),unverified:rub(g.unconfirmed)
 })),trend:[...trend.values()].sort((a,b)=>a.period.localeCompare(b.period)).map(t=>({
   period:t.period,done:t.done,planned:t.scheduled,earned:rub(t.earnedCents),received:rub(t.receivedCents)
 }))};
}
export function buildInsights(teachers,rows,period){
 const byId=new Map(rows.map(r=>[r.user_id,r]));
 const perTeacher=teachers.map(t=>{
   const info=teacherFinancials(byId.get(t.id),period).info;
   return {id:t.id,name:t.name||t.email||"Преподаватель",email:t.email||"",lastSignInAt:t.lastSignInAt||null,
     students:t.students||0,status:t.status||"active",...info};
 });
 const sums=k=>Math.round(perTeacher.reduce((n,t)=>n+num(t[k]),0)*100)/100;
 const monthly=new Map();
 for(const t of teachers){
   const f=teacherFinancials(byId.get(t.id),period);
   for(const item of f.trend){
      const row=monthly.get(item.period)||{period:item.period,done:0,planned:0,earned:0,received:0};
      row.done+=item.done;row.planned+=item.planned;row.earned+=item.earned;row.received+=item.received;
      monthly.set(item.period,row);
   }
 }
 const active7=perTeacher.filter(t=>t.lastSignInAt&&Date.now()-Date.parse(t.lastSignInAt)<7*86400000).length;
 const active30=perTeacher.filter(t=>t.lastSignInAt&&Date.now()-Date.parse(t.lastSignInAt)<30*86400000).length;
 return {
   period,teacherCount:teachers.length,active7,active30,
   metrics:{done:sums("done"),planned:sums("planned"),cancelled:sums("cancelled"),
     earned:sums("earned"),received:sums("received"),factEarned:sums("factEarned"),
     subEarned:sums("subEarned"),advance:sums("advance"),debt:sums("debt"),
     reserve:sums("reserve"),unverified:sums("unverified"),unverifiedLessons:sums("unverifiedLessons")},
   trend:[...monthly.values()].sort((a,b)=>a.period.localeCompare(b.period)),
   teachers:perTeacher,
   generatedAt:new Date().toISOString()
 };
}
