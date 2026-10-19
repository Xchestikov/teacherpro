/* Telegram integration UI. Authenticated Supabase RPC only; never store bot tokens in browser. */
(function(){
 'use strict';
 const safe=s=>htmlSafe(String(s??''));
 const configured=()=>window.TP_TELEGRAM_BOT_ACTIVE===true&&/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(window.TP_TELEGRAM_BOT_USERNAME||'');
 const name=()=>String(window.TP_TELEGRAM_BOT_USERNAME||'');
 const button=(label,action,id)=>'<button class="secondary" type="button" '+action+
   (id?' data-tg-id="'+safe(id)+'"':'')+'>'+safe(label)+'</button>';
 const badge=(x)=>x==='active'?'Подключён':x==='pending'?'Ожидает подтверждения':'Отключён';
 const state={links:[],prefs:null,loaded:false};
 const query=async()=>{
   if(!cloudUser||!cloudClient)return;
   const [links,prefs]=await Promise.all([
     cloudClient.from('tp_telegram_links').select('id,role,student_id,status,updated_at')
       .eq('owner_id',cloudUser.id),
     cloudClient.from('tp_telegram_prefs').select('*').eq('owner_id',cloudUser.id).maybeSingle()
   ]);
   if(links.error||prefs.error)throw new Error('Не удалось получить настройки Telegram.');
   state.links=Array.isArray(links.data)?links.data.filter(x=>x.status!=='revoked'):[];
   state.prefs=prefs.data&&prefs.data.owner_id?prefs.data:null;state.loaded=true;
 };
 const status=(role,student)=>state.links.find(l=>l.role===role&&
   (role==='teacher'||String(l.student_id)===String(student)));
 function widget(){
   const student=state.links.filter(l=>l.role==='student');
   const pref=state.prefs||{};
   const tz=pref.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
   const h='<section class="setting tp-telegram-setting"><h3>Telegram · TeacherPro</h3>'+
     '<p class="muted">Один бот для преподавателей и учеников. Для отправки сообщений человек сначала запускает бота.</p>'+
     (!configured()?'<p class="muted">Бот пока готовится к подключению. Имя бота будет опубликовано после настройки сервера.</p>':'')+
     '<div class="tp-telegram-row"><span>Мой аккаунт: '+safe(badge(status('teacher')?.status))+'</span>'+
     (status('teacher')?button('Отключить','onclick="tpTgRevoke(this)"',status('teacher').id):
       button('Подключить','onclick="tpTgInvite(\'teacher\')"') )+'</div>'+
     '<label>Часовой пояс<input id="tpTgTimezone" maxlength="64" value="'+safe(tz)+'" placeholder="Europe/Moscow"></label>'+
     '<label><input type="checkbox" id="tpTg24" '+(pref.reminder_24h!==false?'checked':'')+'> За 24 часа до урока</label>'+
     '<label><input type="checkbox" id="tpTg2" '+(pref.reminder_2h===true?'checked':'')+'> За 2 часа до урока</label>'+
     '<label><input type="checkbox" id="tpTgDaily" '+(pref.teacher_digest===true?'checked':'')+'> Моя утренняя сводка</label>'+
     '<label>Время сводки<input id="tpTgDailyTime" type="time" value="'+safe(pref.digest_time||'08:00')+'"></label>'+
     '<label><input type="checkbox" id="tpTgChanges" '+(pref.changes_enabled!==false?'checked':'')+'> Сообщать ученикам о переносах и отменах</label>'+
     button('Сохранить настройки','onclick="tpTgSavePrefs()"')+
     '<p class="muted">Ученики подключаются через персональную ссылку из карточки. Преподаватель подтверждает привязку.</p>'+
     (student.length?'<div class="tp-telegram-status">'+student.map(l=>{
       const c=db.clients.find(c=>String(c.id)===String(l.student_id));
       return '<div class="tp-telegram-row"><span>'+safe(c?.name||'Ученик')+
         ' · '+safe(badge(l.status))+'</span><span>'+
         (l.status==='pending'?button('Подтвердить','onclick="tpTgApprove(this)"',l.id):'')+
         button('Отключить','onclick="tpTgRevoke(this)"',l.id)+'</span></div>';
     }).join('')+'</div>':'')+
     '<div id="tpTelegramFeedback" role="status" aria-live="polite"></div>'+
     '</section>';
   return h;
 }
 async function settingsPanel(){
   const grid=document.querySelector('.settings-grid');
   if(!grid)return;
   if(!grid.querySelector('.tp-telegram-setting')){
     const holder=document.createElement('div');holder.innerHTML=
       '<section class="setting tp-telegram-setting"><h3>Telegram</h3><p>Загружаем подключения…</p></section>';
     grid.append(holder.firstElementChild);
   }
   try{await query();}catch(e){setFeedback(e.message);return;}
   if(!document.querySelector('.settings-grid'))return;
   const card=document.querySelector('.settings-grid .tp-telegram-setting');
   if(card){const holder=document.createElement('div');holder.innerHTML=widget();card.replaceWith(holder.firstElementChild);}
 }
 function setFeedback(text){
   const node=document.querySelector('#tpTelegramFeedback');
   if(node)node.textContent=text;
 }
 window.tpTgSavePrefs=async()=>{
   if(!cloudClient||!cloudUser)return;
   const root=document.querySelector('.tp-telegram-setting');
   const tz=root?.querySelector('#tpTgTimezone')?.value.trim();
   const time=root?.querySelector('#tpTgDailyTime')?.value;
   if(!tz||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time||'')){setFeedback('Укажи часовой пояс и время.');return;}
   const args={p_timezone:tz,p_reminder_24h:!!root.querySelector('#tpTg24').checked,
     p_reminder_2h:!!root.querySelector('#tpTg2').checked,
     p_teacher_digest:!!root.querySelector('#tpTgDaily').checked,
     p_digest_time:time,p_changes_enabled:!!root.querySelector('#tpTgChanges').checked};
   const {error}=await cloudClient.rpc('tp_telegram_set_prefs',args);
   if(error){setFeedback('Ошибка сохранения. Проверь часовой пояс.');return;}
   setFeedback('Настройки сохранены.');
 };
 window.tpTgInvite=async(role,studentId)=>{
   if(!cloudClient||!cloudUser)return;
   if(!configured()){
     const target=document.querySelector('#tpTelegramFeedback')||document.querySelector('#tpTelegramStudent');
     if(target)target.textContent='Бот пока не активирован. Подключение станет доступно после запуска.';
     return;
   }
   const {data,error}=await cloudClient.rpc('tp_telegram_issue_invite',{p_role:role,p_student_id:studentId===undefined?null:String(studentId)});
   if(error||!/^[a-f0-9]{64}$/.test(String(data||''))){
     alert('Не удалось создать приглашение. Попробуй позже.');return;
   }
   const url='https://t.me/'+name()+'?start='+data;
   const target=document.querySelector(role==='teacher'?'#tpTelegramFeedback':'#tpTelegramStudent');
   if(!target)return;
   target.replaceChildren();
   const title=document.createElement('p');title.textContent='Персональная ссылка (не передавай посторонним):';
   const input=document.createElement('input');input.type='text';input.readOnly=true;input.value=url;
   const copy=document.createElement('button');copy.type='button';copy.className='secondary';copy.textContent='Скопировать ссылку';
   copy.onclick=()=>{input.select();navigator.clipboard?.writeText(url).catch(()=>{});};
   const open=document.createElement('a');open.href=url;open.target='_blank';open.rel='noopener noreferrer';open.textContent='Открыть в Telegram ↗';
   target.append(title,input,copy,open);
 };
 window.tpTgApprove=async(button)=>{
   const id=button?.dataset?.tgId;
   if(!id||!cloudClient)return;
   const {data,error}=await cloudClient.rpc('tp_telegram_approve_link',{p_link:id});
   if(error||!data){setFeedback('Не удалось подтвердить подключение.');return;}
   const student=document.querySelector('#modalBody .tp-telegram-student');
   if(student){
     const match=state.links.find(x=>x.id===id);
     if(match)openClient(match.student_id,'overview');
   }else await settingsPanel();
 };
 window.tpTgRevoke=async(button)=>{
   const id=button?.dataset?.tgId;
   if(!id||!cloudClient)return;
   const {data,error}=await cloudClient.rpc('tp_telegram_revoke_link',{p_link:id});
   if(error||!data){setFeedback('Не удалось отключить Telegram.');return;}
   await settingsPanel();
 };
 const baseSettings=settings;
 settings=function(){baseSettings();if(cloudUser)settingsPanel();};
 const baseOpenClient=openClient;
 openClient=function(id,tab){
   baseOpenClient(id,tab);
   if(!id|| (tab&&tab!=='overview'))return;
   const container=document.querySelector('#modalBody .student-overview-grid');
   if(!container)return;
   const sec=document.createElement('section');sec.className='student-section tp-telegram-student';
   sec.innerHTML='<h3>Telegram</h3><p class="muted">Подключи ученика для расписания и напоминаний.</p>'+
     '<p id="tpTgStudentStatus">Проверяем подключение…</p>'+
     '<button class="secondary" id="tpTgInviteStudent" type="button">Создать ссылку-приглашение</button>'+
     '<div id="tpTelegramStudent" aria-live="polite"></div>';
   container.append(sec);
   sec.querySelector('#tpTgInviteStudent').onclick=()=>window.tpTgInvite('student',id);
   if(!cloudUser)return;
   query().then(()=>{
     if(!sec.isConnected)return;
     const link=status('student',id),node=sec.querySelector('#tpTgStudentStatus');
     node.textContent='Статус: '+badge(link?.status);
     if(link){
       const controls=document.createElement('div');
       if(link.status==='pending'){
         const yes=document.createElement('button');yes.className='secondary';yes.textContent='Подтвердить';
         yes.dataset.tgId=link.id;yes.onclick=()=>window.tpTgApprove(yes);controls.append(yes);
       }
       const off=document.createElement('button');off.className='secondary';off.textContent='Отключить';
       off.dataset.tgId=link.id;off.onclick=async()=>{await window.tpTgRevoke(off);openClient(id,'overview');};
       controls.append(off);sec.append(controls);
     }
   }).catch(()=>{if(sec.isConnected)sec.querySelector('#tpTgStudentStatus').textContent='Ошибка загрузки';});
 };
})();
