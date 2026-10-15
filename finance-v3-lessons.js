/* Finance V3: save per-lesson sessions without requiring prepaid package balance. */
(function(){
'use strict';
const baseSave=saveLesson;
saveLesson=function(id){
 const selected=client(Number(document.querySelector('#lClient')?.value));
 const previous=id?db.lessons.find(l=>String(l.id)===String(id)):null;
 if(previous&&!previous.billingMode&&previous.status!=='planned')return baseSave(id);
 const mode=previous?.billingMode||(selected?.billingMode==='per_lesson'?'per_lesson':'subscription');
 if(mode!=='per_lesson')return baseSave(id);
 const amount=Number(document.querySelector('#lHourlyRate')?.value);
 const duration=Number(document.querySelector('#lDuration')?.value);
 const date=document.querySelector('#lDate')?.value,time=document.querySelector('#lTime')?.value;
 if(!selected||!date||!time)return alert('Укажи ученика, дату и время.');
 if(!Number.isFinite(amount)||amount<0||amount>100000000||
    Math.abs(amount*100-Math.round(amount*100))>1e-6)return alert('Укажи корректную ставку.');
 if(!Number.isInteger(duration)||duration<15||duration>240)return alert('Проверь длительность занятия.');
 const l={id:id||crypto.randomUUID(),clientId:Number(selected.id),date,time,
   type:document.querySelector('#lType').value,duration,hourlyRate:amount,
   status:document.querySelector('#lStatus').value,billingMode:'per_lesson'};
 const recurrence=previous?'none':(document.querySelector('#lRecurrence')?.value||'none');
 const weeks=previous?1:(recurrence==='biweekly'?26:52);
 const events=[];
 for(let i=0;i<(recurrence==='none'?1:weeks);i++){
   const day=new Date(date+'T12:00:00');
   day.setDate(day.getDate()+7*i*(recurrence==='biweekly'?2:1));
   events.push({...l,id:i===0?l.id:crypto.randomUUID(),
     date:localDateISO(day),status:i===0?l.status:'planned',recurrence});
 }
 const conflicts=events.flatMap((event,i)=>lessonIsCancelled(event.status)?[]:
   lessonConflicts(event,i===0?id:null).map(existing=>({event,existing})));
 if(conflicts.length){
   const examples=conflicts.slice(0,4).map(x=>(client(x.existing.clientId)?.name||'Ученик')+
     ' · '+x.existing.date+' '+x.existing.time).join('\n');
   return alert('Занятие пересекается с другим в расписании: '+examples);
 }
 if(previous){
   // Never replace historical subscription debits by changing a billing mode.
   if(previous.consumedSubscriptionId||previous.consumedClientFallback)
      return alert('Это занятие уже связано со списанием абонемента. Сначала исправь прежнюю запись.');
   Object.assign(previous,l);
 }else db.lessons.push(...events);
 save();closeModal();render();
};
})();
