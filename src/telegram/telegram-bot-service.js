import { HttpError } from "../middlewares/http-error.js";
import { formatDateTime, formatNumber } from "../utils/text.js";
import {
  authKeyboard,
  backHomeKeyboard,
  cellsKeyboard,
  confirmKeyboard,
  issueMenuKeyboard,
  mainMenuKeyboard,
  priorityKeyboard,
  productCardKeyboard,
  productsKeyboard,
  reportCenterKeyboard,
  reportFilterKeyboard,
  requestCardKeyboard,
  requestListKeyboard,
  searchResultsKeyboard,
  settingsKeyboard,
  skipCommentKeyboard
} from "./telegram-ui.js";

const ROLE_LABELS = {
  admin: "Администратор",
  supervisor: "Руководитель",
  keeper: "Кладовщик",
  auditor: "Ревизор"
};

export class TelegramBotService {
  constructor({
    authService,
    inventoryService,
    requestService = null,
    reportService = null,
    backgroundJobService = null,
    mediaService = null,
    importExportService = null,
    telegramGateway,
    sessionStore
  }) {
    this.authService = authService;
    this.inventoryService = inventoryService;
    this.requestService = requestService;
    this.reportService = reportService;
    this.backgroundJobService = backgroundJobService;
    this.mediaService = mediaService;
    this.importExportService = importExportService;
    this.telegramGateway = telegramGateway;
    this.sessionStore = sessionStore;
  }

  async processUpdate(update) {
    if (update.callback_query) {
      return this.processCallback(update.callback_query);
    }

    const message = update.message || update.edited_message;
    if (!message) {
      return [];
    }

    return this.processMessage(message);
  }

  async processMessage(message) {
    const chatId = message.chat?.id;
    const telegramUserId = message.from?.id;
    const telegramUsername = message.from?.username || "";
    const text = String(message.text || "").trim();

    if (!chatId || !telegramUserId) {
      return [];
    }

    if (text === "/start") {
      const user = await this.resolveTelegramUser(telegramUserId, {
        telegramUsername,
        firstName: message.from?.first_name || "",
        lastName: message.from?.last_name || ""
      });
      if (!user) {
        throw new HttpError(503, "No active users available for Telegram bot access");
      }

      this.resetTransientState(telegramUserId);
      return this.sendReplies(chatId, [{
        text: `Bot Sklad готов к работе.\nАвторизация больше не требуется.\nПрофиль: ${user.fullName}\nРоль: ${ROLE_LABELS[user.role] || user.role}`,
        extra: mainMenuKeyboard()
      }]);
    }

    if (text === "/start") {
      return this.sendReplies(chatId, [{
        text: "Bot Sklad готов к работе. Нажмите кнопку авторизации и войдите по номеру телефона.",
        extra: authKeyboard()
      }]);
    }

    if (text.startsWith("/login ")) {
      const phone = text.slice(7).trim();
      const user = await this.authService.loginByPhone({ phone, telegramUserId, telegramUsername });
      return this.sendReplies(chatId, [{
        text: `Авторизация успешна.\n${user.fullName}\nРоль: ${ROLE_LABELS[user.role] || user.role}`,
        extra: mainMenuKeyboard()
      }]);
    }

    const user = await this.resolveTelegramUser(telegramUserId, {
      telegramUsername,
      firstName: message.from?.first_name || "",
      lastName: message.from?.last_name || ""
    });
    const session = this.sessionStore.get(telegramUserId);

    if (!user) {
      return this.sendReplies(chatId, [{
        text: "Сначала авторизуйтесь. Нажмите кнопку авторизации.",
        extra: authKeyboard()
      }]);
    }

    if (session.mode === "await_login_phone") {
      const loggedIn = await this.authService.loginByPhone({ phone: text, telegramUserId, telegramUsername });
      this.sessionStore.clear(telegramUserId);
      return this.sendReplies(chatId, [{
        text: `Авторизация успешна.\n${loggedIn.fullName}\nРоль: ${ROLE_LABELS[loggedIn.role] || loggedIn.role}`,
        extra: mainMenuKeyboard()
      }]);
    }

    if (message.document) {
      return this.handleDocumentMessage(chatId, telegramUserId, user, message.document);
    }

    if (session.mode === "await_search_query") {
      return this.handleSearchInput(chatId, telegramUserId, text);
    }

    if (session.mode === "await_receipt_quantity") {
      const quantity = this.parsePositiveQuantity(text, "Введите корректное количество для приемки.");
      this.sessionStore.set(telegramUserId, { mode: "confirm_receipt", receiptQuantity: quantity });
      return this.sendReplies(chatId, [{
        text: `Подтвердить приемку ${formatNumber(quantity)} шт?`,
        extra: confirmKeyboard("receipt", `product:view:${session.receiptProductId}`)
      }]);
    }

    if (session.mode === "await_issue_quantity") {
      const quantity = this.parsePositiveQuantity(text, "Введите корректное количество для выдачи.");
      this.sessionStore.set(telegramUserId, { mode: "await_issue_target", issueQuantity: quantity });
      return this.sendReplies(chatId, [{
        text: "Укажите, кому выдаем товар.",
        extra: backHomeKeyboard("menu:issue")
      }]);
    }

    if (session.mode === "await_issue_target") {
      this.sessionStore.set(telegramUserId, { mode: "confirm_issue", issueTarget: text });
      return this.sendReplies(chatId, [{
        text: `Подтвердить выдачу для "${text}"?`,
        extra: confirmKeyboard("issue", `product:view:${session.issueProductId}`)
      }]);
    }

    if (session.mode === "await_move_quantity") {
      const quantity = this.parsePositiveQuantity(text, "Введите корректное количество для перемещения.");
      this.sessionStore.set(telegramUserId, { mode: "confirm_move", moveQuantity: quantity });
      return this.sendReplies(chatId, [{
        text: `Подтвердить перемещение ${formatNumber(quantity)} шт?`,
        extra: confirmKeyboard("move", `product:view:${session.moveProductId}`)
      }]);
    }

    if (session.mode === "await_audit_quantity") {
      const quantity = this.parseNonNegativeQuantity(text, "Введите фактический остаток числом.");
      this.sessionStore.set(telegramUserId, { mode: "confirm_audit", auditQuantity: quantity });
      return this.sendReplies(chatId, [{
        text: `Подтвердить ревизию. Фактический остаток: ${formatNumber(quantity)}?`,
        extra: confirmKeyboard("audit", `product:view:${session.auditProductId}`)
      }]);
    }

    if (session.mode === "await_request_quantity") {
      const quantity = this.parsePositiveQuantity(text, "Введите корректное количество для заявки.");
      this.sessionStore.set(telegramUserId, { mode: "select_request_priority", requestQuantity: quantity });
      return this.sendReplies(chatId, [{
        text: "Выберите приоритет заявки.",
        extra: priorityKeyboard("menu:issue")
      }]);
    }

    if (session.mode === "await_request_comment") {
      this.sessionStore.set(telegramUserId, {
        mode: "confirm_request_create",
        requestComment: text
      });
      return this.sendReplies(chatId, [{
        text: this.formatRequestDraft(this.sessionStore.get(telegramUserId)),
        extra: confirmKeyboard("request_create", "menu:issue")
      }]);
    }

    if (session.mode === "await_request_reject_reason") {
      this.requireFeature(this.requestService, "Request service is not configured");
      const rejected = await this.requestService.rejectRequest(session.rejectRequestId, user.id, text);
      this.sessionStore.clear(telegramUserId);
      return this.sendReplies(chatId, [{
        text: `Заявка ${rejected.id} отклонена.\nПричина: ${text}`,
        extra: mainMenuKeyboard()
      }]);
    }

    if (session.mode === "await_photo_manifest") {
      this.requireFeature(this.mediaService, "Media service is not configured");
      const result = await this.mediaService.savePhotoManifest({
        manifestText: text,
        createdBy: user.id
      });
      this.resetTransientState(telegramUserId);
      return this.sendReplies(chatId, [{
        text: [
          "Массовая загрузка фото завершена.",
          `Успешно: ${result.uploadedCount}`,
          `Ошибок: ${result.errorCount}`
        ].join("\n"),
        extra: mainMenuKeyboard()
      }]);
    }

    if (text === "/menu") {
      return this.sendReplies(chatId, [{ text: "Главное меню WMS.", extra: mainMenuKeyboard() }]);
    }

    if (text.startsWith("/find ")) {
      const results = await this.inventoryService.searchProducts(text.slice(6).trim());
      return this.sendReplies(chatId, [{
        text: results.length ? "Результаты поиска:" : "Ничего не найдено.",
        extra: results.length ? searchResultsKeyboard(results, "view") : backHomeKeyboard()
      }]);
    }

    if (text === "/stock") {
      return this.sendLowStock(chatId);
    }

    if (text.startsWith("/history ")) {
      const results = await this.inventoryService.searchProducts(text.slice(9).trim());
      const item = results[0];
      if (!item) {
        return this.sendReplies(chatId, [{ text: "Товар не найден.", extra: backHomeKeyboard() }]);
      }

      return this.sendReplies(chatId, [{
        text: formatHistory(item.history || []),
        extra: productCardKeyboard(item.product.id)
      }]);
    }

    return this.sendReplies(chatId, [{
      text: "Используйте кнопки интерфейса для работы с системой.",
      extra: mainMenuKeyboard()
    }]);
  }

