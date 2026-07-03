export function mainMenuKeyboard() {
  return inlineKeyboard([
    [{ text: "📦 Товары", callback_data: "menu:products" }, { text: "📥 Приемка", callback_data: "menu:receipt" }],
    [{ text: "📤 Выдача", callback_data: "menu:issue" }, { text: "🔄 Перемещение", callback_data: "menu:move" }],
    [{ text: "📝 Ревизия", callback_data: "menu:audit" }, { text: "📊 Остатки", callback_data: "menu:stock" }],
    [{ text: "📈 Отчеты", callback_data: "menu:reports" }, { text: "🔍 Поиск", callback_data: "menu:search" }],
    [{ text: "📷 Сканировать QR", callback_data: "menu:qr" }, { text: "⚙️ Настройки", callback_data: "menu:settings" }]
  ]);
}

export function authKeyboard() {
  return inlineKeyboard([[{ text: "🔐 Авторизация", callback_data: "auth:start" }]]);
}

export function backHomeKeyboard(backTarget = "menu:main") {
  return inlineKeyboard([
    [
      { text: "⬅️ Назад", callback_data: backTarget },
      { text: "🏠 Главное меню", callback_data: "menu:main" }
    ]
  ]);
}

export function productsKeyboard(products, action = "view", backTarget = "menu:main", pager = null) {
  const rows = [
    ...products.map((product) => [
      {
        text: formatProductButtonLabel(product),
        callback_data: `product:${action}:${product.id}`
      }
    ])
  ];

  if (pager && (pager.hasPrev || pager.hasNext)) {
    const pageRow = [];
    if (pager.hasPrev) {
      pageRow.push({ text: "⬅️ Пред.", callback_data: pager.prevCallbackData });
    }
    pageRow.push({ text: `Стр. ${pager.page + 1}`, callback_data: "noop" });
    if (pager.hasNext) {
      pageRow.push({ text: "След. ➡️", callback_data: pager.nextCallbackData });
    }
    rows.push(pageRow);
  }

  rows.push(navRow(backTarget));
  return inlineKeyboard(rows);
}

export function productCardKeyboard(productId) {
  return inlineKeyboard([
    [{ text: "📥 Приемка", callback_data: `product:receipt:${productId}` }, { text: "📤 Выдача", callback_data: `product:issue:${productId}` }],
    [{ text: "🔄 Перемещение", callback_data: `product:move:${productId}` }, { text: "📝 Ревизия", callback_data: `product:audit:${productId}` }],
    [{ text: "📜 История", callback_data: `product:history:${productId}` }],
    navRow("menu:products")
  ]);
}

export function cellsKeyboard(cells, prefix, backTarget = "menu:main") {
  return inlineKeyboard([
    ...cells.map((cell) => [{ text: cell.fullCode, callback_data: `${prefix}:${cell.id}` }]),
    navRow(backTarget)
  ]);
}

export function confirmKeyboard(actionKey, backTarget = "menu:main") {
  return inlineKeyboard([
    [{ text: "✅ Подтвердить", callback_data: `confirm:${actionKey}` }],
    navRow(backTarget)
  ]);
}

export function searchResultsKeyboard(results, action = "view", backTarget = "menu:main") {
  return inlineKeyboard([
    ...results.map((item) => [
      { text: `${item.product.name} (${item.product.sku})`, callback_data: `product:${action}:${item.product.id}` }
    ]),
    navRow(backTarget)
  ]);
}

export function issueMenuKeyboard(options = {}) {
  const rows = [];
  if (options.canIssueDirect) {
    rows.push([{ text: "📤 Прямая выдача", callback_data: "issue:direct" }]);
  }
  if (options.canCreateRequest) {
    rows.push([{ text: "📝 Новая заявка на выдачу", callback_data: "issue:request" }]);
    rows.push([{ text: "📋 Мои заявки", callback_data: "requests:list:mine" }]);
  }
  if (options.canApproveRequest) {
    rows.push([{ text: "🟡 На согласование", callback_data: "requests:list:pending" }]);
  }
  if (options.canFulfillRequest) {
    rows.push([{ text: "🟢 К выполнению", callback_data: "requests:list:approved" }]);
  }
  rows.push(navRow("menu:main"));
  return inlineKeyboard(rows);
}

export function requestListKeyboard(requests, backTarget = "menu:issue") {
  return inlineKeyboard([
    ...requests.map((request) => [
      {
        text: `${request.productName} • ${trimNumber(request.requestedQty)} • ${statusLabel(request.status)}`,
        callback_data: `request:view:${request.id}`
      }
    ]),
    navRow(backTarget)
  ]);
}

