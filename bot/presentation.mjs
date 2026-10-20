// Pure Telegram presentation: no private credentials, writes or mutable app state.
import {dateParts,lessonList,dayLabel} from './logic.mjs';
import {createHash} from 'node:crypto';
export const hashLessonId=id=>createHash('sha256').update(String(id)).digest('hex').slice(0,12);

const safeText=value=>String(value??'').replace(/[\r\n\t]+/g,' ').trim();
const labelLesson=(lesson,role,clients)=>{
  const person=role==='teacher'?' · '+safeText(clients.find(c=>String(c.id)===String(lesson.clientId))?.name||'Ученик'):'';
  return dayLabel(lesson.date)+' · '+lesson.time+' · '+(Number(lesson.duration)||60)+' мин'+person;
};
const button=(link,action,text)=>({text,callback_data:'v:'+link.id+':'+action});

export function homeButtons(link){
  if(link.role==='teacher')return [
    [button(link,'today','📅 Сегодня'),button(link,'week','🗓 Неделя')],
    [button(link,'next','⏰ Ближайшее'),button(link,'students','👥 Ученики')],
    [button(link,'payments','💳 Оплаты'),button(link,'subs','🎟 Абонементы')],
    [button(link,'requests','📨 Запросы учеников')],
    [button(link,link.notifications_enabled?'off':'on',link.notifications_enabled?'🔕 Выключить уведомления':'🔔 Включить уведомления')]
  ];
  return [
    [button(link,'next','⏰ Следующий урок'),button(link,'week','🗓 Расписание')],
    [button(link,'subs','🎟 Абонемент'),button(link,'today','📅 Сегодня')],
    ...(link.role==='student'?[[button(link,'requests','✉️ Запрос переноса')]]:[]),
    [button(link,link.notifications_enabled?'off':'on',link.notifications_enabled?'🔕 Выключить уведомления':'🔔 Включить уведомления')]
  ];
}
export function backButtons(link){
  return [[button(link,'home','← Главное меню')]];
}
export function dashboardText(payload,link,timezone,now=Date.now()){
  const student=link.role!=='teacher';
  const clients=Array.isArray(payload.clients)?payload.clients:[];
  const parts=dateParts(new Date(now),timezone);
  const today=parts.date;
  const events=lessonList(payload,student?link.student_id:null,now,timezone,14);
  const todayItems=events.filter(e=>e.lesson.date===today);
  const next=events[0];
  const notification=link.notifications_enabled?'включены':'выключены';
  if(student){
    return (link.role==='parent'?'👨‍👩‍👧 TeacherPro · Кабинет родителя\n\n':'📚 TeacherPro · Мой кабинет\n\n')+
      (next?'Следующее занятие:\n'+labelLesson(next.lesson,'student',clients):
       'Ближайших занятий пока нет.')+
      '\n\nНапоминания: '+notification+'.\n\nВыберите нужный раздел 👇';
  }
  return '👩‍🏫 TeacherPro · Кабинет преподавателя\n\n'+
    'Сегодня: '+todayItems.length+' '+(todayItems.length===1?'занятие': 'занятий')+'.'+
    (next?'\nБлижайшее:\n'+labelLesson(next.lesson,'teacher',clients):'\nБлижайших занятий пока нет.')+
    '\n\nНапоминания: '+notification+'.\n\nВыберите нужный раздел 👇';
}
export function studentsText(payload){
  const clients=Array.isArray(payload.clients)?payload.clients:[];
  if(!clients.length)return '👥 Ученики\n\nПока нет учеников в TeacherPro.';
  const names=clients.slice(0,15).map((c,i)=>(i+1)+'. '+safeText(c.name||'Ученик')).join('\n');
  return '👥 Ученики · '+clients.length+'\n\n'+names+
    (clients.length>15?'\n…и ещё '+(clients.length-15)+'.':'')+
    '\n\nПодробности доступны в карточках учеников на сайте TeacherPro.';
}
export function subscriptionsText(payload,link){
  const all=Array.isArray(payload.subscriptions)?payload.subscriptions:[];
  const visible=link.role!=='teacher'
    ?all.filter(s=>String(s.clientId)===String(link.student_id))
    :all;
  const open=visible.filter(s=>!s.archivedAt);
  if(!open.length)return '🎟 Абонементы\n\nДействующих абонементов не найдено.';
  const clients=Array.isArray(payload.clients)?payload.clients:[];
  const lines=open.slice(0,12).map(s=>{
    const left=Number(s.remaining),total=Number(s.total);
    const counts=Number.isFinite(left)&&left>=0&&Number.isFinite(total)&&total>=0
      ?Math.max(0,left)+' из '+total+' занятий'
      :'остаток уточняется в TeacherPro';
    const c=link.role==='teacher'?safeText(clients.find(x=>String(x.id)===String(s.clientId))?.name||'Ученик')+' · ':'';
    return '• '+c+safeText(s.name||'Абонемент')+': '+counts;
  });
  return '🎟 Абонементы\n\n'+lines.join('\n')+
    (open.length>12?'\n…и ещё '+(open.length-12)+'.':'')+
    '\n\nАктуальные оплаты и историю списаний смотрите в TeacherPro.';
}
export function paymentsText(payload,link){
  if(link.role!=='teacher')return 'Этот раздел доступен только преподавателю.';
  const subs=Array.isArray(payload.subscriptions)?payload.subscriptions:[];
  const payments=Array.isArray(payload.payments)?payload.payments:[];
  const pending=payments.filter(p=>p?.status==='pending');
  const finishing=subs.filter(s=>!s.archivedAt&&Number.isFinite(Number(s.remaining))&&Number(s.remaining)<=2);
  return '💳 Контроль оплат\n\n'+
    'Ожидают оплаты: '+pending.length+'.\n'+
    'Абонементов с остатком не более 2 занятий: '+finishing.length+'.\n\n'+
    'Суммы, задолженности и действия с оплатами доступны на сайте TeacherPro.';
}


export function lessonRequestKeyboard(link,lessons){
  const rows=lessons.slice(0,5).map(({lesson:l})=>{
    const hash=hashLessonId(l.id);
    const clock=dayLabel(l.date)+' '+l.time;
    return [
      {text:'🚫 '+clock+' · Не смогу',callback_data:'r:'+link.id+':'+hash+':c'},
      {text:'↗ Перенести',callback_data:'r:'+link.id+':'+hash+':m'}
    ];
  });
  return [...rows,...backButtons(link)];
}
