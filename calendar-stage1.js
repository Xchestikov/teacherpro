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
  document.addEventListener('pointerdown',e=>{
    if(e.pointerType!=='touch'||!e.isPrimary)return;
    if(e.target.closest?.('.tp-event-more,.cv2-resize-handle'))return;
    const el=eventButton(e.target);
    if(!el||!lessonFor(el)||lessonFor(el).status!=='planned')return;
    dismiss();
    // Keep iOS Safari's native callout/selection and scrolling from stealing the pointer.
    try{el.setPointerCapture(e.pointerId);}catch(_){}
    gesture={id:el.dataset.lessonId,pointerId:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,active:false,element:el};
    clearTimeout(holdTimer);
    holdTimer=setTimeout(()=>{
      if(!gesture)return;
      gesture.active=true;
      suppressClickUntil=Date.now()+800;
      el.classList.add('touch-dragging');
      window.getSelection?.()?.removeAllRanges();
      if(navigator.vibrate)navigator.vibrate(25);
    },420);
  },{passive:false});
  document.addEventListener('pointermove',e=>{
    if(!gesture||e.pointerType!=='touch'||e.pointerId!==gesture.pointerId)return;
    if(gesture.active&&e.cancelable)e.preventDefault();
    gesture.x=e.clientX;gesture.y=e.clientY;
    if(!gesture.active&&Math.hypot(e.clientX-gesture.startX,e.clientY-gesture.startY)>10){
      clearTimeout(holdTimer);gesture=null;return;
    }
    if(gesture.active){
      window.tpCalendarTouchDragMove?.(e.clientX,e.clientY);
      const cell=document.elementFromPoint(e.clientX,e.clientY)?.closest('.calendar-cell');
      document.querySelectorAll('.calendar-cell.touch-drop-target').forEach(el=>el.classList.remove('touch-drop-target'));
      if(cell)cell.classList.add('touch-drop-target');
    }
  },{passive:false});
  document.addEventListener('selectstart',e=>{if(eventButton(e.target))e.preventDefault();},true);
  document.addEventListener('dragstart',e=>{if(eventButton(e.target)&&e.pointerType!=='mouse')e.preventDefault();},true);
  function finishGesture(e,cancelled){
    if(!gesture||e.pointerId!==gesture.pointerId)return;
    clearTimeout(holdTimer);
    const g=gesture;gesture=null;
    if(g.active&&e.cancelable)e.preventDefault();
    try{if(g.element.hasPointerCapture?.(g.pointerId))g.element.releasePointerCapture(g.pointerId);}catch(_){}
    g.element.classList.remove('touch-dragging');
    document.querySelectorAll('.calendar-cell.touch-drop-target').forEach(el=>el.classList.remove('touch-drop-target'));
    if(!g.active||cancelled)return;
    suppressClickUntil=Date.now()+800;
    const cell=document.elementFromPoint(g.x,g.y)?.closest('.calendar-cell');
    if(cell&&Math.hypot(g.x-g.startX,g.y-g.startY)>14){
      const lesson=db.lessons.find(l=>String(l.id)===String(g.id));
      moveLesson(lesson,cell,g.y);
    }else{
      const event=document.querySelector('.calendar-event[data-lesson-id="'+CSS.escape(g.id)+'"]');
      if(event)openMenu(event,g.x,g.y);
    }
  }
  document.addEventListener('pointerup',e=>{if(e.pointerType==='touch')finishGesture(e,false);},{passive:false});
  document.addEventListener('pointercancel',e=>{if(e.pointerType==='touch')finishGesture(e,true);},{passive:false});

  // Native Touch Events are the primary gesture route on mobile Safari/Yandex.
  // Suppress text selection BEFORE the browser initiates its magnifier/callout.
  let nativeTouch=null,nativeTimer=null;
  const slotUnder=(x,y)=>document.elementsFromPoint(x,y).map(node=>node.closest?.('.calendar-cell')).find(Boolean);
  const getTouch=(list,id)=>Array.from(list||[]).find(t=>t.identifier===id);
  function clearNative(){
    clearTimeout(nativeTimer);
    if(nativeTouch?.element)nativeTouch.element.classList.remove('touch-dragging');
    document.querySelectorAll('.calendar-cell.touch-drop-target').forEach(node=>node.classList.remove('touch-drop-target'));
    nativeTouch=null;
  }
  document.addEventListener('touchstart',e=>{
    if(!e.touches?.length||e.touches.length>1)return;
    const target=e.target;
    // Keep three-dot and resizing controls independent.
    if(target.closest?.('.tp-event-more,.cv2-resize-handle'))return;
    const event=eventButton(target);
    if(!event||lessonFor(event)?.status!=='planned')return;
    if(e.cancelable)e.preventDefault();
    window.getSelection?.()?.removeAllRanges();
    // Reset any pointer-based gesture that may have started on the same tap.
    clearTimeout(holdTimer);
    if(gesture?.element)gesture.element.classList.remove('touch-dragging');
    gesture=null;
    clearNative();
    const touch=e.touches[0];
    nativeTouch={id:touch.identifier,lessonId:event.dataset.lessonId,element:event,
      x:touch.clientX,y:touch.clientY,startX:touch.clientX,startY:touch.clientY,active:false};
    nativeTimer=setTimeout(()=>{
      if(!nativeTouch)return;
      nativeTouch.active=true;
      suppressClickUntil=Date.now()+900;
      event.classList.add('touch-dragging');
      window.getSelection?.()?.removeAllRanges();
      navigator.vibrate?.(20);
    },420);
  },{capture:true,passive:false});
  document.addEventListener('touchmove',e=>{
    if(!nativeTouch)return;
    const t=getTouch(e.touches,nativeTouch.id);
    if(!t)return;
    if(e.cancelable)e.preventDefault();
    nativeTouch.x=t.clientX;nativeTouch.y=t.clientY;
    if(!nativeTouch.active&&Math.hypot(t.clientX-nativeTouch.startX,t.clientY-nativeTouch.startY)>12){
      clearNative();return;
    }
    if(nativeTouch.active){
      window.getSelection?.()?.removeAllRanges();
      // Resolve before edge auto-scroll shifts the grid under the touch.
      const hovered=slotUnder(t.clientX,t.clientY);
      if(hovered){
        const minute=calendarSlotAtPoint(hovered,t.clientY);
        if(minute!==null)nativeTouch.candidate={date:hovered.dataset.date,time:minutesToClock(minute)};
      }
      window.tpCalendarTouchDragMove?.(t.clientX,t.clientY);
      document.querySelectorAll('.calendar-cell.touch-drop-target').forEach(node=>node.classList.remove('touch-drop-target'));
      hovered?.classList.add('touch-drop-target');
    }
  },{capture:true,passive:false});
  document.addEventListener('touchend',e=>{
    if(!nativeTouch)return;
    const t=getTouch(e.changedTouches,nativeTouch.id);
    if(!t)return;
    if(e.cancelable)e.preventDefault();
    const state=nativeTouch;
    const target=slotUnder(t.clientX,t.clientY);
    clearNative();
    suppressClickUntil=Date.now()+850;
    if(!state.active){
      openLessonByKey(state.lessonId);
      return;
    }
    if(Math.hypot(t.clientX-state.startX,t.clientY-state.startY)>14&&(state.candidate||target)){
      const lesson=db.lessons.find(l=>String(l.id)===String(state.lessonId));
      if(state.candidate&&lesson){
        if(typeof window.tpCalendarMove==='function')window.tpCalendarMove(lesson,state.candidate.date,state.candidate.time);
        else if(target)moveLesson(lesson,target,t.clientY);
      }else moveLesson(lesson,target,t.clientY);
    }else{
      const event=document.querySelector('.calendar-event[data-lesson-id="'+CSS.escape(state.lessonId)+'"]');
      if(event)openMenu(event,t.clientX,t.clientY);
    }
  },{capture:true,passive:false});
  document.addEventListener('touchcancel',e=>{
    if(nativeTouch&&getTouch(e.changedTouches,nativeTouch.id))clearNative();
  },{capture:true,passive:false});
  document.addEventListener('selectstart',e=>{
    if(e.target.closest?.('.calendar-shell,.calendar-grid'))e.preventDefault();
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