export function requestCardKeyboard(request, options = {}) {
  const rows = [];
  if (request.status === "pending" && options.canApprove) {
    rows.push([
      { text: "✅ Согласовать", callback_data: `request:approve:${request.id}` },
      { text: "❌ Отклонить", callback_data: `request:reject:${request.id}` }
    ]);
  }
  if (request.status === "approved" && options.canFulfill) {
    rows.push([{ text: "📦 Выполнить выдачу", callback_data: `request:fulfill:${request.id}` }]);
  }
  rows.push(navRow(options.backTarget || "menu:issue"));
  return inlineKeyboard(rows);
}

export function priorityKeyboard(backTarget = "menu:issue") {
  return inlineKeyboard([
    [
      { text: "Обычный", callback_data: "request:priority:normal" },
      { text: "Высокий", callback_data: "request:priority:high" }
    ],
    navRow(backTarget)
  ]);
}

export function skipCommentKeyboard(backTarget = "menu:issue") {
  return inlineKeyboard([
    [{ text: "Пропустить комментарий", callback_data: "request:comment:skip" }],
    navRow(backTarget)
  ]);
}

export function reportCenterKeyboard(filters) {
  const warehouseText = filters.warehouseName || "Все склады";
  const employeeText = filters.employeeName || "Все сотрудники";

  return inlineKeyboard([
    [
      { text: filters.periodDays === 7 ? "✅ 7 дней" : "7 дней", callback_data: "report:period:7" },
      { text: filters.periodDays === 30 ? "✅ 30 дней" : "30 дней", callback_data: "report:period:30" },
      { text: filters.periodDays === 90 ? "✅ 90 дней" : "90 дней", callback_data: "report:period:90" }
    ],
    [{ text: `🏭 Склад: ${warehouseText}`, callback_data: "report:filter:warehouse" }],
    [{ text: `👤 Сотрудник: ${employeeText}`, callback_data: "report:filter:employee" }],
    [
      { text: "📊 Сводка", callback_data: "report:view:summary" },
      { text: "📈 Топ товаров", callback_data: "report:view:top" }
    ],
    [
      { text: "👥 Активность", callback_data: "report:view:activity" },
      { text: "⚠️ Минимальный остаток", callback_data: "report:view:low" }
    ],
    [{ text: "🗓 Движение по дням", callback_data: "report:view:timeline" }],
    [
      { text: "📄 PDF сейчас", callback_data: "report:pdf:once" },
      { text: "🕘 PDF ежедневно", callback_data: "report:pdf:daily" }
    ],
    [{ text: "📅 PDF еженедельно", callback_data: "report:pdf:weekly" }],
    navRow("menu:main")
  ]);
}

export function reportFilterKeyboard(items, prefix, selectedId = null, allText = "Все", backTarget = "menu:reports") {
  return inlineKeyboard([
    [{ text: selectedId ? allText : `✅ ${allText}`, callback_data: `${prefix}:all` }],
    ...items.map((item) => [
      {
        text: item.id === selectedId ? `✅ ${item.name}` : item.name,
        callback_data: `${prefix}:${item.id}`
      }
    ]),
    navRow(backTarget)
  ]);
}

export function settingsKeyboard(options = {}) {
  const rows = [];
  if (options.canUploadMedia) {
    rows.push([{ text: "🖼 Массовое фото", callback_data: "settings:photo-batch" }]);
  }
  if (options.canImportExport) {
    rows.push([{ text: "📥 Импорт Excel", callback_data: "settings:excel-import" }]);
  }
  rows.push(navRow("menu:main"));
  return inlineKeyboard(rows);
}

function inlineKeyboard(inline_keyboard) {
  return {
    reply_markup: {
      inline_keyboard
    }
  };
}

function navRow(backTarget) {
  return [
    { text: "⬅️ Назад", callback_data: backTarget },
    { text: "🏠 Главное меню", callback_data: "menu:main" }
  ];
}

function statusLabel(status) {
  const map = {
    pending: "Ожидает",
    approved: "Согласована",
    rejected: "Отклонена",
    fulfilled: "Выполнена"
  };

  return map[status] || status;
}

function trimNumber(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function formatProductButtonLabel(product) {
  const quantity = Number(product.totalQuantity);
  const baseLabel = `${product.name} (${product.sku})`;

  if (Number.isFinite(quantity)) {
    const unit = product.unit || "";
    return trimLabel(`${baseLabel} • ${trimNumber(quantity)} ${unit}`.trim(), 56);
  }

  return trimLabel(baseLabel, 56);
}

function trimLabel(value, maxLength = 56) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
