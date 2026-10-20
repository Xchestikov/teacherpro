// Pure date and reminder helpers. No Telegram or database credentials in this module.
export const planned = l => l && l.status === 'planned';
export const cancelled = l => ['cancelled','cancelled_by_teacher','deleted','no_show','no_show_charged','cancelled_charged'].includes(l?.status);
export function dateParts(value, zone='UTC') {
 const parts = new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',
   month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
   second:'2-digit',hourCycle:'h23'}).formatToParts(value);
 const obj=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return {date:obj.year+'-'+obj.month+'-'+obj.day,time:obj.hour+':'+obj.minute,
   year:+obj.year,month:+obj.month,day:+obj.day,hour:+obj.hour,minute:+obj.minute,second:+obj.second};
}
export function lessonStart(lesson,zone='UTC') {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(lesson?.date||'')||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(lesson?.time||''))return NaN;
 const guess=Date.parse(lesson.date+'T'+lesson.time+':00Z');
 if(!Number.isFinite(guess))return NaN;
 let result=guess;
 for(let i=0;i<4;i++){
   const p=dateParts(new Date(result),zone);
   const interpreted=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
   const delta=guess-interpreted;
   result+=delta;
   if(!delta)break;
 }
 return result;
}
export function lessonList(payload,studentId=null,now=Date.now(),zone='UTC',days=7) {
 const end=now+days*86400000;
 return (Array.isArray(payload?.lessons)?payload.lessons:[])
   .filter(l=>planned(l)&&(studentId===null||String(l.clientId)===String(studentId)))
   .map(l=>({lesson:l,start:lessonStart(l,zone)}))
   .filter(x=>Number.isFinite(x.start)&&x.start>=now&&x.start<=end)
   .sort((a,b)=>a.start-b.start);
}
export function reminderDue(start,now,hours,grace=4*60000){
 const due=start-hours*3600000;
 return Number.isFinite(due)&&start>now&&now>=due&&now<due+grace;
}
export function dayLabel(date){return date.split('-').reverse().join('.');}
export function teacherName(payload,id){
 return (payload?.clients||[]).find(c=>String(c.id)===String(id))?.name||'Ученик';
}
export function studentName(payload,id){
 return (payload?.clients||[]).find(c=>String(c.id)===String(id))?.name||'';
}
export function scheduleText(payload,link,zone,range='today',now=Date.now()){
 const base=dateParts(new Date(now),zone).date;
 let start=base,end=base;
 if(range==='tomorrow'){
   const d=new Date(base+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);
   start=d.toISOString().slice(0,10);end=start;
 }else if(range==='week'){
   const d=new Date(base+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+6);
   end=d.toISOString().slice(0,10);
 }else if(range==='next'){end='9999-12-31';}
 const list=lessonList(payload,link.role==='teacher'?null:link.student_id,now,zone,range==='next'?370:8)
   .filter(x=>x.lesson.date>=start&&x.lesson.date<=end);
 const selected=range==='next'?list.slice(0,1):list.slice(0,25);
 const label=range==='today'?'Сегодня':range==='tomorrow'?'Завтра':range==='week'?'На ближайшие 7 дней':'Ближайшее занятие';
 if(!selected.length)return label+': запланированных занятий нет.';
 return label+'\n\n'+selected.map(({lesson:l})=>dayLabel(l.date)+' · '+l.time+
   ' · '+(Number(l.duration)||60)+' мин'+(link.role==='teacher'?' · '+teacherName(payload,l.clientId):'')).join('\n')+
   (list.length>25?'\n…ещё занятий: '+(list.length-25):'');
}
export function lessonState(l){return {date:String(l.date||''),time:String(l.time||''),
 duration:Number(l.duration)||60,status:String(l.status||'planned')};}
export function changeText(before,after){
 if(!before||!after)return null;
 if(cancelled(after)&&!cancelled(before)){
   return 'Занятие отменено: '+dayLabel(before.date)+' в '+before.time+'.';
 }
 if(!planned(after)||!planned(before))return null;
 if(before.date!==after.date||before.time!==after.time){
   return 'Занятие перенесено. Новое время: '+dayLabel(after.date)+' в '+after.time+
     ' ('+after.duration+' мин).';
 }
 if(before.duration!==after.duration){
   return 'Изменилась длительность занятия '+dayLabel(after.date)+' в '+after.time+
     ': '+after.duration+' мин.';
 }
 return null;
}
export function digestDue(now,zone,clock,grace=4){
 const p=dateParts(new Date(now),zone);
 const [hour,minute]=(clock||'08:00').split(':').map(Number);
 return Number.isInteger(hour)&&Number.isInteger(minute)&&p.hour===hour&&p.minute>=minute&&p.minute<minute+grace;
}
