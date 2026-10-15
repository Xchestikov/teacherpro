(function(){'use strict';
window.tpVoidPayment=id=>{
 const p=db.payments.find(x=>String(x.id)===String(id));if(!p)return false;
 const sub=p.subscriptionId?db.subscriptions.find(s=>String(s.id)===String(p.subscriptionId)):null;
 if(sub&&p.status!=='paid')return alert('Исправь ожидаемый платёж в абонементах.');
 const previous=JSON.parse(JSON.stringify(p)),snapshot=JSON.stringify(db);
 db.payments=db.payments.filter(x=>String(x.id)!==String(id));
 if(sub&&!tpReconcileSubscription(sub.id)){db=normalizeDb(JSON.parse(snapshot));return alert('Ошибка согласования долга.');}
 tpPaymentAudit('void',previous,null);save();render();return true;
};
deletePayment=id=>tpVoidPayment(id);
})();