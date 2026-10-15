/* TeacherPro Student Profile V2 — preserves existing student tabs and homework.
   Avatar and progress are stored per student in the existing account JSON. */
(function(){
'use strict';
const qs=s=>document.querySelector(s);
const safe=x=>htmlSafe(String(x??''));
const student=id=>db.clients.find(c=>String(c.id)===String(id));
const templates=()=>Array.isArray(db.homeworkTemplates)?db.homeworkTemplates:(db.homeworkTemplates=[]);
const avatar=(c)=>typeof c?.avatarDataUrl==='string'&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]{100,120000}$/.test(c.avatarDataUrl)?
 '<img src="'+c.avatarDataUrl+'" alt="Фото ученика" class="s5-avatar-photo">':
 '<span aria-hidden="true">'+safe((c?.name||'У').charAt(0).toUpperCase())+'</span>';
function studentHeader(id){
 const c=student(id);if(!c)return;
 const body=qs('#modalBody');if(!body)return;
 body.querySelector('.s5-student-banner')?.remove();
 const wrap=document.createElement('div');wrap.className='s5-student-banner';
 wrap.innerHTML='<div class="s5-student-avatar">'+avatar(c)+'</div><div class="s5-student-title"><strong>'+safe(c.name)+'</strong>'+
 '<span>Профиль ученика</span></div><div class="s5-photo-controls">'+
 '<label class="secondary s5-upload">Загрузить фото<input type="file" accept="image/png,image/jpeg,image/webp" data-client-id="'+safe(id)+'" onchange="tpStudentAvatarUpload(this)" hidden></label>'+
 (c.avatarDataUrl?'<button class="link-btn" data-client-id="'+safe(id)+'" onclick="tpStudentAvatarRemove(this.dataset.clientId)">Удалить фото</button>':'')+'</div>';
 body.prepend(wrap);
}
window.tpStudentAvatarRemove=id=>{
 const c=student(id);if(!c||!c.avatarDataUrl)return;
 delete c.avatarDataUrl;save();openClient(id,'overview');
};
window.tpStudentAvatarUpload=async input=>{
 const c=student(input.dataset.clientId),file=input.files?.[0];if(!c||!file)return;
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>6*1024*1024){
  alert('Фото: JPG, PNG или WebP, не больше 6 МБ.');input.value='';return;
 }
 const url=URL.createObjectURL(file);
 try{
  const img=new Image();
  await new Promise((ok,fail)=>{img.onload=ok;img.onerror=fail;img.src=url;});
  const side=Math.min(img.naturalWidth,img.naturalHeight);
  if(!side)throw Error('Некорректное фото');
  const canvas=document.createElement('canvas');canvas.width=160;canvas.height=160;
  const context=canvas.getContext('2d');if(!context)throw Error('Ошибка обработки фото');
  context.fillStyle='#fff';context.fillRect(0,0,160,160);
  context.drawImage(img,(img.naturalWidth-side)/2,(img.naturalHeight-side)/2,side,side,0,0,160,160);
  const data=canvas.toDataURL('image/jpeg',0.76);
  if(data.length>105000)throw Error('Слишком большой файл после сжатия');
  // Verify student still exists after asynchronous image decode.
  const live=student(input.dataset.clientId);if(!live)return;
  live.avatarDataUrl=data;save();openClient(live.id,'overview');
 }catch(e){alert('Не удалось сохранить фотографию. Выбери другое изображение.');}
 finally{URL.revokeObjectURL(url);input.value='';}
};
function progressPanel(id){
 const c=student(id);if(!c)return;
 const done=db.lessons.filter(l=>String(l.clientId)===String(id)&&l.status==='done').length;
 const assigned=db.homework.filter(h=>String(h.clientId)===String(id));
 const completed=assigned.filter(h=>h.status==='done').length;
 const progress=Math.min(100,Math.max(0,Number(c.progressPercent)||0));
 const extra=document.createElement('section');extra.className='student-section s5-progress';
 extra.innerHTML='<h3>Прогресс обучения</h3>'+
 '<p class="muted">Оценка прогресса задаётся преподавателем — это не автоматическая оценка знаний.</p>'+
 '<div class="s5-progress-summary"><div><strong>'+done+'</strong><small>Уроков проведено</small></div>'+
 '<div><strong>'+completed+' / '+assigned.length+'</strong><small>ДЗ выполнено</small></div></div>'+
 '<label>Прогресс по учебной цели: <output id="s5ProgressValue">'+progress+'%</output>'+
 '<input type="range" min="0" max="100" step="5" value="'+progress+'" id="s5ProgressRange" oninput="document.querySelector(\'#s5ProgressValue\').value=this.value+\'%\'"></label>'+
 '<div class="s5-progress-bar" role="progressbar" aria-valuenow="'+progress+'" aria-valuemin="0" aria-valuemax="100"><span style="width:'+progress+'%"></span></div>'+
 '<label>Краткий комментарий<textarea id="s5ProgressNote" rows="2" maxlength="500" placeholder="Что уже получается и что изучаем дальше">'+safe(c.progressNote||'')+'</textarea></label>'+
 '<button class="secondary" data-client-id="'+safe(id)+'" onclick="tpSaveStudentProgress(this.dataset.clientId)">Сохранить прогресс</button>';
 const summary=qs('#modalBody .client-profile-summary');
 if(summary)summary.after(extra);else qs('#modalBody .student-overview-grid')?.before(extra);
}
window.tpSaveStudentProgress=id=>{
 const c=student(id);if(!c)return;
 const value=Number(qs('#s5ProgressRange')?.value),note=qs('#s5ProgressNote')?.value.trim()||'';
 if(!Number.isInteger(value)||value<0||value>100)return alert('Прогресс должен быть от 0 до 100 %.');
 c.progressPercent=value;c.progressNote=note;save();openClient(id,'overview');
};
window.tpStudentCalendar=id=>{
 const c=student(id);if(!c)return;
 const next=db.lessons.filter(l=>String(l.clientId)===String(id)&&l.date>=todayISO()&&l.status==='planned')
  .sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))[0];
 closeModal();calendarClientFilter=String(c.id);
 calendarSelectedDate=next?.date||todayISO();
 calendarMode=window.innerWidth<=700?'day':'week';
 if(typeof calendarSelectDate==='function')calendarSelectDate(calendarSelectedDate);
 setPage('schedule');
};
function calendarButton(id){
 const panel=qs('#modalBody .student-overview-grid section:nth-child(2)');
 if(!panel)return;
 const btn=document.createElement('button');btn.className='primary s5-student-calendar';
 btn.type='button';btn.textContent='Открыть расписание ученика';
 btn.onclick=()=>window.tpStudentCalendar(id);
 panel.prepend(btn);
}
function templatesButton(id){
 const header=qs('#modalBody .student-section-head');if(!header)return;
 const button=document.createElement('button');button.className='secondary';button.type='button';
 button.textContent='Шаблоны заданий';button.onclick=()=>window.tpTemplatesManager(id);header.append(button);
}
function templatesHtml(id){
 return '<div class="s5-template-list">'+
 (templates().length?templates().map(t=>'<article class="s5-template"><div><strong>'+safe(t.title)+'</strong>'+
 '<p>'+safe(t.description||'')+'</p></div><div class="s5-template-actions">'+
 '<button class="secondary" type="button" data-template-id="'+safe(t.id)+'" data-client-id="'+safe(id)+'" onclick="tpUseTemplate(this.dataset.clientId,this.dataset.templateId)">Использовать</button>'+
 '<button class="link-btn" type="button" data-template-id="'+safe(t.id)+'" data-client-id="'+safe(id)+'" onclick="tpDeleteTemplate(this.dataset.clientId,this.dataset.templateId)">Удалить</button></div></article>').join(''):
 '<p class="muted">Шаблонов пока нет. Сохрани первый для повторного использования.</p>')+
 '</div><div class="form"><label>Название шаблона<input id="s5TemplateTitle" maxlength="150" placeholder="Например, повторение темы"></label>'+
 '<label>Описание задания<textarea id="s5TemplateText" maxlength="6000" rows="4" placeholder="Текст домашнего задания"></textarea></label>'+
 '<div class="form-actions"><button class="secondary" data-client-id="'+safe(id)+'" onclick="openClient(this.dataset.clientId,\'homework\')">Назад</button>'+
 '<button class="primary" data-client-id="'+safe(id)+'" onclick="tpAddTemplate(this.dataset.clientId)">Сохранить шаблон</button></div></div>';
}
window.tpTemplatesManager=id=>{if(!student(id))return;openModal('Шаблоны домашних заданий',templatesHtml(id));};
window.tpAddTemplate=id=>{
 const title=qs('#s5TemplateTitle')?.value.trim(),description=qs('#s5TemplateText')?.value.trim();
 if(!title||!description)return alert('Заполни название и текст шаблона.');
 if(templates().length>=100)return alert('Можно сохранить не более 100 шаблонов.');
 templates().push({id:crypto.randomUUID(),title,description,createdAt:new Date().toISOString()});
 save();window.tpTemplatesManager(id);
};
window.tpDeleteTemplate=(id,templateId)=>{
 if(!student(id)||!templates().some(t=>String(t.id)===String(templateId)))return;

 db.homeworkTemplates=templates().filter(t=>String(t.id)!==String(templateId));
 save();window.tpTemplatesManager(id);
};
window.tpUseTemplate=(id,templateId)=>{
 const t=templates().find(t=>String(t.id)===String(templateId));
 if(!student(id)||!t)return;
 openHomeworkEditor(id);
 const title=qs('#hwTitle'),description=qs('#hwDescription');
 if(title)title.value=t.title;if(description)description.value=t.description;
};
const baseHomeworkEditor=openHomeworkEditor;
openHomeworkEditor=function(...args){
 baseHomeworkEditor(...args);
 const container=qs('#modalBody .form');
 if(!container||container.querySelector('#s5TemplatePicker'))return;
 const id=args[0]||db.homework.find(h=>String(h.id)===String(args[1]))?.clientId;
 const block=document.createElement('div');block.className='s5-template-picker';
 block.innerHTML='<label>Заполнить из шаблона<select id="s5TemplatePicker"><option value="">Не использовать</option>'+
 templates().map(t=>'<option value="'+safe(t.id)+'">'+safe(t.title)+'</option>').join('')+'</select></label>';
 const select=block.querySelector('select');
 select.onchange=()=>{
  const t=templates().find(t=>String(t.id)===String(select.value));if(!t)return;
  const title=qs('#hwTitle'),description=qs('#hwDescription');

  if(title)title.value=t.title;if(description)description.value=t.description;
 };
 container.prepend(block);
};
const baseOpenClient=openClient;
openClient=function(id,tab){
 baseOpenClient(id,tab);
 if(!id||!student(id))return;
 studentHeader(id);
 if(!tab||tab==='overview'){progressPanel(id);calendarButton(id);}
 if(tab==='homework')templatesButton(id);
};
const nativeClients=clients;
clients=function(){
 nativeClients();
 const rows=document.querySelectorAll('#clientRows tr');
 rows.forEach((r,i)=>{
  const c=db.clients[i],name=r.querySelector('td.person');
  if(!c||!name)return;
  const photo=document.createElement('span');photo.className='s5-table-avatar';photo.innerHTML=avatar(c);
  name.prepend(photo);
 });
};
const baseLessonOpen=openLesson;
openLesson=function(...args){
 baseLessonOpen(...args);
 const form=qs('#modalBody .form');if(!form||qs('#s5LessonTeacherNote'))return;
 const id=args[0],lesson=id?db.lessons.find(l=>String(l.id)===String(id)):null;
 const label=document.createElement('label');label.textContent='Заметка преподавателя к уроку';
 const textarea=document.createElement('textarea');textarea.id='s5LessonTeacherNote';textarea.maxLength=3000;
 textarea.rows=3;textarea.placeholder='Что прошли, что задать, на что обратить внимание';
 textarea.value=lesson?.teacherNote||'';
 label.append(textarea);
 form.querySelector('.form-actions')?.before(label);
};
const baseLessonSave=saveLesson;
saveLesson=function(...args){
 const field=qs('#s5LessonTeacherNote'),note=field?.value.trim(),id=args[0];
 const existingBefore=id?db.lessons.find(l=>String(l.id)===String(id)):null;
 const beforeIds=new Set(db.lessons.map(l=>String(l.id)));
 baseLessonSave(...args);
 if(!field||qs('#modal')?.classList.contains('open'))return; // validation or cancelled operation
 const record=existingBefore||db.lessons.find(l=>!beforeIds.has(String(l.id)));
 if(record&&typeof note==='string'&&record.teacherNote!==note){
  record.teacherNote=note;save();render();
 }
};
// Template storage is global to the signed-in account and is preserved by normalizeDb.
})();
