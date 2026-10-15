/* Calendar V2 — overlap lanes, adjustable durations, safe undo, current-time navigation.
   Extends existing data functions: no server schema changes or production effects. */
(function(){
  'use strict';
  let includeCancelled=true, lastScrollKey='', drag=null, undo=null, undoTimeout=null;
  const MIN_DURATION=30,MAX_DURATION=240,STEP=15;
  const eventById=id=>db.lessons.find(l=>String(l.id)===String(id));
  const isCancelled=l=>lessonIsCancelled(l.status);
  const isVisible=l=>includeCancelled||!isCancelled(l);
  const minutes=time=>lessonMinutes(time);
  const clock=m=>minutesToClock(m);
  const validDuration=d=>Number.isInteger(d)&&d>=MIN_DURATION&&d<=MAX_DURATION&&d%STEP===0;
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

  function toast(text,previous,expected,id){
    document.querySelector('.cv2-toast')?.remove();
    clearTimeout(undoTimeout);
    undo={previous,expected,id};
    const bar=document.createElement('div');bar.className='cv2-toast';bar.setAttribute('role','status');
    const textNode=document.createElement('span');textNode.textContent=text;
    const button=document.createElement('button');button.type='button';button.textContent='Отменить';
    button.onclick=()=>{
      if(!undo||undo.id!==id)return;
      const current=eventById(id);
      if(!current||current.date!==undo.expected.date||current.time!==undo.expected.time||current.duration!==undo.expected.duration){
        bar.remove();undo=null;return;
      }
      Object.assign(current,undo.previous);
      undo=null;clearTimeout(undoTimeout);bar.remove();save();render();
    };
    const close=document.createElement('button');close.type='button';close.className='cv2-toast-close';
    close.setAttribute('aria-label','Закрыть уведомление');close.textContent='×';
    close.onclick=()=>{undo=null;clearTimeout(undoTimeout);bar.remove();};
    bar.append(textNode,button,close);document.body.append(bar);
    undoTimeout=setTimeout(()=>{if(bar.isConnected)bar.remove();undo=null;},8500);
  }

  function applyChange(lessonId,changes,kind){
    const lesson=eventById(lessonId);
    if(!lesson||lesson.status!=='planned')return false;
    const next={...lesson,duration:Number(lesson.duration)||60,...changes};
    if(!/^\d{4}-\d{2}-\d{2}$/.test(next.date)||!/^\d{2}:\d{2}$/.test(next.time)||!validDuration(Number(next.duration)))return false;
    if(next.date===lesson.date&&next.time===lesson.time&&Number(next.duration)===(Number(lesson.duration)||60))return false;
    if(minutes(next.time)<300||minutes(next.time)>=1440||minutes(next.time)+Number(next.duration)>1440){
      alert('Занятие должно начинаться в календаре и завершаться не позднее 00:00.');return false;
    }
    const conflict=lessonConflicts(next,lesson.id);
    if(conflict.length){
      const names=conflict.slice(0,3).map(l=>(client(l.clientId)?.name||'Ученик')+' · '+l.time).join('\n');
      alert('Выбранное время занято: '+names+'. Выбери другое.');return false;
    }
    // Move/resize is reversible via toast. Only overlap overrides ask confirmation.
    const previous={date:lesson.date,time:lesson.time,duration:Number(lesson.duration)||60};
    const expected={date:next.date,time:next.time,duration:next.duration};
    Object.assign(lesson,changes);save();render();
    toast(kind==='resize'?'Длительность изменена: '+next.duration+' мин.':'Занятие перенесено: '+next.date+' · '+next.time,previous,expected,String(lesson.id));
    return true;
  }
  window.tpCalendarMove=(lesson,date,time)=>applyChange(lesson?.id,{date,time},'move');
  window.tpCalendarResize=(id,duration)=>applyChange(id,{duration},'resize');
  const nativeDrop=calendarDrop;
  calendarDrop=function(event){
    const id=event.dataTransfer?.getData('text/plain');
    if(!id)return nativeDrop(event);
    event.preventDefault();event.stopPropagation();
    const cell=event.currentTarget;
    calendarCellLeave(event);calendarDragEnd();
    const minute=calendarSlotAtPoint(cell,event.clientY);
    if(!cell.dataset.date||minute===null)return;
    window.tpCalendarMove(eventById(id),cell.dataset.date,clock(minute));
  };

  function overlapLayout(){
    const events=[...document.querySelectorAll('.calendar-cell .calendar-event')];
    const map=new Map();
    for(const el of events){
      const lesson=eventById(el.dataset.lessonId);
      if(!lesson){continue;}
      if(!isVisible(lesson)){el.remove();continue;}
      const date=lesson.date,start=minutes(lesson.time);
      const end=start+Math.max(15,Number(lesson.duration)||60);
      if(!map.has(date))map.set(date,[]);
      map.get(date).push({el,lesson,start,end,lane:0});
    }
    for(const group of map.values()){
      group.sort((a,b)=>a.start-b.start||b.end-a.end||String(a.lesson.id).localeCompare(String(b.lesson.id)));
      const components=[];let component=[],maxEnd=-1;
      for(const e of group){
        if(component.length&&e.start>=maxEnd){components.push(component);component=[];maxEnd=-1;}
        component.push(e);maxEnd=Math.max(maxEnd,e.end);
      }
      if(component.length)components.push(component);
      for(const component of components){
        const lanes=[];
        for(const e of component){
          let lane=lanes.findIndex(end=>end<=e.start);
          if(lane<0){lane=lanes.length;lanes.push(e.end);}else lanes[lane]=e.end;
          e.lane=lane;
        }
        const count=lanes.length;
        for(const e of component){
          const percent=100/count;
          // Each card is anchored to its hour cell, but lanes span the whole day.
          e.el.style.left='calc('+Number((percent*e.lane).toFixed(5))+'% + 3px)';
          e.el.style.right='auto';
          e.el.style.width='calc('+Number(percent.toFixed(5))+'% - 6px)';
          e.el.style.maxWidth='none';
          e.el.dataset.lane=String(e.lane+1);
          e.el.dataset.laneCount=String(count);
          e.el.setAttribute('aria-label',(client(e.lesson.clientId)?.name||'Ученик')+' — '+e.lesson.time+
            ', '+e.lesson.duration+' минут, колонка '+(e.lane+1)+' из '+count);
        }
      }
    }
  }

  function resizeHandles(){
    for(const el of document.querySelectorAll('.calendar-event')){
      const lesson=eventById(el.dataset.lessonId);
      if(!lesson||lesson.status!=='planned'||el.querySelector('.cv2-resize-handle'))continue;
      const grip=document.createElement('span');grip.className='cv2-resize-handle';
      grip.setAttribute('role','button');grip.setAttribute('tabindex','0');
      grip.setAttribute('aria-label','Изменить длительность занятия');
      grip.setAttribute('title','Потяни вниз или вверх, чтобы изменить длительность с шагом 15 минут');
      grip.textContent='⋮⋮';
      el.append(grip);
    }
  }
  function startResize(e,handle){
    if(e.button!==0&&e.pointerType!=='touch')return;
    const event=handle.closest('.calendar-event'),lesson=eventById(event?.dataset.lessonId);
    if(!lesson||lesson.status!=='planned')return;
    e.preventDefault();e.stopImmediatePropagation();
    const cell=event.closest('.calendar-cell'),cellRect=cell.getBoundingClientRect(),rect=event.getBoundingClientRect();
    drag={handle,event,id:String(lesson.id),startPointerY:e.clientY,cellHeight:cellRect.height,
      initial:Number(lesson.duration)||60,proposed:Number(lesson.duration)||60,
      initialHeight:event.style.height,pointerId:e.pointerId};
    handle.setPointerCapture?.(e.pointerId);
    event.classList.add('cv2-resizing');
  }
  function moveResize(e){
    if(!drag||drag.pointerId!==e.pointerId)return;
    e.preventDefault();e.stopImmediatePropagation();
    const delta=Math.round((e.clientY-drag.startPointerY)/drag.cellHeight*60/STEP)*STEP;
    drag.proposed=clamp(drag.initial+delta,MIN_DURATION,MAX_DURATION);
    drag.event.style.height='calc('+(drag.proposed/60*100)+'% - 4px)';
    drag.handle.setAttribute('aria-label','Длительность '+drag.proposed+' минут');
    drag.event.dataset.resizePreview=drag.proposed+' мин.';
  }
  function endResize(e,cancel=false){
    if(!drag||e.pointerId!==drag.pointerId)return;
    e.preventDefault();e.stopImmediatePropagation();
    const old=drag;drag=null;
    old.event.style.height=old.initialHeight;old.event.classList.remove('cv2-resizing');
    delete old.event.dataset.resizePreview;
    if(!cancel&&old.proposed!==old.initial)window.tpCalendarResize(old.id,old.proposed);
  }
  // Capture prevents the long-hold move gesture when the resize handle is used.
  document.addEventListener('pointerdown',e=>{
    const handle=e.target.closest?.('.cv2-resize-handle');
    if(handle)startResize(e,handle);
  },true);
  document.addEventListener('pointermove',e=>{if(drag)moveResize(e);},true);
  document.addEventListener('pointerup',e=>{if(drag)endResize(e);},true);
  document.addEventListener('pointercancel',e=>{if(drag)endResize(e,true);},true);
  document.addEventListener('click',e=>{
    if(e.target.closest?.('.cv2-resize-handle')){e.preventDefault();e.stopImmediatePropagation();}
  },true);
  document.addEventListener('keydown',e=>{
    const handle=e.target.closest?.('.cv2-resize-handle');
    if(!handle||!['ArrowUp','ArrowDown'].includes(e.key))return;
    e.preventDefault();e.stopImmediatePropagation();
    const lesson=eventById(handle.closest('.calendar-event').dataset.lessonId);
    if(lesson){
      const delta=e.key==='ArrowUp'?-STEP:STEP;
      window.tpCalendarResize(lesson.id,clamp(Number(lesson.duration)+delta,MIN_DURATION,MAX_DURATION));
    }
  },true);

  function filterControl(){
    const container=document.querySelector('.calendar-filters');
    if(!container)return;
    let btn=container.querySelector('.cv2-filter');
    if(!btn){btn=document.createElement('button');btn.type='button';btn.className='cv2-filter';container.append(btn);}
    btn.textContent=includeCancelled?'◉ Отменённые показаны':'○ Отменённые скрыты';
    btn.setAttribute('aria-pressed',String(includeCancelled));
    btn.setAttribute('aria-label','Показывать отменённые и пропущенные занятия');
    btn.onclick=()=>{includeCancelled=!includeCancelled;schedule();};
  }
  window.tpCalendarShowCancelled=()=>includeCancelled;

  function timeScroll(){
    const now=new Date(),today=todayISO();
    const weekday=(now.getDay()+6)%7;
    const key=calendarMode+'|'+(calendarMode==='day'?calendarSelectedDate:weekOffset)+'|'+today;
    if(lastScrollKey===key)return;
    lastScrollKey=key;
    if(calendarMode==='day'&&calendarSelectedDate!==today)return;
    if(calendarMode!=='day'&&weekOffset!==0)return;
    const targetMin=clamp(now.getHours()*60-60,300,1380);
    const cell=document.querySelector('.calendar-cell[data-date="'+today+'"][data-minute="'+(Math.floor(targetMin/60)*60)+'"]');
    if(!cell)return;
    requestAnimationFrame(()=>{
      if(document.querySelector('.calendar-cell[data-date="'+today+'"]'))cell.scrollIntoView({behavior:'instant',block:'center',inline:'nearest'});
    });
  }

  const nativeSchedule=schedule;
  schedule=function(){
    nativeSchedule();
    if(page!=='schedule')return;
    filterControl();
    const grid=document.querySelector('.calendar-grid');
    if(grid){overlapLayout();resizeHandles();timeScroll();}
  };

  const nativeOpenLesson=openLesson;
  openLesson=function(...args){
    nativeOpenLesson(...args);
    const select=document.querySelector('#lDuration');
    if(!select)return;
    const previous=args[0]?eventById(args[0]):null;
    for(let duration=MIN_DURATION;duration<=MAX_DURATION;duration+=STEP){
      if(![...select.options].some(option=>Number(option.value)===duration)){
        const option=document.createElement('option');option.value=String(duration);
        option.textContent=duration+' минут';select.append(option);
      }
    }
    if(previous)select.value=String(previous.duration||60);
  };

  // Mobile gesture: scrolling near screen edges during a held card move.
  window.tpCalendarTouchDragMove=(x,y)=>{
    const edge=64,height=innerHeight,width=innerWidth;
    if(y<edge)window.scrollBy(0,-Math.min(18,(edge-y)/2));
    else if(y>height-edge)window.scrollBy(0,Math.min(18,(y-height+edge)/2));
    const shell=document.querySelector('.calendar-shell');
    if(shell&&shell.scrollWidth>shell.clientWidth){
      const r=shell.getBoundingClientRect();
      if(x>r.left&&x<r.left+edge)shell.scrollLeft-=12;
      else if(x<r.right&&x>r.right-edge)shell.scrollLeft+=12;
    }
  };
})();
