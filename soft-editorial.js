/* TeacherPro • Soft Editorial — Тёплая студия
   Presentation only: source of truth remains the existing db and action helpers. */
(function(){
  'use strict';
  document.body.classList.add('soft-editorial');
  const weekdays=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const dayKey=d=>localDateISO(d);
  const hhmm=minutes=>Math.floor(minutes/60).toString().padStart(2,'0')+':'+(minutes%60).toString().padStart(2,'0');
  const safe=htmlSafe;
  const copyDate=d=>new Date(d.getFullYear(),d.getMonth(),d.getDate(),12);
  const mondayOf=d=>{const date=copyDate(d);date.setDate(date.getDate()-(date.getDay()+6)%7);return date;};
  const nextLessons=()=>db.lessons.filter(l=>l.status==='planned'&&l.date&&l.time&&(l.date+'T'+l.time)>=todayISO()+'T'+new Date().toTimeString().slice(0,5)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  const money=n=>fmt(Math.round(n*100)/100);
  const duration=l=>Math.max(0,Number(l.duration)||60);
  const studentName=l=>client(l.clientId)?.name||'Ученик';
  const plural=(n,one,few,many)=>n%10===1&&n%100!==11?one:n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?few:many;
  const monthlyIncome=()=>db.payments.filter(p=>p.status==='paid'&&paymentDate(p).startsWith(monthISO())).reduce((n,p)=>n+(Number(p.amount)||0),0);
  const shortDate=s=>new Date(s+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short'}).replace('.','');

  function renderStudioDashboard(){
    const date=new Date();
    const greeting=db.settings?.name?.trim()?.split(/\s+/)[0]||'преподаватель';
    const upcoming=nextLessons(),next=upcoming[0];
    const monday=mondayOf(date);
    const days=Array.from({length:7},(_,i)=>{const d=copyDate(monday);d.setDate(monday.getDate()+i);return d;});
    const from=dayKey(days[0]),to=dayKey(days[6]);
    const lessons=db.lessons.filter(l=>l.date>=from&&l.date<=to&&l.status!=='cancelled');
    const dayHours=days.map(d=>lessons.filter(l=>l.date===dayKey(d)).reduce((h,l)=>h+duration(l)/60,0));
    const hours=dayHours.reduce((a,b)=>a+b,0);
    const conducted=lessons.filter(l=>l.status==='done').reduce((h,l)=>h+duration(l)/60,0);
    const completedPct=hours?Math.round(conducted/hours*100):0;
    const maxDay=Math.max(1,...dayHours);
    const lastLessons=upcoming.slice(0,4);
    const done=lessons.filter(l=>l.status==='done').length;
    const pending=db.payments.filter(p=>p.status!=='paid');
    const income=monthlyIncome();

    const nextCard=next?'<div class="se-next-row"><span class="se-avatar" aria-hidden="true">'+safe(studentName(next).charAt(0).toUpperCase())+'</span>'+
      '<div><div class="se-time">'+safe(next.time)+' – '+safe(hhmm(lessonMinutes(next.time)+duration(next)))+'</div><div class="se-person">'+safe(studentName(next))+'</div>'+
      '<div class="se-row-sub">'+safe(next.type||'Занятие')+' · '+safe(shortDate(next.date))+'</div></div></div>'+
      '<button class="primary se-cta" type="button" data-lesson-id="'+safe(next.id)+'" onclick="openLessonByKey(this.dataset.lessonId)">Открыть занятие →</button>':
      '<div class="se-empty">Ближайших занятий пока нет. Можно запланировать первое.</div><button class="primary" onclick="openLesson()">＋ Запланировать</button>';

    const upcomingRows=lastLessons.length?lastLessons.map(l=>'<button class="se-lesson" type="button" data-lesson-id="'+safe(l.id)+'" onclick="openLessonByKey(this.dataset.lessonId)">'+
      '<span class="se-dot"></span><span class="se-date">'+safe(l.date===todayISO()?'Сегодня':shortDate(l.date))+'</span>'+
      '<span class="se-lesson-time">'+safe(l.time)+'–'+safe(hhmm(lessonMinutes(l.time)+duration(l)))+'</span>'+
      '<span class="se-lesson-name">'+safe(studentName(l))+'</span><span class="se-lesson-arrow" aria-hidden="true">›</span></button>').join(''):
      '<div class="se-empty">Пока ничего не запланировано. Свободное время — тоже часть хорошей недели.</div>';

    const action=(icon,label,handler)=>'<button class="se-action" type="button" onclick="'+handler+'"><span aria-hidden="true">'+icon+'</span><span>'+label+'</span></button>';
    const stats=(icon,count,label)=>'<div class="se-stat"><span aria-hidden="true">'+icon+'</span><div><strong>'+safe(count)+'</strong><div class="se-row-sub">'+label+'</div></div></div>';
    $('#content').innerHTML='<div class="se-dashboard">'+
      '<header class="se-greeting"><h2>Добрый день, '+safe(greeting)+'! ☀️</h2><p class="se-subtitle">Всё важное для занятий — в одном уютном месте.</p></header>'+
      '<div class="se-overview">'+
      '<section class="se-card se-hero" aria-label="Ближайшее занятие"><div class="se-card-head"><h3>Ближайшее занятие</h3>'+
      (next?'<span class="se-soon">◷ '+safe(shortDate(next.date))+'</span>':'')+'</div>'+nextCard+'</section>'+
      '<section class="se-card" aria-label="Нагрузка текущей недели"><div class="se-card-head"><h3>Занятость недели</h3>'+
      '<button class="se-link" onclick="setPage(\'schedule\')">Расписание →</button></div>'+
      '<div class="se-load-body"><div><div class="se-hours">'+Number(hours.toFixed(1)).toLocaleString('ru-RU')+' ч</div>'+
      '<div class="se-row-sub">'+lessons.length+' '+plural(lessons.length,'занятие','занятия','занятий')+' на неделе</div></div>'+
      '<div class="se-donut" style="--se-ratio:'+completedPct+'%" role="img" aria-label="Проведено '+completedPct+' процентов часов недели"><div class="se-donut-inner">'+completedPct+'%</div></div>'+
      '<div><div class="se-week-bars" role="img" aria-label="Количество часов по дням: '+dayHours.map((h,i)=>weekdays[i]+' '+Number(h.toFixed(1))+' ч').join(', ')+'">'+
      dayHours.map((h,i)=>'<div class="se-week-bar" title="'+weekdays[i]+': '+Number(h.toFixed(1))+' ч"><span style="height:'+Math.round(h/maxDay*100)+'%"></span></div>').join('')+'</div>'+
      '<div class="se-week-labels">'+weekdays.map(w=>'<span>'+w+'</span>').join('')+'</div></div></div>'+
      '<div class="se-note">Круг: доля уже проведённых часов · Столбцы: занятость по дням</div></section></div>'+
      '<nav class="se-actions" aria-label="Быстрые действия">'+
      action('▣','Запланировать занятие','openLesson()')+
      action('♙','Добавить ученика','openClient()')+
      action('₽','Записать оплату','openPayment()')+
      action('◒','Оформить абонемент','openSubscription()')+'</nav>'+
      '<div class="se-bottom"><section class="se-card"><div class="se-card-head"><h3>Ближайшие занятия</h3><button class="se-link" onclick="setPage(\'schedule\')">Все занятия →</button></div>'+
      '<div class="se-lesson-list">'+upcomingRows+'</div></section>'+
      '<section class="se-card"><div class="se-card-head"><h3>На этой неделе</h3><span class="se-soft-label">'+safe(shortDate(from))+' – '+safe(shortDate(to))+'</span></div>'+
      '<div class="se-stats">'+
      stats('▣',lessons.length,'Всего занятий')+
      stats('✓',done,'Проведено')+
      stats('◷',pending.length,'Ожидают оплаты')+
      stats('₽',money(income),'Доход за месяц')+
      '</div></section></div>'+
      (typeof upcomingBirthdays==='function'&&upcomingBirthdays().some(x=>x.birthday.days<=14)?'<section class="se-birthday">'+birthdaysWidget()+'</section>':'')+
      '</div>';
  }
  dashboard=renderStudioDashboard;

  /* Preserve existing student, subscription, auth and conflict-resolution handlers. */
  const nativeRender=render;
  render=function(){
    nativeRender();
    document.body.classList.toggle('se-dashboard-page',page==='dashboard');
  };
  let studioMode='week',monthOffset=0,initializedMobile=false;
  const nativeSchedule=schedule, nativeSetMode=calendarSetMode,
    nativeShift=shiftWeek,nativeToday=calendarToday,nativeDate=calendarSelectDate;

  function colorizeEvents(){
    const palettes=[
      ['#f9e2db','#9f4d43','#cb7664'],
      ['#e5eee4','#456b52','#73967d'],
      ['#e5edf7','#416c9b','#6c9bc6'],
      ['#f8ead7','#946b3c','#d89d62'],
      ['#eee5f1','#725a86','#a28ab1']
    ];
    document.querySelectorAll('.calendar-event').forEach(node=>{
      const l=db.lessons.find(x=>String(x.id)===String(node.dataset.lessonId));
      if(!l||l.status==='done')return;
      const id=String(l.clientId),seed=[...id].reduce((n,ch)=>n+ch.charCodeAt(0),0);
      const [bg,ink,border]=palettes[seed%palettes.length];
      node.style.background=bg;node.style.color=ink;node.style.borderLeftColor=border;
      node.querySelectorAll('.event-time,.calendar-event small').forEach(item=>item.style.color=ink);
      node.setAttribute('aria-label',studentName(l)+' '+l.time+' – '+hhmm(lessonMinutes(l.time)+duration(l))+'; открыть быстрые действия');
    });
  }
  function decorateCalendar(){
    const switcher=document.querySelector('.calendar-view-switch');
    if(switcher&&!switcher.querySelector('[data-studio-mode="month"]')){
      const button=document.createElement('button');
      button.type='button';
      button.dataset.studioMode='month';
      button.textContent='Месяц';
      button.setAttribute('aria-label','Режим месяца');
      button.onclick=()=>calendarSetMode('month');
      switcher.append(button);
    }
    colorizeEvents();
  }

  function monthView(){
    const date=new Date((calendarSelectedDate||todayISO())+'T12:00:00');
    date.setDate(1);date.setMonth(date.getMonth()+monthOffset);
    const monthKey=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0');
    const lastDate=new Date(date.getFullYear(),date.getMonth()+1,0,12).getDate();
    const starting=(date.getDay()+6)%7;
    const days=Array.from({length:42},(_,i)=>{
      const n=i-starting+1;
      if(n<1||n>lastDate)return '<div class="se-month-day se-month-empty" aria-hidden="true"></div>';
      const key=monthKey+'-'+String(n).padStart(2,'0');
      const events=db.lessons.filter(l=>l.date===key&&(window.tpCalendarShowCancelled?.()!==false||!lessonIsCancelled(l.status))&&(calendarClientFilter==='all'||String(l.clientId)===String(calendarClientFilter))).sort((a,b)=>a.time.localeCompare(b.time));
      const today=key===todayISO()?' is-today':'';
      return '<button class="se-month-day'+today+'" type="button" data-date="'+key+'" onclick="studioOpenCalendarDay(this.dataset.date)" aria-label="'+n+' число, занятий: '+events.length+'"><span class="se-month-num">'+n+'</span>'+
        (events.length?'<span class="se-month-count">'+events.length+' '+plural(events.length,'занятие','занятия','занятий')+'</span>':'')+
        events.slice(0,2).map(l=>'<span class="se-month-lesson">'+safe(l.time)+' · '+safe(studentName(l))+'</span>').join('')+'</button>';
    });
    $('#content').innerHTML='<div class="calendar-top"><div><div class="calendar-kicker">РАСПИСАНИЕ</div><h2 class="calendar-range">'+
      safe(date.toLocaleDateString('ru-RU',{month:'long',year:'numeric'}))+'</h2><div class="calendar-summary">Календарь занятий по дням</div></div>'+
      '<div class="calendar-actions"><button class="calendar-arrow" type="button" onclick="shiftWeek(-1)" aria-label="Предыдущий месяц">‹</button>'+
      '<button class="calendar-today" onclick="calendarToday()">Сегодня</button>'+
      '<button class="calendar-arrow" type="button" onclick="shiftWeek(1)" aria-label="Следующий месяц">›</button>'+
      '<button class="primary" onclick="openLesson()">＋ Занятие</button></div></div>'+
      '<div class="calendar-filters"><div class="calendar-view-switch" role="group" aria-label="Вид календаря">'+
      '<button onclick="calendarSetMode(\'day\')">День</button>'+
      '<button onclick="calendarSetMode(\'week\')">Неделя</button>'+
      '<button class="active" onclick="calendarSetMode(\'month\')" aria-pressed="true">Месяц</button></div></div>'+
      '<div class="calendar-shell"><div class="se-month-head">Нажми на дату, чтобы открыть занятия за день</div><div class="se-month-grid">'+
      weekdays.map(w=>'<span class="se-month-weekday">'+w+'</span>').join('')+days.join('')+
      '</div></div>';
  }
  window.studioOpenCalendarDay=date=>{
    calendarSelectedDate=date;
    studioMode='day';monthOffset=0;
    nativeSetMode('day');
  };
  schedule=function(){
    if(studioMode==='month'){monthView();return;}
    if(!initializedMobile&&window.innerWidth<=700&&calendarMode==='week'){
      calendarMode='day';calendarSelectedDate=calendarSelectedDate||todayISO();studioMode='day';
    }
    initializedMobile=true;
    nativeSchedule();
    decorateCalendar();
  };
  calendarSetMode=function(mode){
    if(mode==='month'){studioMode='month';monthOffset=0;schedule();return;}
    studioMode=mode==='day'?'day':'week';monthOffset=0;nativeSetMode(studioMode);
  };
  shiftWeek=function(n){if(studioMode==='month'){monthOffset+=n;schedule();return;}nativeShift(n);};
  calendarToday=function(){if(studioMode==='month'){monthOffset=0;calendarSelectedDate=todayISO();schedule();return;}nativeToday();};
  calendarSelectDate=function(value){monthOffset=0;if(studioMode==='month'){calendarSelectedDate=value;schedule();return;}nativeDate(value);};

  /* Normal tap/click uses quick actions; editing is still one tap within the menu. */
  document.addEventListener('click',event=>{
    const more=event.target.closest?.('.tp-event-more');
    if(!more||typeof window.teacherproOpenQuickMenu!=='function')return;
    const lesson=more.closest('.calendar-event');
    if(!lesson)return;
    event.preventDefault();event.stopImmediatePropagation();
    window.teacherproOpenQuickMenu(lesson,event.clientX+9,event.clientY+9);
  },true);
})();
