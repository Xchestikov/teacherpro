/* TeacherPro — management of recurring lesson series and holiday intervals.
 * Uses existing db, save, auth and lesson conflict logic. No schema migrations.
 */
(function(){
'use strict';
const $q=s=>document.querySelector(s);
const clean=s=>htmlSafe(String(s??''));
const iso=s=>/^\d{4}-\d\d-\d\d$/.test(s)&&!Number.isNaN(new Date(s+'T12:00:00').getTime());
const at=s=>new Date(s+'T12:00:00');
const addDays=(date,n)=>{const d=at(date);d.setDate(d.getDate()+n);return localDateISO(d);};
const future=l=>l.status==='planned'&&l.date>=todayISO()&&!l.consumedSubscriptionId&&!l.consumedClientFallback;
const blocked=date=>(db.scheduleBreaks||[]).some(b=>b.start<=date&&b.end>=date);
function validTime(v){return /^(?:0[5-9]|1\d|2[0-3]):[0-5]\d$/.test(v)&&lessonMinutes(v)>=300&&lessonMinutes(v)<1440;}
function notify(text){alert(text);}
function snapshot(target){return JSON.parse(JSON.stringify(target));}
function seriesLessons(id){return db.lessons.filter(l=>String(l.seriesId)===String(id)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));}
function seriesList(){
 const groups=new Map();
 for(const l of db.lessons){
  if(!l.seriesId)continue;
  if(!groups.has(String(l.seriesId)))groups.set(String(l.seriesId),[]);
  groups.get(String(l.seriesId)).push(l);
 }
 return [...groups].map(([id,lessons])=>({id,lessons:lessons.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))})).sort((a,b)=>b.lessons[0].date.localeCompare(a.lessons[0].date));
}
function breakForm(){
 db.scheduleBreaks ||= [];
 return '<div class="s4-row"><label>Начало отдыха<input id="s4BreakStart" type="date" value="'+todayISO()+'"></label>'+
 '<label>Конец<input id="s4BreakEnd" type="date" value="'+todayISO()+'"></label></div>'+
 '<label>Причина<input id="s4BreakReason" maxlength="80" placeholder="Отпуск, каникулы, выходные"></label>'+
 '<button class="secondary" type="button" onclick="tpAddBreak()">Добавить период</button>'+
 (db.scheduleBreaks.length?'<div class="s4-break-list">'+db.scheduleBreaks.map(b=>'<div><span>'+clean(b.start)+' — '+clean(b.end)+' · '+clean(b.reason||'Отдых')+'</span>'+
 '<button class="link-btn" type="button" data-break-id="'+clean(b.id)+'" onclick="tpRemoveBreak(this.dataset.breakId)">Убрать</button></div>').join('')+'</div>':
 '<p class="muted">Периодов отдыха пока нет.</p>');
}
function manager(){
 const groups=seriesList();
 const body='<div class="s4-manager"><p class="muted">Настрой серии занятий и периоды отдыха. Уже проведённые уроки и списания сохраняются.</p>'+
 '<h3>Регулярные занятия</h3>'+(groups.length?groups.map(g=>{
   const next=g.lessons.filter(future);
   const first=g.lessons[0];
   return '<div class="s4-series-card"><div><strong>'+clean(client(first.clientId)?.name||'Ученик')+'</strong>'+
    '<small>'+clean(first.time)+' · '+clean(first.recurrence==='biweekly'?'Раз в 2 недели':'Еженедельно')+
    ' · '+g.lessons.length+' занятий · будущих '+next.length+'</small></div>'+
    '<button class="secondary" type="button" data-series-id="'+clean(g.id)+'" onclick="tpEditSeries(this.dataset.seriesId)" '+(!next.length?'disabled':'')+'>Изменить</button></div>';
  }).join(''):'<p class="muted">Создай повторяющееся занятие в календаре — оно появится здесь.</p>')+
 '<h3>Каникулы и отпуск</h3><p class="muted">При создании серии даты отдыха будут пропущены. Для уже запланированных уроков предложим отмену без списания.</p>'+
 breakForm()+'</div>';
 openModal('Управление расписанием',body);
}
window.tpOpenSeriesManager=manager;
window.tpAddBreak=()=>{
 const start=$q('#s4BreakStart')?.value,end=$q('#s4BreakEnd')?.value,reason=$q('#s4BreakReason')?.value.trim()||'Отдых';
 if(!iso(start)||!iso(end)||end<start||Math.round((at(end)-at(start))/86400000)>365)return notify('Укажи корректный период не больше года.');
 const candidates=db.lessons.filter(l=>future(l)&&l.date>=start&&l.date<=end);
 // Explicitly adding a break cancels only uncharged future planned lessons; no secondary confirmation.
 if(!Array.isArray(db.scheduleBreaks))db.scheduleBreaks=[];
 if(db.scheduleBreaks.some(b=>b.start===start&&b.end===end&&b.reason===reason))return notify('Такой период уже существует.');
 db.scheduleBreaks.push({id:crypto.randomUUID(),start,end,reason});
 for(const lesson of candidates)lesson.status='cancelled_by_teacher';

 save();render();manager();
};
window.tpRemoveBreak=id=>{
 const old=(db.scheduleBreaks||[]).find(b=>String(b.id)===String(id));
 if(!old)return;
 db.scheduleBreaks=db.scheduleBreaks.filter(b=>String(b.id)!==String(id));
 save();render();manager();
};
window.tpEditSeries=id=>{
 const futureLessons=seriesLessons(id).filter(future);
 if(!futureLessons.length)return notify('Нет будущих запланированных занятий в этой серии.');
 const first=futureLessons[0];
 const html='<div class="form"><p>Ученик: <strong>'+clean(client(first.clientId)?.name||'Ученик')+'</strong> · '+futureLessons.length+' будущих занятий</p>'+
 '<p class="muted">Изменяются только запланированные уроки серии. Проведённые уроки и списания не затрагиваются.</p>'+
 '<label>Дата, начиная с которой изменить серию<input type="date" id="s4SeriesFrom" value="'+clean(first.date)+'"></label>'+
 '<label>Переместить даты на количество дней<input id="s4DayShift" type="number" step="1" min="-60" max="60" value="0"></label>'+
 '<label><input id="s4KeepTimes" type="checkbox" '+(new Set(futureLessons.map(x=>x.time)).size>1?'checked':'')+' onchange="document.querySelector(\'#s4NewTime\').disabled=this.checked"> Сохранить время каждого дня</label>'+
 '<label>Новое время для всех дней<input id="s4NewTime" type="text" inputmode="numeric" maxlength="5" placeholder="06:15" value="'+clean(first.time)+'" '+(new Set(futureLessons.map(x=>x.time)).size>1?'disabled':'')+'></label>'+
 '<label>Длительность<select id="s4Duration">'+[30,45,60,75,90,105,120,150,180,240].map(n=>'<option value="'+n+'" '+(Number(first.duration)===n?'selected':'')+'>'+n+' минут</option>').join('')+'</select></label>'+
 '<div class="form-actions"><button class="secondary" onclick="tpOpenSeriesManager()">Назад</button>'+
 '<button class="primary" data-series-id="'+clean(id)+'" onclick="tpSaveSeriesChanges(this.dataset.seriesId)">Проверить и применить</button></div></div>';
 openModal('Изменить будущие занятия серии',html);
};
window.tpSaveSeriesChanges=id=>{
 const start=$q('#s4SeriesFrom')?.value,shift=Number($q('#s4DayShift')?.value),time=$q('#s4NewTime')?.value,duration=Number($q('#s4Duration')?.value);
 const keepTimes=$q('#s4KeepTimes')?.checked===true;
 if(!iso(start)||!Number.isInteger(shift)||Math.abs(shift)>60||(!keepTimes&&!validTime(time))||![30,45,60,75,90,105,120,150,180,240].includes(duration)||(!keepTimes&&lessonMinutes(time)+duration>1440))
   return notify('Проверь дату, время, перенос и длительность.');
 const change=seriesLessons(id).filter(l=>future(l)&&l.date>=start);
 if(!change.length)return notify('Будущих занятий для изменения не найдено.');
 const ids=new Set(change.map(x=>String(x.id)));
 const next=change.map(l=>({...l,date:addDays(l.date,shift),time:keepTimes?l.time:time,duration}));
 if(next.some(l=>blocked(l.date)))return notify('Новые даты попадают на каникулы или отпуск. Выбери другой период.');
 // Check against lessons outside the batch AND other target lessons after shift.
 const external=db.lessons.filter(l=>!ids.has(String(l.id))&&!lessonIsCancelled(l.status));
 const conflicts=[];
 for(let i=0;i<next.length;i++){
  const c=next[i],st=lessonMinutes(c.time),en=st+c.duration;
  if(external.some(l=>l.date===c.date&&st<lessonMinutes(l.time)+(Number(l.duration)||60)&&lessonMinutes(l.time)<en))
   conflicts.push(c.date+' '+c.time);
  for(let j=0;j<i;j++)if(next[j].date===c.date&&st<lessonMinutes(next[j].time)+next[j].duration&&lessonMinutes(next[j].time)<en)
   conflicts.push(c.date+' '+c.time);
 }
 if(conflicts.length)return notify('Обнаружены пересечения ('+conflicts.length+'). Изменения не применены:\n'+conflicts.slice(0,4).join('\n'));
 const prompt='Изменить '+change.length+' будущих занятий?\nПеренос: '+shift+' дней, время '+time+', длительность '+duration+' минут.\nПроведённые уроки останутся без изменений.';

 change.forEach((l,i)=>{l.date=next[i].date;l.time=next[i].time;l.duration=duration;});
 save();closeModal();render();
};