  async processCallback(callbackQuery) {
    const chatId = callbackQuery.message?.chat?.id;
    const telegramUserId = callbackQuery.from?.id;
    const data = callbackQuery.data || "";

    if (!chatId || !telegramUserId) {
      return [];
    }

    await this.telegramGateway.answerCallbackQuery(callbackQuery.id);

    if (data === "auth:start") {
      return this.sendReplies(chatId, [{
        text: "Авторизация отключена. Используйте главное меню.",
        extra: mainMenuKeyboard()
      }]);
    }

    if (data === "auth:start") {
      this.sessionStore.set(telegramUserId, { mode: "await_login_phone" });
      return this.sendReplies(chatId, [{
        text: "Введите номер телефона в формате +79990000001.",
        extra: backHomeKeyboard()
      }]);
    }

    const telegramUsername = callbackQuery.from?.username || "";
    const user = await this.resolveTelegramUser(telegramUserId, {
      telegramUsername,
      firstName: callbackQuery.from?.first_name || "",
      lastName: callbackQuery.from?.last_name || ""
    });
    if (!user) {
      return this.sendReplies(chatId, [{
        text: "Сначала авторизуйтесь.",
        extra: authKeyboard()
      }]);
    }

    if (data === "menu:main") {
      this.resetTransientState(telegramUserId);
      return this.sendReplies(chatId, [{ text: "Главное меню WMS.", extra: mainMenuKeyboard() }]);
    }

    if (data === "menu:products") {
      const products = await this.inventoryService.listProducts(20, 0);
      return this.sendReplies(chatId, [{ text: "Список товаров:", extra: productsKeyboard(products, "view") }]);
    }

    if (data === "menu:search") {
      this.sessionStore.set(telegramUserId, { mode: "await_search_query", pendingAction: "view" });
      return this.sendReplies(chatId, [{
        text: "Введите название, артикул, QR или штрихкод для поиска.",
        extra: backHomeKeyboard()
      }]);
    }

    if (data === "menu:receipt") {
      this.ensurePermission(user, "receipt", "У вас нет доступа к приемке.");
      this.sessionStore.set(telegramUserId, { mode: "await_search_query", pendingAction: "receipt" });
      return this.sendReplies(chatId, [{
        text: "Введите товар для приемки, затем выберите позицию.",
        extra: backHomeKeyboard()
      }]);
    }

    if (data === "menu:move") {
      this.ensurePermission(user, "move", "У вас нет доступа к перемещениям.");
      this.sessionStore.set(telegramUserId, { mode: "await_search_query", pendingAction: "move" });
      return this.sendReplies(chatId, [{
        text: "Введите товар для перемещения, затем выберите позицию.",
        extra: backHomeKeyboard()
      }]);
    }

    if (data === "menu:audit") {
      this.ensurePermission(user, "audit", "У вас нет доступа к ревизии.");
      this.sessionStore.set(telegramUserId, { mode: "await_search_query", pendingAction: "audit" });
      return this.sendReplies(chatId, [{
        text: "Введите товар для ревизии, затем выберите позицию.",
        extra: backHomeKeyboard()
      }]);
    }

    if (data === "menu:issue") {
      return this.sendIssueMenu(chatId, telegramUserId, user);
    }

    if (data === "issue:direct") {
      this.ensurePermission(user, "issue", "У вас нет доступа к прямой выдаче.");
      this.sessionStore.set(telegramUserId, { mode: "await_search_query", pendingAction: "issue" });
      return this.sendReplies(chatId, [{
        text: "Введите товар для выдачи, затем выберите позицию.",
        extra: backHomeKeyboard("menu:issue")
      }]);
    }

    if (data === "issue:request") {
      this.ensurePermission(user, "request_create", "У вас нет доступа к созданию заявок.");
      this.requireFeature(this.requestService, "Request service is not configured");
      this.sessionStore.set(telegramUserId, { mode: "await_search_query", pendingAction: "request" });
      return this.sendReplies(chatId, [{
        text: "Введите товар для заявки на выдачу.",
        extra: backHomeKeyboard("menu:issue")
      }]);
    }

    if (data === "menu:stock") {
      return this.sendLowStock(chatId);
    }

    if (data === "menu:reports") {
      this.ensurePermission(user, "reports", "У вас нет доступа к отчетам.");
      return this.sendReportCenter(chatId, telegramUserId);
    }

    if (data === "menu:qr") {
      this.sessionStore.set(telegramUserId, { mode: "await_search_query", pendingAction: "view" });
      return this.sendReplies(chatId, [{
        text: "Отправьте текст QR-кода или штрихкода для поиска товара.",
        extra: backHomeKeyboard()
      }]);
    }

    if (data === "menu:settings") {
      return this.sendReplies(chatId, [{
        text: `Настройки профиля:\nРоль: ${ROLE_LABELS[user.role] || user.role}\nТелефон: ${user.phone}`,
        extra: settingsKeyboard({
          canUploadMedia: this.authService.can(user, "upload_media"),
          canImportExport: this.authService.can(user, "import_export")
        })
      }]);
    }

    if (data === "settings:photo-batch") {
      this.ensurePermission(user, "upload_media", "У вас нет доступа к загрузке фото.");
      this.requireFeature(this.mediaService, "Media service is not configured");
      this.sessionStore.set(telegramUserId, { mode: "await_photo_manifest" });
      return this.sendReplies(chatId, [{
        text: "Отправьте манифест в формате:\nSKU | https://example.com/photo.jpg\nКаждая строка — отдельный товар.",
        extra: backHomeKeyboard("menu:settings")
      }]);
    }

    if (data === "settings:excel-import") {
      this.ensurePermission(user, "import_export", "У вас нет доступа к импорту Excel.");
      this.requireFeature(this.importExportService, "Import service is not configured");
      this.sessionStore.set(telegramUserId, { mode: "await_excel_import_document" });
      return this.sendReplies(chatId, [{
        text: "Отправьте Excel-файл документом (.xlsx или .xls). Сначала я проверю файл, потом предложу подтвердить импорт.",
        extra: backHomeKeyboard("menu:settings")
      }]);
    }

    if (data.startsWith("product:view:")) {
      return this.sendProductCard(chatId, data.split(":")[2]);
    }

    if (data.startsWith("product:history:")) {
      const productId = data.split(":")[2];
      const product = await this.inventoryService.getProductById(productId);
      return this.sendReplies(chatId, [{
        text: formatHistory(product.history),
        extra: productCardKeyboard(productId)
      }]);
    }

    if (data.startsWith("product:receipt:")) {
      this.ensurePermission(user, "receipt", "У вас нет доступа к приемке.");
      const productId = data.split(":")[2];
      const cells = await this.inventoryService.listCells();
      this.sessionStore.set(telegramUserId, { mode: "select_receipt_cell", receiptProductId: productId });
      return this.sendReplies(chatId, [{
        text: "Выберите ячейку для приемки.",
        extra: cellsKeyboard(cells, "receipt:cell", `product:view:${productId}`)
      }]);
    }

    if (data.startsWith("product:issue:")) {
      this.ensurePermission(user, "issue", "У вас нет доступа к прямой выдаче.");
      const productId = data.split(":")[2];
      const product = await this.inventoryService.getProductById(productId);
      this.sessionStore.set(telegramUserId, { mode: "select_issue_cell", issueProductId: productId });
      return this.sendReplies(chatId, [{
        text: "Выберите ячейку, из которой выдаем товар.",
        extra: cellsKeyboard(this.productCells(product), "issue:cell", `product:view:${productId}`)
      }]);
    }

    if (data.startsWith("product:move:")) {
      this.ensurePermission(user, "move", "У вас нет доступа к перемещениям.");
      const productId = data.split(":")[2];
      const product = await this.inventoryService.getProductById(productId);
      this.sessionStore.set(telegramUserId, { mode: "select_move_from_cell", moveProductId: productId });
      return this.sendReplies(chatId, [{
        text: "Выберите исходную ячейку.",
        extra: cellsKeyboard(this.productCells(product), "move:from", `product:view:${productId}`)
      }]);
    }

    if (data.startsWith("product:audit:")) {
      this.ensurePermission(user, "audit", "У вас нет доступа к ревизии.");
      const productId = data.split(":")[2];
      const product = await this.inventoryService.getProductById(productId);
      this.sessionStore.set(telegramUserId, { mode: "select_audit_cell", auditProductId: productId });
      return this.sendReplies(chatId, [{
        text: "Выберите ячейку для ревизии.",
        extra: cellsKeyboard(this.productCells(product), "audit:cell", `product:view:${productId}`)
      }]);
    }

    if (data.startsWith("product:request:")) {
      this.ensurePermission(user, "request_create", "У вас нет доступа к созданию заявок.");
      this.requireFeature(this.requestService, "Request service is not configured");
      const productId = data.split(":")[2];
      const product = await this.inventoryService.getProductById(productId);
      const cells = this.productCells(product);
      this.sessionStore.set(telegramUserId, {
        mode: "select_request_cell",
        requestProductId: productId,
        requestProductName: product.product.name,
        requestProductSku: product.product.sku
      });
      return this.sendReplies(chatId, [{
        text: cells.length ? "Выберите предпочтительную ячейку для выдачи." : "Нет доступных ячеек с остатком для заявки.",
        extra: cells.length ? cellsKeyboard(cells, "request:cell", "menu:issue") : backHomeKeyboard("menu:issue")
      }]);
    }

    if (data.startsWith("receipt:cell:")) {
      this.sessionStore.set(telegramUserId, { mode: "await_receipt_quantity", receiptCellId: data.split(":")[2] });
      return this.sendReplies(chatId, [{
        text: "Введите количество для приемки.",
        extra: backHomeKeyboard("menu:receipt")
      }]);
    }

    if (data.startsWith("issue:cell:")) {
      this.sessionStore.set(telegramUserId, { mode: "await_issue_quantity", issueCellId: data.split(":")[2] });
      return this.sendReplies(chatId, [{
        text: "Введите количество для выдачи.",
        extra: backHomeKeyboard("menu:issue")
      }]);
    }

    if (data.startsWith("move:from:")) {
      const fromCellId = data.split(":")[2];
      const cells = await this.inventoryService.listCells();
      this.sessionStore.set(telegramUserId, { mode: "select_move_to_cell", moveFromCellId: fromCellId });
      return this.sendReplies(chatId, [{
        text: "Выберите целевую ячейку.",
        extra: cellsKeyboard(cells, "move:to", "menu:move")
      }]);
    }

    if (data.startsWith("move:to:")) {
      this.sessionStore.set(telegramUserId, { mode: "await_move_quantity", moveToCellId: data.split(":")[2] });
      return this.sendReplies(chatId, [{
        text: "Введите количество для перемещения.",
        extra: backHomeKeyboard("menu:move")
      }]);
    }

    if (data.startsWith("audit:cell:")) {
      this.sessionStore.set(telegramUserId, { mode: "await_audit_quantity", auditCellId: data.split(":")[2] });
      return this.sendReplies(chatId, [{
        text: "Введите фактический остаток.",
        extra: backHomeKeyboard("menu:audit")
      }]);
    }

    if (data.startsWith("request:cell:")) {
      const requestCellId = data.split(":")[2];
      const product = await this.inventoryService.getProductById(this.sessionStore.get(telegramUserId).requestProductId);
      const selectedCell = product.locations.find((item) => item.locationId === requestCellId);
      this.sessionStore.set(telegramUserId, {
        mode: "await_request_quantity",
        requestCellId,
        requestCellCode: selectedCell?.code || requestCellId
      });
      return this.sendReplies(chatId, [{
        text: "Введите количество для заявки.",
        extra: backHomeKeyboard("menu:issue")
      }]);
    }

    if (data.startsWith("request:priority:")) {
      const priority = data.split(":")[2];
      this.sessionStore.set(telegramUserId, { mode: "await_request_comment", requestPriority: priority });
      return this.sendReplies(chatId, [{
        text: "Добавьте комментарий к заявке или пропустите этот шаг.",
        extra: skipCommentKeyboard("menu:issue")
      }]);
    }

    if (data === "request:comment:skip") {
      this.sessionStore.set(telegramUserId, {
        mode: "confirm_request_create",
        requestComment: ""
      });
      return this.sendReplies(chatId, [{
        text: this.formatRequestDraft(this.sessionStore.get(telegramUserId)),
        extra: confirmKeyboard("request_create", "menu:issue")
      }]);
    }

    if (data.startsWith("requests:list:")) {
      this.requireFeature(this.requestService, "Request service is not configured");
      const kind = data.split(":")[2];
      return this.sendRequestList(chatId, user, kind);
    }

    if (data.startsWith("request:view:")) {
      this.requireFeature(this.requestService, "Request service is not configured");
      const requestId = data.split(":")[2];
      return this.sendRequestCard(chatId, user, requestId);
    }

    if (data.startsWith("request:approve:")) {
      this.requireFeature(this.requestService, "Request service is not configured");
      this.ensurePermission(user, "request_approve", "У вас нет доступа к согласованию заявок.");
      const requestId = data.split(":")[2];
      const request = await this.requestService.approveRequest(requestId, user.id);
      return this.sendReplies(chatId, [{
        text: `Заявка ${request.id} согласована.`,
        extra: mainMenuKeyboard()
      }]);
    }

    if (data.startsWith("request:reject:")) {
      this.requireFeature(this.requestService, "Request service is not configured");
      this.ensurePermission(user, "request_approve", "У вас нет доступа к отклонению заявок.");
      const requestId = data.split(":")[2];
      this.sessionStore.set(telegramUserId, { mode: "await_request_reject_reason", rejectRequestId: requestId });
      return this.sendReplies(chatId, [{
        text: "Введите причину отклонения заявки.",
        extra: backHomeKeyboard("menu:issue")
      }]);
    }

    if (data.startsWith("request:fulfill:")) {
      this.requireFeature(this.requestService, "Request service is not configured");
      this.ensurePermission(user, "request_fulfill", "У вас нет доступа к выполнению заявок.");
      const requestId = data.split(":")[2];
      const request = await this.requestService.fulfillApprovedRequest(requestId, user.id);
      return this.sendReplies(chatId, [{
        text: `Заявка ${request.id} выполнена.`,
        extra: mainMenuKeyboard()
      }]);
    }

    if (data.startsWith("report:period:")) {
      const periodDays = Number(data.split(":")[2]);
      const filters = this.updateReportFilters(telegramUserId, { periodDays });
      return this.sendReplies(chatId, [{
        text: this.formatReportFilterSummary(filters),
        extra: reportCenterKeyboard(filters)
      }]);
    }

    if (data === "report:filter:warehouse") {
      const filters = this.getReportFilters(telegramUserId);
      const warehouses = await this.inventoryService.listWarehouses();
      return this.sendReplies(chatId, [{
        text: "Выберите склад для фильтра отчета.",
        extra: reportFilterKeyboard(warehouses, "report:warehouse", filters.warehouseId, "Все склады", "menu:reports")
      }]);
    }

    if (data === "report:filter:employee") {
      const filters = this.getReportFilters(telegramUserId);
      const users = await this.authService.listUsers();
      return this.sendReplies(chatId, [{
        text: "Выберите сотрудника для фильтра отчета.",
        extra: reportFilterKeyboard(
          users.map((item) => ({ id: item.id, name: item.fullName })),
          "report:employee",
          filters.employeeId,
          "Все сотрудники",
          "menu:reports"
        )
      }]);
    }

    if (data.startsWith("report:warehouse:")) {
      const warehouseId = data.split(":")[2];
      const warehouses = await this.inventoryService.listWarehouses();
      const selected = warehouses.find((item) => item.id === warehouseId) || null;
      const filters = this.updateReportFilters(telegramUserId, {
        warehouseId: warehouseId === "all" ? null : warehouseId,
        warehouseName: warehouseId === "all" ? null : selected?.name || null
      });
      return this.sendReplies(chatId, [{
        text: this.formatReportFilterSummary(filters),
        extra: reportCenterKeyboard(filters)
      }]);
    }

    if (data.startsWith("report:employee:")) {
      const employeeId = data.split(":")[2];
      const users = await this.authService.listUsers();
      const selected = users.find((item) => item.id === employeeId) || null;
      const filters = this.updateReportFilters(telegramUserId, {
        employeeId: employeeId === "all" ? null : employeeId,
        employeeName: employeeId === "all" ? null : selected?.fullName || null
      });
      return this.sendReplies(chatId, [{
        text: this.formatReportFilterSummary(filters),
        extra: reportCenterKeyboard(filters)
      }]);
    }

    if (data.startsWith("report:view:")) {
      this.requireFeature(this.reportService, "Report service is not configured");
      const view = data.split(":")[2];
      const filters = this.getReportFilters(telegramUserId);
      const analytics = await this.reportService.getAnalytics(filters);
      return this.sendReplies(chatId, [{
        text: formatAnalyticsView(view, analytics),
        extra: reportCenterKeyboard(filters)
      }]);
    }

    if (data === "report:pdf:once") {
      this.requireFeature(this.backgroundJobService, "Background job service is not configured");
      const filters = this.getReportFilters(telegramUserId);
      await this.backgroundJobService.enqueue("scheduled_pdf_report", { filters });
      return this.sendReplies(chatId, [{
        text: "PDF-отчет поставлен в очередь на формирование.",
        extra: reportCenterKeyboard(filters)
      }]);
    }

    if (data === "report:pdf:daily" || data === "report:pdf:weekly") {
      this.requireFeature(this.backgroundJobService, "Background job service is not configured");
      const filters = this.getReportFilters(telegramUserId);
      const frequency = data.endsWith("daily") ? "daily" : "weekly";
      const runAt = nextScheduledRunAt(frequency, 9, 0);
      await this.backgroundJobService.enqueue("scheduled_pdf_report", {
        filters,
        schedule: {
          frequency,
          hour: 9,
          minute: 0
        }
      }, runAt);
      return this.sendReplies(chatId, [{
        text: frequency === "daily"
          ? "Ежедневный PDF-отчет запланирован на 09:00."
          : "Еженедельный PDF-отчет запланирован на 09:00.",
        extra: reportCenterKeyboard(filters)
      }]);
    }

    if (data.startsWith("confirm:")) {
      return this.handleConfirmation(chatId, telegramUserId, user, data.split(":")[1]);
    }

    return this.sendReplies(chatId, [{
      text: "Действие не распознано.",
      extra: mainMenuKeyboard()
    }]);
  }

