// Mirrors the existing TeacherPro billing rules without changing the ledger.
// Never confuse an unpaid invoice with a past-due debt (no due date is required).
const n=v=>v===null||v===undefined||v===''?NaN:Number(v);
const cents=v=>Math.round(n(v)*100);
const validAmount=v=>Number.isFinite(n(v))&&n(v)>=0&&Number.isSafeInteger(cents(v));
const money=c=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(c/100);
const billable=new Set(['done','no_show_charged','cancelled_charged']);
const safe=x=>String(x??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,90);
export const activeSubscriptions=payload=>(Array.isArray(payload?.subscriptions)?payload.subscriptions:[])
  .filter(s=>s&&!s.archivedAt&&s.status!=='expired');
export function remainingBalance(s){
  const remaining=n(s?.remaining),total=n(s?.total);
  return Number.isSafeInteger(remaining)&&remaining>=0&&
    Number.isSafeInteger(total)&&total>=0?{remaining,total}:null;
}
export function renewalCandidates(payload){
  return activeSubscriptions(payload).filter(s=>{
    const x=remainingBalance(s);
    return x&&x.remaining<=2&&x.total>0&&s.id!==undefined&&s.id!==null;
  });
}
export function perLessonBalance(payload,clientId){
  const lessons=(Array.isArray(payload?.lessons)?payload.lessons:[])
    .filter(l=>String(l?.clientId)===String(clientId)&&l.billingMode==='per_lesson'&&billable.has(l.status));
  const payments=(Array.isArray(payload?.payments)?payload.payments:[])
    .filter(p=>String(p?.clientId)===String(clientId)&&p.financeV3Lesson===true&&!p.subscriptionId&&p.status==='paid');
  if(lessons.some(l=>!validAmount(l.hourlyRate))||payments.some(p=>!validAmount(p.amount)))return null;
  const earned=lessons.reduce((sum,l)=>{
    const d=n(l.duration);
    const price=l.priceUnit==='lesson'?cents(l.hourlyRate):
      Math.round(cents(l.hourlyRate)*(Number.isFinite(d)&&d>0?d:60)/60);
    return sum+price;
  },0);
  const paid=payments.reduce((sum,p)=>sum+cents(p.amount),0);
  if(!Number.isSafeInteger(earned)||!Number.isSafeInteger(paid))return null;
  return {earned,paid,due:Math.max(0,earned-paid),credit:Math.max(0,paid-earned),lessons:lessons.length};
}
export function studentFinances(payload,studentId){
  const client=(Array.isArray(payload?.clients)?payload.clients:[])
    .find(c=>String(c.id)===String(studentId));
  const subs=activeSubscriptions(payload).filter(s=>String(s.clientId)===String(studentId));
  const lines=subs.slice(0,8).map(s=>{
    const b=remainingBalance(s);
    return '• '+safe(s.name||'Абонемент')+': '+(b?b.remaining+' из '+b.total+' занятий':'остаток уточняется в TeacherPro');
  });
  const lesson=client?.billingMode==='per_lesson'?perLessonBalance(payload,studentId):null;
  if(!lines.length&&client?.billingMode!=='per_lesson')return '🎟 Абонемент\n\nДействующих абонементов нет.';
  let txt='🎟 Мои занятия и оплата\n\n'+(lines.join('\n')||'Оплата по факту проведённых занятий.');
  if(lesson){
    txt+='\n\nНачислено за проведённые занятия: '+money(lesson.earned)+'.'+
      '\nУчтено оплат: '+money(lesson.paid)+'.'+
      (lesson.due?'\nК оплате по учтённым занятиям: '+money(lesson.due)+'.':'')+
      (lesson.credit?'\nАванс: '+money(lesson.credit)+'.':'');
  }else if(client?.billingMode==='per_lesson'){
    txt+='\n\nДля точного расчёта обратитесь к преподавателю.';
  }
  if(subs.some(s=>{const b=remainingBalance(s);return b&&b.remaining<=2;}))
    txt+='\n\n💡 Абонемент скоро закончится. Уточните продление у преподавателя.';
  return txt+'\n\nВсе данные обновляются в TeacherPro.';
}
export function teacherFinances(payload){
  const clients=Array.isArray(payload?.clients)?payload.clients:[];
  const payments=Array.isArray(payload?.payments)?payload.payments:[];
  const pending=payments.filter(p=>p?.status==='pending');
  const candidates=renewalCandidates(payload);
  const outstanding=clients.filter(c=>c?.billingMode==='per_lesson')
    .map(c=>({client:c,balance:perLessonBalance(payload,c.id)}))
    .filter(x=>x.balance?.due>0);
  const total=outstanding.reduce((sum,x)=>sum+x.balance.due,0);
  const labels=candidates.slice(0,7).map(s=>{
    const c=clients.find(c=>String(c.id)===String(s.clientId));
    const b=remainingBalance(s);
    return '• '+safe(c?.name||'Ученик')+' — осталось '+b.remaining+' из '+b.total;
  });
  return '💳 Оплаты и продление\n\n'+
    'Ожидаемых платежей в TeacherPro: '+pending.length+'.\n'+
    'Абонементов с остатком до 2 занятий: '+candidates.length+'.\n'+
    'Учеников с начислениями по факту: '+outstanding.length+'.'+
    (outstanding.length?'\nНеоплаченные начисления по проведённым урокам: '+money(total)+'.':'')+
    (labels.length?'\n\nСкоро потребуется продление:\n'+labels.join('\n'):'')+
    '\n\nОжидаемые платежи не обязательно просрочены. Изменять оплаты можно только в TeacherPro.';
}
