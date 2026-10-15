/* Editing individual receipts retains all original accounting records until saved. */
(function(){
'use strict';
window.tpOpenPaymentEdit=id=>{
 const p=db.payments.find(x=>String(x.id)===String(id));if(!p)return;
 const sub=p.subscriptionId?db.subscriptions.find(s=>String(s.id)===String(p.subscriptionId)):null;
 openModal('Исправить оплату','<div class="form"><p class="muted">'+
   htmlSafe(client(p.clientId)?.name||'Ученик')+
   (sub?' · Абонемент '+htmlSafe(sub.name):' · Разовая оплата')+'</p>'+
   '<label>Сумма, ₽<input id="tpEditAmount" type="number" min="0.01" step="0.01" value="'+
   Number(p.amount)+'" '+(sub&&p.status!=='paid'?'readonly':'')+'></label>'+
   '<label>Дата<input id="tpEditDate" type="date" value="'+htmlSafe(paymentDate(p))+'"></label>'+
   '<label>Статус<select id="tpEditStatus"><option value="paid">Получено</option>'+
   '<option value="pending">Ожидается</option></select></label>'+
   '<p class="muted">Исправления сохраняются в журнале. Для абонемента долг пересчитается.</p>'+
   '<div class="form-actions"><button class="secondary" onclick="closeModal()">Отмена</button>'+
   '<button class="primary" data-pay-id="'+htmlSafe(p.id)+
   '" onclick="tpSavePaymentEdit(this.dataset.payId)">Сохранить</button></div></div>');
 document.querySelector('#tpEditStatus').value=p.status==='paid'?'paid':'pending';
};
window.tpSavePaymentEdit=id=>tpApplyPaymentEdit(id,{
 amount:document.querySelector('#tpEditAmount')?.value,
 date:document.querySelector('#tpEditDate')?.value,
 status:document.querySelector('#tpEditStatus')?.value
});
})();