  async handleConfirmation(chatId, telegramUserId, user, action) {
    const session = this.sessionStore.get(telegramUserId);

    if (action === "receipt") {
      const result = await this.inventoryService.receipt({
        actorId: user.id,
        productId: session.receiptProductId,
        locationId: session.receiptCellId,
        quantity: session.receiptQuantity
      });
      this.resetTransientState(telegramUserId);
      return this.sendReplies(chatId, [{
        text: `Приемка выполнена: ${result.product.name}, +${formatNumber(session.receiptQuantity)}.`,
        extra: mainMenuKeyboard()
      }]);
    }

    if (action === "issue") {
      const result = await this.inventoryService.issue({
        actorId: user.id,
        productId: session.issueProductId,
        locationId: session.issueCellId,
        quantity: session.issueQuantity,
        issuedTo: session.issueTarget
      });
      this.resetTransientState(telegramUserId);
      return this.sendReplies(chatId, [{
        text: `Выдача выполнена: ${result.product.name}, -${formatNumber(session.issueQuantity)}, кому: ${session.issueTarget}.`,
        extra: mainMenuKeyboard()
      }]);
    }

    if (action === "move") {
      const result = await this.inventoryService.move({
        actorId: user.id,
        productId: session.moveProductId,
        fromLocationId: session.moveFromCellId,
        toLocationId: session.moveToCellId,
        quantity: session.moveQuantity
      });
      this.resetTransientState(telegramUserId);
      return this.sendReplies(chatId, [{
        text: `Перемещение выполнено: ${result.product.name}, ${formatNumber(session.moveQuantity)} шт.`,
        extra: mainMenuKeyboard()
      }]);
    }

    if (action === "audit") {
      const result = await this.inventoryService.audit({
        actorId: user.id,
        productId: session.auditProductId,
        locationId: session.auditCellId,
        actualQty: session.auditQuantity
      });
      this.resetTransientState(telegramUserId);
      return this.sendReplies(chatId, [{
        text: `Ревизия сохранена. Расхождение: ${formatNumber(result.audit.diffQty)}.`,
        extra: mainMenuKeyboard()
      }]);
    }

    if (action === "request_create") {
      this.requireFeature(this.requestService, "Request service is not configured");
      const request = await this.requestService.createRequest({
        productId: session.requestProductId,
        requestedQty: session.requestQuantity,
        preferredCellId: session.requestCellId,
        requestedBy: user.id,
        priority: session.requestPriority || "normal",
        comment: session.requestComment || ""
      });
      this.resetTransientState(telegramUserId);
      return this.sendReplies(chatId, [{
        text: `Заявка ${request.id} создана и отправлена на согласование.`,
        extra: mainMenuKeyboard()
      }]);
    }

    if (action === "excel_import") {
      this.requireFeature(this.importExportService, "Import service is not configured");
      const result = await this.importExportService.confirmProductsWorkbook({
        previewToken: session.importPreviewToken,
        actorId: user.id
      });
      this.resetTransientState(telegramUserId);
      return this.sendReplies(chatId, [{
        text: [
          "Импорт Excel завершен.",
          `Импортировано: ${result.importedCount}`,
          `Пропущено: ${result.skippedCount || 0}`
        ].join("\n"),
        extra: mainMenuKeyboard()
      }]);
    }

    throw new HttpError(400, "Unknown confirmation action");
  }

