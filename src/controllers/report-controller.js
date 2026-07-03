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
