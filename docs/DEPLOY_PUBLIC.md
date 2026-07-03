# Публичное развёртывание: VPS + Docker + домен

Этот вариант нужен для нормальной боевой работы Telegram WMS:

- бот доступен 24/7;
- Telegram доставляет обновления через `webhook`;
- админ-панель открывается по HTTPS-домену;
- PostgreSQL, фото и отчёты живут на постоянных volume.

## Что будет поднято

- `postgres`: база данных
- `app`: backend Telegram WMS
- `caddy`: HTTPS reverse proxy с автоматическим SSL

## Что нужно заранее

- VPS с Ubuntu 22.04/24.04
- домен, направленный на IP сервера
- открытые порты `80` и `443`
- доступ по SSH

## DNS

У регистратора домена создайте запись:

- тип: `A`
- имя: `bot` или `@`
- значение: публичный IP вашего VPS

Пример:

- `bot.example.com -> 203.0.113.10`

## Шаг 1. Подготовить сервер

Скопируйте проект на VPS, затем выполните:

```bash
sudo bash deploy/bootstrap-ubuntu.sh
```

Скрипт:

- установит Docker Engine и Docker Compose plugin;
- включит Docker;
- откроет `22`, `80`, `443` в `ufw`.

## Шаг 2. Заполнить production-настройки

В корне проекта создайте файл `.env.production` на основе [.env.production.example](/C:/Users/User/Documents/Bot%20Sklad/.env.production.example).

Минимальный рабочий пример:

```env
PORT=3000
BOT_TOKEN=your_real_telegram_bot_token
TELEGRAM_API_BASE=https://api.telegram.org
TELEGRAM_TRANSPORT=webhook
PUBLIC_BASE_URL=https://bot.example.com
TELEGRAM_WEBHOOK_PATH=/telegram/webhook
TELEGRAM_WEBHOOK_SECRET=replace_with_long_random_secret
POSTGRES_DB=bot_sklad
POSTGRES_USER=postgres
POSTGRES_PASSWORD=replace_with_strong_db_password
DATABASE_URL=postgresql://postgres:replace_with_strong_db_password@postgres:5432/bot_sklad
DB_INIT_ON_START=true
EMBEDDED_POSTGRES_ENABLED=false
UPLOADS_DIR=./uploads
REPORTS_DIR=./reports
SCHEDULER_ENABLED=true
SCHEDULER_INTERVAL_MS=30000
```

Важно:

- `PUBLIC_BASE_URL` должен совпадать с вашим реальным доменом.
- `TELEGRAM_TRANSPORT=webhook` обязателен для публичного режима.
- `EMBEDDED_POSTGRES_ENABLED=false`, потому что база будет жить в отдельном контейнере.
- `POSTGRES_PASSWORD` должен быть сильным и совпадать с паролем в `DATABASE_URL`.

## Шаг 3. Заполнить deploy env

Создайте `deploy/.env` на основе [deploy/.env.example](/C:/Users/User/Documents/Bot%20Sklad/deploy/.env.example):

```env
APP_DOMAIN=bot.example.com
TELEGRAM_WEBHOOK_PATH=/telegram/webhook
```

В проект уже добавлены готовые шаблоны:

- [.env.production](/C:/Users/User/Documents/Bot%20Sklad/.env.production)
- [deploy/.env](/C:/Users/User/Documents/Bot%20Sklad/deploy/.env)

Перед реальным деплоем вам нужно заменить только домен:

- `PUBLIC_BASE_URL=https://bot.example.com`
- `APP_DOMAIN=bot.example.com`

## Шаг 4. Запустить стек

Выполните:

```bash
bash deploy/deploy-public.sh
```

Скрипт:

- проверит наличие `.env.production`;
- проверит наличие `deploy/.env`;
- соберёт контейнер приложения;
- поднимет `postgres`, `app`, `caddy`.

## Шаг 5. Проверить запуск

Проверьте:

```bash
docker compose -f deploy/docker-compose.public.yml ps
docker compose -f deploy/docker-compose.public.yml logs -f app
```

Проверка адресов:

1. `https://bot.example.com/health`
2. `https://bot.example.com/admin`
3. отправьте `/start` вашему боту в Telegram

## Как это работает

При старте backend:

- поднимает HTTP-сервер;
- регистрирует Telegram webhook на адрес:

```text
PUBLIC_BASE_URL + TELEGRAM_WEBHOOK_PATH
```

То есть:

```text
https://bot.example.com/telegram/webhook
```

Запросы Telegram проходят:

- Telegram -> Caddy -> backend `/telegram/webhook`

## Полезные команды

Перезапуск:

```bash
docker compose -f deploy/docker-compose.public.yml restart
```

Остановка:

```bash
docker compose -f deploy/docker-compose.public.yml down
```

Обновление после изменений в коде:

```bash
git pull
bash deploy/deploy-public.sh
```

Проверка webhook:

```bash
docker compose -f deploy/docker-compose.public.yml logs -f app
```

Если webhook зарегистрирован нормально, в логах будет строка о конфигурации webhook.

## Что уже предусмотрено в проекте

- webhook-режим Telegram
- секрет webhook через `X-Telegram-Bot-Api-Secret-Token`
- PostgreSQL в отдельном контейнере
- HTTPS через Caddy
- persistent volumes для:
  - базы
  - фото
  - отчётов

## Частые причины проблем

- домен ещё не указывает на VPS
- закрыты порты `80/443`
- `PUBLIC_BASE_URL` не совпадает с доменом
- неверный `BOT_TOKEN`
- забыли выставить `TELEGRAM_TRANSPORT=webhook`
- VPS не может получить SSL-сертификат из-за DNS или firewall

## Следующий шаг

Когда будете готовы, мы можем следующим этапом добить:

- backup PostgreSQL;
- отдельный production `.env` под ваш реальный домен;
- защиту админ-панели;
- CI/CD для автоматического деплоя на VPS.
