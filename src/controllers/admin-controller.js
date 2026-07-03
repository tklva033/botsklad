import { readJsonBody, sendJson } from "../utils/http.js";
import { HttpError } from "../middlewares/http-error.js";

export class AdminController {
  constructor({
    reportService,
    requestService,
    inventoryService,
    authService,
    importExportService,
    mediaService,
    backgroundJobService
  }) {
    this.reportService = reportService;
    this.requestService = requestService;
    this.inventoryService = inventoryService;
    this.authService = authService;
    this.importExportService = importExportService;
    this.mediaService = mediaService;
    this.backgroundJobService = backgroundJobService;
  }

  async page(req, res) {
    const user = await this.ensureAdminAccess(req);
    const html = buildAdminHtml(user);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  }

  async dashboard(req, res, url) {
    const user = await this.ensureAdminAccess(req);
    const filters = readFilters(url);
    const requestFilters = { status: url.searchParams.get("requestStatus") || null };
    const [analytics, requests, lowStock, stats, warehouses, employees] = await Promise.all([
      this.reportService.getAnalytics(filters),
      this.requestService.listRequests(requestFilters),
      this.inventoryService.getLowStock(),
      this.inventoryService.getStats(),
      this.inventoryService.listWarehouses(),
      this.authService.listUsers()
    ]);

    sendJson(res, 200, {
      currentUser: sanitizeUser(user),
      capabilities: getCapabilities(user, this.authService),
      stats,
      analytics,
      requests,
      lowStock,
      warehouses,
      employees: employees.map((item) => ({ id: item.id, fullName: item.fullName, role: item.role }))
    });
  }

  async validateImport(req, res) {
    const user = await this.ensurePermission(req, "import_export");
    const body = await readJsonBody(req);
    sendJson(res, 200, await this.importExportService.validateProductsWorkbook({
      ...body,
      actorId: body.actorId || user.id
    }));
  }

  async confirmImport(req, res) {
    const user = await this.ensurePermission(req, "import_export");
    const body = await readJsonBody(req);
    sendJson(res, 200, await this.importExportService.confirmProductsWorkbook({
      ...body,
      actorId: body.actorId || user.id
    }));
  }

  async uploadPhotosBatch(req, res) {
    const user = await this.ensurePermission(req, "upload_media");
    const body = await readJsonBody(req);
    sendJson(res, 201, await this.mediaService.saveProductPhotosBatch({
      ...body,
      createdBy: body.createdBy || user.id
    }));
  }

  async uploadPhotoManifest(req, res) {
    const user = await this.ensurePermission(req, "upload_media");
    const body = await readJsonBody(req);
    sendJson(res, 201, await this.mediaService.savePhotoManifest({
      ...body,
      createdBy: body.createdBy || user.id
    }));
  }

  async listPhotos(req, res, url) {
    await this.ensurePermission(req, "upload_media");
    sendJson(res, 200, await this.mediaService.listProductPhotos({
      productId: url.searchParams.get("productId"),
      sku: url.searchParams.get("sku")
    }));
  }

  async setPrimaryPhoto(req, res, photoId) {
    const user = await this.ensurePermission(req, "upload_media");
    sendJson(res, 200, await this.mediaService.setPrimaryPhoto({
      photoId,
      actorId: user.id
    }));
  }

  async deletePhoto(req, res, photoId) {
    const user = await this.ensurePermission(req, "upload_media");
    sendJson(res, 200, await this.mediaService.deletePhoto({
      photoId,
      actorId: user.id
    }));
  }

  async scheduleReport(req, res) {
    await this.ensurePermission(req, "reports");
    const body = await readJsonBody(req);
    sendJson(res, 202, await this.backgroundJobService.enqueue(
      "scheduled_pdf_report",
      {
        filters: body.filters || {},
        schedule: body.schedule || null
      },
      body.runAt
    ));
  }

  async ensureAdminAccess(req) {
    const userId = req.headers["x-user-id"];
    const telegramId = req.headers["x-telegram-id"];

    const user = userId
      ? await this.authService.getUser(String(userId))
      : telegramId
        ? await this.authService.findByTelegramId(String(telegramId))
        : null;

    if (!user || !this.authService.can(user, "admin_panel")) {
      throw new HttpError(403, "Admin panel access denied");
    }

    return user;
  }

