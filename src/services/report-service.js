import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as XLSX from "xlsx";

export class ReportService {
  constructor({ reportRepository }) {
    this.reportRepository = reportRepository;
  }

  async getAnalytics(filters = {}) {
    const normalized = normalizeFilters(filters);
    const [summary, topProducts, userActivity, lowStock, movementTimeline, warehouseSnapshot, categoryTurnover, requestSummary] = await Promise.all([
      this.reportRepository.getSummary(normalized),
      this.reportRepository.getTopProducts(normalized, 10),
      this.reportRepository.getUserActivity(normalized),
      this.reportRepository.getLowStockDetailed(normalized),
      this.reportRepository.getMovementTimeline(normalized),
      this.reportRepository.getWarehouseSnapshot(normalized),
      this.reportRepository.getCategoryTurnover(normalized),
      this.reportRepository.getRequestSummary(normalized)
    ]);

    return {
      filters: normalized,
      summary,
      topProducts,
      userActivity,
      lowStock,
      movementTimeline,
      warehouseSnapshot,
      categoryTurnover,
      requestSummary
    };
  }

  async exportAnalyticsXlsx(filters = {}) {
    const analytics = await this.getAnalytics(filters);
    const workbook = XLSX.utils.book_new();

    const summaryRows = Object.entries(analytics.summary).map(([metric, value]) => ({
      metric,
      value
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), "Summary");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(analytics.topProducts), "TopProducts");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(analytics.userActivity), "UserActivity");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(analytics.lowStock), "LowStock");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(analytics.movementTimeline), "Timeline");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(analytics.warehouseSnapshot), "Warehouses");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(analytics.categoryTurnover), "Categories");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([analytics.requestSummary]), "Requests");

    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  }

  async exportAnalyticsPdf(filters = {}) {
    const analytics = await this.getAnalytics(filters);
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    let y = 800;

    page.drawText(`Bot Sklad Report (${analytics.filters.periodDays} days)`, {
      x: 40,
      y,
      size: 18,
      font,
      color: rgb(0.1, 0.1, 0.1)
    });
    y -= 30;

    for (const [key, value] of Object.entries(analytics.summary)) {
      page.drawText(`${key}: ${value}`, { x: 40, y, size: 12, font });
      y -= 18;
    }

    y -= 12;
    page.drawText("Top products:", { x: 40, y, size: 14, font });
    y -= 20;
    for (const item of analytics.topProducts.slice(0, 8)) {
      page.drawText(`${item.name} (${item.sku}) - ${item.total}`, { x: 50, y, size: 11, font });
      y -= 16;
    }

    y -= 10;
    page.drawText("Top employees:", { x: 40, y, size: 14, font });
    y -= 20;
    for (const item of analytics.userActivity.slice(0, 6)) {
      page.drawText(`${item.fullName} - ${item.actions}`, { x: 50, y, size: 11, font });
      y -= 16;
    }

    return Buffer.from(await pdfDoc.save());
  }
}

function normalizeFilters(filters = {}) {
  return {
    periodDays: Number(filters.periodDays || 30),
    warehouseId: filters.warehouseId || null,
    employeeId: filters.employeeId || null,
    dateFrom: filters.dateFrom || null,
    dateTo: filters.dateTo || null
  };
}
