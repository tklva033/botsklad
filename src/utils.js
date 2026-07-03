import { sendJson } from "./utils/http.js";

export { createId } from "./utils/ids.js";
export { nowIso } from "./utils/dates.js";
export { normalizeText } from "./utils/text.js";
export { readJsonBody, sendJson } from "./utils/http.js";

export function notFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

export function methodNotAllowed(res) {
  sendJson(res, 405, { error: "Method not allowed" });
}
