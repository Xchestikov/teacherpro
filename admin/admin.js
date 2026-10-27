/* TeacherPro Owner Console. No privileged secrets are ever placed in the browser. */
(() => {
"use strict";
const $=s=>document.querySelector(s);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const rub=n=>new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2}).format(Number(n)||0)+" ₽";
const count=n=>new Intl.NumberFormat("ru-RU").format(Number(n)||0);
const date=v=>v?new Date(v).toLocaleDateString("ru-RU"):"—";
const label={overview:["ПЛАТФОРМА","Обзор"],teachers:["ПОЛЬЗОВАТЕЛИ","Преподаватели"],
 analytics:["ПОКАЗАТЕЛИ","Аналитика"],settings:["ПЛАТФОРМА","Настройки"],
 telegram:["ИНТЕГРАЦИИ","Telegram"],support:["ОБРАТНАЯ СВЯЗЬ","Поддержка"],
 plans:["МОНЕТИЗАЦИЯ","Тарифы"],billing:["ДОХОД ПЛАТФОРМЫ","Платежи TeacherPro"],audit:["БЕЗОПАСНОСТЬ","Журнал действий"]};
let client,me,page="overview",loaded={},busy=false;
function show(id){["auth","loading","workspace"].forEach(name=>$("#"+name).hidden=name!==id)}
function toast(msg){const n=$("#toast");n.textContent=msg;n.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>n.hidden=true,4400)}
function stat(title,value,hint){return '<section class="stat"><div class="label">'+esc(title)+'</div><div class="value">'+esc(value)+'</div><div class="hint">'+esc(hint||"")+'</div></section>'}
function empty(msg){return '<div class="empty">'+esc(msg)+'</div>'}
function table(headers,rows){return '<div class="table-wrap"><table><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join("")+'</tr></thead><tbody>'+rows.join("")+'</tbody></table></div>'}
function statusBadge(status){return '<span class="pill '+esc(status)+'">'+esc(({active:"Активен",suspended:"Приостановлен",new:"Новое",in_progress:"В работе",resolved:"Решено"})[status]||status)+'</span>'}
function note(t){return '<p class="section-note">'+esc(t)+'</p>'}
async function connect(){
  if(!window.supabase?.createClient||!window.RITM_SUPABASE_URL||!window.RITM_SUPABASE_ANON_KEY)
    throw Error("Не удалось загрузить Supabase.");
  let endpoint=window.RITM_SUPABASE_URL;
  const local=new URL("../supabase",location.href).href;
  if(location.protocol==="https:"){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),1600);
    try{const response=await fetch(local+"/auth/v1/health",{headers:{apikey:window.RITM_SUPABASE_ANON_KEY},signal:controller.signal});
      if(response.status<500&&response.headers.get("X-TeacherPro-Proxy")==="v1")endpoint=local;
    }catch(_){/* Use the configured origin. */}finally{clearTimeout(timeout)}
  }
  client=window.supabase.createClient(endpoint,window.RITM_SUPABASE_ANON_KEY);
  const {data,error}=await client.auth.getUser();
  if(!error&&data?.user){await authorize(data.user);return}
  show("auth");
}
async function authorize(user){
  me=user;
  const {data,error}=await client.from("tp_platform_admins").select("role").eq("user_id",user.id).maybeSingle();
  if(error||!data||!["owner","admin"].includes(data.role)){show("auth");$("#auth-error").textContent="У этого аккаунта нет прав администратора.";return}
  $("#signed-email").textContent=user.email||"";
  show("workspace");
  await navigate(page);
}
async function api(action,extra={}){
  const {data,error}=await client.functions.invoke("teacherpro-admin",{body:{action,...extra}});
  if(error||data?.error)throw Error(data?.error||"Не удалось получить ответ сервера.");
  return data||{};
}
function fail(e){toast(e?.message||"Неизвестная ошибка");console.error("Owner console",e)}
function setBusy(b){busy=b;$("#refresh").disabled=b}
async function navigate(next,force=false){
  if(busy)return;
  page=next;$("#page-title").textContent=label[next]?.[1]||"Управление";
  $("#page-kicker").textContent=label[next]?.[0]||"PLATFORM";
  document.querySelectorAll("#nav button").forEach(b=>b.classList.toggle("active",b.dataset.page===next));
  $("#content").innerHTML='<div class="muted">Загружаем данные…</div>';
  setBusy(true);
  try{
    let results;
    if(!force&&loaded[next])results=loaded[next];
    else{
      if(next==="overview")results=await api("overview");
      if(next==="teachers"||next==="analytics")results=await api("teachers");
      if(next==="settings")results=await api("flags");
      if(next==="telegram")results=await api("system");
      if(next==="support")results=await api("support");
      if(next==="plans")results=await api("plans");
      if(next==="billing")results=await api("billing");
      if(next==="audit")results=await api("audit");
      loaded[next]=results;
    }
    $("#content").innerHTML=render(next,results||{});
  }catch(e){$("#content").innerHTML='<div class="alert">Не удалось загрузить раздел. Попробуй обновить данные.</div>';fail(e)}
  finally{setBusy(false)}
}
function renderOverview(d){
  const x=d.overview||{},teachers=d.recent||[];
  return note("Общая картина TeacherPro. Поступления преподавателей — не выручка самой платформы. Данные занятий и оплат берутся из учительских рабочих пространств.")+
   '<div class="stats">'+stat("Преподаватели",count(x.teachers),"Зарегистрировано")+
   stat("Активность за 7 дней",count(x.active7d),"По времени последнего входа")+
   stat("Проведено занятий",count(x.done),"В записанной истории")+
   stat("Полученные оплаты",rub(x.received),"Сумма поступлений преподавателям")+'</div>'+
   '<div class="section-head"><h2>Обзор платформы</h2></div>'+
   '<div class="grid2"><div class="panel"><h2>Ученики и начисления</h2>'+
   stat("Учеников",count(x.students),"Во всех рабочих кабинетах")+
   '<div style="height:12px"></div>'+stat("Начислено по занятиям",rub(x.earned),"Оценка по данным уроков; не равно поступлениям")+'</div>'+
   '<div class="panel"><h2>Требует внимания</h2>'+
   '<p>Приостановлено аккаунтов: <strong>'+count(x.suspended)+'</strong></p>'+
   '<p>Открытых обращений: <strong>'+count(x.supportOpen)+'</strong></p>'+ 
   '<p>Доход TeacherPro: <strong>'+rub(x.ownerRevenue)+'</strong> · за текущий месяц: <strong>'+rub(x.ownerRevenueMonth)+'</strong></p>'+ 
   '<p class="muted">Быстрые действия</p>'+
   '<div class="line-actions"><button class="button" data-nav="teachers">Управление преподавателями</button>'+
   '<button class="button" data-nav="settings">Настройки функций</button>'+
   '<button class="button" data-nav="support">Обращения</button></div></div></div>'+
   '<div class="section-head"><h2>Последние аккаунты</h2><button class="button" data-nav="teachers">Все преподаватели</button></div>'+
   table(["Преподаватель","Учеников","Занятий","Статус"],teachers.slice(0,8).map(t=>
     '<tr><td class="strong">'+esc(t.name||t.email||"Преподаватель")+'</td><td>'+count(t.students)+'</td><td>'+count(t.done)+'</td><td>'+statusBadge(t.status)+'</td></tr>'))+
   '<p class="foot">Отчёт собран '+esc(new Date(x.updatedAt||Date.now()).toLocaleString("ru-RU"))+'. Для обновления воспользуйся кнопкой справа вверху.</p>';
}
function renderTeachers(d){
  const rows=(d.teachers||[]).slice().sort((a,b)=>String(b.createdAt||"").localeCompare(a.createdAt||""));
  return note("Управление аккаунтами без просмотра персональных материалов учеников. Приостановка запрещает чтение и запись облачного рабочего пространства на уровне RLS.")+
  '<div class="toolbar"><input class="search" id="teacher-search" placeholder="Имя или email преподавателя" aria-label="Поиск преподавателя"><span class="muted">Всего '+rows.length+'</span></div>'+
  table(["Преподаватель","Данные","Поступления","Тариф","Статус / действия"],rows.map(t=>
    '<tr data-teacher-row data-search="'+esc((t.email+" "+t.name).toLowerCase())+'"><td><div class="strong">'+esc(t.name||"Преподаватель")+'</div><div class="small">'+esc(t.email)+'</div><div class="small">С '+esc(date(t.createdAt))+'</div></td>'+
    '<td>'+count(t.students)+' уч. · '+count(t.done)+' зан.<div class="small">Вход: '+esc(date(t.lastSignInAt))+'</div></td>'+
    '<td>'+esc(rub(t.received))+'</td><td>'+esc(t.plan||"free")+'</td><td>'+
    statusBadge(t.status)+'<div class="line-actions" style="margin-top:8px">'+
    '<button class="button" data-action="detail" data-id="'+esc(t.id)+'">Открыть</button>'+
    '<button class="button '+(t.status==="active"?"danger":"")+'" data-action="teacher_status" data-id="'+esc(t.id)+'" data-status="'+(t.status==="active"?"suspended":"active")+'">'+(t.status==="active"?"Приостановить":"Восстановить")+'</button>'+
    '<button class="button" data-action="teacher_plan" data-id="'+esc(t.id)+'">Тариф</button><button class="button" data-action="teacher_receipt" data-id="'+esc(t.id)+'">Поступление</button></div></td></tr>'));
}
function renderAnalytics(d){
  const teachers=d.teachers||[],top=[...teachers].sort((a,b)=>(b.earned||0)-(a.earned||0)).slice(0,12);
  const total=k=>teachers.reduce((sum,t)=>sum+Number(t[k]||0),0);
  const max=Math.max(1,...top.map(x=>x.earned||0));
  return note("Оборот преподавателей и расчётные начисления — разные показатели. Это не доход TeacherPro. Тренды будут точнее после накопления событий активности.")+
   '<div class="stats">'+stat("Всего преподавателей",count(teachers.length),"Без аккаунтов администраторов")+
   stat("Всего учеников",count(total("students")),"Суммарно")+
   stat("Заработано по занятиям",rub(total("earned")),"Расчётная оценка")+
   stat("Получено преподавателями",rub(total("received")),"Фактические записи оплат")+'</div>'+
   '<div class="section-head"><h2>Начисления по преподавателям</h2></div>'+
   '<div class="panel">'+(top.length?top.map(t=>'<div class="chart-row"><span class="chart-name" title="'+esc(t.name||t.email)+'">'+esc(t.name||t.email||"Преподаватель")+'</span>'+
     '<div class="chart-track"><div class="chart-fill" style="width:'+Math.max(0,Math.min(100,(t.earned||0)/max*100))+'%"></div></div>'+
     '<span class="chart-number">'+esc(rub(t.earned))+'</span></div>').join(""):empty("Нет данных"))+'</div>'+
   '<div class="section-head"><h2>О состоянии данных</h2></div><div class="alert">Заработок по абонементам рассчитывается по отмеченным списаниям и может отличаться от реального дохода при неполной старой истории. Прибыль и подписки самой платформы пока не являются платёжными поступлениями.</div>';
}
function renderSettings(d){
 const flags=d.flags||[];
 return note("Эти параметры применяются ко всем преподавателям. Изменения записываются в журнал и проверяются сервером.")+
 '<div class="panel">'+flags.map(f=>'<div class="setting"><div><strong>'+esc(f.key==="support_requests"?"Форма обращения в поддержку":"Объявление о технических работах")+'</strong><p>'+esc(f.description)+'</p>'+
  (f.key==="maintenance_banner"?'<p class="small">'+esc(f.value)+'</p>':"")+'</div>'+
  '<div class="line-actions"><button class="button '+(f.enabled?"primary":"")+'" data-action="flag_toggle" data-key="'+esc(f.key)+'" data-enabled="'+(!f.enabled)+'">'+(f.enabled?"Включено":"Выключено")+'</button>'+
  (f.key==="maintenance_banner"?'<button class="button" data-action="flag_text">Изменить текст</button>':"")+'</div></div>').join("")+'</div>';
}
function renderTelegram(d){
 const x=d.system||{};
 return note("Мониторинг подключения и доставки уведомлений Telegram. Состояния считаются по сохранённым записям; это не live-healthcheck процесса бота.")+
 '<div class="stats">'+stat("Активные подключения",count(x.telegramLinked),"Связи с Telegram")+
 stat("Доставлено",count(x.sent),"По журналу уведомлений")+
 stat("Ошибки",count(x.failed),"Неуспешные доставки")+
 stat("Проверено",esc(date(x.checkedAt)),"Время последнего запроса")+'</div>'+
 '<div class="section-head"><h2>Состояние интеграции</h2></div>'+
 '<div class="panel"><p>Интеграция использует существующего Telegram-бота TeacherPro. Для отправки и перезапуска бота используются серверные процессы и отдельный workflow развёртывания.</p>'+
 '<p class="muted">Ключи и секреты бота не показываются в браузере администратора. Управление уведомлениями преподавателей остаётся в их рабочих пространствах.</p></div>';
}
function renderSupport(d){
 const tickets=d.tickets||[];
 return note("Обращения поступают из кабинетов преподавателей. Здесь можно распределять статусы и отслеживать вопросы, не получая доступ к материалам учеников.")+
 '<div class="section-head"><h2>Обращения</h2><span class="muted">Записей: '+tickets.length+'</span></div>'+
 (tickets.length?'<div class="panel">'+tickets.map(t=>
  '<div class="setting" style="display:block"><div class="line-actions" style="justify-content:space-between;align-items:center"><strong>'+esc(t.subject)+'</strong>'+statusBadge(t.status)+'</div>'+
  '<p class="small">'+esc(t.category)+' · '+esc(date(t.created_at))+' · '+esc(t.teacher_id.slice(0,8))+'</p>'+
  '<p style="white-space:pre-wrap;font-size:13px">'+esc(t.message)+'</p>'+
  '<div class="line-actions"><button class="button" data-action="ticket_status" data-id="'+esc(t.id)+'" data-status="in_progress">В работу</button>'+
  '<button class="button" data-action="ticket_status" data-id="'+esc(t.id)+'" data-status="resolved">Решено</button></div></div>').join("")+'</div>':empty("Пока нет обращений"));
}
function renderPlans(d){
 const plans=d.plans||[];
 return note("Первый этап монетизации: каталог тарифов и ручное назначение доступа. Автоматического списания денег и платежного провайдера пока нет; цена является настройкой, а не фактом платежа.")+
 '<div class="section-head"><h2>Тарифы TeacherPro</h2><button class="button primary" data-action="new_plan">Новый тариф</button></div>'+
 table(["Код","Название","Цена / период","Лимит учеников","Статус",""],plans.map(p=>
  '<tr><td class="strong">'+esc(p.code)+'</td><td>'+esc(p.title)+'</td>'+
  '<td>'+esc(rub(p.price_rub))+' / '+esc(({month:"месяц",year:"год",manual:"вручную"})[p.period]||p.period)+'</td>'+
  '<td>'+(Number(p.max_students)===0?"Без ограничения":count(p.max_students))+'</td><td>'+statusBadge(p.enabled?"active":"suspended")+'</td>'+
  '<td><button class="button" data-action="edit_plan" data-code="'+esc(p.code)+'">Изменить</button></td></tr>'))+
 '<p class="foot">Назначение тарифа преподавателю выполняется через раздел «Преподаватели». Пока доступ к существующим функциям не ограничивается тарифами — это нужно подключать отдельно перед запуском платных продаж.</p>';
}
function renderBilling(d){
 const entries=d.receipts||[];
 return note("Только платежи за доступ к TeacherPro. Учительские оплаты учеников здесь не учитываются. Все операции вводятся вручную и записываются в журнал.")+
 '<div class="stats">'+stat("Фактически получено",rub(d.receivedTotal),"Все действующие записи")+
 stat("Получений",count(entries.filter(x=>!x.voided_at).length),"Учтённые поступления")+
 stat("Отменённых записей",count(entries.filter(x=>x.voided_at).length),"История сохраняется")+
 stat("Тарифов",count((d.plans||[]).length),"Конфигурация тарифов")+'</div>'+
 '<div class="section-head"><h2>Платежи TeacherPro</h2><button class="button primary" data-action="new_receipt">Добавить поступление</button></div>'+
 table(["Дата","Преподаватель","Тариф","Сумма","Способ","Действия"],entries.map(x=>
 '<tr><td>'+esc(x.received_on)+'</td><td>'+esc(x.teacher_id.slice(0,8))+'</td><td>'+esc(x.plan_code)+'</td>'+
 '<td class="strong">'+esc(rub(x.amount_rub))+'</td><td>'+esc(x.method)+(x.voided_at?' · Отменено':'')+'</td>'+
 '<td>'+(x.voided_at?'<span class="small">Запись отменена</span>':
 '<button class="button danger" data-action="void_receipt" data-id="'+esc(x.id)+'">Отменить</button>')+'</td></tr>'))+
 '<p class="foot">Поступления фиксируются только после реального получения денег. Автоматического эквайринга и выставления чеков в этой версии нет.</p>';
}
function renderAudit(d){
 return note("История административных изменений помогает отслеживать, кто и когда изменял настройки платформы, статус преподавателя, тариф или обращение.")+
 table(["Когда","Действие","Объект","Изменения"],(d.items||[]).map(x=>'<tr><td>'+esc(new Date(x.created_at).toLocaleString("ru-RU"))+'</td><td class="strong">'+esc(x.action)+'</td><td>'+esc(x.target)+'</td><td>'+esc(JSON.stringify(x.details))+'</td></tr>'));
}
function render(which,d){return ({overview:renderOverview,teachers:renderTeachers,analytics:renderAnalytics,settings:renderSettings,
  telegram:renderTelegram,support:renderSupport,plans:renderPlans,billing:renderBilling,audit:renderAudit})[which](d)}
