import { methodNotAllowed, notFound } from "./utils.js";
import { getErrorPayload } from "./middlewares/http-error.js";

export function createRouter({
  authController,
  inventoryController,
  telegramController,
  requestController,
  reportController,
  mediaController,
  adminController,
  telegramWebhookPath = "/telegram/webhook"
}) {
  return async function route(req, res) {
    try {
      const url = new URL(req.url, "http://localhost");

      if (req.method === "GET" && url.pathname === "/health") {
        await inventoryController.health(req, res);
        return;
      }

      if (req.method === "GET" && url.pathname === "/stats") {
        await inventoryController.stats(req, res);
        return;
      }

      if (req.method === "GET" && url.pathname === "/products") {
        await inventoryController.products(req, res, url);
        return;
      }

      if (req.method === "GET" && /^\/products\/[^/]+\/history$/.test(url.pathname)) {
        const parts = url.pathname.split("/");
        await inventoryController.productHistory(req, res, parts[2]);
        return;
      }

      if (req.method === "POST" && /^\/products\/[^/]+\/photo$/.test(url.pathname)) {
        const parts = url.pathname.split("/");
        await mediaController.uploadProductPhoto(req, res, parts[2]);
        return;
      }

      if (req.method === "GET" && url.pathname === "/inventory/low-stock") {
        await inventoryController.lowStock(req, res);
        return;
      }

      if (req.method === "GET" && url.pathname === "/requests") {
        await requestController.list(req, res, url);
        return;
      }

      if (req.method === "POST" && url.pathname === "/requests") {
        await requestController.create(req, res);
        return;
      }

      if (req.method === "POST" && /^\/requests\/[^/]+\/approve$/.test(url.pathname)) {
        const parts = url.pathname.split("/");
        await requestController.approve(req, res, parts[2]);
        return;
      }

      if (req.method === "POST" && /^\/requests\/[^/]+\/reject$/.test(url.pathname)) {
        const parts = url.pathname.split("/");
        await requestController.reject(req, res, parts[2]);
        return;
      }

      if (req.method === "POST" && /^\/requests\/[^/]+\/fulfill$/.test(url.pathname)) {
        const parts = url.pathname.split("/");
        await requestController.fulfill(req, res, parts[2]);
        return;
      }

      if (req.method === "GET" && url.pathname === "/reports/analytics") {
        await reportController.analytics(req, res, url);
        return;
      }

      if (req.method === "GET" && url.pathname === "/reports/export.xlsx") {
        await reportController.exportXlsx(req, res, url);
        return;
      }

      if (req.method === "GET" && url.pathname === "/reports/export.pdf") {
        await reportController.exportPdf(req, res, url);
        return;
      }

      if (req.method === "POST" && url.pathname === "/reports/import-excel") {
        await reportController.importExcel(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/reports/import-excel/validate") {
        await reportController.validateImportExcel(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/reports/import-excel/confirm") {
        await reportController.confirmImportExcel(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/reports/import-revisions") {
        await reportController.importRevisionFiles(req, res);
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/reports/files/")) {
        const fileName = decodeURIComponent(url.pathname.slice("/reports/files/".length));
        await mediaController.serveReportFile(req, res, fileName);
        return;
      }

      if (req.method === "POST" && url.pathname === "/jobs") {
        await reportController.enqueueJob(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/products/photos/batch") {
        await mediaController.uploadPhotosBatch(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/products/photos/manifest") {
        await mediaController.uploadPhotosManifest(req, res);
        return;
      }

      if (req.method === "GET" && url.pathname === "/admin") {
        await adminController.page(req, res);
        return;
      }

      if (req.method === "GET" && url.pathname === "/admin/api/dashboard") {
        await adminController.dashboard(req, res, url);
        return;
      }

      if (req.method === "POST" && url.pathname === "/admin/api/import/validate") {
        await adminController.validateImport(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/admin/api/import/confirm") {
        await adminController.confirmImport(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/admin/api/photos/batch") {
        await adminController.uploadPhotosBatch(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/admin/api/photos/manifest") {
        await adminController.uploadPhotoManifest(req, res);
        return;
      }

      if (req.method === "GET" && url.pathname === "/admin/api/photos") {
        await adminController.listPhotos(req, res, url);
        return;
      }

      if (req.method === "POST" && /^\/admin\/api\/photos\/[^/]+\/primary$/.test(url.pathname)) {
        const parts = url.pathname.split("/");
        await adminController.setPrimaryPhoto(req, res, parts[4]);
        return;
      }

      if (req.method === "DELETE" && /^\/admin\/api\/photos\/[^/]+$/.test(url.pathname)) {
        const parts = url.pathname.split("/");
        await adminController.deletePhoto(req, res, parts[4]);
        return;
      }

      if (req.method === "POST" && url.pathname === "/admin/api/reports/schedule") {
        await adminController.scheduleReport(req, res);
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/uploads/")) {
        const fileName = decodeURIComponent(url.pathname.slice("/uploads/".length));
        await mediaController.serveUpload(req, res, fileName);
        return;
      }

      if (req.method === "POST" && url.pathname === "/auth/login") {
        await authController.login(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/operations/receipt") {
        await inventoryController.receipt(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/operations/issue") {
        await inventoryController.issue(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/operations/move") {
        await inventoryController.move(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/audits/count") {
        await inventoryController.audit(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === telegramWebhookPath) {
        await telegramController.webhook(req, res);
        return;
      }

      if (url.pathname.startsWith("/")) {
        const knownPaths = [
          "/health",
          "/stats",
          "/products",
          "/inventory/low-stock",
          "/requests",
          "/reports/analytics",
          "/reports/export.xlsx",
          "/reports/export.pdf",
          "/reports/import-excel",
          "/reports/import-excel/validate",
          "/reports/import-excel/confirm",
          "/products/photos/batch",
          "/products/photos/manifest",
          "/jobs",
          "/admin",
          "/admin/api/dashboard",
          "/admin/api/import/validate",
          "/admin/api/import/confirm",
          "/admin/api/photos/batch",
          "/admin/api/photos/manifest",
          "/admin/api/photos",
          "/admin/api/reports/schedule",
          "/auth/login",
          "/operations/receipt",
          "/operations/issue",
          "/operations/move",
          "/audits/count",
          telegramWebhookPath
        ];

        if (knownPaths.includes(url.pathname)) {
          methodNotAllowed(res);
          return;
        }
      }

      notFound(res);
    } catch (error) {
      const payload = getErrorPayload(error);
      res.writeHead(payload.statusCode, {
        "Content-Type": "application/json; charset=utf-8"
      });
      res.end(JSON.stringify(payload.body, null, 2));
    }
  };
}
