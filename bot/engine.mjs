import {createHash} from 'node:crypto';
import {dateParts,lessonStart,lessonList,planned,cancelled,reminderDue,lessonState,changeText,
  scheduleText,digestDue,dayLabel} from './logic.mjs';
import {homeButtons,backButtons,dashboardText,studentsText,subscriptionsText,paymentsText,hashLessonId,lessonRequestKeyboard,lowSubscriptions} from './presentation.mjs';

export function chooseButtons(links){
 return links.slice(0,20).map(link=>[{text:link.role==='teacher'?'👩‍🏫 Мой кабинет преподавателя':link.role==='parent'?'👨‍👩‍👧 Кабинет родителя':'📚 Мой кабинет ученика',
   callback_data:'v:'+link.id+':home'}]);
}
export function menu(link){return homeButtons(link);}
function uniqueOwners(links){return [...new Set(links.map(x=>x.owner_id))];}
const hash=message=>createHash('sha256').update(message).digest('hex').slice(0,32);
export class BotEngine {
 constructor(store,telegram,{now=()=>Date.now(),log=console}={}) {
   this.store=store;this.telegram=telegram;this.now=now;this.log=log;
 }
 async withDelivery(link,key,text) {
   if(link.status!=='active'||!link.notifications_enabled)return false;
   if(!await this.store.claim(link.id,key))return false;
   try {
     await this.telegram.message(link.chat_id,text);
     await this.store.deliveryStatus(link.id,key,'sent');return true;
   } catch(err) {
     await this.store.deliveryStatus(link.id,key,'failed',String(err?.message||'delivery error')).catch(()=>{});
     if(String(err?.message||'').includes('HTTP 403')){
       await this.store.update('tp_telegram_links',link.id,{notifications_enabled:false}).catch(()=>{});
     }
     this.log.warn('Telegram delivery failed for link '+link.id);
     return false;
   }
 }
 async views(userId,link,range) {
   const [payload,prefs]=await Promise.all([this.store.app(link.owner_id),this.store.prefs(link.owner_id)]);
   const timezone=prefs.timezone||'UTC';
   if(range==='home'){
     await this.telegram.message(userId,dashboardText(payload,link,timezone,this.now()),menu(link));
   } else if(range==='students'&&link.role==='teacher'){
     await this.telegram.message(userId,studentsText(payload),backButtons(link));
   } else if(range==='subs'){
     await this.telegram.message(userId,subscriptionsText(payload,link),backButtons(link));
   } else if(range==='requests'){
     if(link.role==='student'){
       const lessons=lessonList(payload,link.student_id,this.now(),timezone,14).slice(0,5);
       await this.telegram.message(userId,lessons.length?
         '✉️ Запрос по занятию\n\nВыберите занятие и действие. Запрос будет отправлен преподавателю. Расписание и оплата пока не изменятся.':
         'Ближайших занятий для запроса нет.',lessonRequestKeyboard(link,lessons));
     }else if(link.role==='teacher'){
       const items=await this.store.lessonRequests(link.owner_id);
       if(!items.length){
         await this.telegram.message(userId,'📨 Новых запросов учеников пока нет.',backButtons(link));
       }else{
         const clients=Array.isArray(payload.clients)?payload.clients:[];
         for(const item of items.slice(0,8)){
           const name=clients.find(c=>String(c.id)===String(item.student_id))?.name||'Ученик';
           const kind=item.kind==='reschedule'?'Просит перенести занятие':'Не сможет прийти';
           const l=(payload.lessons||[]).find(l=>String(l.id)===String(item.lesson_id));
           const when=l?l.date+' · '+l.time:'занятие из расписания';
           await this.telegram.message(userId,'📨 '+name+'\n'+kind+'\n'+when,
             [[{text:'Взять в работу',callback_data:'q:'+item.id+':s'},
               {text:'Отклонить запрос',callback_data:'q:'+item.id+':d'}]]);
         }
         await this.telegram.message(userId,'После принятия запроса внесите изменение в расписание TeacherPro.',backButtons(link));
       }
     }
   } else if(range==='payments'&&link.role==='teacher'){
     await this.telegram.message(userId,paymentsText(payload,link),backButtons(link));
   } else if(['today','tomorrow','week','next'].includes(range)){
     await this.telegram.message(userId,scheduleText(payload,link,timezone,range,this.now()),[
       ...backButtons(link),...menu(link).slice(0,2)
     ]);
   }
 }
 async handle(update) {
   const message=update.message,callback=update.callback_query;
   const actor=message?.from||callback?.from;
   const chat=message?.chat||callback?.message?.chat;
   if(!actor?.id||!chat||chat.type!=='private'||Number(actor.id)!==Number(chat.id))return;
   const id=Number(actor.id),text=(message?.text||'').trim();
   if(callback?.id)await this.telegram.answer(callback.id).catch(()=>{});
   if(text.startsWith('/start ')){
     const token=text.slice(7).trim();
     if(!/^[a-f0-9]{64}$/.test(token)){
       await this.telegram.message(id,'Ссылка подключения неверна или устарела. Запросите новую в TeacherPro.');
       return;
     }
     const result=await this.store.redeem(token,id,id);
     const msg=result?.status==='active'?'Аккаунт TeacherPro подключён! Откройте главное меню командой /menu.':
       result?.status==='pending'?'Запрос отправлен преподавателю. После подтверждения вам станет доступно расписание.':
       'Ссылка истекла или уже использована. Создайте новую ссылку в TeacherPro.';
     await this.telegram.message(id,msg);return;
   }
   const links=await this.store.connections({telegram_user_id:'eq.'+id,status:'eq.active'});
   if(callback?.data?.startsWith('r:')){
     const match=/^r:([a-f0-9-]{36}):([a-f0-9]{12}):([cm])$/.exec(callback.data);
     if(!match)return;
     const link=links.find(x=>x.id===match[1]&&x.role==='student');
     if(!link)return;
     const [payload,prefs]=await Promise.all([this.store.app(link.owner_id),this.store.prefs(link.owner_id)]);
     const events=lessonList(payload,link.student_id,this.now(),prefs.timezone||'UTC',14);
     const lesson=events.find(x=>hashLessonId(x.lesson.id)===match[2])?.lesson;
     if(!lesson){await this.telegram.message(id,'Занятие изменилось. Откройте список заново.',backButtons(link));return;}
     const kind=match[3]==='c'?'cannot_attend':'reschedule';
     const result=await this.store.lessonRequest(link.id,id,lesson.id,kind);
     if(result.status==='created'){
       await this.telegram.message(id,'Запрос отправлен преподавателю. Расписание и остаток оплаченных занятий пока не изменились.',backButtons(link));
       const teachers=await this.store.connections({owner_id:'eq.'+link.owner_id,role:'eq.teacher',status:'eq.active'});
       const name=(payload.clients||[]).find(c=>String(c.id)===String(link.student_id))?.name||'Ученик';
       for(const teacher of teachers){
         await this.telegram.message(teacher.chat_id,
           '📨 Новый запрос · '+name+'\n'+
           (kind==='reschedule'?'Перенести занятие':'Не сможет прийти')+'\n'+
           lesson.date+' · '+lesson.time+'\n'+
           'Подтверждение запроса не меняет само занятие или оплату.',
           [[{text:'Взять в работу',callback_data:'q:'+result.id+':s'},
             {text:'Отклонить запрос',callback_data:'q:'+result.id+':d'}]]);
       }
     }else{
       await this.telegram.message(id,result.status==='existing'?
         'Такой запрос уже отправлен преподавателю.':'Не удалось отправить запрос. Попробуйте позднее.',backButtons(link));
     }
     return;
   }
   if(callback?.data?.startsWith('q:')){
     const match=/^q:([a-f0-9-]{36}):([sd])$/.exec(callback.data);
     if(!match||!links.some(x=>x.role==='teacher'))return;
     const outcome=await this.store.decideRequest(match[1],id,match[2]==='s'?'seen':'declined');
     if(!['seen','declined'].includes(outcome?.status)){
       await this.telegram.message(id,'Этот запрос уже закрыт или недоступен.');return;
     }
     await this.telegram.message(id,outcome.status==='seen'?
       'Запрос взят в работу. Измените занятие в TeacherPro — бот не списывает и не переносит его автоматически.':
       'Запрос отклонён. Расписание не изменено.');
     const original=await this.store.connections({id:'eq.'+outcome.link_id,status:'eq.active',role:'eq.student'});
     for(const link of original)await this.telegram.message(link.chat_id,outcome.status==='seen'?
       'Преподаватель получил ваш запрос и взял его в работу. Дождитесь изменения расписания.':
       'Преподаватель отклонил запрос. Занятие остаётся в прежнем расписании.');
     return;
   }
   if(callback?.data?.startsWith('v:')){
     const match=/^v:([a-f0-9-]{36}):(home|today|tomorrow|week|next|students|subs|payments|requests|off|on)$/.exec(callback.data);
     if(!match)return;
     const link=links.find(x=>x.id===match[1]);
     if(!link)return; // Never trust callback payload without ownership check.
     if(match[2]==='off'||match[2]==='on'){
       const enabled=match[2]==='on';
       await this.store.update('tp_telegram_links',link.id,{notifications_enabled:enabled});
       await this.telegram.message(id,enabled?'Уведомления включены.':'Уведомления выключены.',menu({...link,notifications_enabled:enabled}));
     } else await this.views(id,link,match[2]);
     return;
   }
   if(text==='/start'||text==='/menu'||text==='/help'||!text||text==='/schedule'){
     if(!links.length){await this.telegram.message(id,'Добро пожаловать в TeacherPro! Подключите Telegram в настройках TeacherPro или по приглашению преподавателя.');return;}
     if(links.length===1){await this.views(id,links[0],'home');return;}
     await this.telegram.message(id,'Выберите профиль TeacherPro:',chooseButtons(links));return;
   }
   const intent={'/today':'today','/tomorrow':'tomorrow','/week':'week','/next':'next',
     '/students':'students','/balance':'subs','/payments':'payments','/requests':'requests'}[text];
   if(intent){
     if(links.length===1){
       const link=links[0];
       if((intent==='payments'||intent==='students')&&link.role!=='teacher'){
         await this.telegram.message(id,'Этот раздел доступен только преподавателю.');
       }else await this.views(id,link,intent);
     }
     else if(links.length)await this.telegram.message(id,'Выберите нужный профиль:',chooseButtons(links));
     else await this.telegram.message(id,'Сначала подключите профиль из TeacherPro.');
     return;
   }
   await this.telegram.message(id,'Используйте /menu для просмотра расписания и управления уведомлениями.');
 }
 async pollOwner(owner,links,now){
   const [payload,prefs]=await Promise.all([this.store.app(owner),this.store.prefs(owner)]);
   const tz=prefs.timezone||'UTC';
   try{dateParts(new Date(now),tz);}catch{this.log.warn('Unknown Telegram timezone');return;}
   const teacher=links.filter(l=>l.role==='teacher');
   for(const t of teacher){
     if(prefs.teacher_digest&&digestDue(now,tz,prefs.digest_time)){
       const key='digest:'+dateParts(new Date(now),tz).date;
       const text=scheduleText(payload,t,tz,'today',now);
       const low=lowSubscriptions(payload);
       const clients=Array.isArray(payload.clients)?payload.clients:[];
       const upcoming=low.length?'\n\nСкоро заканчиваются абонементы:\n'+
         low.slice(0,8).map(sub=>{
           const student=clients.find(c=>String(c.id)===String(sub.clientId));
           return '• '+(student?.name||'Ученик')+': осталось '+Number(sub.remaining);
         }).join('\n'):'';
       await this.withDelivery(t,key,'Утренняя сводка TeacherPro\n\n'+text+upcoming);
     }
   }
   const students=links.filter(l=>l.role==='student'||l.role==='parent');
   if(!students.length)return;
   const future=(payload.lessons||[]).filter(l=>l&&l.id!==undefined&&
      (planned(l)||cancelled(l))&&Number.isFinite(lessonStart(l,tz)))
     .filter(l=>{const start=lessonStart(l,tz);return start>=now-2*86400000&&start<now+30*86400000;});
   const previousRows=await this.store.snapshots(owner);
   const previous=new Map(previousRows.map(x=>[String(x.lesson_id),x.state]));
   for(const l of future){
     const state=lessonState(l),before=previous.get(String(l.id));
     const recipients=students.filter(link=>String(link.student_id)===String(l.clientId));
     if(before&&prefs.changes_enabled){
       const msg=changeText(before,state);
       if(msg){
         const signature=hash(JSON.stringify(state));
         for(const link of recipients){
           await this.withDelivery(link,'change:'+l.id+':'+signature,msg);
         }
       }
     }
     // A first observation establishes a baseline. No historical notifications.
     await this.store.snapshot(owner,l.id,state);
   }
   for(const link of students){
     const events=lessonList(payload,link.student_id,now,tz,2);
     for(const {lesson:l,start} of events){
       for(const [hours,enabled] of [[24,prefs.reminder_24h],[2,prefs.reminder_2h]]){
         if(enabled&&reminderDue(start,now,hours)){
           const text='Напоминание TeacherPro: занятие '+dayLabel(l.date)+' в '+l.time+
             ', продолжительность '+(Number(l.duration)||60)+' мин.';
           const key='remind:'+l.id+':'+hours+':'+l.date+':'+l.time;
           await this.withDelivery(link,key,text);
         }
       }
     }
   }
 }
 async poll(){
   const links=await this.store.connections({status:'eq.active'});
   const now=this.now();
   for(const owner of uniqueOwners(links)){
     try{await this.pollOwner(owner,links.filter(x=>x.owner_id===owner),now);}
     catch(err){this.log.warn('Telegram worker error for owner '+owner+': '+String(err?.message||'error'));}
   }
 }
}
