/* Mobile UI 2.0: compact cards rendered from the SAME desktop table rows.
   No duplicated financial operations, no changes to stored data, desktop unchanged. */
(function(){
'use strict';
let openedMenu=null;
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const el=(tag,cls,txt)=>{
 const node=document.createElement(tag);
 if(cls)node.className=cls;
 if(txt!==undefined)node.textContent=clean(txt);
 return node;
};
const cell=(row,index)=>clean(row.cells[index]?.textContent);
const inner=(row,index,selector)=>clean(row.cells[index]?.querySelector(selector)?.textContent);
function closeMenu(){
 if(!openedMenu)return;
 openedMenu.menu.hidden=true;
 openedMenu.button.setAttribute('aria-expanded','false');
 openedMenu.card.classList.remove('tp-mobile-menu-open');
 openedMenu=null;
}
function actionMenu(card,actions){
 const more=el('button','tp-mobile-more','⋮');
 more.type='button';more.setAttribute('aria-label','Действия');more.setAttribute('aria-haspopup','menu');
 more.setAttribute('aria-expanded','false');
 const menu=el('div','tp-mobile-actions');menu.hidden=true;menu.setAttribute('role','menu');
 actions.forEach(({label,run,danger})=>{
  if(typeof run!=='function')return;
  const item=el('button','tp-mobile-action'+(danger?' tp-mobile-danger':''),label);
  item.type='button';item.setAttribute('role','menuitem');
  item.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();closeMenu();run();});
  menu.append(item);
 });
 more.addEventListener('click',e=>{
  e.stopPropagation();e.preventDefault();
  if(openedMenu?.button===more){closeMenu();return;}
  closeMenu();
  menu.hidden=false;more.setAttribute('aria-expanded','true');card.classList.add('tp-mobile-menu-open');
  openedMenu={menu,button:more,card};
 });
 card.append(more,menu);
}
document.addEventListener('click',e=>{if(openedMenu&&!openedMenu.menu.contains(e.target)&&!openedMenu.button.contains(e.target))closeMenu();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&openedMenu){e.stopPropagation();closeMenu();}});
function openCard(card,run){
 card.tabIndex=0;card.setAttribute('aria-label','Открыть запись');
 card.addEventListener('click',e=>{
  if(e.target.closest('button,a,input,select'))return;
  if(typeof run==='function')run();
 });
 card.addEventListener('keydown',e=>{
  if((e.key==='Enter'||e.key===' ')&&e.target===card){
   e.preventDefault();if(typeof run==='function')run();
  }
 });
}
function copiedActions(row){
 // Reuse the original handlers (including confirmations, audit and debt reconciliation).
 return [...row.lastElementChild?.querySelectorAll('button')||[]].map(btn=>({
  label:clean(btn.textContent),run:()=>btn.click(),danger:/отменить запись|удалить/i.test(btn.textContent)
 })).filter(item=>item.label);
}
function createList(table,kind){
 const wrap=table.closest('.table-wrap');if(!wrap)return null;
 wrap.classList.add('tp-mobile-original-table');
 const list=el('div','tp-mobile-list tp-mobile-'+kind);
 list.dataset.kind=kind;
 list.setAttribute('aria-label',kind==='clients'?'Ученики':kind==='subscriptions'?'Абонементы':'Оплаты');
 wrap.before(list);
 return list;
}
function badge(text,good){
 const b=el('span','tp-mobile-badge'+(good?' tp-mobile-badge-ok':''),text);
 return b;
}
function pair(a,b){
 const line=el('div','tp-mobile-pair');
 line.append(el('span','',a),el('strong','',b));return line;
}
function clientsCards(){
 const table=document.querySelector('#clientRows')?.closest('table');
 if(!table)return;
 const list=createList(table,'clients');if(!list)return;
 document.querySelectorAll('#clientRows tr').forEach(row=>{
  const key=row.querySelector('[data-student-id]')?.dataset.studentId;
  const c=db.clients.find(x=>String(x.id)===String(key));if(!c)return;
  const card=el('article','tp-mobile-record tp-mobile-student');
  const header=el('div','tp-mobile-main');
  const image=row.querySelector('.s5-table-avatar')?.cloneNode(true)||el('span','s5-table-avatar',c.name?.charAt(0)||'У');
  image.classList.add('tp-mobile-avatar');
  const body=el('div','tp-mobile-headings');
  body.append(el('strong','tp-mobile-title',c.name));
  const upcoming=cell(row,2);
  body.append(el('small','tp-mobile-meta','Следующее: '+(upcoming&&upcoming!=='—'?upcoming:'не запланировано')));
  header.append(image,body);card.append(header);
  const mode=c.billingMode==='per_lesson'?'По факту · '+fmt(Number(c.hourlyRate)||0)+'/час':
    ((c.package&&c.package!=='—')?c.package+' · ':'')+Number(c.remaining||0)+' занятий осталось';
  card.append(el('div','tp-mobile-subline',mode));
  const count=cell(row,3);
  if(count&&count!=='0')card.append(el('div','tp-mobile-muted','Домашние задания: '+count));
  const run=()=>openClient(key);
  openCard(card,run);
  const actions=[{label:'Открыть карточку',run},
   {label:'Добавить занятие',run:()=>planStudentLesson(key)},
   {label:'Изменить профиль',run:()=>openClient(key,'overview')}];
  const phone=String(c.phone||'').replace(/[^\d+]/g,'');
  if(phone&&/^\+?\d{5,15}$/.test(phone))actions.push({label:'Позвонить',run:()=>{window.location.href='tel:'+phone;}});
  actions.push({label:'Удалить ученика',run:()=>deleteClient(key),danger:true});
  actionMenu(card,actions);
  card.dataset.search=clean(row.textContent).toLowerCase();
  card._sourceRow=row;list.append(card);
 });
 syncCards(list);
}
function subscriptionsCards(){
 const table=document.querySelector('#content .table-wrap table');
 if(!table)return;
 const list=createList(table,'subscriptions');if(!list)return;
 [...table.tBodies[0]?.rows||[]].forEach(row=>{
  const id=row.querySelector('[data-sub-id]')?.dataset.subId;
  const sub=db.subscriptions.find(x=>String(x.id)===String(id));if(!sub)return;
  const card=el('article','tp-mobile-record tp-mobile-subscription');
  const header=el('div','tp-mobile-headings');
  header.append(el('strong','tp-mobile-title',(client(sub.clientId)?.name||'Ученик')+' · '+(sub.name||'Абонемент')));
  header.append(el('small','tp-mobile-meta',sub.endDate?'До '+dateFmt(sub.endDate):'Без срока действия'));
  card.append(header);
  const detail=el('div','tp-mobile-grid');
  detail.append(pair('Осталось',Number(sub.remaining||0)+' из '+Number(sub.total||0)),pair('Стоимость',fmt(Number(sub.price)||0)));
  card.append(detail);
  const status=inner(row,5,'.status')||cell(row,5),due=row.querySelector('.tp-finance-due')?.textContent?.trim()||'';
  const footer=el('div','tp-mobile-footer');
  footer.append(badge(status,/актив|оплачено/i.test(status)));
  if(due)footer.append(el('small','tp-mobile-meta',due));
  card.append(footer);
  const run=()=>openSubscription(id);
  openCard(card,run);
  const actions=[{label:'Открыть абонемент',run},...copiedActions(row).filter(x=>!/^(изменить)$/i.test(x.label))];
  actionMenu(card,actions);
  card._sourceRow=row;list.append(card);
 });
 syncCards(list);
}
function paymentsCards(){
 const tbody=document.querySelector('#paymentRows');
 if(!tbody)return;
 const table=tbody.closest('table'),list=createList(table,'payments');if(!list)return;
 [...tbody.rows].forEach(row=>{
  const card=el('article','tp-mobile-record tp-mobile-payment');
  const header=el('div','tp-mobile-headings');
  header.append(el('strong','tp-mobile-amount',cell(row,2)));
  header.append(el('span','tp-mobile-title',cell(row,0)));
  const date=cell(row,1),detail=cell(row,3);
  card.append(header,el('div','tp-mobile-subline',detail));
  card.append(el('div','tp-mobile-footer tp-mobile-payment-footer'));
  const footer=card.lastElementChild;
  footer.append(el('small','tp-mobile-meta',date));
  const status=row.querySelector('.status');
  footer.append(badge(clean(status?.textContent||cell(row,4)),status?.classList.contains('good')));
  const actions=copiedActions(row);
  const primary=actions.find(a=>/редактировать|получить оплату/i.test(a.label))||actions[0];
  openCard(card,primary?.run);
  actionMenu(card,actions);
  card._sourceRow=row;list.append(card);
 });
 syncCards(list);
}
function syncCards(list){
 for(const card of list.querySelectorAll('.tp-mobile-record')){
  const row=card._sourceRow;
  card.hidden=!row||row.hidden||row.style.display==='none';
 }
}
const baseClients=clients;
clients=function(){closeMenu();baseClients();clientsCards();};
const baseSubscriptions=subscriptions;
subscriptions=function(){closeMenu();baseSubscriptions();subscriptionsCards();};
const basePayments=payments;
payments=function(){closeMenu();basePayments();paymentsCards();};
const baseFilterClients=filterClients;
filterClients=function(){baseFilterClients();const list=document.querySelector('.tp-mobile-clients');if(list)syncCards(list);};
const baseFilterPayments=filterPayments;
filterPayments=function(){baseFilterPayments();const list=document.querySelector('.tp-mobile-payments');if(list)syncCards(list);};
})();