  async handleDocumentMessage(chatId, telegramUserId, user, document) {
    const session = this.sessionStore.get(telegramUserId);
    if (session.mode !== "await_excel_import_document") {
      return this.sendReplies(chatId, [{
        text: "Для обработки Excel сначала откройте импорт в настройках.",
        extra: settingsKeyboard({
          canUploadMedia: this.authService.can(user, "upload_media"),
          canImportExport: this.authService.can(user, "import_export")
        })
      }]);
    }

    this.ensurePermission(user, "import_export", "У вас нет доступа к импорту Excel.");
    this.requireFeature(this.importExportService, "Import service is not configured");

    const fileName = String(document.file_name || "").toLowerCase();
    if (!(fileName.endsWith(".xlsx") || fileName.endsWith(".xls"))) {
      throw new HttpError(400, "Нужен Excel-файл в формате .xlsx или .xls");
    }

    const fileResponse = await this.telegramGateway.getFile(document.file_id);
    const filePath = fileResponse.result?.file_path;
    if (!filePath) {
      throw new HttpError(400, "Не удалось получить путь к файлу Telegram");
    }

    const fileBuffer = await this.telegramGateway.downloadFile(filePath);
    const preview = await this.importExportService.validateProductsWorkbook({
      base64Data: fileBuffer.toString("base64"),
      actorId: user.id
    });

    if (!preview.canImport) {
      this.resetTransientState(telegramUserId);
      return this.sendReplies(chatId, [{
        text: formatImportPreview(preview),
        extra: mainMenuKeyboard()
      }]);
    }

    this.sessionStore.set(telegramUserId, {
      mode: "confirm_excel_import",
      importPreviewToken: preview.previewToken
    });

    return this.sendReplies(chatId, [{
      text: formatImportPreview(preview),
      extra: confirmKeyboard("excel_import", "menu:settings")
    }]);
  }

