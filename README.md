# Bot Sklad

Telegram WMS для склада на PostgreSQL с Inline Keyboard, заявками на выдачу, импортом Excel, экспортом Excel/PDF, хранением фото товара, фоновой обработкой уведомлений и отдельной админ-панелью.

## Что реализовано

### База и доменная модель

- PostgreSQL как основное хранилище
- SQL-схема автоматического создания базы
- миграция старых данных из `data/db.json`
- нормализованная структура склада, товаров, движений и журналов

### Складские сценарии

- авторизация
- поиск товара
- приемка
- выдача
- перемещение
- ревизия
- история операций
- контроль минимального остатка

### Новые функции этапа

- заявки на выдачу и согласование
- импорт товаров и остатков из Excel
- экспорт аналитики в Excel
- экспорт аналитики в PDF
- хранение фото товара в локальном каталоге `uploads/`
- отдельная админ-панель
- фоновые задания и планировщик уведомлений
- более глубокие отчеты и аналитика

## Архитектура

Проект разделен на модули:

- `database/`
- `src/controllers/`
- `src/services/`
- `src/repositories/`
- `src/database/`
- `src/middlewares/`
- `src/telegram/`
- `src/utils/`

Ключевые файлы:

- [src/server.js](/C:/Users/User/Documents/Bot%20Sklad/src/server.js)
- [src/router.js](/C:/Users/User/Documents/Bot%20Sklad/src/router.js)
- [database/schema.sql](/C:/Users/User/Documents/Bot%20Sklad/database/schema.sql)
- [database/migrate-json-to-postgres.js](/C:/Users/User/Documents/Bot%20Sklad/database/migrate-json-to-postgres.js)
- [src/telegram/telegram-bot-service.js](/C:/Users/User/Documents/Bot%20Sklad/src/telegram/telegram-bot-service.js)
- [src/controllers/admin-controller.js](/C:/Users/User/Documents/Bot%20Sklad/src/controllers/admin-controller.js)

## Структура БД

Основные таблицы:

- `roles`
- `users`
- `warehouses`
- `racks`
- `shelves`
- `cells`
- `categories`
- `suppliers`
- `products`
- `product_photos`
- `inventory`
- `inventory_history`
- `stock_movements`
- `receipts`
- `issues`
- `issue_requests`
- `revisions`
- `notifications`
- `user_action_logs`
- `background_jobs`

## Telegram UI

Главное меню:

- `📦 Товары`
- `📥 Приемка`
- `📤 Выдача`
- `🔄 Перемещение`
- `📝 Ревизия`
- `📊 Остатки`
- `📈 Отчеты`
- `🔍 Поиск`
- `📷 Сканировать QR`
- `⚙️ Настройки`

На каждом экране предусмотрены:

- `⬅️ Назад`
- `🏠 Главное меню`

Для совместимости также оставлены текстовые команды:

- `/start`
- `/login +79990000001`
- `/menu`
- `/find 34567`
- `/stock`
- `/history 34567`

## Админ-панель

Админ-панель доступна по адресу:

- `GET /admin`

Она включает:

- дашборд
- создание заявок на выдачу
- загрузку фото товара
- импорт Excel
- экспорт Excel/PDF
- постановку фоновых задач в очередь

## HTTP API

### Базовые маршруты

- `GET /health`
- `GET /stats`
- `GET /products?query=...`
- `GET /products/:id/history`
- `GET /inventory/low-stock`
- `POST /auth/login`
- `POST /operations/receipt`
- `POST /operations/issue`
- `POST /operations/move`
- `POST /audits/count`
- `POST /telegram/webhook`

### Заявки

- `GET /requests`
- `POST /requests`
- `POST /requests/:id/approve`
- `POST /requests/:id/reject`

### Фото товаров

- `POST /products/:id/photo`
- `GET /uploads/:fileName`

### Отчеты и импорт/экспорт

- `GET /reports/analytics`
- `GET /reports/export.xlsx`
- `GET /reports/export.pdf`
- `POST /reports/import-excel`

### Фоновые задания

- `POST /jobs`

### Админ API

- `GET /admin/api/dashboard`

## Настройка окружения

Создайте `.env` на основе [.env.example](/C:/Users/User/Documents/Bot%20Sklad/.env.example):

```env
PORT=3000
DATA_FILE=./data/db.json
BOT_TOKEN=
TELEGRAM_API_BASE=https://api.telegram.org
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/bot_sklad
DB_SSL=false
DB_MAX_CONNECTIONS=10
DB_INIT_ON_START=false
UPLOADS_DIR=./uploads
SCHEDULER_ENABLED=true
SCHEDULER_INTERVAL_MS=30000
```

## Запуск

1. Создать базу PostgreSQL `bot_sklad`
2. Инициализировать схему:

```bash
npm run db:init
```

3. Перенести старые JSON-данные:

```bash
npm run db:migrate-json
```

4. Запустить сервер:

```bash
npm start
```

Если используете встроенный runtime:

```powershell
C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe database/init-db.js
C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe database/migrate-json-to-postgres.js
C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe src/server.js
```

## Проверка

Локальная автоматическая проверка:

```bash
npm run check
```

Проверка, выполненная на текущем этапе:

- smoke check модулей
- проверка схемы БД
- проверка миграционного плана
- проверка Telegram UI
- проверка импортируемости `src/server.js`

## Формат Excel для импорта

Поддерживаемые колонки:

- `Name`
- `SKU`
- `Category`
- `Supplier`
- `Unit`
- `MinStock`
- `Barcode`
- `QRCode`
- `PhotoUrl`
- `Warehouse`
- `Rack`
- `Shelf`
- `Cell`
- `Quantity`

## Следующий этап

- полноценное согласование заявок прямо в Telegram UI
- отчеты по периодам и фильтрам через интерфейс
- массовая загрузка фото
- фоновый генератор регулярных PDF-отчетов
- RBAC для админ-панели
- расширенные KPI и управленческая аналитика
