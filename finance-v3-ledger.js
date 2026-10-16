/* Finance V3: safely recompute an invoice after correcting receipts. */
(function(){
'use strict';
const cents=n=>Math.round(Number(n)*100);
window.tpPaymentAudit=(kind,before,after)=>{
 if(!Array.isArray(db.paymentChanges))db.paymentChanges=[];
 db.paymentChanges.push({id:crypto.randomUUID(),at:new Date().toISOString(),kind,
   paymentId:before?.id||after?.id||'',clientId:before?.clientId??after?.clientId,
   before:before?JSON.parse(JSON.stringify(before)):null,
   after:after?JSON.parse(JSON.stringify(after)):null});
};
window.tpPaymentHistory=()=>db.paymentChanges||[];
window.tpPaymentAmountValid=value=>{
 const n=Number(value);
 return Number.isFinite(n)&&n>0&&n<=100000000&&Math.abs(n*100-Math.round(n*100))<1e-6;
};
window.tpReconcileSubscription=subId=>{
 const sub=db.subscriptions.find(s=>String(s.id)===String(subId));
 if(!sub)return false;
 const related=db.payments.filter(p=>String(p.subscriptionId)===String(sub.id));
 const paid=related.filter(p=>p.status==='paid').reduce((sum,p)=>sum+cents(p.amount),0);
 const total=cents(sub.price);
 if(paid<0||paid>total)return false;
 // Closed packages keep the historic receipts but never recreate future invoices.
 if(sub.archivedAt){
   db.payments=db.payments.filter(p=>String(p.subscriptionId)!==String(sub.id)||p.status==='paid');
   syncClientSubscription(sub);return true;
 }
 const debt=total-paid;
 const waiting=related.filter(p=>p.status!=='paid');
 if(!debt)db.payments=db.payments.filter(p=>!waiting.includes(p));
 else{
   if(waiting.length){waiting[0].amount=debt/100;waiting[0].status='pending';}
   else db.payments.push({id:crypto.randomUUID(),clientId:sub.clientId,subscriptionId:sub.id,
     type:'subscription',status:'pending',amount:debt/100,date:sub.startDate||todayISO(),
     description:'Ожидаемая доплата за абонемент'});
   if(waiting.length>1)db.payments=db.payments.filter(p=>!waiting.slice(1).includes(p));
 }
 sub.paymentStatus=debt>0?'pending':'paid';
 syncClientSubscription(sub);
 return true;
};
})();