  async sendIssueMenu(chatId, telegramUserId, user) {
    this.sessionStore.set(telegramUserId, { mode: "idle" });
    const options = {
      canIssueDirect: this.authService.can(user, "issue"),
      canCreateRequest: this.authService.can(user, "request_create"),
      canApproveRequest: this.authService.can(user, "request_approve"),
      canFulfillRequest: this.authService.can(user, "request_fulfill")
    };

    return this.sendReplies(chatId, [{
      text: "Выберите сценарий работы с выдачей.",
      extra: issueMenuKeyboard(options)
    }]);
  }

  async sendRequestList(chatId, user, kind) {
    const filters = {};
    if (kind === "mine") {
      filters.requestedBy = user.id;
    }
    if (kind === "pending") {
      this.ensurePermission(user, "request_approve", "У вас нет доступа к согласованию заявок.");
      filters.status = "pending";
    }
    if (kind === "approved") {
      this.ensurePermission(user, "request_fulfill", "У вас нет доступа к выполнению заявок.");
      filters.status = "approved";
    }

    const requests = await this.requestService.listRequests(filters);
    return this.sendReplies(chatId, [{
      text: requests.length ? "Список заявок:" : "Подходящих заявок не найдено.",
      extra: requests.length ? requestListKeyboard(requests, "menu:issue") : backHomeKeyboard("menu:issue")
    }]);
  }

