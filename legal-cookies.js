/* TeacherPro: optional-cookie choice. No analytics is loaded without explicit integrations. */
(function () {
  'use strict';
  const KEY = 'teacherpro_cookie_choice';
  const VERSION = '2026-10-27';
  const MAX_AGE = 60 * 60 * 24 * 180;
  function read() {
    const match = document.cookie.split('; ').find(part => part.startsWith(KEY + '='));
    if (!match) return null;
    try {
      const value = JSON.parse(decodeURIComponent(match.slice(KEY.length + 1)));
      return value && value.version === VERSION && typeof value.analytics === 'boolean' ? value : null;
    } catch (_) { return null; }
  }
  function write(analytics) {
    const record = {version: VERSION, necessary: true, analytics: !!analytics, at: new Date().toISOString()};
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = KEY + '=' + encodeURIComponent(JSON.stringify(record)) +
      '; Path=/; SameSite=Lax; Max-Age=' + MAX_AGE + secure;
    window.dispatchEvent(new CustomEvent('teacherpro:cookie-choice', {detail: {analytics: record.analytics}}));
    return record;
  }
  function close() {
    document.getElementById('tpCookieBanner')?.remove();
    document.getElementById('tpCookiePreferences')?.remove();
  }
  function button(text, handler, cssClass) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cssClass;
    b.textContent = text;
    b.addEventListener('click', handler);
    return b;
  }
  function makePanel() {
    close();
    const current = read();
    const overlay = document.createElement('div');
    overlay.className = 'tp-cookie-overlay';
    overlay.id = 'tpCookiePreferences';
    const panel = document.createElement('section');
    panel.className = 'tp-cookie-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'tpCookiePreferencesTitle');
    const title = document.createElement('h2');
    title.id = 'tpCookiePreferencesTitle';
    title.textContent = 'Настройки cookies';
    const intro = document.createElement('p');
    intro.textContent = 'Необходимые технические данные используются для входа и работы сайта. Аналитика сейчас не подключена и по умолчанию отключена.';
    const necessary = document.createElement('p');
    necessary.className = 'tp-cookie-note';
    necessary.textContent = 'Необходимые — всегда активны (сессия, безопасность, сохранение выбора).';
    const label = document.createElement('label');
    label.className = 'tp-cookie-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = current?.analytics === true;
    const desc = document.createElement('span');
    desc.textContent = 'Разрешить аналитические cookies при их подключении (сейчас не используются)';
    label.append(checkbox, desc);
    const link = document.createElement('a');
    link.href = './legal/cookies.html';
    link.textContent = 'Политика cookies';
    const actions = document.createElement('div');
    actions.className = 'tp-cookie-actions';
    const finish = () => { write(checkbox.checked); close(); };
    actions.append(button('Отменить', () => {close(); if (!read()) showBanner();}, 'tp-cookie-secondary'),
      button('Сохранить настройки', finish, 'tp-cookie-primary'));
    panel.append(title, intro, necessary, label, link, actions);
    overlay.append(panel);
    overlay.addEventListener('click', event => {if (event.target === overlay) {close(); if (!read()) showBanner();}});
    document.body.append(overlay);
    checkbox.focus();
  }
  function showBanner() {
    if (read() || document.getElementById('tpCookieBanner')) return;
    const bar = document.createElement('section');
    bar.id = 'tpCookieBanner';
    bar.className = 'tp-cookie-banner';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Выбор файлов cookies');
    const main = document.createElement('div');
    main.className = 'tp-cookie-copy';
    const title = document.createElement('strong');
    title.textContent = 'Файлы cookies в TeacherPro';
    const text = document.createElement('p');
    text.textContent = 'Используем техническое хранение для работы аккаунта и запоминания настроек. Необязательная аналитика выключена. Вы можете изменить выбор в любое время.';
    const a = document.createElement('a');
    a.href = './legal/cookies.html';
    a.textContent = 'Подробнее о cookies';
    main.append(title, text, a);
    const actions = document.createElement('div');
    actions.className = 'tp-cookie-actions';
    actions.append(button('Только необходимые', () => {write(false); close();}, 'tp-cookie-secondary'),
      button('Настроить', makePanel, 'tp-cookie-secondary'),
      button('Разрешить всё', () => {write(true); close();}, 'tp-cookie-primary'));
    bar.append(main, actions);
    document.body.append(bar);
  }
  window.tpOpenCookiePreferences = makePanel;
  window.tpCookieConsent = () => read();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showBanner, {once: true});
  else showBanner();
  try {
    if (new URLSearchParams(location.search).get('cookie_settings') === '1') {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', makePanel, {once: true});
      else makePanel();
    }
  } catch (_) {}
})();
