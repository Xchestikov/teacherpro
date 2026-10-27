/* TeacherPro: platform-level support, announcements and owner shortcut.
   Admin rights are checked in Supabase RLS; this module grants no access itself. */
(function(){
  'use strict';
  let checkedUser='',lastCheck=0,checking=false,owner=false,flags=[],overrides=[];
  const safe=x=>htmlSafe(String(x??''));
  function appendUi(){
    if(!cloudUser)return;
    const top=document.querySelector('.top-actions');
    if(top&&owner&&!top.querySelector('#tpOwnerLink')){
      const link=document.createElement('a');
      link.id='tpOwnerLink';link.href=new URL('admin/',location.href).href;
      link.textContent='Управление';link.className='secondary tp-owner-link';
      link.style.cssText='display:inline-flex;align-items:center;padding:8px 10px;border-radius:9px;text-decoration:none;font:700 11px Manrope,sans-serif';
      top.prepend(link);
    }
    const help=flags.find(x=>x.key==='support_requests');
    if(top&&help?.enabled&&!top.querySelector('#tpSupportButton')){
      const button=document.createElement('button');
      button.id='tpSupportButton';button.type='button';button.className='secondary';
      button.textContent='Поддержка';button.style.cssText='font-size:11px;padding:8px 10px';
      button.onclick=()=>window.tpOpenSupport();
      top.prepend(button);
    }
    if(help&&!help.enabled)top?.querySelector('#tpSupportButton')?.remove();
    if(!owner)top?.querySelector('#tpOwnerLink')?.remove();
    document.querySelector('#tpPlatformBanner')?.remove();
    const globalBanner=flags.find(x=>x.key==='maintenance_banner');
    const targeted=overrides.find(x=>x.key==='maintenance_banner');
    const banner=targeted?{enabled:targeted.enabled,value:targeted.value||globalBanner?.value}:globalBanner;
    if(banner?.enabled&&page!=='settings'){
      const node=document.createElement('div');node.id='tpPlatformBanner';
      node.setAttribute('role','status');node.textContent=String(banner.value||'В TeacherPro проводятся технические работы.');
      node.style.cssText='padding:12px 16px;margin:12px 0;border:1px solid #ecd4c9;background:#fff3e9;border-radius:12px;color:#8b5d4d;font-size:12px;line-height:1.5';
      document.querySelector('#content')?.prepend(node);
    }
  }
  async function refreshFlags(){
    if(!cloudClient||!cloudUser||checking)return;
    const uid=cloudUser.id;
    if(uid===checkedUser&&Date.now()-lastCheck<120000)return appendUi();
    checking=true;
    try{
      const [adminResponse,flagsResponse,overrideResponse]=await Promise.all([
        cloudClient.from('tp_platform_admins').select('role').eq('user_id',uid).maybeSingle(),
        cloudClient.from('tp_platform_flags').select('key,enabled,value'),
        cloudClient.from('tp_platform_flag_overrides').select('key,enabled,value').eq('teacher_id',uid)
      ]);
      if(cloudUser?.id!==uid)return;
      owner=!adminResponse.error&&['owner','admin'].includes(adminResponse.data?.role);
      flags=flagsResponse.error?[]:(flagsResponse.data||[]);
      overrides=overrideResponse.error?[]:(overrideResponse.data||[]);
      checkedUser=uid;lastCheck=Date.now();appendUi();
    }catch(_){/* Personal schedule must not fail when admin features are unavailable. */}
    finally{checking=false}
  }
  const nativeRender=render;
  render=function(){nativeRender();appendUi();void refreshFlags()};
  window.tpOpenSupport=async()=>{
    if(!cloudUser)return;
    if(!flags.find(x=>x.key==='support_requests'&&x.enabled))
      return alert('Обращения в поддержку сейчас отключены.');
    openModal('Поддержка TeacherPro','<div class="form"><p class="muted">Опиши вопрос, ошибку или предложение. Ответ и состояние обращения будут доступны здесь.</p>'+
      '<label>Тип обращения<select id="tpTicketCategory"><option value="question">Вопрос</option><option value="bug">Ошибка</option><option value="idea">Предложение</option><option value="billing">Оплата TeacherPro</option></select></label>'+
      '<label>Тема<input id="tpTicketSubject" maxlength="140" placeholder="Кратко о проблеме"></label>'+
      '<label>Описание<textarea id="tpTicketMessage" maxlength="3000" rows="4" placeholder="Опиши, что произошло или что хотелось бы улучшить"></textarea></label>'+
      '<div class="form-actions"><button class="secondary" onclick="closeModal()">Закрыть</button><button class="primary" id="tpTicketSubmit" onclick="tpSendSupport()">Отправить</button></div>'+
      '<div id="tpTicketHistory" class="muted">Загружаем предыдущие обращения…</div></div>');
    const {data,error}=await cloudClient.from('tp_support_tickets').select('subject,status,created_at').order('created_at',{ascending:false}).limit(8);
    const place=document.querySelector('#tpTicketHistory');
    if(!place)return;
    if(error){place.textContent='Историю обращений сейчас не удалось загрузить.';return;}
    place.replaceChildren();
    const title=document.createElement('p');title.textContent='Предыдущие обращения';place.append(title);
    if(!data?.length){const no=document.createElement('p');no.textContent='Пока обращений нет.';place.append(no);}
    else data.forEach(t=>{
      const row=document.createElement('p');row.textContent=String(t.subject||'')+' · '+(
        {new:'Новое',in_progress:'В работе',resolved:'Решено'}[t.status]||t.status);
      place.append(row);
    });
  };
  window.tpSendSupport=async()=>{
    const subject=document.querySelector('#tpTicketSubject')?.value.trim()||'';
    const message=document.querySelector('#tpTicketMessage')?.value.trim()||'';
    const category=document.querySelector('#tpTicketCategory')?.value||'question';
    if(subject.length<3||subject.length>140||message.length<10||message.length>3000)
      return alert('Укажи тему не короче 3 символов и описание не короче 10 символов.');
    const button=document.querySelector('#tpTicketSubmit');
    if(button)button.disabled=true;
    try{
      const {error}=await cloudClient.from('tp_support_tickets').insert({
        teacher_id:cloudUser.id,category,subject,message
      });
      if(error)throw error;
      closeModal();alert('Обращение отправлено. Статус можно посмотреть в разделе поддержки.');
    }catch(_){alert('Не удалось отправить обращение. Проверь соединение или попробуй позже.');}
    finally{if(button)button.disabled=false}
  };
})();
