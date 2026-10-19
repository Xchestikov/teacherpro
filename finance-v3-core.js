/* Finance V3 — per-student billing policy, without changing historical payments. */
(function(){
'use strict';
const cents=n=>Math.round((Number(n)||0)*100);
const billable=l=>l.billingMode==='per_lesson'&&lessonCharges(l.status);
window.tpLessonPriceUnit=l=>l?.priceUnit==='lesson'?'lesson':'hour';
window.tpLessonPriceCents=l=>{
 const rate=Number(l?.hourlyRate)||0;
 const duration=Number(l?.duration)||60;
 return window.tpLessonPriceUnit(l)==='lesson'?cents(rate):Math.round(rate*duration/60*100);
};
window.tpLessonBalance=id=>{
 const lessons=db.lessons.filter(l=>String(l.clientId)===String(id)&&billable(l))
   .slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
 const earned=lessons.reduce((n,l)=>n+window.tpLessonPriceCents(l),0);
 const paid=db.payments.filter(p=>String(p.clientId)===String(id)&&p.financeV3Lesson===true&&!p.subscriptionId&&p.status==='paid')
   .reduce((n,p)=>n+cents(p.amount),0);
 let covered=paid,oldest=null,unpaidCount=0;
 for(const l of lessons){
   const amount=window.tpLessonPriceCents(l);
   if(covered>=amount){covered-=amount;continue}
   if(!oldest)oldest=l.date;
   unpaidCount++;covered=0;
 }
 return {earned,paid,due:Math.max(0,earned-paid),credit:Math.max(0,paid-earned),
   count:lessons.length,unpaidCount,oldest};
};
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
 '<label>Как считать стоимость<select id="fPriceUnit" onchange="tpUpdateStudentPriceUnit()"><option value="lesson">За занятие</option><option value="hour">За час</option></select></label>'+
 '<label>Стоимость занятия, ₽<input id="fLessonRate" type="number" min="0" step="0.01" value="'+(Number(c?.hourlyRate)>0?Number(c.hourlyRate):'')+'" placeholder="Укажи цену часа"></label>'+
 '<label>Обычная длительность, минут<input id="fLessonDuration" type="number" min="15" max="240" step="1" inputmode="numeric" required placeholder="Например, 50" aria-label="Обычная длительность занятия в минутах"></label>'+ 
 '<p class="muted">Ставка переносится в новый урок. Старые проведённые занятия и оплаты не меняются.</p>';
 const actions=form.querySelector('.form-actions');
 if(actions)actions.before(group);else form.append(group);
 form.querySelector('#fBillingMode').value=c?.billingMode==='per_lesson'?'per_lesson':'subscription';
 form.querySelector('#fPriceUnit').value=c?window.tpLessonPriceUnit(c):'lesson';
 window.tpUpdateStudentPriceUnit();
 const preferred=Number(c?.preferredDuration)||60;
 form.querySelector('#fLessonDuration').value=String(Number.isInteger(preferred)&&preferred>=15&&preferred<=240?preferred:60);
}
const baseOpenClient=openClient;
openClient=function(id,tab){
 baseOpenClient(id,tab);
 if(!id||!tab||tab==='overview')policyForm(id?client(id):null);
};
window.tpUpdateStudentPriceUnit=()=>{
 const unit=document.querySelector('#fPriceUnit')?.value;
 const label=document.querySelector('#fLessonRate')?.closest('label');
 if(label)label.firstChild.textContent=unit==='hour'?'Стоимость часа, ₽':'Стоимость занятия, ₽';
};
function readPolicy(){
 const element=document.querySelector('#fBillingMode');
 if(!element)return null;
 const rate=Number(document.querySelector('#fLessonRate').value);
 const priceUnit=document.querySelector('#fPriceUnit')?.value;
 if(!['hour','lesson'].includes(priceUnit))return false;
 const durationRaw=document.querySelector('#fLessonDuration').value.trim();
 const duration=durationRaw===''?NaN:Number(durationRaw);
 if(!Number.isFinite(rate)||rate<0||rate>100000000||Math.abs(rate*100-Math.round(rate*100))>1e-6){
   alert('Укажи корректную стоимость.');return false;
 }
 if(element.value==='per_lesson'&&rate<=0){alert('Укажи стоимость занятия или часа.');return false}
 if(!Number.isInteger(duration)||duration<15||duration>240){
   alert('Длительность занятия должна быть целым числом от 15 до 240 минут.');return false;
 }
 return {billingMode:element.value,hourlyRate:rate,preferredDuration:duration,priceUnit};
}
function applyPolicy(c,p){
 const old=c.billingMode||'subscription';
 Object.assign(c,p);
 if(old===p.billingMode)return;
 for(const l of db.lessons){
  if(String(l.clientId)!==String(c.id)||l.status!=='planned'||l.date<todayISO()||
      l.consumedSubscriptionId||l.consumedClientFallback)continue;
  l.billingMode=p.billingMode;
  if(p.billingMode==='per_lesson'){l.hourlyRate=p.hourlyRate;l.priceUnit=p.priceUnit||'hour';}
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
updateLessonRatePreview=function(){
 const rateField=document.querySelector('#lHourlyRate'),preview=document.querySelector('#lessonRatePreview');
 const unit=document.querySelector('#lPriceUnit')?.value||'hour';
 const label=rateField?.closest('label');
 if(label)label.firstChild.textContent=unit==='hour'?'Стоимость часа, ₽':'Стоимость занятия, ₽';
 if(!preview)return;
 const raw=rateField?.value||'',rate=Number(raw),duration=Number(document.querySelector('#lDuration')?.value)||60;
 preview.textContent=raw!==''&&Number.isFinite(rate)&&rate>=0?
   'Стоимость занятия: '+fmt(window.tpLessonPriceCents({hourlyRate:rate,duration,priceUnit:unit})/100):
   'Укажи стоимость';
};
window.tpUpdateLessonPriceUnit=()=>updateLessonRatePreview();
const baseUpdateLessonRateForStudent=updateLessonRateForStudent;
updateLessonRateForStudent=function(){
 baseUpdateLessonRateForStudent();
 const c=client(document.querySelector('#lClient')?.value),duration=document.querySelector('#lDuration');
 if(!c||!duration)return;
 const minutes=Number(c.preferredDuration)||60;
 if(![...duration.options].some(x=>Number(x.value)===minutes)){
   const o=document.createElement('option');o.value=String(minutes);o.textContent=minutes+' минут';duration.append(o);
 }
 duration.value=String(minutes);
 const unit=document.querySelector('#lPriceUnit');
 if(unit&&unit.dataset.currentClient!==String(c.id)){
   unit.value=window.tpLessonPriceUnit(c);unit.dataset.currentClient=String(c.id);
 }
 updateLessonRatePreview();
};
const baseOpenLesson=openLesson;
openLesson=function(id,date,time){
 baseOpenLesson(id,date,time);
 const field=document.querySelector('#lHourlyRate');
 if(!field)return;
 const previous=id?db.lessons.find(l=>String(l.id)===String(id)):null;
 const student=client(document.querySelector('#lClient')?.value);
 const label=document.createElement('label');label.textContent='Как считать стоимость';
 const unit=document.createElement('select');unit.id='lPriceUnit';
 unit.innerHTML='<option value="lesson">За занятие</option><option value="hour">За час</option>';
 unit.setAttribute('onchange','tpUpdateLessonPriceUnit()');
 unit.value=previous?window.tpLessonPriceUnit(previous):student?window.tpLessonPriceUnit(student):'lesson';
 unit.dataset.currentClient=String(student?.id||'');label.append(unit);
 field.closest('label')?.before(label);
 if(previous){
   const duration=document.querySelector('#lDuration'),minutes=Number(previous.duration)||60;
   if(duration&&![...duration.options].some(o=>Number(o.value)===minutes)){
     const o=document.createElement('option');o.value=String(minutes);o.textContent=minutes+' минут';duration.append(o);
   }
   if(duration)duration.value=String(minutes);
 }
 if(!id&&student){
   const duration=document.querySelector('#lDuration'),minutes=Number(student.preferredDuration)||60;
   if(duration&&![...duration.options].some(o=>Number(o.value)===minutes)){
     const o=document.createElement('option');o.value=String(minutes);o.textContent=minutes+' минут';duration.append(o);
   }
   if(duration)duration.value=String(minutes);
   field.value=String(suggestedLessonRate(student.id,date||todayISO())||'');
 }
 updateLessonRatePreview();
};
})();
