import { withTransaction } from "../database/postgres.js";
import { HttpError } from "../middlewares/http-error.js";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/dates.js";

export class RequestService {
  constructor({
    pool,
    authService,
    requestRepository,
    catalogRepository,
    inventoryService,
    notificationRepository,
    auditLogRepository
  }) {
    this.pool = pool;
    this.authService = authService;
    this.requestRepository = requestRepository;
    this.catalogRepository = catalogRepository;
    this.inventoryService = inventoryService;
    this.notificationRepository = notificationRepository;
    this.auditLogRepository = auditLogRepository;
  }

  async createRequest(payload) {
    const requester = await this.authService.getUser(payload.requestedBy);
    if (!requester) {
      throw new HttpError(404, "Requester not found");
    }

    const product = await this.catalogRepository.getProductCard(payload.productId);
    if (!product) {
      throw new HttpError(404, "Product not found");
    }

    const createdAt = nowIso();
    const request = {
      id: createId("req"),
      productId: payload.productId,
      requestedQty: Number(payload.requestedQty),
      preferredCellId: payload.preferredCellId || null,
      requestedBy: payload.requestedBy,
      approvedBy: null,
      fulfilledIssueId: null,
      priority: payload.priority || "normal",
      status: "pending",
      comment: payload.comment || "",
      createdAt,
      updatedAt: createdAt
    };

    await this.requestRepository.create(request);
    await this.notificationRepository.create({
      id: createId("notif"),
      type: "issue_request_created",
      severity: "info",
      productId: payload.productId,
      cellId: payload.preferredCellId || null,
      message: `Новая заявка на выдачу: ${product.product.name}, ${request.requestedQty} ${product.product.unit}`,
      payload: request,
      createdAt
    });
    await this.auditLogRepository.log({
      id: createId("ulog"),
      userId: payload.requestedBy,
      actionType: "issue_request_create",
      entityType: "issue_request",
      entityId: request.id,
      oldValue: null,
      newValue: request,
      createdAt
    });

    return request;
  }

  async listRequests(filters = null) {
    if (typeof filters === "string" || filters === null) {
      return this.requestRepository.list({ status: filters || null });
    }

    return this.requestRepository.list(filters || {});
  }

  async getRequestById(requestId) {
    const request = await this.requestRepository.findById(requestId);
    if (!request) {
      throw new HttpError(404, "Request not found");
    }

    return request;
  }

  async approveRequest(requestId, approverId) {
    const approver = await this.authService.getUser(approverId);
    if (!approver) {
      throw new HttpError(404, "Approver not found");
    }

    return withTransaction(this.pool, async (db) => {
      const request = await this.requestRepository.findById(requestId, db);
      if (!request) {
        throw new HttpError(404, "Request not found");
      }
      if (request.status !== "pending") {
        throw new HttpError(400, "Only pending requests can be approved");
      }

      const updated = await this.requestRepository.updateStatus(
        { id: requestId, status: "approved", approvedBy: approverId },
        db
      );

      await this.notificationRepository.create(
        {
          id: createId("notif"),
          type: "issue_request_approved",
          severity: "info",
          productId: request.productId,
          cellId: request.preferredCellId,
          message: `Заявка ${requestId} согласована`,
          payload: updated,
          createdAt: nowIso()
        },
        db
      );

      await this.auditLogRepository.log(
        {
          id: createId("ulog"),
          userId: approverId,
          actionType: "issue_request_approve",
          entityType: "issue_request",
          entityId: requestId,
          oldValue: request,
          newValue: updated,
          createdAt: nowIso()
        },
        db
      );

      return updated;
    });
  }

  async rejectRequest(requestId, approverId, reason = "") {
    return withTransaction(this.pool, async (db) => {
      const request = await this.requestRepository.findById(requestId, db);
      if (!request) {
        throw new HttpError(404, "Request not found");
      }
      if (request.status !== "pending") {
        throw new HttpError(400, "Only pending requests can be rejected");
      }

      const updated = await this.requestRepository.updateStatus(
        { id: requestId, status: "rejected", approvedBy: approverId },
        db
      );

      await this.notificationRepository.create(
        {
          id: createId("notif"),
          type: "issue_request_rejected",
          severity: "warning",
          productId: request.productId,
          cellId: request.preferredCellId,
          message: `Заявка ${requestId} отклонена`,
          payload: {
            ...updated,
            reason
          },
          createdAt: nowIso()
        },
        db
      );

      await this.auditLogRepository.log(
        {
          id: createId("ulog"),
          userId: approverId,
          actionType: "issue_request_reject",
          entityType: "issue_request",
          entityId: requestId,
          oldValue: request,
          newValue: {
            ...updated,
            reason
          },
          createdAt: nowIso()
        },
        db
      );

      return updated;
    });
  }

  async fulfillApprovedRequest(requestId, actorId) {
    return withTransaction(this.pool, async (db) => {
      const request = await this.requestRepository.findById(requestId, db);
      if (!request) {
        throw new HttpError(404, "Request not found");
      }
      if (request.status !== "approved") {
        throw new HttpError(400, "Only approved requests can be fulfilled");
      }
      if (!request.preferredCellId) {
        throw new HttpError(400, "Request has no preferred cell");
      }

      const issue = await this.inventoryService.issue({
        actorId,
        productId: request.productId,
        locationId: request.preferredCellId,
        quantity: request.requestedQty,
        issuedTo: `Request:${requestId}`
      });

      const updated = await this.requestRepository.updateStatus(
        {
          id: requestId,
          status: "fulfilled",
          approvedBy: request.approvedBy,
          fulfilledIssueId: issue.id || null
        },
        db
      );

      await this.notificationRepository.create(
        {
          id: createId("notif"),
          type: "issue_request_fulfilled",
          severity: "info",
          productId: request.productId,
          cellId: request.preferredCellId,
          message: `Заявка ${requestId} выполнена`,
          payload: updated,
          createdAt: nowIso()
        },
        db
      );

      await this.auditLogRepository.log(
        {
          id: createId("ulog"),
          userId: actorId,
          actionType: "issue_request_fulfill",
          entityType: "issue_request",
          entityId: requestId,
          oldValue: request,
          newValue: updated,
          createdAt: nowIso()
        },
        db
      );

      return updated;
    });
  }
}
