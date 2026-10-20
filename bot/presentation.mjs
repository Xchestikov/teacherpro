// Pure Telegram presentation: no private credentials, writes or mutable app state.
import {dateParts,lessonList,dayLabel} from './logic.mjs';
import {createHash} from 'node:crypto';
import {studentFinances,teacherFinances,activeSubscriptions,remainingBalance} from './finance.mjs';
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
    [button(link,'alerts','⚙️ Напоминания')],
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
  if(link.role!=='teacher')return studentFinances(payload,link.student_id);
  const all=activeSubscriptions(payload);
  if(!all.length)return '🎟 Абонементы\n\nДействующих абонементов не найдено.';
  const clients=Array.isArray(payload.clients)?payload.clients:[];
  const lines=all.slice(0,12).map(s=>{
    const b=remainingBalance(s);
    const name=clients.find(c=>String(c.id)===String(s.clientId))?.name||'Ученик';
    return '• '+safeText(name)+' · '+safeText(s.name||'Абонемент')+': '+
      (b?b.remaining+' из '+b.total+' занятий':'остаток уточняется в TeacherPro');
  });
  return '🎟 Абонементы\n\n'+lines.join('\n')+
    (all.length>12?'\n…и ещё '+(all.length-12)+'.':'')+
    '\n\nИстория списаний и продление доступны в TeacherPro.';
}
export function paymentsText(payload,link){
  if(link.role!=='teacher')return 'Этот раздел доступен только преподавателю.';
  return teacherFinances(payload);
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

export function resolvedAlerts(link,prefs={}){
  return {
    r24:link.reminder_24h_override??prefs.reminder_24h??true,
    r2:link.reminder_2h_override??prefs.reminder_2h??false,
    chg:link.changes_override??prefs.changes_enabled??true
  };
}
export function alertOptionsText(link,prefs={}){
  const opts=resolvedAlerts(link,prefs);
  const state=x=>x?'включено':'выключено';
  return '🔔 Мои напоминания\n\n'+
    'За 24 часа до урока: '+state(opts.r24)+'.\n'+
    'За 2 часа до урока: '+state(opts.r2)+'.\n'+
    'Переносы и отмены: '+state(opts.chg)+'.\n\n'+
    (!link.notifications_enabled?'⚠️ Все уведомления сейчас отключены. Включите их из главного меню.\n\n':'')+
    'Настройки действуют только для вашего Telegram-аккаунта. Они не меняют настройки преподавателя и других участников.';
}
export function alertOptionsKeyboard(link,prefs={}){
  const opts=resolvedAlerts(link,prefs);
  const label=(name,on)=>(on?'✅ ':'⬜ ')+name;
  return [
    [button(link,'r24',label('За 24 часа',opts.r24))],
    [button(link,'r2',label('За 2 часа',opts.r2))],
    [button(link,'chg',label('Переносы и отмены',opts.chg))],
    ...backButtons(link)
  ];
}
