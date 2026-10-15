/* Keep the complete Payments screen, add calculated lesson balances and actions. */
(function(){
'use strict';
const basic=payments;
payments=function(){
 basic();
 const tbody=document.querySelector('#paymentRows');if(!tbody)return;
 const records=db.payments.slice().sort((a,b)=>paymentDate(b).localeCompare(paymentDate(a)));
 [...tbody.querySelectorAll('tr')].forEach((row,i)=>{
   const p=records[i];if(!p)return;
   const actions=row.lastElementChild;
   const edit=document.createElement('button');edit.className='link-btn';edit.textContent='Редактировать';
   edit.onclick=()=>tpOpenPaymentEdit(p.id);actions.prepend(edit);
   const remove=actions.querySelectorAll('button')[2];
   if(remove)remove.textContent='Отменить запись';
   if(p.financeV3Lesson)row.children[3].textContent='Оплата занятий';
   if(p.subscriptionId){
     const sub=db.subscriptions.find(x=>String(x.id)===String(p.subscriptionId));
     if(sub){
       const total=Number(sub.total)||0,remaining=Math.max(0,Number(sub.remaining)||0);
       const scheduled=db.lessons.filter(l=>String(l.clientId)===String(sub.clientId)&&
         l.status==='planned'&&l.date>=(sub.startDate||'0000-01-01')&&
         (!sub.endDate||l.date<=sub.endDate)).length;
       const info=document.createElement('div');info.className='muted tp-subscription-progress';
       info.textContent='Всего '+total+' · осталось '+remaining+
         (scheduled?' · запланировано '+scheduled:'');
       row.children[3].append(info);
     }
   }
 });
 let debt=0,late=0,credit=0,overdueCount=0,accounts=0;
 for(const c of db.clients.filter(x=>x.billingMode==='per_lesson')){
   const b=tpLessonBalance(c.id);credit+=b.credit;
   if(!b.due)continue;
   accounts++;debt+=b.due;
   const overdue=Boolean(b.oldest&&b.oldest<todayISO());
   if(overdue){late+=b.due;overdueCount++;}
   const row=document.createElement('tr');
   row.dataset.status=overdue?'overdue':'pending';
   row.dataset.search=(c.name+' занятия задолженность').toLowerCase();
   row.className='tp-accrual-row';
   row.innerHTML='<td class="person">'+htmlSafe(c.name)+'</td>'+
     '<td>'+dateFmt(b.oldest||todayISO())+'<div class="muted">Начисления уроков</div></td>'+
     '<td>'+fmt(b.due/100)+'</td>'+
     '<td>'+b.count+' уроков · оплата по факту</td>'+
     '<td><span class="status warn">'+(overdue?'Просрочено':'Ожидает оплаты')+'</span></td>'+
     '<td class="finance-actions"><button class="link-btn">Получить оплату</button></td>';
   row.querySelector('button').onclick=()=>openPayment(c.id);tbody.prepend(row);
 }
 const cards=document.querySelectorAll('.finance-cards .stat');
 function explicitPending(){return db.payments.filter(p=>p.status!=='paid')}
 if(cards.length>=4){
   const waiting=explicitPending();
   cards[2].querySelector('.value').textContent=fmt((waiting.reduce((n,p)=>n+Number(p.amount||0),0)*100+debt)/100);
   cards[2].querySelector('.hint').textContent=waiting.length+' ожидаемых платежей · '+accounts+' учеников с долгом';
   const past=waiting.filter(paymentOverdue);
   cards[3].querySelector('.value').textContent=fmt((past.reduce((n,p)=>n+Number(p.amount||0),0)*100+late)/100);
   cards[3].querySelector('.hint').textContent=past.length+' ожидаемых платежей · '+overdueCount+' учеников';
 }
 const toolbar=document.querySelector('#content .toolbar .finance-actions');
 if(toolbar){
   const button=document.createElement('button');button.className='secondary';button.textContent='История исправлений';
   button.onclick=()=>tpShowPaymentChanges();toolbar.prepend(button);
 }
 if(credit){
   const info=document.createElement('p');info.className='tp-credit-note';
   info.textContent='Аванс по занятиям: '+fmt(credit/100)+' — учтётся в следующих уроках.';
   document.querySelector('.finance-filters')?.before(info);
 }
};
window.tpShowPaymentChanges=()=>{
 const events=(tpPaymentHistory()||[]).slice().reverse();
 const rows=events.map(e=>'<div class="tp-history-row"><strong>'+htmlSafe(e.kind==='void'?'Отмена записи':'Исправление')+
 '</strong><span>'+htmlSafe(client(e.clientId)?.name||'Ученик')+'</span><small>'+
 htmlSafe(new Date(e.at).toLocaleString('ru-RU'))+'</small><span>'+
 (e.before?fmt(e.before.amount):'—')+' → '+(e.after?fmt(e.after.amount):'отменено')+'</span></div>').join('');
 openModal('История корректировок','<div class="tp-payment-change-log">'+
 (rows||'<p class="muted">Пока исправлений нет.</p>')+
 '<div class="form-actions"><button class="secondary" onclick="closeModal()">Закрыть</button></div></div>');
};
})();