  async sendRequestCard(chatId, user, requestId) {
    const request = await this.requestService.getRequestById(requestId);
    const canApprove = request.status === "pending" && this.authService.can(user, "request_approve");
    const canFulfill = request.status === "approved" && this.authService.can(user, "request_fulfill");

    return this.sendReplies(chatId, [{
      text: formatRequestCard(request),
      extra: requestCardKeyboard(request, { canApprove, canFulfill, backTarget: "menu:issue" })
    }]);
  }

  async sendReportCenter(chatId, telegramUserId) {
    const filters = this.getReportFilters(telegramUserId);
    return this.sendReplies(chatId, [{
      text: this.formatReportFilterSummary(filters),
      extra: reportCenterKeyboard(filters)
    }]);
  }

  async sendLowStock(chatId) {
    const lowStock = await this.inventoryService.getLowStock();
    const stockText = lowStock.length
      ? ["Товары ниже минимального остатка:", ...lowStock.map((item) => `${item.product.name} (${item.product.sku}) - ${formatNumber(item.totalQuantity)}`)].join("\n")
      : "Товаров ниже минимального остатка нет.";

    return this.sendReplies(chatId, [{ text: stockText, extra: backHomeKeyboard() }]);
  }

  async sendProductCard(chatId, productId) {
    const card = await this.inventoryService.getProductById(productId);
    return this.sendReplies(chatId, [{ text: formatProductCard(card), extra: productCardKeyboard(productId) }]);
  }

