export class MediaRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findProductBySku(sku, db = this.pool) {
    const result = await db.query(
      `
        SELECT
          id,
          sku,
          name
        FROM products
        WHERE sku = $1
        LIMIT 1
      `,
      [sku]
    );

    return result.rows[0] || null;
  }

  async upsertPrimaryPhoto(photo, db = this.pool) {
    await db.query(`UPDATE product_photos SET is_primary = FALSE WHERE product_id = $1`, [photo.productId]);
    await db.query(
      `
        INSERT INTO product_photos (
          id, product_id, file_name, file_path, mime_type, file_size, is_primary, created_by, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [
        photo.id,
        photo.productId,
        photo.fileName,
        photo.filePath,
        photo.mimeType,
        photo.fileSize,
        true,
        photo.createdBy || null,
        photo.createdAt
      ]
    );
  }

  async listProductPhotos(productId, db = this.pool) {
    const result = await db.query(
      `
        SELECT
          id,
          product_id AS "productId",
          file_name AS "fileName",
          file_path AS "filePath",
          mime_type AS "mimeType",
          file_size AS "fileSize",
          is_primary AS "isPrimary",
          created_by AS "createdBy",
          created_at AS "createdAt"
        FROM product_photos
        WHERE product_id = $1
        ORDER BY is_primary DESC, created_at DESC
      `,
      [productId]
    );

    return result.rows;
  }

  async findPhotoById(photoId, db = this.pool) {
    const result = await db.query(
      `
        SELECT
          id,
          product_id AS "productId",
          file_name AS "fileName",
          file_path AS "filePath",
          mime_type AS "mimeType",
          file_size AS "fileSize",
          is_primary AS "isPrimary",
          created_by AS "createdBy",
          created_at AS "createdAt"
        FROM product_photos
        WHERE id = $1
        LIMIT 1
      `,
      [photoId]
    );

    return result.rows[0] || null;
  }

  async setPrimaryPhoto(photoId, db = this.pool) {
    const photo = await this.findPhotoById(photoId, db);
    if (!photo) {
      return null;
    }

    await db.query(`UPDATE product_photos SET is_primary = FALSE WHERE product_id = $1`, [photo.productId]);
    await db.query(`UPDATE product_photos SET is_primary = TRUE WHERE id = $1`, [photoId]);
    return this.findPhotoById(photoId, db);
  }

  async deletePhoto(photoId, db = this.pool) {
    const photo = await this.findPhotoById(photoId, db);
    if (!photo) {
      return null;
    }

    await db.query(`DELETE FROM product_photos WHERE id = $1`, [photoId]);

    const remaining = await db.query(
      `
        SELECT id
        FROM product_photos
        WHERE product_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [photo.productId]
    );

    if (photo.isPrimary && remaining.rows[0]?.id) {
      await this.setPrimaryPhoto(remaining.rows[0].id, db);
    }

    return photo;
  }

  async getPrimaryPhoto(productId) {
    const result = await this.pool.query(
      `
        SELECT
          id,
          product_id AS "productId",
          file_name AS "fileName",
          file_path AS "filePath",
          mime_type AS "mimeType",
          file_size AS "fileSize",
          created_by AS "createdBy",
          created_at AS "createdAt"
        FROM product_photos
        WHERE product_id = $1 AND is_primary = TRUE
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [productId]
    );

    return result.rows[0] || null;
  }
}
