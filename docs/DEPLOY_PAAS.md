# Облачный деплой: Railway / Render-подобные платформы

Этот сценарий подходит, когда вы не хотите вручную администрировать VPS, Docker daemon и reverse proxy.

## Когда использовать

- нужен быстрый внешний запуск без настройки сервера;
- бот должен быть доступен из интернета;
- админ-панель и webhook должны жить на постоянном URL;
- PostgreSQL нужен как managed service платформы.

## Что уже подготовлено в проекте

- Docker-образ приложения: [Dockerfile](/C:/Users/User/Documents/Bot%20Sklad/Dockerfile)
- webhook-режим Telegram
- автоопределение публичного URL из:
  - `PUBLIC_BASE_URL`
  - `RENDER_EXTERNAL_URL`
  - `RAILWAY_PUBLIC_DOMAIN`
- готовый blueprint для Render: [render.yaml](/C:/Users/User/Documents/Bot%20Sklad/render.yaml)

## Общая логика для PaaS

В облаке вам нужны:

1. web service из этого репозитория;
2. PostgreSQL от платформы;
3. внешний HTTPS URL;
4. переменные окружения для Telegram.

## Render

### Что использовать

- `render.yaml` уже добавлен в проект;
- PostgreSQL создаётся как managed database;
- web service собирается из `Dockerfile`.

### Что нужно заполнить руками в Render

Секреты:

- `BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`

Рекомендуется также вручную задать:

- `PUBLIC_BASE_URL=https://your-service.onrender.com`

Это особенно полезно на первом деплое, чтобы Telegram webhook сразу регистрировался на точный внешний адрес.

### Переменные, которые уже описаны в `render.yaml`

- `TELEGRAM_TRANSPORT=webhook`
- `TELEGRAM_WEBHOOK_PATH=/telegram/webhook`
- `DB_INIT_ON_START=true`
- `EMBEDDED_POSTGRES_ENABLED=false`
- `DATABASE_URL` из managed database

### Порядок развёртывания на Render

1. Подключить репозиторий к Render.
2. Создать Blueprint deploy из `render.yaml`.
3. После создания сервиса открыть env variables.
4. Вставить:
   - `BOT_TOKEN`
   - `TELEGRAM_WEBHOOK_SECRET`
   - `PUBLIC_BASE_URL`
5. Дождаться деплоя.
6. Проверить:
   - `/health`
   - `/admin`
   - `/start` в Telegram

## Railway

### Что использовать

На Railway удобнее всего:

- создать новый project;
- подключить этот репозиторий;
- добавить PostgreSQL plugin/service;
- задать переменные окружения вручную.

### Почему отдельный файл не обязателен

В Railway конфигурация переменных и базы обычно проще настраивается прямо в UI проекта, а приложение уже умеет подхватывать:

- `DATABASE_URL`
- `RAILWAY_PUBLIC_DOMAIN`

То есть `PUBLIC_BASE_URL` можно вообще не задавать, если Railway выдал публичный домен и прокинул `RAILWAY_PUBLIC_DOMAIN`.

### Что задать в Railway

- `BOT_TOKEN`
- `TELEGRAM_TRANSPORT=webhook`
- `TELEGRAM_WEBHOOK_PATH=/telegram/webhook`
- `TELEGRAM_WEBHOOK_SECRET=<long-random-secret>`
- `DB_INIT_ON_START=true`
- `EMBEDDED_POSTGRES_ENABLED=false`
- `UPLOADS_DIR=./uploads`
- `REPORTS_DIR=./reports`
- `SCHEDULER_ENABLED=true`
- `SCHEDULER_INTERVAL_MS=30000`

Обычно `DATABASE_URL` Railway подставляет сам от PostgreSQL service.

### Порядок развёртывания на Railway

1. Создать проект в Railway.
2. Подключить GitHub-репозиторий с проектом.
3. Добавить PostgreSQL service.
4. Убедиться, что `DATABASE_URL` попал в backend service.
5. Добавить env variables из списка выше.
6. Включить публичный доступ для backend service.
7. После первого деплоя проверить домен сервиса.
8. Отправить `/start` боту.

## Что важно для обоих вариантов

- `TELEGRAM_TRANSPORT` должен быть `webhook`
- `EMBEDDED_POSTGRES_ENABLED` должен быть `false`
- у сервиса должен быть постоянный внешний HTTPS URL
- Telegram webhook должен указывать на:

```text
/telegram/webhook
```

## Проверка после выкладки

1. Открыть `https://<public-domain>/health`
2. Открыть `https://<public-domain>/admin`
3. Проверить запуск webhook по логам
4. Отправить `/start` в Telegram

## Если хотите максимально простой первый запуск

Для Render:

- используйте `render.yaml`
- сразу вручную задайте `PUBLIC_BASE_URL`

Для Railway:

- используйте встроенный PostgreSQL
- положитесь на `RAILWAY_PUBLIC_DOMAIN` или задайте `PUBLIC_BASE_URL` явно

## Следующий шаг

Если хотите, следующим сообщением я могу добить уже конкретно один из двух путей:

1. `Railway` пошагово под UI платформы
2. `Render` пошагово под Blueprint deploy

Отдельная Railway-инструкция уже вынесена сюда:

- [docs/DEPLOY_RAILWAY.md](/C:/Users/User/Documents/Bot%20Sklad/docs/DEPLOY_RAILWAY.md)