  async handleSearchInput(chatId, telegramUserId, query) {
    const session = this.sessionStore.get(telegramUserId);
    const results = await this.inventoryService.searchProducts(query);
    this.sessionStore.set(telegramUserId, { mode: "idle", lastSearch: query });
    const action = session.pendingAction || "view";

    return this.sendReplies(chatId, [{
      text: results.length ? "Результаты поиска:" : "Ничего не найдено.",
      extra: results.length ? searchResultsKeyboard(results, action, "menu:main") : backHomeKeyboard()
    }]);
  }

  sendReplies(chatId, replies) {
    return replies.reduce(
      (promise, reply) =>
        promise.then(async (sent) => {
          await this.telegramGateway.sendMessage(chatId, reply.text, reply.extra);
          sent.push(reply);
          return sent;
        }),
      Promise.resolve([])
    );
  }

  productCells(product) {
    return (product.locations || [])
      .filter((item) => Number(item.quantity || 0) > 0)
      .map((item) => ({ id: item.locationId, fullCode: `${item.code} (${formatNumber(item.quantity)})` }));
  }

  async resolveTelegramUser(telegramUserId, profile = {}) {
    if (typeof this.authService.resolveTelegramUser === "function") {
      return this.authService.resolveTelegramUser(
        telegramUserId,
        profile.telegramUsername || "",
        profile
      );
    }

    return this.authService.findByTelegramId(telegramUserId);
  }

  resetTransientState(telegramUserId) {
    const current = this.sessionStore.get(telegramUserId);
    this.sessionStore.clear(telegramUserId);
    if (current.reportFilters) {
      this.sessionStore.set(telegramUserId, { mode: "idle", reportFilters: current.reportFilters });
    } else {
      this.sessionStore.set(telegramUserId, { mode: "idle" });
    }
  }

  getReportFilters(telegramUserId) {
    const session = this.sessionStore.get(telegramUserId);
    return {
      periodDays: Number(session.reportFilters?.periodDays || 30),
      warehouseId: session.reportFilters?.warehouseId || null,
      warehouseName: session.reportFilters?.warehouseName || null,
      employeeId: session.reportFilters?.employeeId || null,
      employeeName: session.reportFilters?.employeeName || null
    };
  }

  updateReportFilters(telegramUserId, patch) {
    const current = this.getReportFilters(telegramUserId);
    const reportFilters = { ...current, ...patch };
    this.sessionStore.set(telegramUserId, { mode: "idle", reportFilters });
    return reportFilters;
  }

  formatReportFilterSummary(filters) {
    return [
      "Центр отчетов",
      `Период: ${filters.periodDays} дней`,
      `Склад: ${filters.warehouseName || "Все склады"}`,
      `Сотрудник: ${filters.employeeName || "Все сотрудники"}`
    ].join("\n");
  }

  formatRequestDraft(session) {
    return [
      "Подтвердите создание заявки:",
      `Товар: ${session.requestProductName || session.requestProductId}`,
      `Артикул: ${session.requestProductSku || "не указан"}`,
      `Ячейка: ${session.requestCellCode || session.requestCellId || "не указана"}`,
      `Количество: ${formatNumber(session.requestQuantity)}`,
      `Приоритет: ${session.requestPriority === "high" ? "Высокий" : "Обычный"}`,
      `Комментарий: ${session.requestComment || "без комментария"}`
    ].join("\n");
  }

  parsePositiveQuantity(value, errorMessage) {
    const quantity = Number(value);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new HttpError(400, errorMessage);
    }
    return quantity;
  }

  parseNonNegativeQuantity(value, errorMessage) {
    const quantity = Number(value);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new HttpError(400, errorMessage);
    }
    return quantity;
  }

  ensurePermission(user, permission, message) {
    if (!this.authService.can(user, permission)) {
      throw new HttpError(403, message);
    }
  }

  requireFeature(feature, message) {
    if (!feature) {
      throw new HttpError(500, message);
    }
  }
}

