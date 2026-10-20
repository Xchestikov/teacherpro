/* TeacherPro design polish: profile photo, financial-safe lesson statuses,
   calendar now-line, separate three-dot actions, real compact weekly summary. */
(function(){
  'use strict';
  const validAvatar=()=>typeof db.settings?.avatarDataUrl==='string'&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]{100,150000}$/.test(db.settings.avatarDataUrl);
  const avatarImg=()=>validAvatar()?'<img class="tp-avatar-photo" src="'+db.settings.avatarDataUrl+'" alt="Фото преподавателя">':htmlSafe((db.settings.name||'Т').trim().charAt(0).toUpperCase());
  window.tpAvatarSettings=()=>'<div class="tp-avatar-settings"><span class="tp-settings-preview">'+avatarImg()+'</span><div><label class="secondary tp-avatar-upload">Загрузить фотографию<input type="file" accept="image/jpeg,image/png,image/webp" onchange="tpUploadAvatar(this)" hidden></label>'+
    (validAvatar()?'<button class="tp-remove-photo" type="button" onclick="tpRemoveAvatar()">Удалить фото</button>':'')+
    '<p>JPG, PNG или WebP · фото будет уменьшено для безопасной синхронизации.</p></div></div>';
  window.tpRemoveAvatar=()=>{
    if(!db.settings?.avatarDataUrl)return;
    delete db.settings.avatarDataUrl;save();render();
  };
  window.tpUploadAvatar=async input=>{
    const file=input.files?.[0];if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>6*1024*1024){
      alert('Выбери JPG, PNG или WebP размером не более 6 МБ.');input.value='';return;
    }
    const url=URL.createObjectURL(file);
    try{
      const img=new Image();
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});
      if(!img.naturalWidth||!img.naturalHeight)throw Error('Не удалось прочитать изображение');
      const canvas=document.createElement('canvas');canvas.width=160;canvas.height=160;
      const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas unavailable');
      const side=Math.min(img.naturalWidth,img.naturalHeight);
      ctx.fillStyle='#fff';ctx.fillRect(0,0,160,160);
      ctx.drawImage(img,(img.naturalWidth-side)/2,(img.naturalHeight-side)/2,side,side,0,0,160,160);
      const data=canvas.toDataURL('image/jpeg',.78);
      if(data.length>110000)throw Error('Фотография получилась слишком большой');
      db.settings.avatarDataUrl=data;save();render();
    }catch(err){alert('Не удалось сохранить фотографию. Попробуй другое изображение.');}
    finally{URL.revokeObjectURL(url);input.value='';}
  };
  function installProfile(){
    const top=document.querySelector('.top-actions .avatar');
    if(top){
      top.innerHTML=avatarImg();top.classList.add('tp-profile-avatar');
      top.setAttribute('role','button');top.setAttribute('tabindex','0');
      top.setAttribute('aria-label','Открыть профиль преподавателя');
      top.onclick=()=>setPage('settings');
      top.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setPage('settings');}};
    }
    const sidebar=document.querySelector('.sidebar-bottom');
    if(sidebar){
      sidebar.querySelector('.tp-teacher-profile')?.remove();
      const el=document.createElement('button');el.type='button';el.className='tp-teacher-profile';
      el.innerHTML='<span class="tp-profile-circle">'+avatarImg()+'</span><span class="tp-profile-copy"><strong>'+htmlSafe(db.settings.name||'Преподаватель')+'</strong><small>Мой профиль</small></span>';
      el.onclick=()=>setPage('settings');sidebar.prepend(el);
    }
  }

  /* Status transitions preserve the original charge link.
     Calling consumeLesson on a new charged state decrements only once.
     Returning from a charged state uses refundLesson, then clears its link. */
  window.tpUpdateLessonStatus=(id,status)=>{
    if(!Object.prototype.hasOwnProperty.call(LESSON_STATUSES,status))return;
    const lesson=db.lessons.find(x=>String(x.id)===String(id));
    if(!lesson||lesson.status===status)return;
    const charged=Boolean(lesson.consumedSubscriptionId||lesson.consumedClientFallback);
    const mustCharge=lessonCharges(status);
    // Explicit paid absences still need a debit warning. Routine status changes
    // are applied immediately; consume/refund and rollback safeguards remain.

    const snapshot=JSON.stringify(db);
    if(charged&&!mustCharge)refundLesson(lesson);
    if(mustCharge&&!charged&&!consumeLesson(lesson.clientId,lesson)){
      db=normalizeDb(JSON.parse(snapshot));return;
    }
    lesson.status=status;save();render();
  };

  const nativeRender=render;
  const nativeSchedule=schedule;
  function compactWeeklySummary(){
    const card=[...document.querySelectorAll('.se-bottom .se-card')].find(node=>node.querySelector('h3')?.textContent==='На этой неделе');
    if(!card)return;
    const {total,completed,upcoming}=tpWeekOverview();
    const list=card.querySelector('.se-stats');if(!list)return;
    card.classList.add('tp-week-summary');
    list.classList.add('tp-week-list');
    const metrics=[
      ['total','calendar',total,'Всего занятий'],
      ['completed','check-circle',completed,'Проведено'],
      ['upcoming','clock',upcoming,'Предстоит']
    ];
    list.innerHTML=metrics.map(([key,icon,count,label])=>
      '<div class="tp-week-row" data-week-metric="'+key+'">'+
      '<span class="tp-week-icon tp-week-'+key+'" aria-hidden="true">'+tpUiIcon(icon)+'</span>'+
      '<strong>'+count+'</strong><small>'+label+'</small></div>').join('');
  }
  function decorateEvents(){
    document.querySelectorAll('.calendar-event').forEach(el=>{
      const lesson=db.lessons.find(x=>String(x.id)===String(el.dataset.lessonId));if(!lesson)return;
      const cancelled=lessonIsCancelled(lesson.status);
      el.classList.toggle('event-cancelled',cancelled);
      el.classList.toggle('event-no-show',lesson.status.startsWith('no_show'));
      el.dataset.status=lesson.status;
      el.setAttribute('title',lessonStatusText(lesson.status)+' · '+(client(lesson.clientId)?.name||'Ученик')+' · '+lesson.time);
      el.querySelector('.tp-event-more')?.remove();
      const more=document.createElement('span');more.className='tp-event-more';
      more.setAttribute('role','button');more.setAttribute('tabindex','0');more.setAttribute('aria-label','Статус и действия занятия');
      more.textContent='⋮';
      el.append(more);
      if(cancelled){
        const details=el.querySelector('small');
        if(details){details.classList.add('tp-event-status');details.textContent=lessonStatusText(lesson.status);}
      }
    });
  }
  document.addEventListener('keydown',event=>{
    const more=event.target.closest?.('.tp-event-more');
    if(!more||!['Enter',' '].includes(event.key))return;
    event.preventDefault();event.stopImmediatePropagation();
    const lesson=more.closest('.calendar-event');
    if(lesson)window.teacherproOpenQuickMenu?.(lesson,more.getBoundingClientRect().left,more.getBoundingClientRect().bottom);
  },true);
  function drawTimeLine(){
    const grid=document.querySelector('.calendar-grid');grid?.querySelector('.tp-now-indicator')?.remove();
    if(!grid)return;
    const now=new Date(),minutes=now.getHours()*60+now.getMinutes();
    if(minutes<300||minutes>=1440)return;
    const hour=Math.floor(minutes/60)*60;
    const today=document.querySelector('.calendar-cell[data-date="'+todayISO()+'"][data-minute="'+hour+'"]');
    if(!today)return;
    const gridRect=grid.getBoundingClientRect(),cellRect=today.getBoundingClientRect();
    const top=cellRect.top-gridRect.top+((minutes-hour)/60)*cellRect.height;
    const indicator=document.createElement('div');indicator.className='tp-now-indicator';
    indicator.style.top=top+'px';
    indicator.innerHTML='<span class="tp-now-clock">'+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+'</span>';
    indicator.setAttribute('aria-label','Текущее время '+indicator.textContent);
    grid.append(indicator);
  }
  window.tpRefreshTimeLine=drawTimeLine;
  function decorateCalendar(){
    const title=document.querySelector('.calendar-top');
    if(title)title.classList.add('tp-calendar-toolbar');
    const add=title?.querySelector('.calendar-actions .primary');if(add)add.textContent='＋ Запланировать занятие';
    decorateEvents();
    drawTimeLine();
  }
  schedule=function(){nativeSchedule();decorateCalendar();};
  render=function(){
    nativeRender();
    installProfile();
    if(page==='dashboard')compactWeeklySummary();
    if(page==='schedule')decorateCalendar();
  };
  // No permanent user changes from presentation decorators.
  setInterval(()=>{if(page==='schedule')drawTimeLine();},60000);
  installProfile();
})();
