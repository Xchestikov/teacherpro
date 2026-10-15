/* TeacherPro calendar UX — stage 1, review branch only. */
(function(){
  'use strict';
  let holdTimer=null, gesture=null, suppressClickUntil=0;
  const menu=document.createElement('div');
  menu.className='lesson-quick-menu';
  menu.hidden=true;
  menu.setAttribute('role','menu');
  document.body.appendChild(menu);
  const eventButton=target=>target?.closest?.('.calendar-event');
  const lessonFor=el=>el&&db.lessons.find(l=>String(l.id)===String(el.dataset.lessonId));
  const dismiss=()=>{menu.hidden=true;menu.innerHTML='';};
  function openMenu(el,x,y){
    const lesson=lessonFor(el);if(!lesson)return;
    dismiss();
    const items=[
      ['status:planned','Запланирован'],
      ['status:done','Проведён'],
      ['move','Перенести'],
      ['status:no_show','Не пришёл (без списания)'],
      ['status:no_show_charged','Не пришёл (со списанием)'],
      ['status:cancelled','Отменён (без списания)'],
      ['status:cancelled_charged','Отменён со списанием'],
      ['status:cancelled_by_teacher','Отменено мной'],
      ['delete','Удалить урок']
    ];
    menu.innerHTML='<div class="lesson-quick-heading">'+htmlSafe(client(lesson.clientId)?.name||'Ученик')+' · '+htmlSafe(lesson.time)+'</div>'+
      items.map(([key,name])=>'<button type="button" role="menuitem" class="'+(key==='delete'?'menu-delete ':key==='status:'+lesson.status?'selected ':'')+'" data-action="'+key+'">'+
      (key==='status:'+lesson.status?'✓　':'')+name+'</button>').join('');
