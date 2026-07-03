import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../middlewares/http-error.js";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/dates.js";
import { withTransaction } from "../database/postgres.js";

export class MediaService {
  constructor({ uploadsDir, mediaRepository, auditLogRepository }) {
    this.uploadsDir = uploadsDir;
    this.mediaRepository = mediaRepository;
    this.auditLogRepository = auditLogRepository;
  }

  async ensureUploadsDir() {
    await fs.mkdir(this.uploadsDir, { recursive: true });
  }

  async saveProductPhoto({ productId, fileName, mimeType, base64Data, createdBy }) {
    const resolvedProductId = await this.resolveProductId({ productId });
    if (!base64Data) {
      throw new HttpError(400, "Photo data is required");
    }

    await this.ensureUploadsDir();

    const extension = inferExtension(mimeType, fileName);
    const safeFileName = `${resolvedProductId}-${Date.now()}${extension}`;
    const absolutePath = path.join(this.uploadsDir, safeFileName);
    const buffer = Buffer.from(base64Data, "base64");
    await fs.writeFile(absolutePath, buffer);

    const photo = {
      id: createId("photo"),
      productId: resolvedProductId,
      fileName: fileName || safeFileName,
      filePath: `/uploads/${safeFileName}`,
      mimeType: mimeType || "image/jpeg",
      fileSize: buffer.length,
      createdBy,
      createdAt: nowIso()
    };

    await this.mediaRepository.upsertPrimaryPhoto(photo);
    await this.auditLogRepository.log({
      id: createId("ulog"),
      userId: createdBy || null,
      actionType: "product_photo_upload",
      entityType: "product",
      entityId: resolvedProductId,
      oldValue: null,
      newValue: {
        fileName: photo.fileName,
        filePath: photo.filePath
      },
      createdAt: photo.createdAt
    });

    return photo;
  }

  async saveProductPhotoFromUrl({ productId, sku, sourceUrl, fileName, mimeType, createdBy }) {
    const resolvedProductId = await this.resolveProductId({ productId, sku });
    if (!sourceUrl) {
      throw new HttpError(400, "Photo URL is required");
    }

    const photo = {
      id: createId("photo"),
      productId: resolvedProductId,
      fileName: fileName || path.basename(new URL(sourceUrl).pathname || `${resolvedProductId}.jpg`) || `${resolvedProductId}.jpg`,
      filePath: sourceUrl,
      mimeType: mimeType || inferMimeTypeFromUrl(sourceUrl),
      fileSize: 0,
      createdBy,
      createdAt: nowIso()
    };

    await this.mediaRepository.upsertPrimaryPhoto(photo);
    await this.auditLogRepository.log({
      id: createId("ulog"),
      userId: createdBy || null,
      actionType: "product_photo_link",
      entityType: "product",
      entityId: resolvedProductId,
      oldValue: null,
      newValue: {
        fileName: photo.fileName,
        filePath: photo.filePath
      },
      createdAt: photo.createdAt
    });

    return photo;
  }

  async getPrimaryPhoto(productId) {
    return this.mediaRepository.getPrimaryPhoto(productId);
  }

  async listProductPhotos({ productId, sku }) {
    const resolvedProductId = await this.resolveProductId({ productId, sku });
    return this.mediaRepository.listProductPhotos(resolvedProductId);
  }

  async setPrimaryPhoto({ photoId, actorId }) {
    const photo = await this.mediaRepository.setPrimaryPhoto(photoId);
    if (!photo) {
      throw new HttpError(404, "Photo not found");
    }

    await this.auditLogRepository.log({
      id: createId("ulog"),
      userId: actorId || null,
      actionType: "product_photo_set_primary",
      entityType: "product_photo",
      entityId: photoId,
      oldValue: null,
      newValue: { productId: photo.productId },
      createdAt: nowIso()
    });

    return photo;
  }

  async deletePhoto({ photoId, actorId }) {
    const photo = await withTransaction(this.mediaRepository.pool, async (db) => {
      return this.mediaRepository.deletePhoto(photoId, db);
    });

    if (!photo) {
      throw new HttpError(404, "Photo not found");
    }

    if (photo.filePath?.startsWith("/uploads/")) {
      const safeName = path.basename(photo.filePath);
      await fs.rm(path.join(this.uploadsDir, safeName), { force: true });
    }

    await this.auditLogRepository.log({
      id: createId("ulog"),
      userId: actorId || null,
      actionType: "product_photo_delete",
      entityType: "product_photo",
      entityId: photoId,
      oldValue: {
        productId: photo.productId,
        filePath: photo.filePath
      },
      newValue: null,
      createdAt: nowIso()
    });

    return photo;
  }

  async saveProductPhotosBatch({ items = [], createdBy }) {
    const uploaded = [];
    const errors = [];
    let index = 1;

    for (const item of items) {
      try {
        uploaded.push(
          item.sourceUrl
            ? await this.saveProductPhotoFromUrl({
                productId: item.productId,
                sku: item.sku,
                sourceUrl: item.sourceUrl,
                fileName: item.fileName,
                mimeType: item.mimeType,
                createdBy: item.createdBy || createdBy || null
              })
            : await this.saveProductPhoto({
                productId: item.productId,
                fileName: item.fileName,
                mimeType: item.mimeType,
                base64Data: item.base64Data,
                createdBy: item.createdBy || createdBy || null
              })
        );
      } catch (error) {
        errors.push({
          item: index,
          productId: item.productId || null,
          message: error instanceof Error ? error.message : "Unknown upload error"
        });
      }
      index += 1;
    }

    return {
      uploadedCount: uploaded.length,
      uploaded,
      errorCount: errors.length,
      errors
    };
  }

  async savePhotoManifest({ manifestText = "", createdBy }) {
    const items = manifestText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const [sku, sourceUrl] = line.split("|").map((item) => item.trim());
        return {
          line: index + 1,
          sku,
          sourceUrl
        };
      });

    return this.saveProductPhotosBatch({
      createdBy,
      items
    });
  }

  async resolveProductId({ productId, sku }) {
    if (productId) {
      return productId;
    }

    if (sku) {
      const product = await this.mediaRepository.findProductBySku(sku);
      if (!product) {
        throw new HttpError(404, `Product with SKU ${sku} was not found`);
      }
      return product.id;
    }

    throw new HttpError(400, "Product id or SKU is required");
  }
}

function inferExtension(mimeType, fileName = "") {
  const ext = path.extname(fileName);
  if (ext) {
    return ext;
  }

  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp"
  };

  return map[mimeType] || ".bin";
}

function inferMimeTypeFromUrl(sourceUrl) {
  const pathname = new URL(sourceUrl).pathname.toLowerCase();
  if (pathname.endsWith(".png")) {
    return "image/png";
  }
  if (pathname.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/jpeg";
}
