/* Payments V3: one actual receipt may settle several billed lessons. */
(function(){
'use strict';
window.tpPaymentDefault=()=>{
 const c=client(document.querySelector('#pClient')?.value);if(!c)return;
 const b=c.billingMode==='per_lesson'?tpLessonBalance(c.id):null;
 const input=document.querySelector('#pAmount');if(input)input.value=b?.due?(b.due/100).toFixed(2):'';
 const note=document.querySelector('#tpPaymentHint');
 if(note)note.textContent=b?
  'Начислено: '+fmt(b.earned/100)+' · Получено: '+fmt(b.paid/100)+' · Долг: '+fmt(b.due/100):
  'Разовая оплата. Абонементы оформляются отдельно.';
};
openPayment=function(id){
 if(!db.clients.length)return alert('Сначала добавь ученика.');
 openModal('Получение оплаты','<div class="form"><label>Ученик<select id="pClient" onchange="tpPaymentDefault()">'+
   db.clients.map(c=>'<option value="'+htmlSafe(c.id)+'">'+htmlSafe(c.name)+'</option>').join('')+
   '</select></label><p id="tpPaymentHint" class="muted"></p>'+
   '<label>Дата<input id="pDate" type="date" value="'+todayISO()+'"></label>'+
   '<label>Сумма, ₽<input id="pAmount" type="number" min="0.01" step="0.01"></label>'+
   '<label>Статус<select id="pStatus"><option value="paid">Получено</option>'+
   '<option value="pending">Ожидается (разовая оплата)</option></select></label>'+
   '<div class="form-actions"><button class="secondary" onclick="closeModal()">Отмена</button>'+
   '<button class="primary" onclick="savePayment()">Записать</button></div></div>');
 if(id&&db.clients.some(c=>String(c.id)===String(id)))document.querySelector('#pClient').value=String(id);
 tpPaymentDefault();
};
savePayment=function(){
 const c=client(document.querySelector('#pClient')?.value);
 const amount=Number(document.querySelector('#pAmount')?.value);
 const status=document.querySelector('#pStatus')?.value;
 const date=document.querySelector('#pDate')?.value;
 if(!c||!tpPaymentAmountValid(amount)||!/^\d{4}-\d{2}-\d{2}$/.test(date||''))
   return alert('Проверь ученика, сумму и дату.');
 if(c.billingMode==='per_lesson'&&status==='pending')
   return alert('Долг за занятия начисляется автоматически. Укажи фактически полученные деньги.');
 db.payments.push({id:crypto.randomUUID(),clientId:Number(c.id),amount:Math.round(amount*100)/100,
   date,...(status==='paid'?{paidAt:date}:{}),status,type:'single',financeV3Lesson:c.billingMode==='per_lesson'});
 save();closeModal();render();
};
})();