const weekdayNames=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const weekIndex=d=>(d.getDay()+6)%7;
const fromISO=value=>new Date(value+'T12:00:00');
const toISO=d=>localDateISO(d);
function selectedWeekdays(){
 const selected=[...document.querySelectorAll('#tpRecurrenceDays input[data-weekday]:checked')];
 return selected.map(field=>{
   const day=Number(field.dataset.weekday);
   const input=document.querySelector('#tpWeekdayTime'+day);
   return {day,time:(input?.value||document.querySelector('#lTime')?.value||'').trim()};
 }).sort((a,b)=>a.day-b.day);
}
window.tpToggleRecurrenceDays=()=>{
 const mode=document.querySelector('#lRecurrence')?.value||'none';
 const group=document.querySelector('#tpRecurrenceDays');if(!group)return;
 group.hidden=mode==='none';
 const picked=selectedWeekdays();
 const timeline=document.querySelector('#tpRecurrenceTimes');
 if(!timeline)return;
 timeline.innerHTML=picked.length>1?picked.map(p=>'<label class="tp-recurrence-time">'+weekdayNames[p.day]+
  '<input id="tpWeekdayTime'+p.day+'" data-weekday-time="'+p.day+'" maxlength="5" inputmode="numeric" type="text" value="'+clean(p.time)+'" placeholder="16:30"></label>').join(''):'';
 const summary=document.querySelector('#tpRecurrenceSummary');
 if(summary)summary.textContent=mode==='none'?'':picked.length?
   'Повторение по выбранным дням без настройки количества недель. Можно позже изменить всю серию.':
   'Выбери хотя бы один день недели.';
};
window.tpRecurrenceDateChanged=()=>{
 const group=document.querySelector('#tpRecurrenceDays');
 if(!group||group.dataset.customized==='true')return;
 const idx=weekIndex(fromISO(document.querySelector('#lDate')?.value||todayISO()));
 for(const field of group.querySelectorAll('input[data-weekday]'))
   field.checked=Number(field.dataset.weekday)===idx;
 window.tpToggleRecurrenceDays();
};
function readSeriesPlan(){
 const selected=selectedWeekdays();
 if(!selected.length)return null;
 if(selected.some(x=>!validTime(x.time)))return null;
 const start=document.querySelector('#lDate')?.value;
 if(!iso(start))return null;
 const mode=document.querySelector('#lRecurrence')?.value;
 const first=fromISO(start),baseDay=weekIndex(first),dates=[];
 // Bound each repeating series to the 52-week window following the chosen date,
 // even when two or more lessons are scheduled in the same week.
 for(let n=0;n<364;n++){
  const day=new Date(first);day.setDate(first.getDate()+n);
  const dayIndex=weekIndex(day);
  const pick=selected.find(x=>x.day===dayIndex);
  if(!pick)continue;
  const week=Math.floor((n+baseDay)/7);
  if(mode==='biweekly'&&week%2!==0)continue;
  dates.push({date:toISO(day),time:pick.time});
 }
 return dates;
}
window.tpRecurrencePlan=readSeriesPlan;
function recurrenceControls(){
 const root=document.querySelector('#modalBody .form');
 const select=document.querySelector('#lRecurrence');
 if(!root||!select||root.querySelector('#tpRecurrenceDays'))return;
 const group=document.createElement('div');group.id='tpRecurrenceDays';
 group.className='tp-recurrence';
 group.dataset.customized='false';
 const day=weekIndex(fromISO(document.querySelector('#lDate')?.value||todayISO()));
 group.innerHTML='<div class="tp-recurrence-heading">В какие дни недели?</div><div class="tp-recurrence-days">'+
  weekdayNames.map((name,i)=>'<label class="tp-recurrence-day"><input type="checkbox" data-weekday="'+i+'" '+(i===day?'checked':'')+'><span>'+name+'</span></label>').join('')+
  '</div><div class="tp-recurrence-times" id="tpRecurrenceTimes"></div><p id="tpRecurrenceSummary" class="muted"></p>';
 select.closest('label')?.after(group);
 group.querySelectorAll('input[data-weekday]').forEach(input=>input.addEventListener('change',()=>{
   group.dataset.customized='true';
   window.tpToggleRecurrenceDays();
 }));
 select.addEventListener('change',window.tpToggleRecurrenceDays);
 document.querySelector('#lDate')?.addEventListener('change',window.tpRecurrenceDateChanged);
 document.querySelector('#lTime')?.addEventListener('change',()=>{
   const times=group.querySelectorAll('[data-weekday-time]');
   if(times.length===1)times[0].value=document.querySelector('#lTime').value;
 });
 window.tpToggleRecurrenceDays();
}
const baseOpenLesson=openLesson;
openLesson=function(...args){
 baseOpenLesson(...args);
 const existing=args[0]?db.lessons.find(l=>String(l.id)===String(args[0])):null;
 const actions=$q('#modalBody .form-actions');
 if(!actions)return;
 if(existing?.seriesId){
  const btn=document.createElement('button');btn.type='button';btn.className='secondary';btn.textContent='Изменить серию';
  btn.onclick=()=>window.tpEditSeries(existing.seriesId);
  actions.prepend(btn);
 }else if(!existing){
 
  recurrenceControls();
 }
};
const baseSaveLesson=saveLesson;
saveLesson=function(id){
 const recurrence=!id?$q('#lRecurrence')?.value:'none';
 if(id||!['weekly','biweekly'].includes(recurrence))return baseSaveLesson(id);
 const person=client($q('#lClient')?.value),date=$q('#lDate')?.value,time=$q('#lTime')?.value;
 const status=$q('#lStatus')?.value,rate=Number($q('#lHourlyRate')?.value),duration=Number($q('#lDuration')?.value);
 const dates=readSeriesPlan(),kind=$q('#lType')?.value;
 if(!person||!iso(date)||!validTime(time)||!dates?.length||
   !Number.isInteger(duration)||duration<15||duration>240||dates.some(x=>lessonMinutes(x.time)+duration>1440)||
   !Number.isFinite(rate)||rate<0||rate>100000000||Math.abs(rate*100-Math.round(rate*100))>1e-6)
   return notify('Проверь выбранные дни, время занятий и длительность.');
 if(status!=='planned')return notify('Серию можно создавать только с запланированным статусом. После проведения отметь нужные уроки отдельно.');
 const seriesId=crypto.randomUUID();
 const events=[],skipped=[];
 for(const occurrence of dates){
  if(blocked(occurrence.date)){skipped.push(occurrence.date);continue;}
  events.push({id:crypto.randomUUID(),seriesId,clientId:person.id,date:occurrence.date,time:occurrence.time,type:kind,duration,hourlyRate:rate,status:'planned',
   recurrence,billingMode:person.billingMode==='per_lesson'?'per_lesson':'subscription'});
 }
 if(!events.length)return notify('Все даты серии попадают на отпуск или каникулы.');
 const conflicts=events.flatMap(candidate=>lessonConflicts(candidate,null).map(other=>candidate.date+' · '+(client(other.clientId)?.name||'Ученик')+' '+other.time));
 if(conflicts.length)return notify('В серии есть пересечения. Ничего не сохранено:\n'+conflicts.slice(0,5).join('\n'));

 db.lessons.push(...events);save();closeModal();render();
};
const nativeSchedule=schedule;
schedule=function(){
 nativeSchedule();
 if(page!=='schedule')return;
 const actions=$q('.calendar-top .calendar-actions');if(!actions||actions.querySelector('.s4-manager-btn'))return;
 const b=document.createElement('button');b.type='button';b.className='secondary s4-manager-btn';b.textContent='Серии и отпуск';b.onclick=manager;
 actions.prepend(b);
};
})();
