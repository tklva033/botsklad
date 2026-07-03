import { readJsonBody, sendJson } from "../utils/http.js";

export class RequestController {
  constructor(requestService) {
    this.requestService = requestService;
  }

  async list(req, res, url) {
    sendJson(
      res,
      200,
      await this.requestService.listRequests({
        status: url.searchParams.get("status"),
        requestedBy: url.searchParams.get("requestedBy"),
        approvedBy: url.searchParams.get("approvedBy"),
        productId: url.searchParams.get("productId")
      })
    );
  }

  async create(req, res) {
    const body = await readJsonBody(req);
    sendJson(res, 201, await this.requestService.createRequest(body));
  }

  async approve(req, res, requestId) {
    const body = await readJsonBody(req);
    sendJson(res, 200, await this.requestService.approveRequest(requestId, body.approverId));
  }

  async reject(req, res, requestId) {
    const body = await readJsonBody(req);
    sendJson(res, 200, await this.requestService.rejectRequest(requestId, body.approverId, body.reason || ""));
  }

  async fulfill(req, res, requestId) {
    const body = await readJsonBody(req);
    sendJson(res, 200, await this.requestService.fulfillApprovedRequest(requestId, body.actorId));
  }
}
