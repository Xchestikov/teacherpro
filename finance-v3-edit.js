/* Correct an existing payment and preserve a journal of changes. */
(function(){
'use strict';
const cents=n=>Math.round(Number(n)*100);
window.tpApplyPaymentEdit=(id,changes)=>{
 const p=db.payments.find(x=>String(x.id)===String(id));if(!p)return false;
 if(!tpPaymentAmountValid(changes.amount)||!/^\d{4}-\d{2}-\d{2}$/.test(changes.date||'')){
   alert('Укажи корректную сумму и дату.');return false;
 }
 const sub=p.subscriptionId?db.subscriptions.find(s=>String(s.id)===String(p.subscriptionId)):null;
 const nextStatus=changes.status==='paid'?'paid':'pending';
 if(sub){
   if(p.status!=='paid'&&nextStatus==='pending'&&cents(changes.amount)!==cents(p.amount)){
     alert('Долг рассчитывается автоматически. Для частичной оплаты открой абонемент.');return false;
   }
   const others=db.payments.filter(x=>x!==p&&String(x.subscriptionId)===String(sub.id)&&x.status==='paid')
     .reduce((sum,x)=>sum+cents(x.amount),0);
   if(others+(nextStatus==='paid'?cents(changes.amount):0)>cents(sub.price)){
     alert('Общая сумма превышает стоимость абонемента.');return false;
   }
 }
 if(!confirm('Сохранить исправление оплаты и записать в историю?'))return false;
 const before=JSON.parse(JSON.stringify(p)),snapshot=JSON.stringify(db);
 p.amount=Math.round(Number(changes.amount)*100)/100;p.date=changes.date;p.status=nextStatus;
 if(nextStatus==='paid')p.paidAt=changes.date;else delete p.paidAt;
 if(sub&&!tpReconcileSubscription(sub.id)){
   db=normalizeDb(JSON.parse(snapshot));alert('Не удалось пересчитать долг.');return false;
 }
 tpPaymentAudit('edit',before,p);save();closeModal();render();return true;
};
togglePaymentStatus=function(id){
 const p=db.payments.find(x=>String(x.id)===String(id));if(!p)return;
 return tpApplyPaymentEdit(id,{amount:p.amount,date:p.date||todayISO(),status:p.status==='paid'?'pending':'paid'});
};
})();
