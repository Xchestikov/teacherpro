/* Finance V2.1 — fact-of-lesson billing and corrections without changing the payments dashboard. */
(function(){
 'use strict';
 const cents=v=>Math.round(Number(v)*100);
 const money=c=>fmt(Math.round(c)/100);
 const safe=htmlSafe;
 const isFact=c=>c?.billingMode==='fact';
 const ledger=(c)=>db.lessons.filter(l=>String(l.clientId)===String(c.id)&&l.factBillable&&lessonCharges(l.status))
   .reduce((s,l)=>s+cents(roundRub((Number(l.hourlyRate)||0)*(Number(l.duration)||60)/60)),0);
 const received=c=>db.payments.filter(p=>String(p.clientId)===String(c.id)&&p.type==='single'&&p.billingV2&&p.status==='paid')
   .reduce((s,p)=>s+cents(p.amount),0);
 const balance=c=>ledger(c)-received(c);
 window.tpFactBalance=id=>{const c=client(id);return c&&isFact(c)?balance(c)/100:null;};
 // Preserve historical payments: only NEW receipts explicitly marked billingV2 apply to auto-accrual.
 const nativeSavePayment=savePayment;
 savePayment=function(){
   const c=client(Number($('#pClient')?.value));
   const before=db.payments.length;
   nativeSavePayment();
   if(db.payments.length!==before){
     const p=db.payments[db.payments.length-1];
     if(p&&isFact(c)){p.billingV2=true;save();render();}
   }
 };
 const nativeOpenPayment=openPayment;
 openPayment=function(){
   nativeOpenPayment();
   const form=$('#pClient');if(!form)return;
   const update=()=>{
     const c=client(Number(form.value)),amount=$('#pAmount'),hint=$('#tpFactHint');
     if(!amount||!hint)return;
     if(!isFact(c)){hint.textContent='Разовая оплата. Платежи за абонементы вносятся в карточке абонемента.';return;}
     const amountDue=Math.max(0,balance(c));
     hint.textContent='Начислено за уроки: '+money(ledger(c))+' · Получено: '+money(received(c))+
       ' · Остаток: '+money(balance(c))+'. Одним платежом можно закрыть несколько занятий.';
     if(amountDue)amount.value=String(Math.round(amountDue)/100);
   };
   const hint=document.createElement('p');hint.id='tpFactHint';hint.className='muted';
   $('#pAmount')?.closest('label')?.after(hint);
   form.addEventListener('change',update);update();
 };
 function paymentOwner(p){return client(p.clientId)}
 function allowedEdit(p){
   if(!p)return false;
   if(p.subscriptionId)return false;
   if(p.installment)return false;
   return true;
 }
 window.tpEditPayment=id=>{
   const p=db.payments.find(x=>String(x.id)===String(id));if(!p)return;
   if(!allowedEdit(p)){alert('Этот платёж относится к абонементу. Исправление полученной предоплаты требует согласованного перерасчёта в карточке абонемента.');return;}
   openModal('Редактировать оплату','<div class="form"><label>Ученик<select id="tpEditClient">'+
     db.clients.map(c=>'<option value="'+safe(c.id)+'" '+(String(c.id)===String(p.clientId)?'selected':'')+'>'+safe(c.name)+'</option>').join('')+
     '</select></label><label>Дата<input id="tpEditDate" type="date" value="'+safe(p.status==='paid'?(p.paidAt||p.date):p.date)+'"></label>'+
     '<label>Сумма, ₽<input id="tpEditAmount" type="number" min="0.01" step="0.01" value="'+Number(p.amount)+'"></label>'+
     '<label>Статус<select id="tpEditStatus"><option value="pending" '+(p.status==='pending'?'selected':'')+'>Ожидает</option>'+
     '<option value="paid" '+(p.status==='paid'?'selected':'')+'>Получено</option></select></label>'+
     '<div class="form-actions"><button class="secondary" onclick="closeModal()">Отмена</button><button class="primary" data-pay-id="'+safe(id)+'" onclick="tpSavePaymentEdit(this.dataset.payId)">Сохранить</button></div></div>');
 };
 window.tpSavePaymentEdit=id=>{
   const p=db.payments.find(x=>String(x.id)===String(id));if(!allowedEdit(p))return;
   const amount=Number($('#tpEditAmount')?.value),date=$('#tpEditDate')?.value,status=$('#tpEditStatus')?.value,student=client($('#tpEditClient')?.value);
   if(!Number.isFinite(amount)||amount<=0||amount>100000000||Math.abs(amount*100-Math.round(amount*100))>1e-6)return alert('Неверная сумма.');
   if(!/^\d{4}-\d\d-\d\d$/.test(date||'')||!student||!['paid','pending'].includes(status))return alert('Проверь дату, ученика и статус.');
   if(!confirm('Сохранить исправления этой оплаты?'))return;
   if(!Array.isArray(db.paymentCorrections))db.paymentCorrections=[];
   db.paymentCorrections.push({id:crypto.randomUUID(),paymentId:id,at:new Date().toISOString(),kind:'edit',before:{...p}});
   Object.assign(p,{amount,date,status,clientId:student.id});
   if(status==='paid')p.paidAt=date;else delete p.paidAt;
   // Enable fact billing for new or edited receipts only if the owner chooses that model.
   p.billingV2=isFact(student);
   save();closeModal();render();
 };
 const nativeDelete=deletePayment;
 deletePayment=function(id){
   const p=db.payments.find(x=>String(x.id)===String(id));if(!p)return;
   if(!p.subscriptionId){
     if(!confirm('Удалить ошибочную запись об оплате? Сумма и задолженность пересчитаются.'))return;
     if(!Array.isArray(db.paymentCorrections))db.paymentCorrections=[];
     db.paymentCorrections.push({id:crypto.randomUUID(),paymentId:id,at:new Date().toISOString(),kind:'delete',before:{...p}});
     db.payments=db.payments.filter(x=>String(x.id)!==String(id));save();render();return;
   }
   // Partial receipts and used packages cannot be physically removed: maintain original invoices.
   const sub=db.subscriptions.find(s=>String(s.id)===String(p.subscriptionId));
   const used=db.lessons.some(l=>String(l.consumedSubscriptionId)===String(p.subscriptionId));
   const linked=db.payments.filter(x=>String(x.subscriptionId)===String(p.subscriptionId));
   if(!sub)return alert('Абонемент не найден. Запись не изменена.');
   if(used)return alert('У этого абонемента уже есть списанные занятия. Удалять связанную оплату нельзя: потребуется отдельная корректировка и проверка долга.');
   if(p.status==='pending'&&linked.length===1){
     if(!confirm('Удалить ошибочно созданный неоплаченный абонемент вместе с записью ожидаемой оплаты?'))return;
     db.payments=db.payments.filter(x=>x!==p);
     db.subscriptions=db.subscriptions.filter(s=>s!==sub);
     save();render();return;
   }
   // Do not silently rewrite paid receipts/remaining due on partially paid packages.
   alert('По абонементу уже есть финансовая история. Открой «Абонементы» → «История» для проверки; удаление заблокировано до безопасной операции коррекции.');
 };
 // Rebuild payment rows preserving the original four KPI cards, filters and full transaction table.
 const nativePayments=payments;
 payments=function(){
   nativePayments();
   const rows=$$('#paymentRows tr');
   const sorted=db.payments.slice().sort((a,b)=>paymentDate(b).localeCompare(paymentDate(a)));
   rows.forEach((row,i)=>{
     const p=sorted[i];if(!p)return;
     const actions=row.querySelector('.finance-actions');if(!actions)return;
     if(!p.subscriptionId){
       const edit=document.createElement('button');edit.className='link-btn';
       edit.textContent='Редактировать';edit.dataset.payId=String(p.id);edit.onclick=()=>window.tpEditPayment(p.id);
       actions.prepend(edit);
     }else{
       const edit=document.createElement('button');edit.className='link-btn';edit.textContent='Абонемент';
       edit.onclick=()=>{setPage('subscriptions');window.tpSubscriptionHistory?.(p.subscriptionId);};
       actions.prepend(edit);
     }
   });
   const facts=db.clients.filter(isFact);
   if(!facts.length)return;
   const block=document.createElement('section');block.className='tp-fact-debt';
   block.innerHTML='<h3>Расчёты по проведённым занятиям</h3><p class="muted">Начисления учитываются только с момента перехода ученика на новую модель. Старые занятия и платежи автоматически не пересчитываются.</p>'+
     facts.map(c=>'<div class="tp-fact-debt-row"><span>'+safe(c.name)+'</span><span>Начислено '+money(ledger(c))+'</span><span>Оплачено '+money(received(c))+'</span><strong>Остаток '+money(balance(c))+'</strong></div>').join('');
   const filters=document.querySelector('.finance-filters');filters?.before(block);
 };
 const nativeClients=clients;
 clients=function(){
   nativeClients();
   // Tariffs visible in the student list, but no extra columns on the main dashboard.
   $$('#clientRows tr').forEach((row,i)=>{
     const c=db.clients[i];if(!c||!isFact(c))return;
     const name=row.querySelector('.person');if(!name)return;
     name.insertAdjacentHTML('beforeend','<div class="muted">По факту · '+money(cents(c.hourlyRate))+'/час · долг '+money(balance(c))+'</div>');
   });
 };
})();
