# Railway Deployment

Этот сценарий нужен, если вы хотите развернуть Telegram WMS в Railway без собственного VPS.

## Что уже подготовлено

- Docker-сборка приложения: [Dockerfile](/C:/Users/User/Documents/Bot%20Sklad/Dockerfile)
- Railway config: [railway.json](/C:/Users/User/Documents/Bot%20Sklad/railway.json)
- webhook-режим Telegram
- автоопределение внешнего адреса через `RAILWAY_PUBLIC_DOMAIN`

## Что создаём в Railway

В одном Railway project:

1. `Web Service` из этого репозитория
2. `PostgreSQL` service
3. при необходимости `Volume` для фото и отчётов

## Рекомендуемая схема

- backend работает в `webhook` режиме
- PostgreSQL берётся из Railway
- Railway выдаёт внешний домен
- Telegram webhook смотрит на Railway URL

## Пошагово

### 1. Создать проект

В Railway:

1. `New Project`
2. `Deploy from GitHub repo`
3. выбрать этот репозиторий

### 2. Добавить PostgreSQL

Внутри проекта:

1. `New`
2. `Database`
3. `Add PostgreSQL`

После этого Railway обычно создаёт переменную `DATABASE_URL`, которую можно использовать в web service.

## 3. Проверить Docker deploy

В проект уже добавлен [railway.json](/C:/Users/User/Documents/Bot%20Sklad/railway.json), где указано:

- использовать `Dockerfile`
- healthcheck: `/health`
- policy перезапуска при ошибке

## 4. Добавить переменные окружения

В `Variables` web service задайте:

```env
BOT_TOKEN=your_real_telegram_bot_token
TELEGRAM_TRANSPORT=webhook
TELEGRAM_WEBHOOK_PATH=/telegram/webhook
TELEGRAM_WEBHOOK_SECRET=replace_with_long_random_secret
DB_INIT_ON_START=true
EMBEDDED_POSTGRES_ENABLED=false
SCHEDULER_ENABLED=true
SCHEDULER_INTERVAL_MS=30000
PORT=3000
TELEGRAM_API_BASE=https://api.telegram.org
```

Если `DATABASE_URL` не подтянулся автоматически, добавьте его вручную из PostgreSQL service.

## 5. PUBLIC_BASE_URL

Для Railway можно не задавать `PUBLIC_BASE_URL` вручную, потому что backend уже умеет собирать его из:

- `RAILWAY_PUBLIC_DOMAIN`

Но если хотите зафиксировать внешний адрес явно, можно задать:

```env
PUBLIC_BASE_URL=https://your-service.up.railway.app
```

## 6. Внешняя доступность

Нужно включить public networking для web service, чтобы Railway выдал публичный домен.

После этого приложение будет доступно примерно по адресу:

```text
https://<your-service>.up.railway.app
```

## 7. Volume для фото и отчётов

Если хотите сохранять фото товара и PDF-отчёты между перезапусками, добавьте Railway Volume.

Рекомендуемый mount path:

```text
/data
```

Тогда в переменных web service задайте:

```env
UPLOADS_DIR=/data/uploads
REPORTS_DIR=/data/reports
```

Если volume пока не используете, можно оставить текущие значения `./uploads` и `./reports`, но это менее надёжно для продакшена.

## 8. Что произойдёт после старта

При запуске backend:

1. поднимет HTTP-сервер;
2. выполнит health endpoint `/health`;
3. зарегистрирует Telegram webhook;
4. начнёт принимать обновления от Telegram через Railway URL.

Webhook будет зарегистрирован на:

```text
https://<railway-domain>/telegram/webhook
```

## 9. Что проверить после деплоя

1. открыть `/health`
2. открыть `/admin`
3. отправить `/start` в Telegram
4. открыть логи сервиса

## 10. Минимальный чек после выкладки

- сервис в Railway имеет статус `Healthy`
- `DATABASE_URL` доступен web service
- `TELEGRAM_TRANSPORT=webhook`
- внешний домен Railway активен
- Telegram бот отвечает на `/start`

## Типовые причины проблем

- не добавлен `BOT_TOKEN`
- не создан внешний домен Railway
- сервис не видит `DATABASE_URL`
- забыли `EMBEDDED_POSTGRES_ENABLED=false`
- не подключили volume, а фото/отчёты ожидаются как постоянные

## Что уже сделано в коде под Railway

- поддержка webhook
- защита webhook secret token
- автоматический healthcheck endpoint
- Docker deploy
- автоопределение `PUBLIC_BASE_URL` из `RAILWAY_PUBLIC_DOMAIN`
