import { readJsonBody, sendJson } from "../utils/http.js";

export class ReportController {
  constructor({ reportService, importExportService, backgroundJobService }) {
    this.reportService = reportService;
    this.importExportService = importExportService;
    this.backgroundJobService = backgroundJobService;
  }

  async analytics(_req, res, url) {
    sendJson(res, 200, await this.reportService.getAnalytics(readFilters(url)));
  }

  async exportXlsx(_req, res, url) {
    const buffer = await this.reportService.exportAnalyticsXlsx(readFilters(url));
    res.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="bot-sklad-report.xlsx"',
      "Content-Length": buffer.length
    });
    res.end(buffer);
  }

  async exportPdf(_req, res, url) {
    const buffer = await this.reportService.exportAnalyticsPdf(readFilters(url));
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="bot-sklad-report.pdf"',
      "Content-Length": buffer.length
    });
    res.end(buffer);
  }

  async importExcel(req, res) {
    const body = await readJsonBody(req);
    sendJson(res, 200, await this.importExportService.importProductsWorkbook(body));
  }

  async validateImportExcel(req, res) {
    const body = await readJsonBody(req);
    sendJson(res, 200, await this.importExportService.validateProductsWorkbook(body));
  }

  async confirmImportExcel(req, res) {
    const body = await readJsonBody(req);
    sendJson(res, 200, await this.importExportService.confirmProductsWorkbook(body));
  }

  async importRevisionFiles(req, res) {
    const body = await readJsonBody(req);
    const files = Array.isArray(body.files) ? body.files : [];
    sendJson(res, 200, await this.importExportService.importRevisionWorkbooks({
      actorId: body.actorId || null,
      files: files.map((file, index) => ({
        name: file.name || `revision-${index + 1}.xlsx`,
        sourceLabel: file.name || `revision-${index + 1}.xlsx`,
        buffer: Buffer.from(String(file.base64Data || ""), "base64")
      }))
    }));
  }

  async enqueueJob(req, res) {
    const body = await readJsonBody(req);
    sendJson(res, 202, await this.backgroundJobService.enqueue(body.jobType, body.payload || {}, body.runAt));
  }
}

function readFilters(url) {
  return {
    periodDays: Number(url.searchParams.get("periodDays") || 30),
    warehouseId: url.searchParams.get("warehouseId"),
    employeeId: url.searchParams.get("employeeId"),
    dateFrom: url.searchParams.get("dateFrom"),
    dateTo: url.searchParams.get("dateTo")
  };
}
