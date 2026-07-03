export class TelegramWebhookService {
  constructor({
    telegramGateway,
    publicBaseUrl,
    webhookPath = "/telegram/webhook",
    secretToken = ""
  }) {
    this.telegramGateway = telegramGateway;
    this.publicBaseUrl = publicBaseUrl;
    this.webhookPath = webhookPath;
    this.secretToken = secretToken;
  }

  async start() {
    if (!this.telegramGateway.botToken) {
      return;
    }

    if (!this.publicBaseUrl) {
      throw new Error("PUBLIC_BASE_URL is required when TELEGRAM_TRANSPORT=webhook");
    }

    const webhookUrl = `${this.publicBaseUrl}${this.webhookPath}`;
    await this.telegramGateway.setWebhook({
      url: webhookUrl,
      secretToken: this.secretToken,
      allowedUpdates: ["message", "callback_query"]
    });

    const webhookInfo = await this.telegramGateway.getWebhookInfo();
    console.log(`Telegram webhook configured: ${webhookInfo.result?.url || webhookUrl}`);
  }

  async stop() {
    return undefined;
  }
}