  async ensurePermission(req, permission) {
    const user = await this.ensureAdminAccess(req);
    if (!this.authService.can(user, permission)) {
      throw new HttpError(403, `Permission denied: ${permission}`);
    }
    return user;
  }
}

function readFilters(url) {
  return {
    periodDays: Number(url.searchParams.get("periodDays") || 30),
    warehouseId: url.searchParams.get("warehouseId"),
    employeeId: url.searchParams.get("employeeId"),
    dateFrom: url.searchParams.get("dateFrom"),
    dateTo: url.searchParams.get("dateTo")
  };
}

function sanitizeUser(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    role: user.role,
    phone: user.phone,
    permissions: user.permissions
  };
}

function getCapabilities(user, authService) {
  return {
    canImportExport: authService.can(user, "import_export"),
    canUploadMedia: authService.can(user, "upload_media"),
    canApproveRequests: authService.can(user, "request_approve"),
    canFulfillRequests: authService.can(user, "request_fulfill"),
    canReports: authService.can(user, "reports")
  };
}

function buildAdminHtml(user) {
  const userJson = JSON.stringify(sanitizeUser(user)).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Bot Sklad Admin</title>
  <style>
    :root {
      --bg: #f5efe7;
      --surface: #fffdfa;
      --surface-soft: #f8f2ea;
      --ink: #1f1f1f;
      --muted: #6e665c;
      --line: #ddd1c0;
      --accent: #0d6b5f;
      --accent-soft: #e4f3ef;
      --warn: #cb6c2d;
      --warn-soft: #fff0e4;
      --danger: #b24040;
      --danger-soft: #fdeceb;
      --shadow: 0 16px 40px rgba(0, 0, 0, 0.06);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, #fff7ec 0, transparent 34%),
        radial-gradient(circle at top right, #e7f6f0 0, transparent 32%),
        var(--bg);
      font-family: "Segoe UI", sans-serif;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 5;
      padding: 22px 24px;
      backdrop-filter: blur(12px);
      background: rgba(255, 251, 246, 0.88);
      border-bottom: 1px solid var(--line);
    }
    header h1 { margin: 0; font-size: 30px; }
    header p { margin: 8px 0 0; color: var(--muted); }
    .shell {
      display: grid;
      gap: 18px;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      padding: 24px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 22px;
      padding: 18px;
      box-shadow: var(--shadow);
    }
    .wide { grid-column: 1 / -1; }
    h2 { margin: 0 0 14px; font-size: 20px; }
    h3 {
      margin: 18px 0 10px;
      font-size: 13px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .grid2, .grid3, .grid4, .stats {
      display: grid;
      gap: 12px;
    }
    .grid2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .grid3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .grid4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    label {
      display: block;
      margin-bottom: 6px;
      font-size: 12px;
      color: var(--muted);
    }
    input, select, textarea, button {
      width: 100%;
      border-radius: 12px;
      padding: 11px 12px;
      font: inherit;
    }
    input, select, textarea {
      border: 1px solid var(--line);
      background: white;
    }
    textarea {
      min-height: 120px;
      resize: vertical;
    }
    button {
      border: none;
      background: var(--accent);
      color: white;
      font-weight: 600;
      cursor: pointer;
    }
    button.secondary { background: var(--warn); }
    button.ghost {
      background: #efe4d6;
      color: var(--ink);
    }
    button.danger {
      background: var(--danger);
    }
    .button-row {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .pill {
      display: inline-flex;
      margin: 4px 8px 0 0;
      padding: 7px 10px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 12px;
    }
    .stat {
      border: 1px solid #eadfce;
      border-radius: 18px;
      background: var(--surface-soft);
      padding: 14px;
    }
    .stat span {
      display: block;
      color: var(--muted);
      font-size: 13px;
    }
    .stat strong {
      display: block;
      margin-top: 6px;
      font-size: 26px;
    }
    .table-wrap {
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 16px;
    }
    table {
      width: 100%;
      min-width: 560px;
      border-collapse: collapse;
    }
    th, td {
      padding: 11px 12px;
      border-bottom: 1px solid #eee3d5;
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }
    th {
      background: #faf4eb;
      color: var(--muted);
      font-weight: 600;
    }
    tr:last-child td { border-bottom: none; }
    .subtle {
      color: var(--muted);
      font-size: 12px;
    }
    .notice {
      border-radius: 16px;
      padding: 14px;
      background: var(--surface-soft);
      border: 1px solid var(--line);
    }
    .notice.success {
      background: var(--accent-soft);
      border-color: #b8ddd5;
    }
    .notice.warn {
      background: var(--warn-soft);
      border-color: #f0c39f;
    }
    .notice.error {
      background: var(--danger-soft);
      border-color: #eab7b4;
    }
    .photo-grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }
    .photo-card {
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 12px;
      background: white;
    }
    .photo-card img {
      width: 100%;
      height: 190px;
      object-fit: cover;
      border-radius: 12px;
      background: #f0ece5;
    }
    .photo-actions {
      display: grid;
      gap: 8px;
      grid-template-columns: 1fr 1fr;
      margin-top: 10px;
    }
    .summary-list {
      display: grid;
      gap: 10px;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 12px;
      background: var(--surface-soft);
    }
    .summary-row strong { font-size: 18px; }
    .empty {
      padding: 18px;
      border: 1px dashed var(--line);
      border-radius: 16px;
      text-align: center;
      color: var(--muted);
    }
    .step {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
      color: var(--muted);
      font-size: 13px;
    }
    .step b {
      width: 24px;
      height: 24px;
      display: inline-grid;
      place-items: center;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
    }
    @media (max-width: 980px) {
      .grid2, .grid3, .grid4, .stats, .button-row {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>Bot Sklad Admin</h1>
    <p id="who"></p>
  </header>
  <main class="shell">
    <section class="card wide">
      <h2>Права доступа</h2>
      <div id="permissions"></div>
    </section>

    <section class="card wide">
      <h2>Фильтры отчётов</h2>
      <div class="grid4">
        <div>
          <label for="periodDays">Период</label>
          <select id="periodDays">
            <option value="7">7 дней</option>
            <option value="30" selected>30 дней</option>
            <option value="90">90 дней</option>
          </select>
        </div>
        <div>
          <label for="warehouseId">Склад</label>
          <select id="warehouseId"><option value="">Все склады</option></select>
        </div>
        <div>
          <label for="employeeId">Сотрудник</label>
          <select id="employeeId"><option value="">Все сотрудники</option></select>
        </div>
        <div>
          <label for="requestStatus">Статус заявки</label>
          <select id="requestStatus">
            <option value="">Все</option>
            <option value="pending">Ожидают</option>
            <option value="approved">Согласованы</option>
            <option value="fulfilled">Выполнены</option>
            <option value="rejected">Отклонены</option>
          </select>
        </div>
      </div>
      <div class="grid2" style="margin-top: 12px;">
        <div>
          <label for="dateFrom">Дата с</label>
          <input id="dateFrom" type="date" />
        </div>
        <div>
          <label for="dateTo">Дата по</label>
          <input id="dateTo" type="date" />
        </div>
      </div>
      <div class="button-row" style="margin-top: 12px;">
        <button onclick="loadDashboard()">Обновить отчёты</button>
        <button class="secondary" onclick="schedulePdf()">Запланировать PDF-отчёт</button>
      </div>
    </section>

    <section class="card wide">
      <h2>Ключевые показатели</h2>
      <div id="stats" class="stats"></div>
    </section>

    <section class="card wide">
      <h2>Сводка движений</h2>
      <div class="grid2">
        <div>
          <h3>Основные метрики</h3>
          <div id="summaryMetrics" class="summary-list"></div>
        </div>
        <div>
          <h3>Статусы заявок</h3>
          <div id="requestMetrics" class="summary-list"></div>
        </div>
      </div>
      <h3>Топ товаров</h3>
      <div class="table-wrap"><table id="topProductsTable"></table></div>
      <h3>Активность сотрудников</h3>
      <div class="table-wrap"><table id="userActivityTable"></table></div>
      <h3>Срез по складам</h3>
      <div class="table-wrap"><table id="warehouseTable"></table></div>
      <h3>Оборот по категориям</h3>
      <div class="table-wrap"><table id="categoryTable"></table></div>
      <h3>Минимальные остатки</h3>
      <div class="table-wrap"><table id="lowStockTable"></table></div>
      <h3>Движение по дням</h3>
      <div class="table-wrap"><table id="timelineTable"></table></div>
    </section>

    <section class="card wide">
      <h2>Заявки на выдачу</h2>
      <div class="table-wrap"><table id="requestsTable"></table></div>
    </section>

    <section class="card">
      <h2>Импорт Excel через пошаговую проверку</h2>
      <div class="step"><b>1</b><span>Загрузите файл и выполните проверку структуры и строк.</span></div>
      <input id="importFile" type="file" accept=".xlsx,.xls" />
      <div class="button-row" style="margin-top: 12px;">
        <button onclick="validateImport()">Проверить файл</button>
        <button class="secondary" onclick="confirmImport()">Подтвердить импорт</button>
      </div>
      <div id="importStatus" class="notice" style="margin-top: 12px;">Файл ещё не проверялся.</div>
      <h3>Предпросмотр строк</h3>
      <div class="table-wrap"><table id="importPreviewTable"></table></div>
    </section>

    <section class="card">
      <h2>Массовая загрузка фото</h2>
      <h3>Файлы по списку SKU</h3>
      <label for="photoSkus">SKU по одному на строку</label>
      <textarea id="photoSkus" placeholder="34567&#10;98765"></textarea>
      <input id="photoFiles" type="file" accept="image/*" multiple />
      <button style="margin-top: 12px;" onclick="uploadPhotoBatch()">Загрузить фото</button>
      <h3>Привязка фото по URL</h3>
      <label for="photoManifest">Формат: SKU | URL</label>
      <textarea id="photoManifest" placeholder="34567 | https://example.com/bolt.jpg"></textarea>
      <button class="ghost" onclick="uploadPhotoManifest()">Загрузить по URL</button>
      <div id="photoStatus" class="notice" style="margin-top: 12px;">Здесь появится результат загрузки фото.</div>
    </section>

    <section class="card wide">
      <h2>Просмотр и управление фото товара</h2>
      <div class="grid3">
        <div>
          <label for="managePhotoSku">SKU</label>
          <input id="managePhotoSku" placeholder="Например, 34567" />
        </div>
        <div>
          <label for="managePhotoProductId">ID товара</label>
          <input id="managePhotoProductId" placeholder="Если нужен поиск по ID" />
        </div>
        <div style="display: flex; align-items: end;">
          <button onclick="loadPhotos()">Показать фото</button>
        </div>
      </div>
      <div id="photoGallery" class="photo-grid" style="margin-top: 14px;"></div>
    </section>

    <section class="card">
      <h2>Планировщик PDF-отчётов</h2>
      <div class="grid2">
        <div>
          <label for="scheduleFrequency">Частота</label>
          <select id="scheduleFrequency">
            <option value="daily">Ежедневно</option>
            <option value="weekly">Еженедельно</option>
          </select>
        </div>
        <div>
          <label for="scheduleTime">Время</label>
          <input id="scheduleTime" type="time" value="09:00" />
        </div>
      </div>
      <div id="scheduleStatus" class="notice" style="margin-top: 12px;">Планировщик ещё не запускался.</div>
    </section>
  </main>

  <script>
    const currentUser = ${userJson};
    let lastPreviewToken = null;

    function authHeaders() {
      return {
        "Content-Type": "application/json",
        "x-user-id": currentUser.id
      };
    }

    async function fetchJson(url, options = {}) {
      const response = await fetch(url, options);
      const text = await response.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }

      if (!response.ok) {
        throw new Error(data.error || data.message || text || "Request failed");
      }

      return data;
    }

    function filtersQuery() {
      const params = new URLSearchParams();
      const values = {
        periodDays: document.getElementById("periodDays").value,
        warehouseId: document.getElementById("warehouseId").value,
        employeeId: document.getElementById("employeeId").value,
        requestStatus: document.getElementById("requestStatus").value,
        dateFrom: document.getElementById("dateFrom").value,
        dateTo: document.getElementById("dateTo").value
      };

      for (const [key, value] of Object.entries(values)) {
        if (value) {
          params.set(key, value);
        }
      }

      return params.toString();
    }

    async function loadDashboard() {
      const data = await fetchJson("/admin/api/dashboard?" + filtersQuery(), {
        headers: { "x-user-id": currentUser.id }
      });

      document.getElementById("who").textContent = currentUser.fullName + " • " + currentUser.role;
      document.getElementById("permissions").innerHTML = currentUser.permissions
        .map((permission) => '<span class="pill">' + escapeHtml(permission) + '</span>')
        .join("");

      renderStats([
        ["Товаров", data.stats.totalProducts],
        ["Всего на складе", data.stats.totalQuantity],
        ["Принято сегодня", data.stats.receiptsToday],
        ["Выдано сегодня", data.stats.issuesToday]
      ]);

      hydrateSelect(
        "warehouseId",
        data.warehouses.map((item) => ({ value: item.id, label: item.name })),
        "Все склады"
      );
      hydrateSelect(
        "employeeId",
        data.employees.map((item) => ({ value: item.id, label: item.fullName + " (" + item.role + ")" })),
        "Все сотрудники"
      );

      renderSummaryList("summaryMetrics", [
        ["Поступления", data.analytics.summary.receipts],
        ["Выдачи", data.analytics.summary.issues],
        ["Перемещения", data.analytics.summary.moves],
        ["Ревизии", data.analytics.summary.audits],
        ["Уникальные товары", data.analytics.summary.uniqueProducts],
        ["Активные сотрудники", data.analytics.summary.activeEmployees]
      ]);
      renderSummaryList("requestMetrics", [
        ["Ожидают", data.analytics.requestSummary.pending],
        ["Согласованы", data.analytics.requestSummary.approved],
        ["Выполнены", data.analytics.requestSummary.fulfilled],
        ["Отклонены", data.analytics.requestSummary.rejected]
      ]);

      renderTable("topProductsTable", ["Товар", "Артикул", "Оборот"], (data.analytics.topProducts || []).map((item) => [
        item.name,
        item.sku,
        item.total
      ]));
      renderTable("userActivityTable", ["Сотрудник", "Действий"], (data.analytics.userActivity || []).map((item) => [
        item.fullName,
        item.actions
      ]));
      renderTable("warehouseTable", ["Склад", "Код", "Товаров", "Количество"], (data.analytics.warehouseSnapshot || []).map((item) => [
        item.name,
        item.code,
        item.productCount,
        item.totalQuantity
      ]));
      renderTable("categoryTable", ["Категория", "Приход", "Расход"], (data.analytics.categoryTurnover || []).map((item) => [
        item.name,
        item.receipts,
        item.issues
      ]));
      renderTable("lowStockTable", ["Товар", "Артикул", "Остаток", "Мин. остаток"], (data.analytics.lowStock || []).map((item) => [
        item.name,
        item.sku,
        item.totalQuantity,
        item.minStock
      ]));
      renderTable("timelineTable", ["Дата", "Тип", "Количество"], (data.analytics.movementTimeline || []).map((item) => [
        item.day,
        item.type,
        item.total
      ]));
      renderTable("requestsTable", ["ID", "Товар", "SKU", "Кол-во", "Статус", "Приоритет", "Запросил", "Ячейка"], (data.requests || []).map((item) => [
        item.id,
        item.productName,
        item.productSku,
        item.requestedQty,
        item.status,
        item.priority,
        item.requestedByName || "",
        item.preferredCellCode || ""
      ]));
    }

    function renderStats(items) {
      const root = document.getElementById("stats");
      root.innerHTML = items.map(([label, value]) =>
        '<div class="stat"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(String(value ?? 0)) + "</strong></div>"
      ).join("");
    }

    function renderSummaryList(id, rows) {
      const root = document.getElementById(id);
      root.innerHTML = rows.map(([label, value]) =>
        '<div class="summary-row"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(String(value ?? 0)) + "</strong></div>"
      ).join("");
    }

    function hydrateSelect(id, items, defaultLabel) {
      const select = document.getElementById(id);
      const currentValue = select.value;
      select.innerHTML =
        '<option value="">' + escapeHtml(defaultLabel) + "</option>" +
        items.map((item) => '<option value="' + escapeAttribute(item.value) + '">' + escapeHtml(item.label) + "</option>").join("");
      if (currentValue) {
        select.value = currentValue;
      }
    }

    function renderTable(id, headers, rows) {
      const table = document.getElementById(id);
      const headerHtml = "<thead><tr>" + headers.map((header) => "<th>" + escapeHtml(header) + "</th>").join("") + "</tr></thead>";
      const bodyHtml = rows.length
        ? "<tbody>" + rows.map((row) => "<tr>" + row.map((cell) => "<td>" + escapeHtml(String(cell ?? "")) + "</td>").join("") + "</tr>").join("") + "</tbody>"
        : '<tbody><tr><td colspan="' + headers.length + '" class="subtle">Нет данных</td></tr></tbody>';
      table.innerHTML = headerHtml + bodyHtml;
    }

    function renderNotice(id, type, title, details) {
      const root = document.getElementById(id);
      root.className = "notice " + type;
      root.innerHTML = "<strong>" + escapeHtml(title) + "</strong>" + (details.length
        ? "<div style=\\"margin-top:8px\\">" + details.map((line) => "<div class=\\"subtle\\">" + escapeHtml(line) + "</div>").join("") + "</div>"
        : "");
    }

    function arrayBufferToBase64(buffer) {
      let binary = "";
      const bytes = new Uint8Array(buffer);
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      return btoa(binary);
    }

    async function validateImport() {
      try {
        const file = document.getElementById("importFile").files[0];
        if (!file) {
          throw new Error("Выберите Excel-файл");
        }

        const base64Data = arrayBufferToBase64(await file.arrayBuffer());
        const result = await fetchJson("/admin/api/import/validate", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ base64Data })
        });

        lastPreviewToken = result.previewToken;
        renderNotice(
          "importStatus",
          result.canImport ? "success" : "warn",
          result.canImport ? "Файл готов к импорту" : "Файл требует исправлений",
          [
            "Строк всего: " + (result.summary?.totalRows || 0),
            "Готово: " + (result.summary?.validRows || 0),
            "С ошибками: " + (result.summary?.errorRows || 0),
            "С предупреждениями: " + (result.summary?.warningRows || 0),
            ...((result.errors || []).slice(0, 4).map((item) => "Ошибка, строка " + item.row + ": " + item.message)),
            ...((result.warnings || []).slice(0, 4).map((item) => "Предупреждение, строка " + item.row + ": " + item.message))
          ]
        );

        renderTable("importPreviewTable", ["Строка", "SKU", "Название", "Количество", "Статус"], (result.rows || []).map((row) => [
          row.rowNumber,
          row.sku,
          row.name,
          row.quantity,
          row.isValid ? "Готово" : "Ошибка"
        ]));
      } catch (error) {
        renderNotice("importStatus", "error", "Проверка не выполнена", [error.message]);
      }
    }

    async function confirmImport() {
      try {
        if (!lastPreviewToken) {
          throw new Error("Сначала выполните проверку файла");
        }

        const result = await fetchJson("/admin/api/import/confirm", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ previewToken: lastPreviewToken })
        });

        renderNotice("importStatus", "success", "Импорт завершён", [
          "Импортировано строк: " + (result.importedCount || 0),
          "Пропущено: " + (result.skippedCount || 0)
        ]);
        lastPreviewToken = null;
        await loadDashboard();
      } catch (error) {
        renderNotice("importStatus", "error", "Импорт не выполнен", [error.message]);
      }
    }

    async function uploadPhotoBatch() {
      try {
        const files = Array.from(document.getElementById("photoFiles").files || []);
        const skus = document.getElementById("photoSkus").value
          .split(/\\r?\\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        if (!files.length) {
          throw new Error("Выберите файлы изображений");
        }
        if (files.length !== skus.length) {
          throw new Error("Количество SKU должно совпадать с количеством файлов");
        }

        const items = [];
        for (let index = 0; index < files.length; index += 1) {
          const file = files[index];
          items.push({
            sku: skus[index],
            fileName: file.name,
            mimeType: file.type || "image/jpeg",
            base64Data: arrayBufferToBase64(await file.arrayBuffer())
          });
        }

        const result = await fetchJson("/admin/api/photos/batch", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ items })
        });

        renderNotice("photoStatus", result.errorCount ? "warn" : "success", "Загрузка фото завершена", [
          "Успешно: " + result.uploadedCount,
          "Ошибок: " + result.errorCount,
          ...((result.errors || []).slice(0, 4).map((item) => "Позиция " + item.item + ": " + item.message))
        ]);
      } catch (error) {
        renderNotice("photoStatus", "error", "Фото не загружены", [error.message]);
      }
    }

    async function uploadPhotoManifest() {
      try {
        const manifestText = document.getElementById("photoManifest").value.trim();
        if (!manifestText) {
          throw new Error("Введите строки в формате SKU | URL");
        }

        const result = await fetchJson("/admin/api/photos/manifest", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ manifestText })
        });

        renderNotice("photoStatus", result.errorCount ? "warn" : "success", "Привязка фото завершена", [
          "Успешно: " + result.uploadedCount,
          "Ошибок: " + result.errorCount,
          ...((result.errors || []).slice(0, 4).map((item) => "Позиция " + item.item + ": " + item.message))
        ]);
      } catch (error) {
        renderNotice("photoStatus", "error", "Привязка не выполнена", [error.message]);
      }
    }

    async function loadPhotos() {
      try {
        const sku = document.getElementById("managePhotoSku").value.trim();
        const productId = document.getElementById("managePhotoProductId").value.trim();
        if (!sku && !productId) {
          throw new Error("Укажите SKU или ID товара");
        }

        const query = new URLSearchParams();
        if (sku) {
          query.set("sku", sku);
        }
        if (productId) {
          query.set("productId", productId);
        }

        const photos = await fetchJson("/admin/api/photos?" + query.toString(), {
          headers: { "x-user-id": currentUser.id }
        });

        renderPhotoGallery(photos);
      } catch (error) {
        document.getElementById("photoGallery").innerHTML = '<div class="empty">' + escapeHtml(error.message) + "</div>";
      }
    }

    function renderPhotoGallery(photos) {
      const root = document.getElementById("photoGallery");
      if (!photos.length) {
        root.innerHTML = '<div class="empty">Фото для выбранного товара не найдены.</div>';
        return;
      }

      root.innerHTML = photos.map((photo) => (
        '<div class="photo-card">' +
          '<img src="' + escapeAttribute(photo.filePath) + '" alt="' + escapeAttribute(photo.fileName) + '" />' +
          '<div style="margin-top:10px;"><strong>' + escapeHtml(photo.fileName) + '</strong></div>' +
          '<div class="subtle">ID: ' + escapeHtml(photo.id) + '</div>' +
          '<div class="subtle">Основное фото: ' + escapeHtml(photo.isPrimary ? "Да" : "Нет") + '</div>' +
          '<div class="subtle">Тип: ' + escapeHtml(photo.mimeType || "") + '</div>' +
          '<div class="photo-actions">' +
            '<button onclick="setPrimaryPhoto(\\'' + escapeJs(photo.id) + '\\')">Сделать основным</button>' +
            '<button class="danger" onclick="deletePhoto(\\'' + escapeJs(photo.id) + '\\')">Удалить</button>' +
          '</div>' +
        '</div>'
      )).join("");
    }

    async function setPrimaryPhoto(photoId) {
      await fetchJson("/admin/api/photos/" + encodeURIComponent(photoId) + "/primary", {
        method: "POST",
        headers: authHeaders()
      });
      await loadPhotos();
    }

    async function deletePhoto(photoId) {
      await fetchJson("/admin/api/photos/" + encodeURIComponent(photoId), {
        method: "DELETE",
        headers: { "x-user-id": currentUser.id }
      });
      await loadPhotos();
    }

    async function schedulePdf() {
      try {
        const [hour, minute] = document.getElementById("scheduleTime").value.split(":").map(Number);
        const result = await fetchJson("/admin/api/reports/schedule", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            filters: {
              periodDays: Number(document.getElementById("periodDays").value),
              warehouseId: document.getElementById("warehouseId").value || null,
              employeeId: document.getElementById("employeeId").value || null,
              dateFrom: document.getElementById("dateFrom").value || null,
              dateTo: document.getElementById("dateTo").value || null
            },
            schedule: {
              frequency: document.getElementById("scheduleFrequency").value,
              hour,
              minute
            }
          })
        });

        renderNotice("scheduleStatus", "success", "PDF-отчёт поставлен в очередь", [
          "Задание: " + (result.id || "создано"),
          "Следующий запуск будет выполнен по расписанию."
        ]);
      } catch (error) {
        renderNotice("scheduleStatus", "error", "Не удалось поставить отчёт в очередь", [error.message]);
      }
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    function escapeAttribute(value) {
      return escapeHtml(String(value ?? ""));
    }

    function escapeJs(value) {
      return String(value).replaceAll("\\\\", "\\\\\\\\").replaceAll("'", "\\\\'");
    }

    loadDashboard().catch((error) => {
      document.getElementById("stats").innerHTML = '<div class="empty">' + escapeHtml(error.message) + "</div>";
    });
  </script>
</body>
</html>`;
}