function modal(title,html){$("#modal-title").textContent=title;$("#modal-content").innerHTML=html;$("#modal").hidden=false}
function closeModal(){$("#modal").hidden=true;$("#modal-content").replaceChildren()}
async function run(action,extra,next=page){
 if(busy)return;setBusy(true);
 try{await api(action,extra);toast("Изменения сохранены");loaded={};setBusy(false);closeModal();await navigate(next,true)}
 catch(e){setBusy(false);fail(e)}
}
async function detail(id){
 try{
  const {teacher:t}=await api("teacher_detail",{id});
  modal("Преподаватель",'<p class="strong">'+esc(t.name||t.email)+'</p><p class="muted">'+esc(t.email)+'</p>'+
    '<div class="stats" style="grid-template-columns:1fr 1fr">'+stat("Учеников",count(t.students),"")+
    stat("Проведено",count(t.done),"")+stat("Начислено",rub(t.earned),"")+stat("Поступления",rub(t.received),"")+'</div>'+
    '<p class="foot">Детальные карточки учеников открываются только при согласованном доступе для поддержки.</p>');
 }catch(e){fail(e)}
}
function choosePlan(id){
 const t=(loaded.teachers?.teachers||[]).find(x=>x.id===id);
 if(!t)return;
 modal("Тариф преподавателя",'<p>'+esc(t.name||t.email)+'</p>'+
 '<form id="plan-assign" class="form"><label class="field">Тариф<input name="plan" value="'+esc(t.plan||"free")+'" required pattern="[a-z][a-z0-9_]{1,29}"></label>'+
 '<label class="field">Доступ до (необязательно)<input name="until" type="date" value="'+esc(t.planUntil||'')+'"></label><p class="muted">Тариф должен существовать и быть включён в разделе «Тарифы».</p>'+
 '<button class="button primary" type="submit">Назначить тариф</button></form>');
 $("#plan-assign").onsubmit=e=>{e.preventDefault();run("teacher_plan",{id,plan:new FormData(e.target).get("plan"),until:new FormData(e.target).get("until")},"teachers")};
}
function editPlan(code){
 const p=(loaded.plans?.plans||[]).find(x=>x.code===code)||{code:"",title:"",period:"month",price_rub:0,max_students:0,enabled:false};
 modal(p.code?"Изменить тариф":"Создать тариф",'<form id="plan-edit" class="form"><div class="form-grid">'+
 '<label class="field">Код тарифа<input name="code" value="'+esc(p.code)+'" '+(p.code?"readonly":"")+' required pattern="[a-z][a-z0-9_]{1,29}"></label>'+
 '<label class="field">Название<input name="title" value="'+esc(p.title)+'" required maxlength="80"></label></div>'+
 '<div class="form-grid"><label class="field">Цена, ₽<input name="price" type="number" min="0" max="1000000" step=".01" value="'+esc(p.price_rub)+'"></label>'+
 '<label class="field">Период<select name="period">'+["month","year","manual"].map(x=>'<option value="'+x+'" '+(p.period===x?"selected":"")+'>'+x+'</option>').join("")+'</select></label></div>'+
 '<label class="field">Максимум учеников (0 — без лимита)<input type="number" min="0" step="1" name="max_students" value="'+esc(p.max_students)+'"></label>'+
 '<label class="field">Статус<select name="enabled"><option value="true" '+(p.enabled?"selected":"")+'>Включён</option><option value="false" '+(!p.enabled?"selected":"")+'>Скрыт</option></select></label>'+
 '<button class="button primary" type="submit">Сохранить тариф</button></form>');
 $("#plan-edit").onsubmit=e=>{e.preventDefault();const o=Object.fromEntries(new FormData(e.target).entries());
  run("plan_save",{code:o.code,title:o.title,price:Number(o.price),period:o.period,max_students:Number(o.max_students),enabled:o.enabled==="true"},"plans")};
}
async function newReceipt(defaultId=""){
 let teachers=(loaded.teachers?.teachers||[]);
 if(!teachers.length){try{teachers=(await api("teachers")).teachers||[];loaded.teachers={teachers};}catch(e){return fail(e)}}
 let plans=(loaded.billing?.plans||loaded.plans?.plans||[]).filter(x=>x.enabled);
 if(!plans.length){try{plans=(await api("plans")).plans.filter(x=>x.enabled);loaded.plans={plans};}catch(e){return fail(e)}}
 if(!teachers.length)return toast("Не найдено преподавателей");
 modal("Записать поступление TeacherPro",'<form id="receipt-form" class="form">'+
 '<label class="field">Преподаватель<select name="id">'+teachers.map(t=>
 '<option value="'+esc(t.id)+'" '+(t.id===defaultId?"selected":"")+'>'+esc(t.name||t.email||t.id)+'</option>').join("")+'</select></label>'+
 '<label class="field">Тариф<select name="plan">'+plans.map(p=>'<option value="'+esc(p.code)+'">'+esc(p.title)+'</option>').join("")+'</select></label>'+
 '<div class="form-grid"><label class="field">Получено, ₽<input type="number" name="amount" required min="0.01" step="0.01" max="1000000"></label>'+
 '<label class="field">Дата получения<input name="date" type="date" value="'+new Date().toISOString().slice(0,10)+'" required></label></div>'+
 '<label class="field">Способ<select name="method"><option value="manual">Вручную</option><option value="bank">Банковский перевод</option><option value="other">Другой</option></select></label>'+
 '<label class="field">Комментарий<input name="note" maxlength="300" placeholder="Основание платежа"></label>'+
 '<p class="muted">Добавляй запись только после фактического поступления средств. Операцию можно отменить с сохранением истории.</p>'+
 '<button class="button primary" type="submit">Записать получение</button></form>');
 $("#receipt-form").onsubmit=e=>{e.preventDefault();const p=Object.fromEntries(new FormData(e.target).entries());run("receipt_record",{id:p.id,
 plan:p.plan,amount:Number(p.amount),date:p.date,method:p.method,note:p.note},"billing")};
}
document.addEventListener("click",async e=>{
 const n=e.target.closest("[data-nav]");if(n){navigate(n.dataset.nav);return}
 const b=e.target.closest("[data-action]");if(!b||busy)return;
 const a=b.dataset.action;
 if(a==="detail")return detail(b.dataset.id);
 if(a==="teacher_plan")return choosePlan(b.dataset.id);
 if(a==="teacher_receipt")return newReceipt(b.dataset.id);
 if(a==="new_receipt")return newReceipt();
 if(a==="void_receipt"){
   if(!confirm("Отменить этот платёж TeacherPro? Запись останется в истории, но будет исключена из выручки."))return;
   return run("receipt_void",{id:b.dataset.id},"billing");
 }
 if(a==="teacher_status"){
  if(b.dataset.status==="suspended"&&!confirm("Приостановить преподавателя? Сохранённые данные останутся в базе, но облачное рабочее пространство будет недоступно."))return;
  return run("teacher_status",{id:b.dataset.id,status:b.dataset.status},"teachers");
 }
 if(a==="flag_toggle"){
  const f=(loaded.settings?.flags||[]).find(x=>x.key===b.dataset.key);
  return run("flag_set",{key:b.dataset.key,enabled:b.dataset.enabled==="true",value:f?.value||""},"settings");
 }
 if(a==="flag_text"){
  const f=(loaded.settings?.flags||[]).find(x=>x.key==="maintenance_banner");
  modal("Объявление",'<form id="banner-form" class="form"><label class="field">Текст сообщения<textarea name="text" maxlength="240" required>'+esc(f?.value||"")+'</textarea></label>'+
  '<button class="button primary" type="submit">Сохранить</button></form>');
  $("#banner-form").onsubmit=e=>{e.preventDefault();run("flag_set",{key:"maintenance_banner",enabled:!!f?.enabled,value:new FormData(e.target).get("text")},"settings")};
  return;
 }
 if(a==="ticket_status")return run("ticket_status",{id:b.dataset.id,status:b.dataset.status},"support");
 if(a==="new_plan")return editPlan("");
 if(a==="edit_plan")return editPlan(b.dataset.code);
});
$("#nav").addEventListener("click",e=>{const b=e.target.closest("[data-page]");if(b)navigate(b.dataset.page)});
$("#refresh").addEventListener("click",()=>{loaded={};navigate(page,true)});
$("#logout").addEventListener("click",async()=>{await client?.auth.signOut();location.href="../"});
$("#modal-close").addEventListener("click",closeModal);
$("#modal").addEventListener("click",e=>{if(e.target.id==="modal")closeModal()});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal()});
$("#content").addEventListener("input",e=>{
 if(e.target.id==="teacher-search"){const q=e.target.value.toLowerCase().trim();
  document.querySelectorAll("[data-teacher-row]").forEach(row=>row.hidden=!row.dataset.search.includes(q))}
});
$("#login-form").addEventListener("submit",async e=>{
 e.preventDefault();$("#auth-error").textContent="";
 const email=$("#email").value.trim(),password=$("#password").value;
 const submit=e.target.querySelector('[type="submit"]');submit.disabled=true;
 try{const {data,error}=await client.auth.signInWithPassword({email,password});if(error)throw error;await authorize(data.user)}
 catch(e){$("#auth-error").textContent=e.message||"Не удалось войти"}finally{submit.disabled=false}
});
connect().catch(e=>{show("auth");$("#auth-error").textContent=e.message});
})();
