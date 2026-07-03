export class TelegramGateway {
  constructor({ botToken, telegramApiBase }) {
    this.botToken = botToken;
    this.telegramApiBase = telegramApiBase;
  }

  async sendMessage(chatId, text, extra = {}) {
    if (!this.botToken) {
      return { skipped: true, reason: "BOT_TOKEN is not configured", chatId, text, extra };
    }

    const response = await fetch(`${this.telegramApiBase}/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, ...extra })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API error: ${response.status} ${body}`);
    }

    return response.json();
  }

  async answerCallbackQuery(callbackQueryId) {
    if (!this.botToken) {
      return { skipped: true, callbackQueryId };
    }

    const response = await fetch(`${this.telegramApiBase}/bot${this.botToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API error: ${response.status} ${body}`);
    }

    return response.json();
  }

  async getUpdates({ offset, timeout = 25 } = {}) {
    if (!this.botToken) {
      return { ok: true, result: [] };
    }

    const response = await fetch(`${this.telegramApiBase}/bot${this.botToken}/getUpdates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offset,
        timeout,
        allowed_updates: ["message", "callback_query"]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API error: ${response.status} ${body}`);
    }

    return response.json();
  }

  async deleteWebhook({ dropPendingUpdates = false } = {}) {
    if (!this.botToken) {
      return { ok: true };
    }

    const response = await fetch(`${this.telegramApiBase}/bot${this.botToken}/deleteWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drop_pending_updates: dropPendingUpdates })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API error: ${response.status} ${body}`);
    }

    return response.json();
  }

  async setWebhook({ url, secretToken = "", allowedUpdates = ["message", "callback_query"], dropPendingUpdates = false } = {}) {
    if (!this.botToken) {
      return { ok: true };
    }

    const response = await fetch(`${this.telegramApiBase}/bot${this.botToken}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        secret_token: secretToken || undefined,
        allowed_updates: allowedUpdates,
        drop_pending_updates: dropPendingUpdates
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API error: ${response.status} ${body}`);
    }

    return response.json();
  }

  async getWebhookInfo() {
    if (!this.botToken) {
      return { ok: true, result: null };
    }

    const response = await fetch(`${this.telegramApiBase}/bot${this.botToken}/getWebhookInfo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API error: ${response.status} ${body}`);
    }

    return response.json();
  }

  async getFile(fileId) {
    if (!this.botToken) {
      return { ok: false, result: null };
    }

    const response = await fetch(`${this.telegramApiBase}/bot${this.botToken}/getFile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API error: ${response.status} ${body}`);
    }

    return response.json();
  }

  async downloadFile(filePath) {
    if (!this.botToken) {
      return Buffer.from([]);
    }

    const response = await fetch(`${this.telegramApiBase}/file/bot${this.botToken}/${filePath}`);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram file download error: ${response.status} ${body}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }
}
