# TeacherPro: переход с Vercel на свой VPS

Это **инструкция для отдельной инфраструктурной ветки**. Прямой автоматический деплой не включён, рабочий домен и Supabase не изменены.

## 1. Текущее состояние VPS (проверено пользователем 14.10.2026)

- Ubuntu 24.04, IP `153.76.167.146`.
- Nginx **запущен**, порт 80 занят Nginx; Caddy отключён по просьбе пользователя и не должен запускаться.
- Учётная запись `teacherpro-deploy` создана, владеет `/srv/teacherpro`.
- Nginx уже имеет конфигурацию `/etc/nginx/conf.d/teacherpro.conf` для `teacherpro-app.ru`: `curl -H 'Host: teacherpro-app.ru' http://127.0.0.1/` возвращает тестовую страницу.
- Существующая служебная конфигурация панели на порту **1501** должна остаться нетронутой.
- У регистратора установлены NS `ns1.firstvds.ru` и `ns2.firstvds.ru`. Авторитативный NS возвращает `153.76.167.146`, публичный DNS пока возвращает NXDOMAIN. **Не запускать Let's Encrypt до проверки публичного DNS.**
- Рабочая версия остаётся на Vercel до проверки переноса.

## 2. Публичный DNS, Nginx и Let's Encrypt

Проверить публичные записи **на компьютере Windows**:

```powershell
nslookup teacherpro-app.ru 1.1.1.1
nslookup -type=ns teacherpro-app.ru 1.1.1.1
```

А-запись должна указывать на `153.76.167.146`. Если NXDOMAIN сохраняется, дождаться завершения делегирования, проверить через Whois и обратиться к регистратору при длительной задержке; не добавлять дублирующих записей.

Текущая конфигурация Nginx создана и проверена пользователем:

```nginx
server {
    listen 80;
    server_name teacherpro-app.ru;
    root /srv/teacherpro/current;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
    location = /sw.js { add_header Cache-Control "no-store"; }
    location = /cloud-config.js { add_header Cache-Control "no-store"; }
}
```

**Не заменять другие конфигурации Nginx** и не трогать порт 1501. После DNS установить SSL, например с помощью Certbot:

```bash
apt update
apt install -y certbot python3-certbot-nginx
nginx -t
certbot --nginx -d teacherpro-app.ru --redirect
nginx -t
systemctl reload nginx
certbot renew --dry-run
```

Установка сертификата требует, чтобы запросы снаружи приходили на сервер по HTTP (порт 80), а DNS уже указывал на VPS. Перед запуском проверить `ufw status` и открыть порты 80/443 только после подтверждения, что SSH-порт доступен: не потерять SSH-доступ.

**Особое замечание:** в текущей конфигурации `location = /sw.js` и `location = /cloud-config.js` есть заголовки, но явного `try_files` нет. Nginx всё равно отдаёт файлы через статический handler при наличии файла. После релиза надо проверить, что оба пути возвращают 200 и `Cache-Control: no-store`.

Для корневого URL также полезно запретить долговременное кеширование `index.html` (например, отдельной директивой `location = /index.html` и `location = /`), чтобы обновления отображались корректно. Изменять это лишь после тестового релиза и `nginx -t`.

## 3. GitHub Actions Secrets — вводить в GitHub, не в чат

Открой репозиторий `Xchestikov/teacherpro` → **Settings → Secrets and variables → Actions → New repository secret**. Добавь:

- `VPS_HOST`: публичный IPv4;
- `VPS_USER`: `teacherpro-deploy`;
- `VPS_DOMAIN`: приобретённый домен, **без** `https://` (например, `teacherpro.example`);
- `VPS_SSH_KEY`: содержимое **приватного** ключа `~/.ssh/teacherpro_deploy` (вводить только в GitHub);
- `VPS_KNOWN_HOSTS`: проверенная запись публичного SSH host key (не копировать без проверки из случайного сетевого ответа).

Fingerprint ключа сервера нужно сверить с fingerprint из надёжной консоли VPS. Сгенерировать строку known_hosts можно с локального компьютера через `ssh-keyscan -H SERVER_IP`, **затем обязательно проверить ключ** перед сохранением.

Для безопасности рекомендуются GitHub Environment `production-vps`, защита ветки `main` и обязательное подтверждение релиза. GitHub Actions использует аккаунт `teacherpro-deploy`, не root. SSH-ключ не сохраняй в репозиторий.

## 4. Выполнение деплоя

В `.github/workflows/deploy-vps.yml` подготовлен workflow с **ручным запуском**, без автоматической публикации на каждом push. Для `workflow_dispatch` сначала надо согласованно объединить этот workflow в `main`, затем запустить его в **Actions → Deploy TeacherPro to VPS → Run workflow**.

Workflow проверяет JS, загружает статические файлы в `/srv/teacherpro/releases/GIT_SHA`, переключает симлинк `current` на новую версию и проверяет HTTPS-ответ Nginx для `VPS_DOMAIN` с проверкой TLS-сертификата (через `curl --resolve`). При проблемах можно вручную вернуть симлинк на предыдущий каталог релиза. Он **не меняет Supabase и не выключает Vercel**.

После успешной публикации добавить новый домен в Supabase Auth (Site URL и Redirect URLs), выполнить вход/выход/восстановление пароля на новом домене, проверить календарь, оплату и мобильную версию.

**Не включать автоматическое выкладывание из main и не отключать Vercel до фактической проверки нового домена.**
