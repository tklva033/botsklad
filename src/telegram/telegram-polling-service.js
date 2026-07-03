export class TelegramPollingService {
  constructor({ telegramGateway, telegramBotService, timeoutSec = 25 }) {
    this.telegramGateway = telegramGateway;
    this.telegramBotService = telegramBotService;
    this.timeoutSec = timeoutSec;
    this.offset = 0;
    this.running = false;
    this.loopPromise = null;
  }

  async start() {
    if (this.running || !this.telegramGateway.botToken) {
      return;
    }

    await this.telegramGateway.deleteWebhook({ dropPendingUpdates: false });
    this.running = true;
    this.loopPromise = this.pollLoop();
  }

  async stop() {
    this.running = false;
    await this.loopPromise?.catch(() => undefined);
    this.loopPromise = null;
  }

  async pollLoop() {
    while (this.running) {
      try {
        const response = await this.telegramGateway.getUpdates({
          offset: this.offset,
          timeout: this.timeoutSec
        });

        for (const update of response.result || []) {
          this.offset = Number(update.update_id) + 1;
          await this.telegramBotService.processUpdate(update);
        }
      } catch (error) {
        console.error("Telegram polling error:", error instanceof Error ? error.message : error);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }
}
