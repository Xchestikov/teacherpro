# TeacherPro: переход с Vercel на свой VPS

Это **инструкция для отдельной инфраструктурной ветки**. Прямой автоматический деплой не включён, рабочий домен и Supabase не изменены.

## 1. VPS и DNS

Нужен Ubuntu 24.04 LTS, доступ SSH и публичный IPv4. На компьютере администратора войди на сервер через SSH, используя доступ, выданный хостингом (пароли/закрытые ключи в чат не присылай).

При первом подключении проверь fingerprint хоста по консоли провайдера. Установи Caddy, rsync, curl, ufw:

```bash
sudo apt update
sudo apt install -y caddy rsync curl ufw
sudo adduser --disabled-password --gecos "" teacherpro-deploy
sudo mkdir -p /srv/teacherpro/releases
sudo chown -R teacherpro-deploy:teacherpro-deploy /srv/teacherpro
sudo chmod 755 /srv /srv/teacherpro
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

**Не закрывай текущую SSH-сессию**, пока не проверишь вход во второй сессии. Для VPS с SSH на нестандартном порту сначала разреши реальный порт вместо `OpenSSH`.

Создай отдельный ключ **на своём компьютере** и не используй его для root:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/teacherpro_deploy -C "teacherpro-deploy" -N ""
```

Добавь содержимое `~/.ssh/teacherpro_deploy.pub` в файл `/home/teacherpro-deploy/.ssh/authorized_keys` на сервере. Настрой на VPS права: директория `700`, файл `600`, владелец `teacherpro-deploy`. Проверь командой `ssh -i ~/.ssh/teacherpro_deploy teacherpro-deploy@SERVER_IP`. Только после успешного теста переходи к GitHub.

В панели регистратора создай DNS `A` для выбранного домена, указывающий на публичный IPv4. Убедись, что нет неправильной `AAAA` записи, если IPv6 не настроен.

## 2. Caddy + автоматический HTTPS

Когда домен уже указывает на IP, запиши конфигурацию в `/etc/caddy/Caddyfile` (замени `DOMAIN.EXAMPLE` своим доменом):

```caddyfile
DOMAIN.EXAMPLE {
    root * /srv/teacherpro/current
    encode zstd gzip
    header {
        X-Content-Type-Options nosniff
        Referrer-Policy strict-origin-when-cross-origin
        X-Frame-Options DENY
    }
    @shell path / /index.html /sw.js /cloud-config.js
    header @shell Cache-Control "no-store"
    file_server
}
```

Проверь и примени:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
sudo systemctl status caddy --no-pager
```

Caddy получает сертификат при доступных DNS, портах 80/443 и работающем домене. Пока файлы ещё не загружены, сервер может возвращать 404 — это ожидаемо.

## 3. GitHub Actions Secrets — вводить в GitHub, не в чат

Открой репозиторий `Xchestikov/teacherpro` → **Settings → Secrets and variables → Actions → New repository secret**. Добавь:

- `VPS_HOST`: публичный IPv4;
- `VPS_USER`: `teacherpro-deploy`;
- `VPS_SSH_KEY`: содержимое **приватного** ключа `~/.ssh/teacherpro_deploy` (вводить только в GitHub);
- `VPS_KNOWN_HOSTS`: проверенная запись публичного SSH host key (не копировать без проверки из случайного сетевого ответа).

Fingerprint ключа сервера нужно сверить с fingerprint из надёжной консоли VPS. Сгенерировать строку known_hosts можно с локального компьютера через `ssh-keyscan -H SERVER_IP`, **затем обязательно проверить ключ** перед сохранением.

Для безопасности рекомендуются GitHub Environment `production-vps`, защита ветки `main` и обязательное подтверждение релиза. GitHub Actions использует аккаунт `teacherpro-deploy`, не root. SSH-ключ не сохраняй в репозиторий.

## 4. Выполнение деплоя

В `.github/workflows/deploy-vps.yml` подготовлен workflow с **ручным запуском**, без автоматической публикации на каждом push. Для `workflow_dispatch` сначала надо согласованно объединить этот workflow в `main`, затем запустить его в **Actions → Deploy TeacherPro to VPS → Run workflow**.

Workflow проверяет JS, загружает статические файлы в `/srv/teacherpro/releases/GIT_SHA`, переключает симлинк `current` на новую версию и проверяет локальный HTTP-ответ от Caddy. При проблемах можно вручную вернуть симлинк на предыдущий каталог релиза. Он **не меняет Supabase и не выключает Vercel**.

После успешной публикации добавить новый домен в Supabase Auth (Site URL и Redirect URLs), выполнить вход/выход/восстановление пароля на новом домене, проверить календарь, оплату и мобильную версию.

**Не включать автоматическое выкладывание из main и не отключать Vercel до фактической проверки нового домена.**
