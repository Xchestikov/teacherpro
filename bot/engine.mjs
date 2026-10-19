import {createHash} from 'node:crypto';
import {dateParts,lessonStart,lessonList,planned,cancelled,reminderDue,lessonState,changeText,
  scheduleText,digestDue,dayLabel} from './logic.mjs';

export function chooseButtons(links){
 return links.slice(0,20).map(link=>[{text:link.role==='teacher'?'Мой кабинет преподавателя':'Моё расписание ученика',
   callback_data:'v:'+link.id+':today'}]);
}
export function menu(link){
 return [
  [{text:'Сегодня',callback_data:'v:'+link.id+':today'},{text:'Завтра',callback_data:'v:'+link.id+':tomorrow'}],
  [{text:'Неделя',callback_data:'v:'+link.id+':week'},{text:'Ближайшее занятие',callback_data:'v:'+link.id+':next'}],
  [{text:link.notifications_enabled?'Выключить уведомления':'Включить уведомления',
    callback_data:'v:'+link.id+':'+(link.notifications_enabled?'off':'on')}]
 ];
}
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
   await this.telegram.message(userId,scheduleText(payload,link,prefs.timezone,range,this.now()),menu(link));
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
     const msg=result?.status==='active'?'Аккаунт TeacherPro подключён. Выберите расписание командой /menu.':
       result?.status==='pending'?'Запрос отправлен преподавателю. После подтверждения вам станет доступно расписание.':
       'Ссылка истекла или уже использована. Создайте новую ссылку в TeacherPro.';
     await this.telegram.message(id,msg);return;
   }
   const links=await this.store.connections({telegram_user_id:'eq.'+id,status:'eq.active'});
   if(callback?.data?.startsWith('v:')){
     const match=/^v:([a-f0-9-]{36}):(today|tomorrow|week|next|off|on)$/.exec(callback.data);
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
     if(!links.length){await this.telegram.message(id,'Привет! Подключите Telegram из TeacherPro или через ссылку преподавателя.');return;}
     if(links.length===1){await this.telegram.message(id,'Выберите действие:',menu(links[0]));return;}
     await this.telegram.message(id,'Выберите профиль TeacherPro:',chooseButtons(links));return;
   }
   const intent={'/today':'today','/tomorrow':'tomorrow','/week':'week','/next':'next'}[text];
   if(intent){
     if(links.length===1)await this.views(id,links[0],intent);
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
       await this.withDelivery(t,key,'Утренняя сводка TeacherPro\n\n'+text);
     }
   }
   const students=links.filter(l=>l.role==='student');
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
