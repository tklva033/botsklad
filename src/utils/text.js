export function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

export function formatDateTime(value) {
  if (!value) {
    return "Нет данных";
  }

  return new Date(value).toLocaleString("ru-RU");
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString("ru-RU");
}