function formatProductCard(card) {
  const firstLocation = card.locations[0] || {};
  const historyText = card.history.length
    ? card.history.slice(0, 5).map((item) => `${formatDateTime(item.createdAt)} | ${item.type} | ${item.quantity}`).join("\n")
    : "История пока пустая";

  return [
    card.product.photoUrl ? `Фото: ${card.product.photoUrl}` : "Фото: не указано",
    `Название: ${card.product.name}`,
    `Артикул: ${card.product.sku}`,
    `QR-код: ${card.product.qrCode || "не указан"}`,
    `Штрихкод: ${card.product.barcode || "не указан"}`,
    `Категория: ${card.product.category || "не указана"}`,
    `Поставщик: ${card.product.supplier || "не указан"}`,
    `Количество: ${formatNumber(card.totalQuantity)} ${card.product.unit}`,
    `Минимальный остаток: ${formatNumber(card.product.minStock)}`,
    `Склад: ${firstLocation.warehouse || "не указан"}`,
    `Стеллаж: ${firstLocation.rack || "не указан"}`,
    `Полка: ${firstLocation.shelf || "не указана"}`,
    `Ячейка: ${firstLocation.cell || "не указана"}`,
    `Дата последнего поступления: ${formatDateTime(card.lastReceiptAt)}`,
    `Дата последней выдачи: ${formatDateTime(card.lastIssueAt)}`,
    "История операций:",
    historyText
  ].join("\n");
}

function formatHistory(items) {
  if (!items.length) {
    return "История операций пока пустая.";
  }

  return items.map((item) => `${formatDateTime(item.createdAt)} | ${item.type} | ${item.quantity} | ${item.actorName || "Неизвестно"}`).join("\n");
}

function formatRequestCard(request) {
  return [
    `Заявка: ${request.id}`,
    `Статус: ${requestStatusLabel(request.status)}`,
    `Товар: ${request.productName || request.productId}`,
    `Артикул: ${request.productSku || "не указан"}`,
    `Количество: ${formatNumber(request.requestedQty)} ${request.unit || ""}`.trim(),
    `Ячейка: ${request.preferredCellCode || "не указана"}`,
    `Приоритет: ${request.priority === "high" ? "Высокий" : "Обычный"}`,
    `Запросил: ${request.requestedByName || request.requestedBy || "неизвестно"}`,
    `Согласовал: ${request.approvedByName || "еще не согласована"}`,
    `Комментарий: ${request.comment || "без комментария"}`,
    `Создана: ${formatDateTime(request.createdAt)}`
  ].join("\n");
}

function formatAnalyticsView(view, analytics) {
  if (view === "summary") {
    return [
      "Сводка по отчету:",
      ...Object.entries(analytics.summary).map(([key, value]) => `${key}: ${value}`)
    ].join("\n");
  }

  if (view === "top") {
    return [
      "Топ товаров:",
      ...(analytics.topProducts.length
        ? analytics.topProducts.map((item) => `${item.name} (${item.sku}) — ${formatNumber(item.total)}`)
        : ["Нет данных"])
    ].join("\n");
  }

  if (view === "activity") {
    return [
      "Активность сотрудников:",
      ...(analytics.userActivity.length
        ? analytics.userActivity.map((item) => `${item.fullName} — ${item.actions}`)
        : ["Нет данных"])
    ].join("\n");
  }

  if (view === "low") {
    return [
      "Минимальные остатки:",
      ...(analytics.lowStock.length
        ? analytics.lowStock.map((item) => `${item.name} (${item.sku}) — ${formatNumber(item.totalQuantity)} / min ${formatNumber(item.minStock)}`)
        : ["Нет данных"])
    ].join("\n");
  }

  if (view === "timeline") {
    return [
      "Движение по дням:",
      ...(analytics.movementTimeline.length
        ? analytics.movementTimeline.map((item) => `${item.day} | ${item.type} | ${formatNumber(item.total)}`)
        : ["Нет данных"])
    ].join("\n");
  }

  return "Неизвестный тип отчета.";
}

function formatImportPreview(preview) {
  const lines = [
    "Проверка Excel завершена.",
    `Всего строк: ${preview.summary?.totalRows || 0}`,
    `Готово к импорту: ${preview.summary?.validRows || 0}`,
    `Строк с ошибками: ${preview.summary?.errorRows || 0}`,
    `Строк с предупреждениями: ${preview.summary?.warningRows || 0}`
  ];

  if (preview.errors?.length) {
    lines.push("", "Ошибки:");
    lines.push(...preview.errors.slice(0, 5).map((item) => `Строка ${item.row}: ${item.message}`));
  }

  if (preview.warnings?.length) {
    lines.push("", "Предупреждения:");
    lines.push(...preview.warnings.slice(0, 5).map((item) => `Строка ${item.row}: ${item.message}`));
  }

  if (preview.canImport) {
    lines.push("", "Нажмите подтверждение, чтобы выполнить импорт.");
  }

  return lines.join("\n");
}

function requestStatusLabel(status) {
  const map = {
    pending: "Ожидает согласования",
    approved: "Согласована",
    rejected: "Отклонена",
    fulfilled: "Выполнена"
  };

  return map[status] || status;
}

function nextScheduledRunAt(frequency, hour, minute) {
  const date = new Date();
  if (frequency === "daily") {
    date.setDate(date.getDate() + 1);
  }
  if (frequency === "weekly") {
    date.setDate(date.getDate() + 7);
  }
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}
