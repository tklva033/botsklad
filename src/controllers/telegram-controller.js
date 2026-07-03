import { readJsonBody, sendJson } from "../utils/http.js";
import { HttpError } from "../middlewares/http-error.js";

export class TelegramController {
  constructor(telegramBotService, options = {}) {
    this.telegramBotService = telegramBotService;
    this.webhookSecret = options.webhookSecret || "";
  }

  async webhook(req, res) {
    if (this.webhookSecret) {
      const receivedSecret = req.headers["x-telegram-bot-api-secret-token"];
      if (receivedSecret !== this.webhookSecret) {
        throw new HttpError(403, "Invalid Telegram webhook secret");
      }
    }

    const body = await readJsonBody(req);
    const replies = await this.telegramBotService.processUpdate(body);
    sendJson(res, 200, { ok: true, replies });
  }
}
