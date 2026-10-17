# 🚀 Инструкция по развертыванию: Proxmox + Cloudflare Tunnel

Это руководство описывает процесс переноса и запуска приложения **Signal Script** на домашнем или удаленном сервере под управлением **Proxmox VE** с безопасным доступом по вашему личному домену через **Cloudflare Tunnel** (без необходимости белого IP и проброса портов на роутере).

---

## 1. Подготовка окружения на Proxmox

Рекомендуемый и самый легковесный способ — запуск в **LXC-контейнере** с поддержкой Docker, либо в отдельной виртуальной машине (VM) с **Ubuntu 24.04 LTS / Debian 12**.

### Если используете LXC-контейнер:
1. При создании контейнера в Proxmox:
   - Шаблон: `debian-12-standard` или `ubuntu-24.04-standard`.
   - Ресурсы: 2 CPU ядра, 2048 MB RAM, 15-20 GB диска.
2. В параметрах контейнера во вкладке **Options**:
   - Включите **Nesting: 1** (необходимо для работы Docker).
   - Включите **keyctl: 1**.

### Установка Docker и Docker Compose на сервере:
Подключитесь по SSH к вашей виртуальной машине / LXC:
```bash
# Обновление пакетов
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y curl git ufw

# Установка официального Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Проверка
docker --version
docker compose version
```

---

## 2. Клонирование и запуск приложения через Docker Compose

```bash
# 1. Клонируем ваш репозиторий
git clone https://github.com/neonxx96/g-backrest.git /opt/signal-script
cd /opt/signal-script

# 2. Создаем файл переменных окружения
cp .env.example .env
nano .env
# Вставьте ваш TELEGRAM_BOT_TOKEN и ключи (если требуются)

# 3. Запуск контейнеров в фоновом режиме
docker compose up -d --build

# 4. Проверка статуса
docker compose ps
docker compose logs -f backend
```
После этого:
* Бэкенд доступен локально по адресу `http://<IP_сервера>:8000`
* Веб-интерфейс доступен по адресу `http://<IP_сервера>:5173`

---

## 3. Настройка Cloudflare Tunnel (Доступ по своему домену)

Cloudflare Tunnel (`cloudflared`) позволяет безопасно подключить ваш веб-интерфейс к собственному домену (например, `signals.yourdomain.com`) без открытых портов наружу.

### Шаг A: Установка `cloudflared` на сервер
```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
```

### Шаг B: Авторизация и создание туннеля
```bash
# Авторизация в Cloudflare (откройте выведенную ссылку в браузере и выберите ваш домен)
cloudflared tunnel login

# Создание туннеля
cloudflared tunnel create signal-script
```
Команда выведет ID туннеля и создаст файл сертификата в `~/.cloudflared/<TUNNEL_ID>.json`.

### Шаг C: Привязка DNS записи
```bash
# Привязываем поддомен signals.yourdomain.com к созданному туннелю
cloudflared tunnel route dns signal-script signals.yourdomain.com
```

### Шаг D: Конфигурационный файл туннеля
Создайте файл `/etc/cloudflared/config.yml`:
```yaml
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json

ingress:
  # Проксируем все запросы на локальный фронтенд контейнер
  - hostname: signals.yourdomain.com
    service: http://localhost:5173
  - service: http_status:404
```

### Шаг E: Запуск как системной службы
```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

---

## 4. Защита доступа (Безопасность)

Поскольку в веб-интерфейсе можно менять настройки фильтров и смотреть график со стаканом, критически важно защитить его от посторонних.

Рекомендуется настроить **Cloudflare Zero Trust Access** (бесплатно до 50 пользователей):
1. В панели Cloudflare перейдите в **Zero Trust** → **Access** → **Applications**.
2. Нажмите **Add an Application** → **Self-hosted**.
3. Введите название (например, `Signal Script`) и поддомен `signals.yourdomain.com`.
4. В разделе **Policies** создайте правило:
   * Action: `Allow`
   * Rule type: `Include` → `Emails` (введите ваш личный email).
5. Теперь при открытии `signals.yourdomain.com` Cloudflare запросит одноразовый PIN-код, который придет на вашу почту, и никто посторонний в терминал не попадет.

В файле `.env` укажите ваш публичный домен:
```env
FRONTEND_URL=https://signals.yourdomain.com
```
И перезапустите бэкенд: `docker compose restart backend`.
Теперь ссылки в сообщениях Telegram-бота будут сразу вести на ваш защищенный домен!
