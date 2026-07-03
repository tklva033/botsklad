import fs from "node:fs/promises";
import path from "node:path";
import { readJsonBody, sendJson } from "../utils/http.js";
import { HttpError } from "../middlewares/http-error.js";

export class MediaController {
  constructor({ mediaService, uploadsDir, reportsDir }) {
    this.mediaService = mediaService;
    this.uploadsDir = uploadsDir;
    this.reportsDir = reportsDir;
  }

  async uploadProductPhoto(req, res, productId) {
    const body = await readJsonBody(req);
    sendJson(res, 201, await this.mediaService.saveProductPhoto({ productId, ...body }));
  }

  async uploadPhotosBatch(req, res) {
    const body = await readJsonBody(req);
    sendJson(res, 201, await this.mediaService.saveProductPhotosBatch(body));
  }

  async uploadPhotosManifest(req, res) {
    const body = await readJsonBody(req);
    sendJson(res, 201, await this.mediaService.savePhotoManifest(body));
  }

  async serveUpload(_req, res, fileName) {
    const safeName = path.basename(fileName);
    const absolutePath = path.join(this.uploadsDir, safeName);
    try {
      await this.sendFile(res, absolutePath, safeName);
    } catch (error) {
      throw new HttpError(404, "File not found");
    }
  }

  async serveReportFile(_req, res, fileName) {
    const safeName = path.basename(fileName);
    const absolutePath = path.join(this.reportsDir, safeName);
    try {
      await this.sendFile(res, absolutePath, safeName);
    } catch (error) {
      throw new HttpError(404, "File not found");
    }
  }

  async sendFile(res, absolutePath, fileName) {
    const buffer = await fs.readFile(absolutePath);
    const ext = path.extname(fileName).toLowerCase();
    const mimeType =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".pdf"
            ? "application/pdf"
            : "image/jpeg";

    res.writeHead(200, {
      "Content-Type": mimeType,
      "Content-Length": buffer.length
    });
    res.end(buffer);
  }
}
