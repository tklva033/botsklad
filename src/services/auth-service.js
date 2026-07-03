import { HttpError } from "../middlewares/http-error.js";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/dates.js";
import { normalizeText } from "../utils/text.js";

const LEGACY_ROLE_MAP = {
  manager: "supervisor"
};

export class AuthService {
  constructor({ authRepository, auditLogRepository }) {
    this.authRepository = authRepository;
    this.auditLogRepository = auditLogRepository;
  }

  async loginByPhone({ phone, telegramUserId, telegramUsername }) {
    const user = await this.authRepository.findUserByPhone(phone);
    if (!user) {
      throw new HttpError(404, "User with this phone number was not found");
    }

    const updated = await this.authRepository.updateTelegramBinding(
      user.id,
      telegramUserId,
      telegramUsername
    );

    await this.auditLogRepository.log({
      id: createId("ulog"),
      userId: user.id,
      actionType: "login",
      entityType: "user",
      entityId: user.id,
      oldValue: {
        telegramId: user.telegramId,
        telegramUsername: user.telegramUsername
      },
      newValue: {
        telegramId: telegramUserId,
        telegramUsername
      },
      createdAt: nowIso()
    });

    return {
      ...updated,
      role: this.normalizeRole(user.role),
      roleName: user.roleName,
      permissions: this.normalizePermissions(user.permissions, user.role)
    };
  }

  async findByTelegramId(telegramId) {
    const user = await this.authRepository.findUserByTelegramId(telegramId);
    if (!user) {
      return null;
    }

    return {
      ...user,
      role: this.normalizeRole(user.role),
      permissions: this.normalizePermissions(user.permissions, user.role)
    };
  }

  async resolveTelegramUser(telegramId, telegramUsername = "") {
    const byTelegramId = await this.findByTelegramId(telegramId);
    if (byTelegramId) {
      return byTelegramId;
    }

    const fallbackUser = await this.authRepository.findPreferredBotUser();
    if (!fallbackUser) {
      return null;
    }

    return {
      ...fallbackUser,
      telegramId: telegramId || fallbackUser.telegramId || null,
      telegramUsername: telegramUsername || fallbackUser.telegramUsername || "",
      role: this.normalizeRole(fallbackUser.role),
      permissions: this.normalizePermissions(fallbackUser.permissions, fallbackUser.role)
    };
  }

  async getUser(userId) {
    const user = await this.authRepository.findUserById(userId);
    if (!user) {
      return null;
    }

    return {
      ...user,
      role: this.normalizeRole(user.role),
      permissions: this.normalizePermissions(user.permissions, user.role)
    };
  }

  async listUsers() {
    const users = await this.authRepository.listUsers();
    return users.map((user) => ({
      ...user,
      role: this.normalizeRole(user.role),
      permissions: this.normalizePermissions(user.permissions, user.role)
    }));
  }

  can(user, permission) {
    if (!user) {
      return false;
    }

    return this.normalizePermissions(user.permissions, user.role).includes(permission);
  }

  normalizeRole(role) {
    return LEGACY_ROLE_MAP[normalizeText(role)] || normalizeText(role);
  }

  normalizePermissions(permissions, role) {
    if (Array.isArray(permissions)) {
      return permissions;
    }

    if (typeof permissions === "string") {
      try {
        return JSON.parse(permissions);
      } catch (error) {
        return this.defaultPermissions(this.normalizeRole(role));
      }
    }

    return this.defaultPermissions(this.normalizeRole(role));
  }

  defaultPermissions(role) {
    const map = {
      admin: ["search", "stock", "receipt", "issue", "move", "audit", "reports", "manage", "settings", "request_create", "request_approve", "request_fulfill", "admin_panel", "import_export", "upload_media"],
      supervisor: ["search", "stock", "reports", "request_approve", "admin_panel"],
      keeper: ["search", "stock", "receipt", "issue", "move", "audit", "request_create", "request_fulfill", "upload_media"],
      auditor: ["search", "stock", "audit", "reports"]
    };

    return map[role] || [];
  }
}
