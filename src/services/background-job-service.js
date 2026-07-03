import fs from "node:fs/promises";
import path from "node:path";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/dates.js";

export class BackgroundJobService {
  constructor({ pool, jobRepository, notificationRepository, reportRepository, reportService, reportsDir, intervalMs = 30000 }) {
    this.pool = pool;
    this.jobRepository = jobRepository;
    this.notificationRepository = notificationRepository;
    this.reportRepository = reportRepository;
    this.reportService = reportService;
    this.reportsDir = reportsDir;
    this.intervalMs = intervalMs;
    this.timer = null;
  }

  async enqueue(jobType, payload = {}, runAt = nowIso()) {
    const createdAt = nowIso();
    const job = {
      id: createId("job"),
      jobType,
      payload,
      status: "pending",
      attempts: 0,
      runAt,
      createdAt,
      updatedAt: createdAt
    };

    await this.jobRepository.enqueue(job);
    return job;
  }

  start() {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.processPending().catch(() => {});
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processPending() {
    const jobs = await this.jobRepository.claimPending(10);

    for (const job of jobs) {
      try {
        await this.runJob(job);
        await this.jobRepository.markDone(job.id);
      } catch (error) {
        await this.jobRepository.markFailed(job.id, error instanceof Error ? error.message : "Unknown error");
      }
    }
  }

  async runJob(job) {
    const payload = job.payload || {};

    if (job.jobType === "low_stock_scan") {
      const rows = await this.reportRepository.getLowStockDetailed(payload.filters || payload);
      for (const item of rows) {
        await this.notificationRepository.create({
          id: createId("notif"),
          type: "scheduled_low_stock",
          severity: "warning",
          productId: item.id,
          warehouseId: null,
          cellId: null,
          message: `Плановая проверка: низкий остаток по ${item.name}`,
          payload: item,
          createdAt: nowIso()
        });
      }
      return;
    }

    if (job.jobType === "analytics_snapshot") {
      const summary = await this.reportRepository.getSummary(payload.filters || payload);
      await this.notificationRepository.create({
        id: createId("notif"),
        type: "analytics_snapshot_ready",
        severity: "info",
        productId: null,
        warehouseId: null,
        cellId: null,
        message: "Сформирован аналитический срез",
        payload: summary,
        createdAt: nowIso()
      });
      return;
    }

    if (job.jobType === "scheduled_pdf_report") {
      await fs.mkdir(this.reportsDir, { recursive: true });
      const fileName = `report-${Date.now()}.pdf`;
      const absolutePath = path.join(this.reportsDir, fileName);
      const pdfBuffer = await this.reportService.exportAnalyticsPdf(payload.filters || payload);
      await fs.writeFile(absolutePath, pdfBuffer);

      await this.notificationRepository.create({
        id: createId("notif"),
        type: "scheduled_pdf_report_ready",
        severity: "info",
        productId: null,
        warehouseId: null,
        cellId: null,
        message: "Регулярный PDF-отчет сформирован",
        payload: {
          filePath: absolutePath,
          publicPath: `/reports/files/${fileName}`,
          filters: payload.filters || payload,
          schedule: payload.schedule || null
        },
        createdAt: nowIso()
      });

      const nextRunAt = getNextRunAt(payload.schedule);
      if (nextRunAt) {
        await this.enqueue(job.jobType, payload, nextRunAt);
      }
    }
  }
}

function getNextRunAt(schedule) {
  if (!schedule?.frequency) {
    return null;
  }

  const nextDate = new Date();
  if (schedule.frequency === "daily") {
    nextDate.setDate(nextDate.getDate() + 1);
  } else if (schedule.frequency === "weekly") {
    nextDate.setDate(nextDate.getDate() + 7);
  } else {
    return null;
  }

  nextDate.setHours(Number(schedule.hour ?? 9), Number(schedule.minute ?? 0), 0, 0);
  return nextDate.toISOString();
}
