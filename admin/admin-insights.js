/* TeacherPro owner insights UI: reads aggregate-only reports from the authorized admin API. */
(function(global){
"use strict";
const day=(d)=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
const today=()=>day(new Date());
const shift=(date,n)=>{const d=new Date(date+"T12:00:00");d.setDate(d.getDate()+n);return day(d)};
let period={from:shift(today(),-29),to:today(),preset:"30"};
let lastReport=null,lastTeacher=null;
const h=global.TPOwnerInsights={};
h.period=()=>({...period});
h.setPeriod=function(p){
  const to=String(p.to||""),from=String(p.from||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to||
    (new Date(to+"T12:00:00")-new Date(from+"T12:00:00"))>3660*86400000)throw Error("Выбери корректный период не длиннее 10 лет.");
  period={from,to,preset:String(p.preset||"custom")};
};
h.applyPreset=function(key){
  if(key==="all")period={from:"2000-01-01",to:today(),preset:key};
  else if(key==="month"){const now=today();period={from:now.slice(0,7)+"-01",to:now,preset:key};}
  else if(key==="7"||key==="30"||key==="90")period={from:shift(today(),-(Number(key)-1)),to:today(),preset:key};
  else throw Error("Неизвестный период");
};
function fmt(n){return new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2}).format(Number(n)||0)}
function month(s){const [year,mm]=String(s).split("-");const d=new Date(Number(year),Number(mm)-1,1);return d.toLocaleDateString("ru-RU",{month:"short",year:"2-digit"})}
function escapeCSV(v){const value=String(v??"");const safe=/^[=+@\-\t\r]/.test(value)?"'"+value:value;return '"'+safe.replace(/"/g,'""')+'"'}
function exportCsv(file,headers,rows){
 const lines=[headers,...rows].map(row=>row.map(escapeCSV).join(";")).join("\r\n");
 const blob=new Blob(["\uFEFF"+lines],{type:"text/csv;charset=utf-8"});
 const url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download=file.replace(/[^a-z0-9_\-\.]/gi,"_");document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),2000);
}
h.exportReport=()=>{
 if(!lastReport)return;
 const p=lastReport.period,m=lastReport.metrics;
 exportCsv("teacherpro_report_"+p.from+"_"+p.to+".csv",
 ["Преподаватель","Email","Проведено","Отменено","Начислено ₽","Поступило ₽","Авансы ₽","Задолженность ₽","Не подтверждено ₽"],
 lastReport.teachers.map(t=>[t.name,t.email,t.done,t.cancelled,t.earned,t.received,t.advance,t.debt,t.unverified])
 .concat([["ИТОГО","",m.done,m.cancelled,m.earned,m.received,m.advance,m.debt,m.unverified]]));
};
h.exportTeacher=()=>{
 if(!lastTeacher)return;
 const p=lastTeacher.period,teacher=lastTeacher.teacher;
 exportCsv("teacherpro_teacher_"+teacher.id.slice(0,8)+"_"+p.from+"_"+p.to+".csv",
 ["Ученик (обезличенно)","Проведено","Запланировано","Начислено ₽","Получено ₽","Задолженность ₽","Аванс ₽","Резерв ₽","Без подтверждения ₽"],
 lastTeacher.students.map(s=>[s.label,s.done,s.planned,s.earned,s.received,s.debt,s.advance,s.reserve,s.unverified]));
};
h.periodControls=function(esc){
  return '<div class="insight-toolbar"><div class="period-pills" role="group" aria-label="Период отчёта">'+
  [["7","7 дней"],["30","30 дней"],["90","90 дней"],["month","Этот месяц"],["all","Вся история"]]
   .map(x=>'<button class="period-chip '+(period.preset===x[0]?"selected":"")+'" data-period="'+x[0]+'">'+x[1]+'</button>').join("")+
  '</div><div class="period-custom"><label>С <input type="date" id="insight-from" value="'+esc(period.from)+'"></label>'+
  '<label>По <input type="date" id="insight-to" value="'+esc(period.to)+'"></label>'+
  '<button class="button" data-action="apply_period">Применить</button></div></div>';
};
function topHeading(title,subtitle){return '<div class="hero-heading"><div><div class="eyebrow">TEACHERPRO · УПРАВЛЕНИЕ</div><h2>'+title+'</h2><p>'+subtitle+'</p></div><div class="hero-mark">T</div></div>'}
function metric(ctx,name,value,description,icon){
 return '<div class="insight-metric"><div class="metric-name">'+ctx.esc(name)+'<span class="metric-symbol">'+icon+'</span></div><div class="metric-value">'+ctx.esc(value)+'</div><div class="metric-desc">'+ctx.esc(description)+'</div></div>';
}
function graph(trend,ctx,metric="done"){
  const max=Math.max(1,...trend.map(x=>Number(x[metric]||0)));
  if(!trend.length)return '<div class="chart-empty">Пока нет событий за выбранный период.</div>';
  return '<div class="trend-bars" role="img" aria-label="Динамика по месяцам">'+trend.map(t=>
  '<div class="trend-item" title="'+ctx.esc(month(t.period)+": "+fmt(t[metric]))+'">'+
    '<div class="trend-col"><div class="trend-bar" style="height:'+Math.max(2,Number(t[metric]||0)/max*100)+'%"></div></div>'+
    '<div class="trend-label">'+ctx.esc(month(t.period))+'</div><strong>'+ctx.esc(fmt(t[metric]))+'</strong></div>'
  ).join("")+'</div>';
}
function attention(d,ctx){
 const diag=d.diagnostics||{},issues=(diag.issues||[]).slice(0,4);
 return '<div class="insight-card"><div class="insight-card-head"><h3>Требует внимания</h3><button class="small-link" data-nav="diagnostics">Центр диагностики ↗</button></div>'+
 (issues.length?issues.map(x=>
 '<div class="attention-item"><span class="dot '+ctx.esc(x.severity)+'"></span><div><strong>'+ctx.esc(x.title)+'</strong>'+
 '<p>'+ctx.esc(x.detail)+'</p></div>'+
 (x.teacherId?'<button class="button" data-action="detail" data-id="'+ctx.esc(x.teacherId)+'">Разобрать</button>':'')+'</div>'
 ).join(""):'<div class="all-clear">По текущим проверкам новых замечаний нет.</div>')+
 '<div class="insight-foot">Проверка не заменяет мониторинг процессов на VPS.</div></div>';
}
h.renderOverview=function(d,ctx){
 const x=d.insights||{},m=x.metrics||{},diag=d.diagnostics||{};
 lastReport=x;
 return topHeading("Всё важное — на одном экране","Показатели платформы, финансовые расхождения и действия, которым стоит уделить внимание.")+
 h.periodControls(ctx.esc)+
 '<div class="insight-metrics">'+metric(ctx,"Преподавателей",ctx.count(x.teacherCount),"Зарегистрировано","♙")+
 metric(ctx,"Проведено занятий",ctx.count(m.done),"В выбранном периоде","◷")+
 metric(ctx,"Начислено по урокам",ctx.rub(m.earned),"Подтверждённые занятия","₽")+
 metric(ctx,"Поступления преподавателям",ctx.rub(m.received),"Не доход платформы","↗")+'</div>'+
 '<div class="insight-split"><div class="insight-card"><div class="insight-card-head"><h3>Динамика занятий</h3><button class="small-link" data-nav="analytics">Подробнее ↗</button></div>'+
 graph(x.trend||[],ctx,"done")+'</div>'+attention(diag,ctx)+'</div>'+
 '<div class="insight-metrics secondary">'+metric(ctx,"Активны за 7 дней",ctx.count(x.active7),"По последнему входу","◉")+
 metric(ctx,"Запланировано",ctx.count(m.planned),"В выбранном периоде","◻")+
 metric(ctx,"Предоплаты",ctx.rub(m.advance),"В расчёте по ученикам","◆")+
 metric(ctx,"Неподтверждённая история",ctx.rub(m.unverified),"Требует сверки","!")+'</div>'+
 '<div class="insight-split"><div class="insight-card"><div class="insight-card-head"><h3>Преподаватели</h3><button class="small-link" data-nav="teachers">Все преподаватели ↗</button></div>'+
 (x.teachers||[]).slice().sort((a,b)=>b.done-a.done).slice(0,5).map(t=>
 '<div class="teacher-mini"><div><strong>'+ctx.esc(t.name)+'</strong><small>'+ctx.esc(t.email)+'</small></div>'+
 '<div><strong>'+ctx.count(t.done)+' зан.</strong><small>'+ctx.rub(t.earned)+'</small></div></div>').join("")+
 '</div><div class="insight-card"><h3>Быстрые действия</h3><div class="quick-actions">'+
 '<button class="quick-action" data-nav="teachers"><span>♙</span>Открыть преподавателей</button>'+
 '<button class="quick-action" data-nav="analytics"><span>▤</span>Скачать аналитику</button>'+
 '<button class="quick-action" data-nav="diagnostics"><span>◉</span>Проверить систему</button>'+
 '<button class="quick-action" data-nav="settings"><span>⚙</span>Управление платформой</button></div>'+
 '<p class="insight-foot">Последний отчёт: '+ctx.esc(new Date(x.generatedAt||Date.now()).toLocaleString("ru-RU"))+'</p></div></div>';
};
h.renderAnalytics=function(d,ctx){
 const x=d.insights||{},m=x.metrics||{}; lastReport=x;
 const top=(x.teachers||[]).slice().sort((a,b)=>b.earned-a.earned),max=Math.max(1,...top.map(t=>t.earned||0));
 return topHeading("Как развивается TeacherPro","Подтверждённые уроки, поступления преподавателям и качество учёта по выбранным датам.")+
 h.periodControls(ctx.esc)+
 '<div class="section-head"><h2>Отчёт за период</h2><button class="button primary" data-action="export_report">↧ Скачать CSV</button></div>'+
 '<div class="insight-metrics">'+metric(ctx,"Проведено",ctx.count(m.done),"Уроков","◷")+
 metric(ctx,"Начислено",ctx.rub(m.earned),"Стоимость проведённого","₽")+
 metric(ctx,"Поступило",ctx.rub(m.received),"Фактические записи","↗")+
 metric(ctx,"Долги по факту",ctx.rub(m.debt),"Положительные остатки","!")+'</div>'+
 '<div class="insight-split"><div class="insight-card"><h3>Занятия по месяцам</h3>'+graph(x.trend||[],ctx,"done")+'</div>'+
 '<div class="insight-card"><h3>Поступления по месяцам</h3>'+graph(x.trend||[],ctx,"received")+'</div></div>'+
 '<div class="insight-metrics secondary">'+metric(ctx,"Оплачено по факту",ctx.rub(m.factEarned),"Начислено за занятия","▤")+
 metric(ctx,"По абонементам",ctx.rub(m.subEarned),"Подтверждённые списания","◇")+
 metric(ctx,"Авансы",ctx.rub(m.advance),"Поступления сверх начислений по факту","↗")+
 metric(ctx,"Без подтверждения",ctx.rub(m.unverified),"Старые списания / нужно проверить","!")+'</div>'+
 '<div class="section-head"><h2>Преподаватели</h2></div><div class="insight-card">'+
 (top.length?top.map(t=>'<div class="rank-row"><span>'+ctx.esc(t.name)+'</span><div class="rank-track">'+
 '<div class="rank-fill" style="width:'+Math.max(0,Number(t.earned||0)/max*100)+'%"></div></div>'+
 '<strong>'+ctx.rub(t.earned)+'</strong><button class="small-link" data-action="detail" data-id="'+ctx.esc(t.id)+'">Сверка ↗</button></div>').join(""):ctx.empty("Нет данных"))+
 '</div><p class="insight-foot">Количество учеников — текущее, а активность определяется по последнему входу. Историческая стоимость абонементов считается только по подтверждённым списаниям; суммы могут отличаться от полученной предоплаты.</p>';
};
h.renderTeacherFinancials=function(d,ctx){
 lastTeacher=d;
 const f=d.info||{},t=d.teacher||{},students=d.students||[],p=d.period||{};
 return '<div class="detail-intro"><strong>'+ctx.esc(t.name||t.email||"Преподаватель")+'</strong><small>'+ctx.esc(t.email||"")+'</small></div>'+
 '<p class="muted">Период: '+ctx.esc(p.from)+' — '+ctx.esc(p.to)+'. Последняя синхронизация: '+ctx.esc(t.lastSavedAt?new Date(t.lastSavedAt).toLocaleString("ru-RU"):"Нет данных")+'.</p>'+
 '<div class="detail-stats">'+metric(ctx,"Проведено",ctx.count(f.done),"Занятий","◷")+
 metric(ctx,"Начислено",ctx.rub(f.earned),"Подтверждённый заработок","₽")+
 metric(ctx,"Поступило",ctx.rub(f.received),"По записям оплат","↗")+
 metric(ctx,"Расхождения",ctx.rub(f.received-f.earned),"Включая предоплаты","!")+'</div>'+
 '<div class="reconcile"><h3>Из чего складывается сумма</h3>'+
 '<div><span>Начислено по факту</span><b>'+ctx.rub(f.factEarned)+'</b></div>'+
 '<div><span>Списания по абонементам</span><b>'+ctx.rub(f.subEarned)+'</b></div>'+
 '<div><span>Получено по факту</span><b>'+ctx.rub(f.factPaid)+'</b></div>'+
 '<div><span>Получено за абонементы</span><b>'+ctx.rub(f.subReceipts)+'</b></div>'+
 '<div><span>Авансы по оплате за уроки</span><b>'+ctx.rub(f.advance)+'</b></div>'+
 '<div><span>Резерв неиспользованных абонементов</span><b>'+ctx.rub(f.reserve)+'</b></div>'+
 '<div><span>Неподтверждённые историей списания</span><b>'+ctx.rub(f.unverified)+'</b></div></div>'+
 (f.unverifiedLessons?'<div class="alert">Не найдено списаний для '+ctx.count(f.unverifiedLessons)+' использованных по остатку уроков. Проверить исторические записи — не списывать повторно.</div>':'')+
 (f.priceUnitMissing?'<p class="muted">В истории '+ctx.count(f.priceUnitMissing)+' проведённых занятий без явно записанного типа тарифа: они интерпретируются по старому правилу.</p>':'')+
 '<div class="section-head"><h3>Обезличенная сверка по ученикам</h3><button class="button" data-action="export_teacher">↧ CSV</button></div>'+
 ctx.table(["Ученик","Проведено","Начислено","Получено","Резерв","Не подтверждено"],students.map(s=>'<tr><td>'+ctx.esc(s.label)+'</td>'+
 '<td>'+ctx.count(s.done)+'</td><td>'+ctx.rub(s.earned)+'</td><td>'+ctx.rub(s.received)+'</td>'+
 '<td>'+ctx.rub(s.reserve)+'</td><td>'+ctx.rub(s.unverified)+'</td></tr>'))+
 '<p class="insight-foot">'+ctx.esc(d.privacy||"")+' Текущий остаток абонемента используется как справочная величина на момент проверки; для исторического среза он не восстанавливается задним числом.</p>';
};
h.renderDiagnostics=function(d,ctx){
 const x=d.diagnostics||{},issues=x.issues||[],tg=x.telegram||{},acc=x.accounts||{};
 return topHeading("Центр диагностики","Ошибки и сомнительные данные, требующие внимания. Проверки доступны без прямого доступа к VPS.")+
 '<div class="insight-metrics">'+metric(ctx,"Административный API",x.api==="available"?"Доступен":"Нет данных","Подтверждено ответом сервера","◉")+
 metric(ctx,"Telegram: доставлено",ctx.count(tg.sent7d),"Последние 7 дней","↗")+
 metric(ctx,"Telegram: ошибок",ctx.count(tg.failed7d),"Последние 7 дней","!")+
 metric(ctx,"Открытые обращения",ctx.count(x.ticketsOpen),"Проверить в поддержке","☏")+'</div>'+
 '<div class="insight-split"><div class="insight-card"><h3>Диагностика данных</h3>'+
 '<div class="diagnostic-key"><span>Аккаунтов с данными</span><strong>'+ctx.count(acc.withData)+'</strong></div>'+
 '<div class="diagnostic-key"><span>Без новых сохранений более 7 дней</span><strong>'+ctx.count(acc.withoutRecentChanges7d)+'</strong></div>'+
 '<div class="diagnostic-key"><span>Исторических списаний для сверки</span><strong>'+ctx.count(x.unverifiedSubscriptionLessons)+'</strong></div>'+
 '<div class="diagnostic-key"><span>Занятий без явного типа тарифа</span><strong>'+ctx.count(x.legacyPrices)+'</strong></div>'+
 '<div class="diagnostic-key"><span>Активных Telegram-подключений</span><strong>'+ctx.count(tg.activeLinks)+'</strong></div></div>'+
 '<div class="insight-card"><h3>Быстрая диагностика</h3><p>Запрос к административному API и чтение PostgreSQL выполнены успешно.</p>'+
 '<div class="quick-actions"><button class="quick-action" data-action="diag_refresh"><span>↻</span>Проверить повторно</button>'+
 '<button class="quick-action" data-nav="support"><span>☏</span>Открыть поддержку</button>'+
 '<button class="quick-action" data-nav="settings"><span>⚙</span>Настройки платформы</button></div>'+
 '<p class="insight-foot">Изменения в облачных данных не означают доступность сайта, а ошибки Telegram в журнале не равны состоянию процесса бота.</p></div></div>'+
 '<div class="section-head"><h2>Замечания</h2><span class="muted">Всего '+ctx.count(issues.length)+'</span></div>'+
 '<div class="insight-card">'+(issues.length?issues.map(i=>
 '<div class="attention-item"><span class="dot '+ctx.esc(i.severity)+'"></span><div><strong>'+ctx.esc(i.title)+'</strong>'+
 '<p>'+ctx.esc(i.detail)+'</p></div>'+(i.teacherId?'<button class="button" data-action="detail" data-id="'+ctx.esc(i.teacherId)+'">Сверка</button>':'')+'</div>').join(""):'<div class="all-clear">Активных замечаний в текущей выборке нет.</div>')+
 '</div><p class="insight-foot">Проверено '+ctx.esc(x.checkedAt?new Date(x.checkedAt).toLocaleString("ru-RU"):"—")+'. '+ctx.esc(x.note||"")+'</p>';
};
h.renderSettings=function(d,ctx){
 const flags=d.flags||[],overrides=d.overrides||[],teachers=d.teachers||[];
 return topHeading("Быстрые настройки","Управляй доступными настройками платформы и объявлениями без изменения кода.")+
 '<div class="insight-card"><div class="insight-card-head"><h3>Глобальные переключатели</h3><span class="muted">Изменения сохраняются в журнале</span></div>'+
 flags.map(f=>'<div class="setting"><div><strong>'+ctx.esc(f.key==="support_requests"?"Обращения в поддержку":"Объявление о технических работах")+'</strong>'+
 '<p>'+ctx.esc(f.description)+'</p>'+(f.key==="maintenance_banner"?'<p class="setting-preview">'+ctx.esc(f.value)+'</p>':'')+'</div>'+
 '<div class="line-actions"><button class="button '+(f.enabled?"primary":"")+'" data-action="flag_toggle" data-key="'+ctx.esc(f.key)+'" data-enabled="'+(!f.enabled)+'">'+(f.enabled?"Включено":"Выключено")+'</button>'+
 (f.key==="maintenance_banner"?'<button class="button" data-action="flag_text">Изменить текст</button>':'')+'</div></div>').join("")+'</div>'+
 '<div class="section-head"><h2>Индивидуальные объявления</h2><button class="button primary" data-action="override_open">Настроить преподавателю</button></div>'+
 '<div class="insight-card"><p class="muted">Персональный переключатель позволяет показать или скрыть техническое объявление конкретному преподавателю. Его настройка имеет приоритет над глобальной. Тестовые функции календаря и оплат здесь пока не переключаются.</p>'+
 (overrides.length?overrides.map(o=>{
   const teacher=teachers.find(t=>t.id===o.teacher_id);
   return '<div class="setting"><div><strong>'+ctx.esc(teacher?.name||teacher?.email||"Преподаватель")+'</strong>'+
   '<p>'+ctx.esc(o.enabled?"Объявление включено":"Объявление отключено")+' · '+ctx.esc(o.value||"Текст по умолчанию")+'</p></div>'+
   '<button class="button" data-action="override_clear" data-id="'+ctx.esc(o.teacher_id)+'">Вернуть глобальное правило</button></div>';
 }).join(""):'<div class="empty">Индивидуальные объявления пока не настроены.</div>')+'</div>';
};
h.renderSupport=function(d,ctx){
 const tickets=d.tickets||[],teachers=d.teachers||[];
 return topHeading("Поддержка преподавателей","Обрабатывай вопросы и сообщения об ошибках с сохранением истории статусов.")+
 '<div class="insight-toolbar"><div class="toolbar-group"><label>Статус <select id="ticket-filter"><option value="all">Все</option><option value="new">Новые</option><option value="in_progress">В работе</option><option value="resolved">Решены</option></select></label></div>'+
 '<span class="muted">Обращений: '+ctx.count(tickets.length)+'</span></div>'+
 '<div class="insight-card">'+(tickets.length?tickets.map(t=>{
   const owner=teachers.find(a=>a.id===t.teacher_id);
   return '<div class="support-ticket" data-ticket-status="'+ctx.esc(t.status)+'">'+
   '<div class="support-head"><strong>'+ctx.esc(t.subject)+'</strong>'+ctx.statusBadge(t.status)+'</div>'+
   '<div class="muted">'+ctx.esc(owner?.name||owner?.email||"Преподаватель")+' · '+ctx.esc(t.category)+' · '+ctx.esc(new Date(t.created_at).toLocaleString("ru-RU"))+'</div>'+
   '<p>'+ctx.esc(t.message)+'</p><div class="line-actions">'+
   (t.status!=="in_progress"?'<button class="button" data-action="ticket_status" data-id="'+ctx.esc(t.id)+'" data-status="in_progress">В работу</button>':'')+
   (t.status!=="resolved"?'<button class="button primary" data-action="ticket_status" data-id="'+ctx.esc(t.id)+'" data-status="resolved">Отметить решённым</button>':'')+
   '</div></div>';
 }).join(""):'<div class="all-clear">Пока нет обращений.</div>')+'</div>';
};
h.teacherOption=function(teachers,esc){return (teachers||[]).map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name||t.email||t.id)+'</option>').join("")};
h.updateTicketFilter=function(value){
 document.querySelectorAll("[data-ticket-status]").forEach(el=>el.hidden=value!=="all"&&el.dataset.ticketStatus!==value);
};
})(window);
