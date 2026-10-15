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
    menu.dataset.lessonId=String(lesson.id);
    menu.hidden=false;
    menu.style.left=Math.max(8,Math.min(x,innerWidth-menu.offsetWidth-8))+'px';
    menu.style.top=Math.max(8,Math.min(y,innerHeight-menu.offsetHeight-8))+'px';
    menu.querySelector('[data-action="edit"]')?.focus({preventScroll:true});
  }
  function moveLesson(lesson,cell,clientY){
    const minute=calendarSlotAtPoint(cell,clientY);
    if(!lesson||lesson.status!=='planned'||minute===null||minute<480||minute>=1380)return;
    const date=cell.dataset.date,time=minutesToClock(minute);
    if(typeof window.tpCalendarMove==='function'){window.tpCalendarMove(lesson,date,time);return;}
    if(date===lesson.date&&time===lesson.time)return;
    const conflicts=lessonConflicts({...lesson,date,time},lesson.id);
    if(conflicts.length&&!confirm('В выбранное время уже запланировано занятие. Всё равно перенести?'))return;
    if(!confirm('Перенести занятие на '+date+' в '+time+'?'))return;
    lesson.date=date;lesson.time=time;save();render();
  }
  window.teacherproOpenQuickMenu=openMenu;
  menu.addEventListener('click',e=>{
    const button=e.target.closest('[data-action]');if(!button)return;
    const id=menu.dataset.lessonId,action=button.dataset.action;
    dismiss();
    if(action==='edit')openLessonByKey(id);
    if(action==='delete')deleteLesson(id);
    if(action==='move'){openLessonByKey(id);document.querySelector('#lDate')?.focus();}
    if(action.startsWith('status:')&&typeof window.tpUpdateLessonStatus==='function')window.tpUpdateLessonStatus(id,action.slice(7));
  });
  document.addEventListener('contextmenu',e=>{
    const el=eventButton(e.target);if(!el)return;
    e.preventDefault();openMenu(el,e.clientX,e.clientY);
  });
  document.addEventListener('click',e=>{
    if(Date.now()<suppressClickUntil&&eventButton(e.target)){e.preventDefault();e.stopImmediatePropagation();return;}
    if(!menu.hidden&&!menu.contains(e.target))dismiss();
  },true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')dismiss();});
  // iOS Safari and mobile Chromium can cancel pointer gestures to perform a
  // native long-press selection. Use non-passive Touch Events as the authoritative
  // path on actual touchscreens; retain Pointer Events for compatible devices.
  function beginGesture(el,x,y,pointerId=null,fromTouch=false,touchId=null){
    const lesson=lessonFor(el);
    if(!lesson||lesson.status!=='planned')return false;
    dismiss();
    clearTimeout(holdTimer);
    if(gesture&&gesture.element!==el)gesture.element.classList.remove('touch-dragging');
    gesture={id:el.dataset.lessonId,pointerId,touchId,fromTouch,x,y,
      startX:x,startY:y,active:false,element:el};
    holdTimer=setTimeout(()=>{
      const current=gesture;
      if(!current||current.element!==el)return;
      current.active=true;
      suppressClickUntil=Date.now()+900;
      el.classList.add('touch-dragging');
      window.getSelection?.()?.removeAllRanges();
      if(navigator.vibrate)navigator.vibrate(25);
    },450);
    return true;
  }
  function cellAt(x,y,origin){
    const hit=document.elementFromPoint(x,y);
    const direct=hit?.closest?.('.calendar-cell');
    if(direct){
      const r=direct.getBoundingClientRect();
      // A long event may visually cover a later grid row. Its closest cell
      // is then the ORIGINAL hour, not the hour at the finger coordinate.
      if(x>=r.left&&x<r.right&&y>=r.top&&y<r.bottom)return direct;
    }
    const originDate=origin?.closest('.calendar-cell')?.dataset.date;
    const cells=[...document.querySelectorAll('.calendar-cell[data-minute]')];
    const atPosition=cells.find(cell=>{
      const r=cell.getBoundingClientRect();
      return y>=r.top&&y<r.bottom&&x>=r.left&&x<r.right;
    });
    if(atPosition)return atPosition;
    // Dragging over the sticky hour labels still means the same day's row.
    if(hit?.closest?.('.calendar-hour')&&originDate)
      return cells.find(cell=>cell.dataset.date===originDate&&
        y>=cell.getBoundingClientRect().top&&y<cell.getBoundingClientRect().bottom)||null;
    return null;
  }
  function clearDropTargets(){
    document.querySelectorAll('.calendar-cell.touch-drop-target')
      .forEach(el=>el.classList.remove('touch-drop-target'));
  }
  function updateGesture(x,y){
    if(!gesture)return;
    const g=gesture;g.x=x;g.y=y;
    if(!g.active&&Math.hypot(x-g.startX,y-g.startY)>12){
      clearTimeout(holdTimer);
      g.element.classList.remove('touch-dragging');
      gesture=null;return;
    }
    if(g.active){
      window.getSelection?.()?.removeAllRanges();
      window.tpCalendarTouchDragMove?.(x,y);
      const cell=cellAt(x,y,g.element);
      clearDropTargets();
      if(cell)cell.classList.add('touch-drop-target');
    }
  }
  function finishGesture(cancelled){
    if(!gesture)return;
    clearTimeout(holdTimer);
    const g=gesture;gesture=null;
    const wasActive=g.active;
    g.element.classList.remove('touch-dragging');
    clearDropTargets();
    try{
      if(g.pointerId!==null&&g.element.hasPointerCapture?.(g.pointerId))
        g.element.releasePointerCapture(g.pointerId);
    }catch(_){}
    if(cancelled)return;
    if(!wasActive){
      // Preventing touchstart's native selection suppresses a synthetic click
      // in Safari. Open the lesson explicitly on a clean, short tap.
      if(g.fromTouch&&Math.hypot(g.x-g.startX,g.y-g.startY)<12){
        suppressClickUntil=Date.now()+600;
        openLessonByKey(g.id);
      }
      return;
    }
    suppressClickUntil=Date.now()+900;
    const cell=cellAt(g.x,g.y,g.element);
    if(cell&&Math.hypot(g.x-g.startX,g.y-g.startY)>14){
      moveLesson(lessonFor(g.element),cell,g.y);
    }else{
      const event=document.querySelector('.calendar-event[data-lesson-id="'+CSS.escape(g.id)+'"]');
      if(event)openMenu(event,g.x,g.y);
    }
  }
  function calendarTouchTarget(target){
    if(target?.closest?.('.tp-event-more,.cv2-resize-handle'))return null;
    return eventButton(target);
  }
  document.addEventListener('pointerdown',e=>{
    if(e.pointerType!=='touch'||!e.isPrimary)return;
    const el=calendarTouchTarget(e.target);
    if(!el)return;
    if(gesture?.fromTouch&&gesture.element===el){gesture.pointerId=e.pointerId;return;}
    if(!beginGesture(el,e.clientX,e.clientY,e.pointerId))return;
    try{el.setPointerCapture(e.pointerId);}catch(_){}
  },{passive:false});
  document.addEventListener('pointermove',e=>{
    if(!gesture||gesture.fromTouch||e.pointerType!=='touch'||
      gesture.pointerId!==e.pointerId)return;
    if(gesture.active&&e.cancelable)e.preventDefault();
    updateGesture(e.clientX,e.clientY);
  },{passive:false});
  document.addEventListener('pointerup',e=>{
    if(gesture?.fromTouch||e.pointerType!=='touch'||
      gesture?.pointerId!==e.pointerId)return;
    if(gesture.active&&e.cancelable)e.preventDefault();
    updateGesture(e.clientX,e.clientY);finishGesture(false);
  },{passive:false});
  document.addEventListener('pointercancel',e=>{
    if(gesture?.fromTouch||e.pointerType!=='touch'||
      gesture?.pointerId!==e.pointerId)return;
    finishGesture(true);
  },{passive:false});

  document.addEventListener('touchstart',e=>{
    const el=calendarTouchTarget(e.target);
    if(!el||!lessonFor(el)||lessonFor(el).status!=='planned')return;
    const t=e.changedTouches?.[0];if(!t)return;
    // Cancels the Safari text-selection recognizer BEFORE the long-press.
    if(e.cancelable)e.preventDefault();
    el.draggable=false; // Avoid native HTML drag interfering with custom touch drag.
    window.getSelection?.()?.removeAllRanges();
    if(gesture?.element===el){
      gesture.fromTouch=true;gesture.touchId=t.identifier;
      gesture.x=t.clientX;gesture.y=t.clientY;
    }else beginGesture(el,t.clientX,t.clientY,null,true,t.identifier);
  },{passive:false,capture:true});
  document.addEventListener('touchmove',e=>{
    const g=gesture;
    if(!g?.fromTouch)return;
    const t=[...e.changedTouches].find(t=>t.identifier===g.touchId);
    if(!t)return;
    if(e.cancelable)e.preventDefault();
    updateGesture(t.clientX,t.clientY);
  },{passive:false,capture:true});
  document.addEventListener('touchend',e=>{
    const g=gesture;
    if(!g?.fromTouch)return;
    const t=[...e.changedTouches].find(t=>t.identifier===g.touchId);
    if(!t)return;
    if(e.cancelable)e.preventDefault();
    updateGesture(t.clientX,t.clientY);finishGesture(false);
  },{passive:false,capture:true});
  document.addEventListener('touchcancel',e=>{
    if(gesture?.fromTouch&&[...e.changedTouches].some(t=>t.identifier===gesture.touchId))
      finishGesture(true);
  },{passive:false,capture:true});

  // The hour rail and empty cells need the same selection protection as cards.
  document.addEventListener('selectstart',e=>{
    if(e.target.closest?.('.calendar-grid')){
      e.preventDefault();window.getSelection?.()?.removeAllRanges();
    }
  },true);
  document.addEventListener('contextmenu',e=>{
    if(e.target.closest?.('.calendar-grid'))e.preventDefault();
  },true);
  document.addEventListener('dragstart',e=>{
    if(e.target.closest?.('.calendar-grid')&&e.pointerType!=='mouse'&&
       (gesture?.fromTouch||('ontouchstart' in window)))e.preventDefault();
  },true);
  /* Add a real weekly workload counter without changing stored data. */
  const originalDashboard=dashboard;
  dashboard=function(){
    originalDashboard();
    if(!db.clients.length)return;
    const now=new Date(todayISO()+'T12:00:00');
    const dow=(now.getDay()+6)%7;
    const monday=new Date(now);monday.setDate(now.getDate()-dow);
    const sunday=new Date(monday);sunday.setDate(monday.getDate()+6);
    const from=localDateISO(monday),to=localDateISO(sunday);
    const weekly=db.lessons.filter(l=>l.date>=from&&l.date<=to&&l.status!=='cancelled');
    const minutes=weekly.reduce((sum,l)=>sum+(Number(l.duration)||60),0);
    const next=db.lessons.filter(l=>l.status==='planned'&&(l.date+'T'+l.time)>=(todayISO()+'T'+new Date().toTimeString().slice(0,5))).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))[0];
    const stats=document.querySelector('.dash-stats');
    if(stats){
      const node=document.createElement('button');
      node.type='button';node.className='dash-stat stat-lilac weekly-workload';
      node.innerHTML='<span class="dash-stat-icon">⏱</span><span class="dash-stat-label">Занятость недели</span><strong>'+Math.round(minutes/6)/10+' ч</strong><small>'+weekly.length+' занятий · '+from+' — '+to+'</small>';
      node.onclick=()=>setPage('schedule');stats.appendChild(node);
    }
    const heading=document.querySelector('.dash-main-grid .dash-section-head');
    if(heading&&next){
      const chip=document.createElement('p');chip.className='next-lesson-chip';
      chip.textContent='Следующее занятие: '+dateFmt(next.date)+' в '+next.time+' · '+(client(next.clientId)?.name||'Ученик');
      heading.insertAdjacentElement('afterend',chip);
    }
  };
})();
