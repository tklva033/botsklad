import { readJsonBody, sendJson } from "../utils/http.js";

export class InventoryController {
  constructor(inventoryService) {
    this.inventoryService = inventoryService;
  }

  async health(_req, res) {
    sendJson(res, 200, { ok: true });
  }

  async stats(_req, res) {
    sendJson(res, 200, await this.inventoryService.getStats());
  }

  async products(req, res, url) {
    const query = url.searchParams.get("query") || "";
    sendJson(res, 200, await this.inventoryService.searchProducts(query));
  }

  async productHistory(_req, res, productId) {
    sendJson(res, 200, await this.inventoryService.getHistory(productId));
  }

  async lowStock(_req, res) {
    sendJson(res, 200, await this.inventoryService.getLowStock());
  }

  async receipt(req, res) {
    const body = await readJsonBody(req);
    sendJson(res, 201, await this.inventoryService.receipt(body));
  }

  async issue(req, res) {
    const body = await readJsonBody(req);
    sendJson(res, 201, await this.inventoryService.issue(body));
  }

  async move(req, res) {
    const body = await readJsonBody(req);
    sendJson(res, 201, await this.inventoryService.move(body));
  }

  async audit(req, res) {
    const body = await readJsonBody(req);
    sendJson(res, 201, await this.inventoryService.audit(body));
  }
}
