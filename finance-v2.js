/* TeacherPro — finances and subscription operations, stage 3.
   Ledger records only NEW consume/refund events; existing history is not guessed.
   Partial payments split one outstanding invoice into paid receipts + residual debt. */
(function(){
  'use strict';
  const cents=n=>Math.round(Number(n)*100);
  const rub=n=>Math.round(n)/100;
  const number=n=>Number.isFinite(Number(n))?Number(n):0;
  const safe=htmlSafe;
  const bySub=id=>db.payments.filter(p=>String(p.subscriptionId)===String(id));
  const paidCents=id=>bySub(id).filter(p=>p.status==='paid').reduce((sum,p)=>sum+cents(p.amount),0);
  const dueCents=s=>{
    if(s.archivedAt)return 0;
    const payments=bySub(s.id);
    if(!payments.length)return s.paymentStatus==='pending'?cents(s.price):0;
    return Math.max(0,cents(s.price)-paidCents(s.id));
  };
  const visibleTitle=s=>safe((client(s.clientId)?.name||'Ученик')+' · '+(s.name||'Абонемент'));
  const log=(action,lesson,subscriptionId,remainingAfter)=>{
    if(!lesson)return;
    if(!Array.isArray(db.subscriptionHistory))db.subscriptionHistory=[];
    db.subscriptionHistory.push({
      id:crypto.randomUUID(),at:new Date().toISOString(),
      action,clientId:lesson.clientId,lessonId:lesson.id||null,
      subscriptionId:subscriptionId||null,lessonDate:lesson.date||'',
      lessonTime:lesson.time||'',lessonStatus:lesson.status||'',
      remainingAfter:Number.isFinite(remainingAfter)?remainingAfter:null
    });
  };
  const nativeConsume=consumeLesson;
  consumeLesson=function(clientId,lesson){
    const already=Boolean(lesson?.consumedSubscriptionId||lesson?.consumedClientFallback);
    const result=nativeConsume(clientId,lesson);
    if(result&&lesson&&!already&&(lesson.consumedSubscriptionId||lesson.consumedClientFallback)){
      const sub=db.subscriptions.find(s=>String(s.id)===String(lesson.consumedSubscriptionId));
      log('debit',lesson,lesson.consumedSubscriptionId,sub?Number(sub.remaining):Number(client(clientId)?.remaining));
    }
    return result;
  };
  const nativeRefund=refundLesson;
  refundLesson=function(lesson){
    const subId=lesson?.consumedSubscriptionId||null;
    const had=Boolean(subId||lesson?.consumedClientFallback);
    nativeRefund(lesson);
    if(had){
      const sub=db.subscriptions.find(s=>String(s.id)===String(subId));
      log('refund',lesson,subId,sub?Number(sub.remaining):Number(client(lesson.clientId)?.remaining));
    }
  };

  function refreshSubscriptionUi(){
    const table=document.querySelector('#content .table-wrap table');
    if(!table)return;
    const head=table.querySelector('thead tr');
    if(!head)return;
    const rows=[...table.querySelectorAll('tbody tr')];
    // Original subscriptions() sorts descending by startDate.
    const sorted=db.subscriptions.slice().sort((a,b)=>(b.startDate||'').localeCompare(a.startDate||''));
    const th=document.createElement('th');th.textContent='Оплата / долг';
    head.insertBefore(th,head.lastElementChild);
    rows.forEach((row,i)=>{
      const sub=sorted[i];if(!sub)return;
      const td=document.createElement('td');td.className='tp-finance-balance';
      const receipts=bySub(sub.id);
      if(!receipts.length&&sub.paymentStatus!=='pending')td.innerHTML='<strong>По старым данным</strong><small>Платёж не привязан к пакету</small>';
      else{
        const received=rub(paidCents(sub.id)),due=rub(dueCents(sub));
        td.innerHTML='<strong>'+fmt(received)+'</strong><small class="'+(due?'tp-finance-due':'')+'">'+
          (due?'Долг: '+fmt(due):'Оплачено полностью')+'</small>';
      }
      row.insertBefore(td,row.lastElementChild);
      const actions=row.lastElementChild;
      const hist=document.createElement('button');hist.type='button';hist.className='link-btn';
      hist.textContent='История';hist.onclick=()=>window.tpSubscriptionHistory(sub.id);
      actions.append(hist);
      if(dueCents(sub)>0&&bySub(sub.id).some(p=>p.status==='pending')){
        const pay=document.createElement('button');pay.type='button';pay.className='link-btn tp-sub-pay';
        pay.textContent='Внести оплату';pay.onclick=()=>window.tpSubscriptionPayment(sub.id);
        actions.prepend(pay);
      }
    });
    const alerts=db.subscriptions.filter(s=>!s.archivedAt&&s.paymentStatus!=='pending'&&Number(s.remaining)<=2&&Number(s.remaining)>0).slice(0,5);
    if(alerts.length){
      const block=document.createElement('section');block.className='tp-finance-attention';
      block.innerHTML='<h3>Скоро понадобится продление</h3>'+
        alerts.map(s=>'<button class="tp-finance-alert" type="button" data-sub-id="'+safe(s.id)+'">'+
        '<span>'+visibleTitle(s)+'</span><strong>'+Number(s.remaining)+' '+(Number(s.remaining)===1?'занятие':'занятия')+' осталось →</strong></button>').join('');
      block.querySelectorAll('button').forEach(btn=>btn.onclick=()=>renewSubscription(btn.dataset.subId));
      table.closest('.table-wrap').before(block);
    }
  }
  const nativeSubscriptions=subscriptions;
  subscriptions=function(){nativeSubscriptions();refreshSubscriptionUi();};

  window.tpSubscriptionHistory=id=>{
    const sub=db.subscriptions.find(s=>String(s.id)===String(id));
    if(!sub)return;
    const events=(db.subscriptionHistory||[]).filter(x=>String(x.subscriptionId)===String(id))
      .slice().sort((a,b)=>String(b.at).localeCompare(String(a.at)));
    const rows=events.map(e=>'<div class="tp-history-row"><span class="tp-history-symbol '+(e.action==='debit'?'debit':'refund')+'">'+(e.action==='debit'?'−1':'+1')+'</span>'+
      '<div><strong>'+(e.action==='debit'?'Списано занятие':'Возврат занятия')+'</strong>'+
      '<small>'+safe(e.lessonDate||'')+' · '+safe(e.lessonTime||'')+' · '+safe(new Date(e.at).toLocaleString('ru-RU'))+'</small></div>'+
      '<div class="tp-history-remaining">'+(e.remainingAfter===null?'':'Осталось '+e.remainingAfter)+'</div></div>').join('');
    const pay=bySub(id).slice().sort((a,b)=>paymentDate(b).localeCompare(paymentDate(a)))
      .map(p=>'<div class="tp-history-row"><span class="tp-history-symbol paid">₽</span><div><strong>'+
      (p.status==='paid'?'Поступление':'Ожидается')+'</strong><small>'+safe(paymentDate(p))+'</small></div><div class="tp-history-remaining">'+
      fmt(number(p.amount))+'</div></div>').join('');
    const active=db.lessons.filter(l=>String(l.consumedSubscriptionId)===String(id)).length;
    openModal('История абонемента',
      '<div class="tp-history"><p><strong>'+visibleTitle(sub)+'</strong></p>'+
      '<p>Остаток '+Number(sub.remaining)+' из '+Number(sub.total)+' · Текущих списаний: '+active+
      (sub.archivedAt?' · Закрыт '+safe(sub.archivedAt.slice(0,10)):'')+'</p>'+
      '<h4>Списания и возвраты</h4>'+(rows||'<p class="muted">Журнал событий ведётся с этого обновления. Ранее проведённые уроки уже учтены в остатке.</p>')+
      '<h4>Платежи по абонементу</h4>'+(pay||'<p class="muted">Связанные платежи отсутствуют в исторических данных.</p>')+
      '<div class="form-actions"><button class="secondary" onclick="closeModal()">Закрыть</button></div></div>');
  };
  window.tpSubscriptionPayment=id=>{
    const sub=db.subscriptions.find(s=>String(s.id)===String(id));if(!sub||sub.archivedAt)return;
    const due=dueCents(sub);
    if(due<=0)return alert('Абонемент уже полностью оплачен.');
    if(!bySub(sub.id).some(p=>p.status!=='paid'))return alert('Не найдена запись ожидаемого платежа. Не изменяй финансовую историю вручную.');
    openModal('Частичная оплата абонемента','<div class="form"><p>'+visibleTitle(sub)+'</p>'+
      '<p>Получено: <strong>'+fmt(rub(paidCents(id)))+'</strong> · Осталось оплатить: <strong>'+fmt(rub(due))+'</strong></p>'+
      '<label>Получено сейчас, ₽<input id="tpPartialAmount" type="number" min="0.01" max="'+rub(due)+'" step="0.01" value="'+rub(due)+'" required></label>'+
      '<label>Дата получения<input id="tpPartialDate" type="date" value="'+todayISO()+'"></label>'+
      '<p class="muted">Каждое поступление будет отдельной записью. Остаток задолженности пересчитается автоматически. До полной оплаты абонемент не считается оплаченным.</p>'+
      '<div class="form-actions"><button class="secondary" onclick="closeModal()">Отмена</button>'+
      '<button class="primary" data-sub-id="'+safe(id)+'" onclick="tpSavePartialPayment(this.dataset.subId)">Записать поступление</button></div></div>');
  };
  window.tpSavePartialPayment=id=>{
    const sub=db.subscriptions.find(s=>String(s.id)===String(id));if(!sub)return;
    const pending=bySub(id).find(p=>p.status!=='paid');
    const due=dueCents(sub),raw=$('#tpPartialAmount')?.value||'';
    if(!/^\d{1,9}(?:\.\d{1,2})?$/.test(raw))return alert('Укажи сумму в рублях с точностью до копеек.');
    const amount=cents(raw),date=$('#tpPartialDate')?.value;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return alert('Укажи дату получения.');
    if(!pending||due<=0||amount<=0||amount>due)return alert('Сумма не должна превышать оставшуюся задолженность.');
    const expected=cents(sub.price),receipts=paidCents(id);
    const linked=bySub(id);
    if(linked.filter(p=>p.status!=='paid').length!==1||linked.some(p=>!Number.isFinite(Number(p.amount))||Number(p.amount)<0)||
       linked.reduce((n,p)=>n+cents(p.amount),0)!==expected||
       cents(pending.amount)!==expected-receipts)
      return alert('Сумма долга расходится с платежами. Операция остановлена, чтобы не испортить учёт.');
    // Explicit Save already confirms the receipt; no second browser dialog.
    const remainder=due-amount;
    if(remainder===0)db.payments=db.payments.filter(p=>p!==pending);
    else pending.amount=rub(remainder);
    db.payments.push({id:crypto.randomUUID(),clientId:sub.clientId,amount:rub(amount),date,
      paidAt:date,status:'paid',type:'subscription',subscriptionId:sub.id,installment:true,
      description:'Оплата абонемента: '+sub.name});
    sub.paymentStatus=remainder===0?'paid':'pending';
    syncClientSubscription(sub);save();closeModal();render();
  };

  // Individual installment receipts must remain immutable; deleting them would
  // silently corrupt the package balance and falsify already received money.
  const nativeToggle=togglePaymentStatus;
  togglePaymentStatus=function(id){
    const p=db.payments.find(x=>String(x.id)===String(id));
    if(p?.installment)return alert('Частичная оплата уже записана как поступившая. Исправление требует отдельной корректирующей операции.');
    return nativeToggle(id);
  };

  // Add quick access from payments screen to outstanding subscription invoices.
  const nativePayments=payments;
  payments=function(){
    nativePayments();
    const rows=document.querySelector('#paymentRows');
    if(!rows)return;
    const pending=bySub;
    const list=db.subscriptions.filter(s=>!s.archivedAt&&dueCents(s)>0&&pending(s.id).some(p=>p.status!=='paid'));
    if(!list.length)return;
    const panel=document.createElement('section');panel.className='tp-finance-attention';
    panel.innerHTML='<h3>Частичные оплаты по абонементам</h3><div class="tp-finance-alerts">'+
      list.slice(0,8).map(s=>'<button type="button" class="tp-finance-alert" data-sub-id="'+safe(s.id)+'">'+
      '<span>'+visibleTitle(s)+'</span><strong>Осталось '+fmt(rub(dueCents(s)))+' →</strong></button>').join('')+'</div>';
    panel.querySelectorAll('button').forEach(b=>b.onclick=()=>window.tpSubscriptionPayment(b.dataset.subId));
    document.querySelector('#content .table-wrap')?.before(panel);
  };

  // Elegant, relevant home alert only when there is an actionable subscription.
  const nativeRender=render;
  render=function(){
    nativeRender();
    if(page!=='dashboard')return;
    const actions=db.subscriptions.filter(s=>s.paymentStatus!=='pending'&&Number(s.remaining)>0&&Number(s.remaining)<=2);
    if(!actions.length)return;
    const el=document.createElement('section');el.className='tp-home-attention se-card';
    el.innerHTML='<h3>Требует внимания</h3><div>'+
      actions.slice(0,3).map(s=>'<button type="button" data-sub-id="'+safe(s.id)+'">'+
      '<span>'+visibleTitle(s)+'</span><strong>Осталось '+Number(s.remaining)+' · Продлить →</strong></button>').join('')+
      '</div>';
    el.querySelectorAll('button').forEach(b=>b.onclick=()=>renewSubscription(b.dataset.subId));
    document.querySelector('.se-dashboard .se-bottom')?.after(el);
  };
})();


