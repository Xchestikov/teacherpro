/* Telegram integration UI. Authenticated Supabase RPC only; never store bot tokens in browser. */
(function(){
 'use strict';
 const safe=s=>htmlSafe(String(s??''));
 const configured=()=>window.TP_TELEGRAM_BOT_ACTIVE===true&&/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(window.TP_TELEGRAM_BOT_USERNAME||'');
 const name=()=>String(window.TP_TELEGRAM_BOT_USERNAME||'');
 const button=(label,action,id)=>'<button class="tp-tg-btn tp-tg-btn--secondary" type="button" '+action+
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
   const students=state.links.filter(l=>l.role==='student'||l.role==='parent');
   const pref=state.prefs||{};
   const tz=pref.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
   const teacher=status('teacher');
   const stateClass=x=>x==='active'?'active':x==='pending'?'pending':'off';
   const chip=x=>'<span class="tp-tg-chip tp-tg-chip--'+stateClass(x)+'">'+safe(badge(x))+'</span>';
   return '<section class="setting tp-telegram-setting" aria-label="Настройки Telegram">'+
     '<header class="tp-tg-header">'+
       '<div class="tp-tg-mark" aria-hidden="true">✈</div>'+
       '<div class="tp-tg-header-copy">'+
         '<span class="tp-tg-eyebrow">ИНТЕГРАЦИИ</span>'+
         '<h3>Telegram · TeacherPro</h3>'+
         '<p class="tp-tg-lede">Расписание, напоминания и изменения занятий — прямо в Telegram.</p>'+
       '</div>'+
     '</header>'+
     '<div class="tp-tg-block">'+
       '<div class="tp-tg-block-head"><h4>Мой аккаунт</h4>'+chip(teacher?.status)+'</div>'+
       '<div class="tp-tg-account-main">'+
         '<p class="tp-tg-muted">'+(teacher?.status==='active'?
           'Аккаунт привязан. Бот поможет быстро узнать о ближайших занятиях.':
           'Подключите свой Telegram, чтобы получать расписание и уведомления.')+'</p>'+
         (teacher?button('Отключить Telegram','onclick="tpTgRevoke(this)"',teacher.id):
           '<button class="tp-tg-btn tp-tg-btn--primary" type="button" onclick="tpTgInvite(\'teacher\')">Подключить Telegram ↗</button>')+
       '</div>'+
       (!configured()?'<p class="tp-tg-muted">Бот @'+safe(name())+' пока готовится к подключению.</p>':'')+
       '<div class="tp-tg-invite-slot" id="tpTelegramInviteTeacher" aria-live="polite"></div>'+
       '<div id="tpTelegramFeedback" class="tp-tg-feedback" role="status" aria-live="polite"></div>'+
     '</div>'+
     '<div class="tp-tg-block">'+
       '<div class="tp-tg-block-head"><h4>Настройки уведомлений</h4></div>'+
       '<div class="tp-tg-field-grid">'+
         '<label class="tp-tg-field" for="tpTgTimezone">Часовой пояс'+
           '<input id="tpTgTimezone" type="text" maxlength="64" autocomplete="off" value="'+safe(tz)+'" placeholder="Europe/Moscow"></label>'+
         '<label class="tp-tg-field" for="tpTgDailyTime">Время утренней сводки'+
           '<input id="tpTgDailyTime" type="time" value="'+safe(pref.digest_time||'08:00')+'"></label>'+
       '</div>'+
       '<div class="tp-tg-option-grid">'+
         '<label class="tp-tg-choice" for="tpTg24">'+
           '<input type="checkbox" id="tpTg24" '+(pref.reminder_24h!==false?'checked':'')+'>'+
           '<span><strong>За 24 часа до занятия</strong><small>Напоминание ученику за день.</small></span></label>'+
         '<label class="tp-tg-choice" for="tpTg2">'+
           '<input type="checkbox" id="tpTg2" '+(pref.reminder_2h===true?'checked':'')+'>'+
           '<span><strong>За 2 часа до занятия</strong><small>Дополнительное напоминание.</small></span></label>'+
         '<label class="tp-tg-choice" for="tpTgDaily">'+
           '<input type="checkbox" id="tpTgDaily" '+(pref.teacher_digest===true?'checked':'')+'>'+
           '<span><strong>Утренняя сводка</strong><small>План занятий на день.</small></span></label>'+
         '<label class="tp-tg-choice" for="tpTgChanges">'+
           '<input type="checkbox" id="tpTgChanges" '+(pref.changes_enabled!==false?'checked':'')+'>'+
           '<span><strong>Переносы и отмены</strong><small>Сообщать ученикам об изменениях.</small></span></label>'+
       '</div>'+
       '<div class="tp-tg-footer"><p class="tp-tg-muted">Изменения действуют после сохранения.</p>'+
         '<button class="tp-tg-btn tp-tg-btn--primary" type="button" onclick="tpTgSavePrefs()">Сохранить настройки</button>'+
       '</div>'+
     '</div>'+
     '<div class="tp-tg-block">'+
       '<div class="tp-tg-block-head"><h4>Ученики и родители</h4>'+
         '<span class="tp-tg-chip">'+students.length+' '+(students.length===1?'подключение': 'подключений')+'</span></div>'+
       '<p class="tp-tg-muted">Приглашайте ученика из его карточки. Подключение подтверждает преподаватель.</p>'+
       (students.length?'<div class="tp-tg-status-list">'+students.map(l=>{
         const c=db.clients.find(c=>String(c.id)===String(l.student_id));
         return '<div class="tp-tg-student-line">'+
           '<span class="tp-tg-person-name">'+safe(l.role==='parent'?'Родитель · ':'Ученик · ')+safe(c?.name||'Ученик')+' · '+safe(badge(l.status))+'</span>'+
           '<div class="tp-tg-student-actions">'+
             (l.status==='pending'?button('Подтвердить','onclick="tpTgApprove(this)"',l.id):'')+
             button('Отключить','onclick="tpTgRevoke(this)"',l.id)+'</div></div>';
       }).join('')+'</div>':'')+
     '</div>'+
   '</section>';
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
 async function copyPrivateText(value,feedback,label){
   let ok=false;
   try{
     if(navigator.clipboard?.writeText){
       await navigator.clipboard.writeText(value);
       ok=true;
     }
   }catch(_){}
   if(!ok){
     const tmp=document.createElement('textarea');
     tmp.value=value;tmp.readOnly=true;
     tmp.style.cssText='position:fixed;left:-9999px;top:0;opacity:0';
     document.body.append(tmp);tmp.focus();tmp.select();
     try{ok=document.execCommand('copy');}catch(_){}
     tmp.remove();
   }
   if(feedback)feedback.textContent=ok?label:'Не удалось скопировать автоматически. Выделите и скопируйте команду вручную.';
   return ok;
 }
 function inviteCard(token,role){
   const url='https://t.me/'+name()+'?start='+token;
   // Web K opens the browser client explicitly. It does not reliably pass ?start=,
   // so the exact /start command is available for manual submission as well.
   const webUrl='https://web.telegram.org/k/#@'+name();
   const command='/start '+token;
   const wrapper=document.createElement('div');wrapper.className='tp-tg-invite';
   const head=document.createElement('div');head.className='tp-tg-invite-head';
   const heading=document.createElement('strong');heading.className='tp-tg-invite-title';
   heading.textContent=role==='teacher'?'Персональная ссылка для вашего аккаунта':role==='parent'?'Персональное приглашение родителя':'Персональное приглашение ученика';
   const intro=document.createElement('p');
   intro.textContent='Ссылка одноразовая. Не передавайте её посторонним.';
   head.append(heading,intro);
   const actions=document.createElement('div');actions.className='tp-tg-invite-actions';
   const actionLink=(text,href,primary=false)=>{
     const a=document.createElement('a');
     a.className='tp-tg-btn '+(primary?'tp-tg-btn--primary':'tp-tg-btn--secondary');
     a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=text;
     return a;
   };
   const copyStatus=document.createElement('div');copyStatus.className='tp-tg-copy-status';
   copyStatus.setAttribute('role','status');copyStatus.setAttribute('aria-live','polite');
   const copyLink=document.createElement('button');copyLink.type='button';
   copyLink.className='tp-tg-btn tp-tg-btn--secondary';copyLink.textContent='Скопировать ссылку';
   copyLink.onclick=()=>copyPrivateText(url,copyStatus,'Ссылка скопирована');
   actions.append(actionLink('Открыть в Telegram ↗',url,true),
     actionLink('Открыть Telegram Web ↗',webUrl),copyLink);
   const fallback=document.createElement('div');fallback.className='tp-tg-fallback';
   const manual=document.createElement('div');manual.className='tp-tg-invite-note';
   const manualTitle=document.createElement('strong');manualTitle.className='tp-tg-invite-title';
   manualTitle.textContent='Если вы используете Telegram Web';
   const manualTip=document.createElement('p');manualTip.textContent=
     'Если веб-версия откроет только список чатов, найдите @'+name()+
     ' и отправьте ему команду ниже. Обычная кнопка Start без кода не привяжет аккаунт.';
   manual.append(manualTitle,manualTip);
   const codeRow=document.createElement('div');codeRow.className='tp-tg-code-row';
   const code=document.createElement('input');code.type='text';code.readOnly=true;
   code.className='tp-tg-code-input';code.value=command;
   code.setAttribute('aria-label','Команда для подключения в Telegram Web');
   code.addEventListener('focus',()=>code.select());
   const copyCmd=document.createElement('button');copyCmd.type='button';
   copyCmd.className='tp-tg-btn tp-tg-btn--secondary';
   copyCmd.textContent='Скопировать команду';
   copyCmd.onclick=()=>copyPrivateText(command,copyStatus,'Команда скопирована');
   codeRow.append(code,copyCmd);
   fallback.append(manual,codeRow);
   wrapper.append(head,actions,fallback,copyStatus);
   return wrapper;
 }
 window.tpTgInvite=async(role,studentId)=>{
   if(!cloudClient||!cloudUser)return;
   if(!configured()){
     const target=document.querySelector(role==='teacher'?'#tpTelegramFeedback':role==='parent'?'#tpTelegramParent':'#tpTelegramStudent');
     if(target)target.textContent='Бот пока не активирован. Подключение станет доступно после запуска.';
     return;
   }
   const {data,error}=await cloudClient.rpc('tp_telegram_issue_invite',{
     p_role:role,p_student_id:studentId===undefined?null:String(studentId)
   });
   if(error||!/^[a-f0-9]{64}$/.test(String(data||''))){
     const target=document.querySelector(role==='teacher'?'#tpTelegramFeedback':role==='parent'?'#tpTelegramParent':'#tpTelegramStudent');
     if(target)target.textContent='Не удалось создать приглашение. Попробуйте ещё раз.';
     return;
   }
   const target=document.querySelector(role==='teacher'?'#tpTelegramInviteTeacher':role==='parent'?'#tpTelegramParent':'#tpTelegramStudent');
   if(!target)return;
   target.replaceChildren(inviteCard(data,role));
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
   sec.innerHTML='<div class="tp-tg-header">'+
     '<div class="tp-tg-mark" aria-hidden="true">✈</div>'+
     '<div class="tp-tg-header-copy"><h3>Telegram</h3>'+
     '<p class="tp-tg-muted">Расписание и напоминания ученика в Telegram.</p></div></div>'+
     '<div class="tp-tg-block-head"><strong id="tpTgStudentStatus" class="tp-tg-person-name">Проверяем подключение…</strong></div>'+
     '<button class="tp-tg-btn tp-tg-btn--secondary" id="tpTgInviteStudent" type="button">Пригласить ученика</button>'+
     '<button class="tp-tg-btn tp-tg-btn--secondary" id="tpTgInviteParent" type="button">Пригласить родителя</button>'+
     '<div id="tpTelegramStudent" class="tp-tg-invite-slot" aria-live="polite"></div>'+
     '<div id="tpTelegramParent" class="tp-tg-invite-slot" aria-live="polite"></div>';
   container.append(sec);
   sec.querySelector('#tpTgInviteStudent').onclick=()=>window.tpTgInvite('student',id);
   sec.querySelector('#tpTgInviteParent').onclick=()=>window.tpTgInvite('parent',id);
   if(!cloudUser)return;
   query().then(()=>{
     if(!sec.isConnected)return;
     const node=sec.querySelector('#tpTgStudentStatus');
     node.textContent='Подключения ученика и родителя';
     for(const role of ['student','parent']){
       const link=status(role,id);
       const row=document.createElement('div');row.className='tp-tg-student-line';
       const summary=document.createElement('span');summary.className='tp-tg-person-name';
       summary.textContent=(role==='parent'?'Родитель':'Ученик')+' · '+badge(link?.status);
       row.append(summary);
       if(link){
         const controls=document.createElement('div');controls.className='tp-tg-student-actions';
         if(link.status==='pending'){
           const yes=document.createElement('button');yes.className='tp-tg-btn tp-tg-btn--primary';
           yes.textContent='Подтвердить';yes.dataset.tgId=link.id;
           yes.onclick=()=>window.tpTgApprove(yes);controls.append(yes);
         }
         const off=document.createElement('button');off.className='tp-tg-btn tp-tg-btn--secondary';
         off.textContent='Отключить';off.dataset.tgId=link.id;
         off.onclick=async()=>{await window.tpTgRevoke(off);openClient(id,'overview');};
         controls.append(off);row.append(controls);
       }
       sec.append(row);
     }
   }).catch(()=>{if(sec.isConnected)sec.querySelector('#tpTgStudentStatus').textContent='Ошибка загрузки';});
 };
})();
