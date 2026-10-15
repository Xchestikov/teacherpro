/* Finance V3 — per-student billing policy, without changing historical payments. */
(function(){
'use strict';
const cents=n=>Math.round((Number(n)||0)*100);
const billable=l=>l.billingMode==='per_lesson'&&lessonCharges(l.status);
function balance(id){
 const lessons=db.lessons.filter(l=>String(l.clientId)===String(id)&&billable(l));
 const earned=lessons.reduce((n,l)=>n+Math.round((Number(l.hourlyRate)||0)*(Number(l.duration)||60)/60*100),0);
 const paid=db.payments.filter(p=>String(p.clientId)===String(id)&&p.financeV3Lesson===true&&p.status==='paid')
   .reduce((n,p)=>n+cents(p.amount),0);
 return {earned,paid,due:Math.max(0,earned-paid),credit:Math.max(0,paid-earned),
         count:lessons.length,oldest:lessons.slice().sort((a,b)=>a.date.localeCompare(b.date))[0]?.date||null};
}
window.tpLessonBalance=balance;
const baseConsume=consumeLesson;
consumeLesson=function(id,lesson){
 if(lesson?.billingMode==='per_lesson')return true;
 return baseConsume(id,lesson);
};
const baseRate=suggestedLessonRate;
suggestedLessonRate=function(id,date){
 const c=client(id);
 return c?.billingMode==='per_lesson'?(Number(c.hourlyRate)||0):baseRate(id,date);
};
function policyForm(c){
 const form=document.querySelector('#fName')?.closest('.form');
 if(!form||form.querySelector('#fBillingMode'))return;
 const group=document.createElement('div');group.className='tp-billing-policy';
 group.innerHTML='<h3>Условия занятий</h3>'+
 '<label>Способ оплаты<select id="fBillingMode"><option value="subscription">По абонементу</option>'+
 '<option value="per_lesson">По факту занятия</option></select></label>'+
 '<label>Стоимость часа, ₽<input id="fLessonRate" type="number" min="0" step="0.01" value="'+(Number(c?.hourlyRate)>0?Number(c.hourlyRate):'')+'" placeholder="Укажи цену часа"></label>'+
 '<label>Обычная длительность<select id="fLessonDuration">'+[30,45,60,90,120].map(n=>'<option value="'+n+'">'+n+' минут</option>').join('')+'</select></label>'+
 '<p class="muted">Ставка переносится в новый урок. Старые проведённые занятия и оплаты не меняются.</p>';
 const actions=form.querySelector('.form-actions');
 if(actions)actions.before(group);else form.append(group);
 form.querySelector('#fBillingMode').value=c?.billingMode==='per_lesson'?'per_lesson':'subscription';
 form.querySelector('#fLessonDuration').value=String(c?.preferredDuration||60);
}
const baseOpenClient=openClient;
openClient=function(id,tab){
 baseOpenClient(id,tab);
 if(!id||!tab||tab==='overview')policyForm(id?client(id):null);
};
function readPolicy(){
 const element=document.querySelector('#fBillingMode');
 if(!element)return null;
 const rate=Number(document.querySelector('#fLessonRate').value);
 const duration=Number(document.querySelector('#fLessonDuration').value);
 if(!Number.isFinite(rate)||rate<0||rate>100000000||Math.abs(rate*100-Math.round(rate*100))>1e-6){
   alert('Укажи корректную стоимость часа.');return false;
 }
 if(element.value==='per_lesson'&&rate<=0){alert('Укажи стоимость часа.');return false}
 if(![30,45,60,90,120].includes(duration))return false;
 return {billingMode:element.value,hourlyRate:rate,preferredDuration:duration};
}
function applyPolicy(c,p){
 const old=c.billingMode||'subscription';
 Object.assign(c,p);
 if(old===p.billingMode)return;
 for(const l of db.lessons){
  if(String(l.clientId)!==String(c.id)||l.status!=='planned'||l.date<todayISO()||
      l.consumedSubscriptionId||l.consumedClientFallback)continue;
  l.billingMode=p.billingMode;
  if(p.billingMode==='per_lesson')l.hourlyRate=p.hourlyRate;
 }
}
window.tpApplyBillingPolicy=applyPolicy;
const baseSaveClient=saveClient;
saveClient=function(id){
 const policy=readPolicy();if(policy===false)return;
 const name=document.querySelector('#fName')?.value.trim();
 const tg=document.querySelector('#fTelegram')?.value.trim()||'';
 if(!name||normalizeBirthday(document.querySelector('#fBirthday')?.value||'')===null||
    (tg&&!/^@?[a-zA-Z0-9_]{5,32}$/.test(tg)))return baseSaveClient(id);
 baseSaveClient(id);
 const c=id?client(id):db.clients[db.clients.length-1];
 if(c&&policy){applyPolicy(c,policy);save();render();}
};
const baseSaveProfile=saveClientProfile;
saveClientProfile=function(id){
 const policy=readPolicy();if(policy===false)return;
 const name=document.querySelector('#fName')?.value.trim();
 const tg=document.querySelector('#fTelegram')?.value.trim()||'';
 if(!name||normalizeBirthday(document.querySelector('#fBirthday')?.value||'')===null||
    (tg&&!/^@?[a-zA-Z0-9_]{5,32}$/.test(tg)))return baseSaveProfile(id);
 baseSaveProfile(id);
 const c=client(id);
 if(c&&policy){applyPolicy(c,policy);save();render();openClient(id,'overview');}
};
const baseOpenLesson=openLesson;
openLesson=function(id,date,time){
 baseOpenLesson(id,date,time);
 if(id)return;
 const select=document.querySelector('#lDuration');
 const student=client(document.querySelector('#lClient')?.value);
 if(!select||!student)return;
 const n=Number(student.preferredDuration)||60;
 if(!Array.from(select.options).some(o=>Number(o.value)===n)){
   const option=document.createElement('option');option.value=n;option.textContent=n+' минут';select.append(option);
 }
 select.value=String(n);
 document.querySelector('#lHourlyRate').value=String(suggestedLessonRate(student.id,date||todayISO())||'');
 updateLessonRatePreview();
};
})();