/* Subscription lifecycle: a mistaken package can be removed when no lesson
   history exists. Closed packages retain paid receipts and completed lessons.
   No browser confirmation dialogs, but the action screen explains consequences. */
(function(){
'use strict';
const safe=v=>htmlSafe(String(v??''));
const byId=id=>db.subscriptions.find(s=>String(s.id)===String(id));
const linked=id=>db.payments.filter(p=>String(p.subscriptionId)===String(id));
const used=id=>db.lessons.some(l=>String(l.consumedSubscriptionId)===String(id))||
 (db.subscriptionHistory||[]).some(e=>String(e.subscriptionId)===String(id)&&e.action==='debit');
const hasHistory=s=>used(s.id)||Number(s.remaining)<Number(s.total);
const copy=x=>JSON.parse(JSON.stringify(x));
const logVoid=p=>{if(typeof window.tpPaymentAudit==='function')window.tpPaymentAudit('void',copy(p),null);};
const clearInvoices=id=>{
 for(const p of linked(id).filter(p=>p.status!=='paid'))logVoid(p);
 db.payments=db.payments.filter(p=>String(p.subscriptionId)!==String(id)||p.status==='paid');
};
function refreshStudent(id){
 const c=client(id);if(!c)return;
 syncClientSubscription({clientId:id});
}
window.tpManageSubscription=id=>{
 const s=byId(id);if(!s)return;
 if(s.archivedAt)return window.tpRestoreSubscriptionModal(id);
 const n=linked(id),receipts=n.filter(p=>p.status==='paid');
 const h=hasHistory(s);
 const c=client(s.clientId),rate=Number(c?.hourlyRate)||subscriptionHourlyRate(s)||0;
 const input=Number.isFinite(rate)&&rate>0?String(rate):'';
 const html='<div class="form tp-subscription-manage"><p><strong>'+safe(c?.name||'Ученик')+' · '+safe(s.name)+'</strong></p>'+
   '<p class="muted">Всего: '+Number(s.total)+' · осталось: '+Number(s.remaining)+
   ' · получено платежей: '+receipts.length+'.</p>'+
   '<div class="tp-subscription-manage-choices">'+
   (!h?'<button class="secondary tp-sub-danger" type="button" data-sub-id="'+safe(s.id)+
     '" onclick="tpRemoveMistakenSubscription(this.dataset.subId)">Удалить ошибочный абонемент</button>'+
     '<p class="muted">Удалится этот пакет и его связанные платежи. Полученные суммы исключатся из сводки, а отмена будет записана в историю исправлений.</p>':'')+
   '<button class="secondary" type="button" data-sub-id="'+safe(s.id)+
     '" onclick="tpCloseSubscription(this.dataset.subId,false)">Закрыть абонемент</button>'+
   '<p class="muted">Пакет перестанет использоваться для новых списаний; проведённые уроки и реальные поступления сохранятся. Ожидаемые платежи по нему будут сняты.</p>'+
   '<label>Стоимость часа при оплате по факту, ₽<input id="tpSwitchHourlyRate" type="number" min="0.01" step="0.01" placeholder="Например, 1500" value="'+safe(input)+'"></label>'+
   '<button class="primary" type="button" data-sub-id="'+safe(s.id)+
     '" onclick="tpCloseSubscription(this.dataset.subId,true)">Закрыть и перейти на оплату по факту</button>'+
   '<p class="muted">Новые и будущие запланированные уроки будут оплачиваться по факту. Проведённые уроки и исторические платежи не изменятся.</p>'+
   '</div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Назад</button></div></div>';
 openModal('Управление абонементом',html);
};
window.tpRemoveMistakenSubscription=id=>{
 const s=byId(id);if(!s||s.archivedAt)return false;
 // Never erase a package once a lesson was charged to it.
 if(hasHistory(s))return alert('По пакету уже проходили занятия. Его можно закрыть, сохранив историю.');
 const records=linked(id);
 records.forEach(logVoid);
 db.payments=db.payments.filter(p=>String(p.subscriptionId)!==String(id));
 db.subscriptions=db.subscriptions.filter(p=>String(p.id)!==String(id));
 refreshStudent(s.clientId);
 save();closeModal();render();return true;
};
window.tpCloseSubscription=(id,switchToFact=false)=>{
 const s=byId(id);if(!s||s.archivedAt)return false;
 const c=client(s.clientId);
 let rate=0;
 if(switchToFact){
   rate=Number(document.querySelector('#tpSwitchHourlyRate')?.value);
   if(!Number.isFinite(rate)||rate<=0||rate>100000000||
      Math.abs(rate*100-Math.round(rate*100))>1e-6)return alert('Укажи корректную стоимость часа для оплаты по факту.');
   if(!c)return alert('Не найден ученик для смены способа оплаты.');
 }
 s.archivedAt=new Date().toISOString();
 s.archivedReason=switchToFact?'per_lesson':'manual';
 s.status='archived';
 clearInvoices(s.id);
 if(switchToFact){
   if(typeof window.tpApplyBillingPolicy==='function')
     window.tpApplyBillingPolicy(c,{billingMode:'per_lesson',hourlyRate:rate,preferredDuration:Number(c.preferredDuration)||60});
   else{c.billingMode='per_lesson';c.hourlyRate=rate;}
   for(const l of db.lessons){
     if(String(l.clientId)===String(c.id)&&l.status==='planned'&&l.date>=todayISO()&&
        !l.consumedSubscriptionId&&!l.consumedClientFallback){
       l.billingMode='per_lesson';l.hourlyRate=rate;
     }
   }
 }
 refreshStudent(s.clientId);
 save();closeModal();render();return true;
};
window.tpRestoreSubscriptionModal=id=>{
 const s=byId(id);if(!s||!s.archivedAt)return;
 openModal('Закрытый абонемент','<div class="form tp-subscription-manage">'+
 '<p>'+safe(client(s.clientId)?.name||'Ученик')+' · '+safe(s.name)+'</p>'+
 '<p class="muted">Пакет закрыт. Исторические поступления и проведённые занятия сохранены.</p>'+
 '<button class="secondary" data-sub-id="'+safe(id)+'" onclick="tpRestoreSubscription(this.dataset.subId)">Восстановить абонемент</button>'+
 '<div class="form-actions"><button class="secondary" onclick="closeModal()">Назад</button></div></div>');
};
window.tpRestoreSubscription=id=>{
 const s=byId(id);if(!s?.archivedAt)return false;
 delete s.archivedAt;delete s.archivedReason;
 s.status=Number(s.remaining)>0?'active':'expired';
 if(typeof window.tpReconcileSubscription==='function'&&!window.tpReconcileSubscription(s.id)){
   s.archivedAt=new Date().toISOString();s.status='archived';
   return alert('Не удалось восстановить связанный платёж. Данные не изменены.');
 }
 refreshStudent(s.clientId);
 save();closeModal();render();return true;
};
const originalSubscriptions=subscriptions;
subscriptions=function(){
 originalSubscriptions();
 const tbody=document.querySelector('#content .table-wrap table tbody');
 if(!tbody)return;
 const sorted=db.subscriptions.slice().sort((a,b)=>(b.startDate||'').localeCompare(a.startDate||''));
 [...tbody.rows].forEach((row,i)=>{
   const s=sorted[i];if(!s)return;
   const actions=row.lastElementChild;if(!actions)return;
   if(s.archivedAt){
     for(const button of [...actions.querySelectorAll('button')]){
       if(button.textContent.trim()==='Изменить'||button.textContent.trim()==='Продлить'||button.textContent.trim()==='Внести оплату')button.remove();
     }
   }
   const button=document.createElement('button');
   button.type='button';button.className='link-btn tp-sub-manage-btn';
   button.dataset.subId=s.id;
   button.textContent=s.archivedAt?'Восстановить':'Удалить / закрыть';
   button.onclick=()=>s.archivedAt?window.tpRestoreSubscriptionModal(s.id):window.tpManageSubscription(s.id);
   actions.append(button);
 });
};
})();
